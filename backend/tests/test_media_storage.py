"""
Unit Tests for Media Storage Service.
"""

import base64
import tempfile
import shutil
from pathlib import Path
from django.test import SimpleTestCase
from apps.content.services.media_storage import (
    MediaStorageService,
    strip_base64_data_uri,
    sanitize_filename_part,
)


class MediaStorageTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.service = MediaStorageService(media_root=Path(self.temp_dir))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_strip_base64_data_uri(self):
        raw = "data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        stripped = strip_base64_data_uri(raw)
        self.assertEqual(stripped, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")

        plain = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        self.assertEqual(strip_base64_data_uri(plain), plain)

    def test_save_frames_decoding(self):
        # 1x1 transparent PNG / dummy JPEG data
        dummy_data = base64.b64encode(b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xFF\xDB").decode('ascii')
        frames_input = [
            {
                'videoTimestampSeconds': 35.0,
                'mimeType': 'image/jpeg',
                'data': f"data:image/jpeg;base64,{dummy_data}",
                'width': 1280,
                'height': 720,
            }
        ]

        saved = self.service.save_frames("testVideo123", 1, "contrib_abc", frames_input)
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['video_timestamp_seconds'], 35.0)
        self.assertEqual(saved[0]['filename'], "00035.000.jpg")

        saved_file = Path(self.temp_dir) / saved[0]['file_path']
        self.assertTrue(saved_file.exists())
        content = saved_file.read_bytes()
        self.assertTrue(content.startswith(b"\xFF\xD8\xFF"))

    def test_save_audio_chunks(self):
        dummy_audio = base64.b64encode(b"\x1A\x45\xDF\xA3WebM_AUDIO_BYTES").decode('ascii')
        audio_input = [
            {
                'startSeconds': 30.0,
                'endSeconds': 48.0,
                'alignmentDriftMs': 12,
                'mimeType': 'audio/webm;codecs=opus',
                'data': dummy_audio,
            }
        ]

        saved = self.service.save_audio_chunks("testVideo123", 1, "contrib_abc", audio_input)
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['start_seconds'], 30.0)
        self.assertEqual(saved[0]['end_seconds'], 48.0)
        self.assertEqual(saved[0]['filename'], "00030.000_00048.000.webm")

        saved_file = Path(self.temp_dir) / saved[0]['file_path']
        self.assertTrue(saved_file.exists())
        self.assertEqual(saved_file.read_bytes(), b"\x1A\x45\xDF\xA3WebM_AUDIO_BYTES")

    def test_save_audio_chunks_server_fallback(self):
        from unittest.mock import patch
        mock_slice = {
            'start_seconds': 0.0,
            'end_seconds': 30.0,
            'duration_seconds': 30.0,
            'alignment_drift_ms': 0,
            'file_path': 'youtube/testVid123/segments/seg_0/contrib_xyz/audio/00000.000_00030.000.webm',
            'filename': '00000.000_00030.000.webm',
            'size_bytes': 450000,
            'mime_type': 'audio/webm;codecs=opus',
        }

        with patch('apps.content.services.media_storage.YouTubeAudioService.slice_segment_audio', return_value=mock_slice) as mock_fn:
            saved = self.service.save_audio_chunks(
                video_id="Qp2zfpqogxU",
                segment_index=0,
                contribution_id="contrib_xyz",
                audio_data=[],
                observed_intervals=[(0.0, 30.0)]
            )
            self.assertEqual(len(saved), 1)
            self.assertEqual(saved[0]['duration_seconds'], 30.0)
            self.assertEqual(saved[0]['filename'], "00000.000_00030.000.webm")
            mock_fn.assert_called_once()

