"""
Unit Tests for Manifest Builder Service.
"""

import tempfile
import shutil
import json
from pathlib import Path
from django.test import SimpleTestCase
from apps.content.services.manifest_builder import ManifestBuilder


class ManifestBuilderTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.builder = ManifestBuilder(media_root=Path(self.temp_dir))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_build_segment_manifest(self):
        video_id = "test_vid_manifest"
        seg_idx = 1
        seg_bounds = (30.0, 60.0)
        merged = [(30.0, 48.0)]
        frames = [
            {'video_timestamp_seconds': 35.0, 'file_path': 'frames/00035.000.jpg', 'width': 1280, 'height': 720},
            {'video_timestamp_seconds': 40.0, 'file_path': 'frames/00040.000.jpg', 'width': 1280, 'height': 720},
        ]
        audio = [
            {'start_seconds': 30.0, 'end_seconds': 48.0, 'file_path': 'audio/00030.000_00048.000.webm'}
        ]
        cues = [
            {'startSeconds': 10.0, 'endSeconds': 20.0, 'text': 'Outside cue'},
            {'startSeconds': 32.0, 'endSeconds': 38.0, 'text': 'Inside segment cue'},
        ]

        manifest_path = self.builder.build_segment_manifest(
            video_id=video_id,
            segment_index=seg_idx,
            segment_bounds=seg_bounds,
            coverage_status='partial',
            merged_intervals=merged,
            frames=frames,
            audio_chunks=audio,
            transcript_cues=cues,
            transcript_hash='mock_hash_123',
        )

        self.assertTrue(manifest_path.exists())
        data = json.loads(manifest_path.read_text(encoding='utf-8'))

        self.assertEqual(data['video_id'], video_id)
        self.assertEqual(data['segment_index'], 1)
        self.assertEqual(data['coverage_status'], 'partial')
        self.assertEqual(len(data['frames']), 2)
        self.assertEqual(len(data['audio_chunks']), 1)
        # Verify cue filtering: only cues intersecting [30, 60) should be included
        self.assertEqual(len(data['segment_cues']), 1)
        self.assertEqual(data['segment_cues'][0]['text'], 'Inside segment cue')

        # Verify llm-input.md also exists
        llm_md = manifest_path.parent / 'llm-input.md'
        self.assertTrue(llm_md.exists())
        md_text = llm_md.read_text(encoding='utf-8')
        self.assertIn("Inside segment cue", md_text)
        self.assertIn("[Frame 35.0s]", md_text)
