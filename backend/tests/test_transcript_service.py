"""
Unit Tests for Transcript Deduplication Service.
"""

import tempfile
import shutil
import json
from pathlib import Path
from django.test import SimpleTestCase
from apps.content.services.transcript_service import (
    TranscriptService,
    compute_transcript_content_hash,
)


class TranscriptServiceTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.service = TranscriptService(media_root=Path(self.temp_dir))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_compute_transcript_content_hash(self):
        cues = [
            {'startSeconds': 0.0, 'endSeconds': 4.5, 'text': 'Hello world'},
            {'startSeconds': 4.5, 'endSeconds': 8.0, 'text': 'Second line'},
        ]
        h1 = compute_transcript_content_hash(cues)
        self.assertEqual(len(h1), 64)

        # Whitespace normalization
        cues_with_spaces = [
            {'startSeconds': 0.0, 'endSeconds': 4.5, 'text': '  Hello world  '},
            {'startSeconds': 4.5, 'endSeconds': 8.0, 'text': 'Second line'},
        ]
        h2 = compute_transcript_content_hash(cues_with_spaces)
        self.assertEqual(h1, h2)

    def test_transcript_deduplication(self):
        video_id = "vid_transcript_test"
        transcript_data = {
            'scope': 'full',
            'language': 'en',
            'segments': [
                {'startSeconds': 0.0, 'endSeconds': 4.5, 'text': 'Unique caption'},
            ],
        }

        # First ingestion
        res1 = self.service.process_transcript(video_id, transcript_data)
        self.assertIsNotNone(res1)
        thash1, scope1, is_new1, file_path1 = res1
        self.assertTrue(is_new1)
        self.assertTrue(file_path1.exists())

        # Second ingestion with same content
        res2 = self.service.process_transcript(video_id, transcript_data)
        self.assertIsNotNone(res2)
        thash2, scope2, is_new2, file_path2 = res2
        self.assertEqual(thash1, thash2)
        self.assertFalse(is_new2)  # Deduplicated!
