"""
Unit Tests for YouTube Transcript Service & Automated Server Fallback.
"""

import tempfile
import shutil
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from django.test import SimpleTestCase
from apps.content.services.youtube_transcript_service import YouTubeTranscriptService
from apps.content.services.transcript_service import TranscriptService, compute_transcript_content_hash


class MockSnippet:
    def __init__(self, start, duration, text):
        self.start = start
        self.duration = duration
        self.text = text


class YouTubeTranscriptServiceTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.media_root = Path(self.temp_dir)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_invalid_video_id_returns_none(self):
        self.assertIsNone(YouTubeTranscriptService.get_or_fetch_transcript("invalid", media_root=self.media_root))
        self.assertIsNone(YouTubeTranscriptService.get_or_fetch_transcript("", media_root=self.media_root))
        self.assertIsNone(YouTubeTranscriptService.get_or_fetch_transcript("too_long_video_id_12345", media_root=self.media_root))

    @patch('apps.content.services.youtube_transcript_service.YouTubeTranscriptService._fetch_via_youtube_transcript_api')
    def test_get_or_fetch_transcript_success(self, mock_fetch):
        mock_fetch.return_value = {
            'video_id': '38uv47uXz8I',
            'language': 'en',
            'scope': 'full',
            'is_generated': False,
            'segments': [
                {'startSeconds': 0.0, 'endSeconds': 4.5, 'start_seconds': 0.0, 'end_seconds': 4.5, 'text': 'Intro speech'},
                {'startSeconds': 4.5, 'endSeconds': 10.0, 'start_seconds': 4.5, 'end_seconds': 10.0, 'text': 'Second line'},
                {'startSeconds': 10.0, 'endSeconds': 15.0, 'start_seconds': 10.0, 'end_seconds': 15.0, 'text': 'Third line'},
                {'startSeconds': 15.0, 'endSeconds': 20.0, 'start_seconds': 15.0, 'end_seconds': 20.0, 'text': 'Fourth line'},
                {'startSeconds': 20.0, 'endSeconds': 25.0, 'start_seconds': 20.0, 'end_seconds': 25.0, 'text': 'Fifth line'},
            ]
        }

        res = YouTubeTranscriptService.get_or_fetch_transcript('38uv47uXz8I', media_root=self.media_root)
        self.assertIsNotNone(res)
        self.assertEqual(res['video_id'], '38uv47uXz8I')
        self.assertEqual(res['language'], 'en')
        self.assertEqual(res['scope'], 'full')
        self.assertEqual(len(res['segments']), 5)

        # Verify cached to disk
        cached_file = self.media_root / 'youtube' / '38uv47uXz8I' / 'transcripts' / 'transcript.json'
        self.assertTrue(cached_file.exists())

        # Second call reads from disk cache without calling fetch
        mock_fetch.reset_mock()
        cached_res = YouTubeTranscriptService.get_or_fetch_transcript('38uv47uXz8I', media_root=self.media_root)
        self.assertIsNotNone(cached_res)
        self.assertEqual(len(cached_res['segments']), 5)
        mock_fetch.assert_not_called()

    @patch('youtube_transcript_api.YouTubeTranscriptApi.list')
    def test_youtube_transcript_api_extraction_and_normalization(self, mock_list):
        mock_transcript = MagicMock()
        mock_transcript.is_generated = False
        mock_transcript.language_code = 'en'
        mock_transcript.fetch.return_value = [
            MockSnippet(0.0, 3.25, "  First normalized cue  "),
            MockSnippet(3.25, 4.1, "Second cue\nwith newline"),
        ]

        mock_transcript_list = MagicMock()
        mock_transcript_list.find_manually_created_transcript.return_value = mock_transcript
        mock_list.return_value = mock_transcript_list

        res = YouTubeTranscriptService._fetch_via_youtube_transcript_api('testVid0001', ['en'])
        self.assertIsNotNone(res)
        self.assertEqual(res['language'], 'en')
        cues = res['segments']
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0]['startSeconds'], 0.0)
        self.assertEqual(cues[0]['endSeconds'], 3.25)
        self.assertEqual(cues[0]['text'], 'First normalized cue')
        self.assertEqual(cues[1]['text'], 'Second cue with newline')

    @patch('apps.content.services.youtube_transcript_service.YouTubeTranscriptService.get_or_fetch_transcript')
    def test_transcript_service_server_fallback(self, mock_get_or_fetch):
        mock_get_or_fetch.return_value = {
            'video_id': 'vidFallback1',
            'language': 'hi',
            'scope': 'full',
            'is_generated': True,
            'segments': [
                {'startSeconds': 0.0, 'endSeconds': 5.0, 'text': 'Hindi caption'},
                {'startSeconds': 5.0, 'endSeconds': 10.0, 'text': 'Second caption'},
            ]
        }

        service = TranscriptService(media_root=self.media_root)

        # When client payload is empty or unavailable
        client_empty = {'scope': 'unavailable', 'segments': []}
        res = service.process_transcript('vidFallback1', client_empty, allow_server_fallback=True)

        self.assertIsNotNone(res)
        thash, scope, is_new, file_path = res
        self.assertEqual(len(thash), 64)
        self.assertEqual(scope, 'full')
        self.assertTrue(is_new)
        self.assertEqual(len(res.cues), 2)
        self.assertEqual(res.language, 'hi')
        self.assertTrue(file_path.exists())
