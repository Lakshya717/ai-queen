"""
Tests for Hardcoded Component Connectors.
Verifies input preparation, component invocation, output collection, and skip handling.
"""

import tempfile
from pathlib import Path
from PIL import Image
from django.test import TestCase

from apps.content.inference.context import SegmentContext
from apps.content.inference.connectors import (
    SlopOutVisualConnector,
    SlopOutTextConnector,
    TemporalConsistencyConnector,
    AudioSignalConnector,
)


class ComponentConnectorsTestCase(TestCase):
    def setUp(self):
        import os
        os.environ["MOCK_INFERENCE_MODELS"] = "1"
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.media_root = Path(self.tmp_dir.name)

        # Create two test frames
        self.frame1_path = self.media_root / "frame_0.jpg"
        self.frame2_path = self.media_root / "frame_1.jpg"

        # Frame 1: uniform dark gray
        img1 = Image.new("RGB", (64, 64), color=(50, 50, 50))
        img1.save(self.frame1_path)

        # Frame 2: uniform light gray
        img2 = Image.new("RGB", (64, 64), color=(150, 150, 150))
        img2.save(self.frame2_path)

        # Create dummy audio file
        self.audio_path = self.media_root / "audio_0_30.webm"
        self.audio_path.write_bytes(b"\x1a\x45\xdf\xa3" + b"\x00" * 200)

    def tearDown(self):
        import os
        os.environ.pop("MOCK_INFERENCE_MODELS", None)
        self.tmp_dir.cleanup()

    def test_visual_connector_lifecycle(self):
        connector = SlopOutVisualConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="complete",
            frame_paths=(self.frame1_path, self.frame2_path),
            frame_timestamps=(0.0, 5.0),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SUCCESS")
        self.assertEqual(record.component_name, "slopout_visual")
        self.assertEqual(record.modality, "visual")
        self.assertIsNotNone(record.score)
        self.assertIn("per_frame", record.details)
        self.assertIn("mean_prob", record.details)
        self.assertIn("max_prob", record.details)
        self.assertIn("std_prob", record.details)
        self.assertEqual(len(record.details["per_frame"]), 2)
        self.assertEqual(record.details["per_frame"][0]["timestamp"], 0.0)

    def test_visual_connector_skips_when_no_frames(self):
        connector = SlopOutVisualConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="missing",
            frame_paths=(),
            frame_timestamps=(),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SKIPPED")
        self.assertIsNone(record.score)
        self.assertIn("reason", record.details)

    def test_text_connector_lifecycle(self):
        connector = SlopOutTextConnector()
        sample_transcript = (
            "Artificial intelligence is transforming content generation across the globe. "
            "In this video we demonstrate how machine learning classifiers evaluate multimodal signals. "
            "We inspect linguistic structure, word frequencies, and semantic coherence."
        )
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="complete",
            frame_paths=(),
            frame_timestamps=(),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=sample_transcript,
            transcript_cues=({"start": 0.0, "end": 10.0, "text": sample_transcript},),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SUCCESS")
        self.assertEqual(record.component_name, "slopout_text")
        self.assertEqual(record.modality, "text")
        self.assertIsNotNone(record.score)
        self.assertIn("chunks_count", record.details)
        self.assertIn("mean_chunk_score", record.details)
        self.assertGreaterEqual(record.details["chunks_count"], 1)

    def test_text_connector_skips_when_no_transcript(self):
        connector = SlopOutTextConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="complete",
            frame_paths=(),
            frame_timestamps=(),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SKIPPED")
        self.assertIsNone(record.score)

    def test_temporal_connector_lifecycle(self):
        connector = TemporalConsistencyConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="complete",
            frame_paths=(self.frame1_path, self.frame2_path),
            frame_timestamps=(0.0, 4.0),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SUCCESS")
        self.assertEqual(record.component_name, "temporal_consistency")
        self.assertEqual(record.modality, "temporal")
        self.assertIsNotNone(record.score)
        self.assertIn("mean_abs_luminance_delta", record.details)
        self.assertIn("temporal_jitter_index", record.details)
        self.assertIn("pair_metrics", record.details)
        self.assertEqual(record.details["frame_pairs_analyzed"], 1)

    def test_temporal_connector_skips_with_single_frame(self):
        connector = TemporalConsistencyConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="partial",
            frame_paths=(self.frame1_path,),
            frame_timestamps=(0.0,),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SKIPPED")
        self.assertIsNone(record.score)

    def test_audio_connector_lifecycle(self):
        connector = AudioSignalConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="complete",
            frame_paths=(),
            frame_timestamps=(),
            audio_paths=(self.audio_path,),
            audio_intervals=((0.0, 30.0),),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SUCCESS")
        self.assertEqual(record.component_name, "audio_signal")
        self.assertEqual(record.modality, "audio")
        self.assertIsNotNone(record.score)
        self.assertEqual(record.details["chunks_count"], 1)
        self.assertEqual(record.details["total_duration_seconds"], 30.0)

    def test_audio_connector_skips_when_no_audio(self):
        connector = AudioSignalConnector()
        context = SegmentContext(
            video_id="testVid",
            segment_index=0,
            segment_bounds=(0.0, 30.0),
            coverage_status="complete",
            frame_paths=(),
            frame_timestamps=(),
            audio_paths=(),
            audio_intervals=(),
            transcript_text=None,
            transcript_cues=(),
        )

        record = connector.run(context)
        self.assertEqual(record.status, "SKIPPED")
        self.assertIsNone(record.score)
