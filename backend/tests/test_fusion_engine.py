"""
Tests for Multimodal Fusion Engine.
Verifies dynamic weight normalization, missing modality fallback, time-weighted video aggregation,
and verdict thresholding.
"""

from django.test import TestCase
from apps.content.models import Video, VideoSegment
from apps.content.inference.base_connector import CollectedScoreRecord
from apps.content.inference.fusion import FusionEngine, DEFAULT_MODALITY_WEIGHTS


class FusionEngineTestCase(TestCase):
    def setUp(self):
        self.fusion = FusionEngine()
        self.video = Video.objects.create(
            video_id="fuseTestVid",
            duration_seconds=60.0,
            segment_duration_seconds=30,
            status="partial",
        )
        self.seg0 = VideoSegment.objects.create(
            video=self.video,
            segment_index=0,
            start_seconds=0.0,
            end_seconds=30.0,
            coverage_status="complete",
        )
        self.seg1 = VideoSegment.objects.create(
            video=self.video,
            segment_index=1,
            start_seconds=30.0,
            end_seconds=60.0,
            coverage_status="complete",
        )

    def test_fuse_all_modalities(self):
        records = [
            CollectedScoreRecord(component_name="vis", modality="visual", score=0.80, status="SUCCESS"),
            CollectedScoreRecord(component_name="txt", modality="text", score=0.60, status="SUCCESS"),
            CollectedScoreRecord(component_name="temp", modality="temporal", score=0.40, status="SUCCESS"),
            CollectedScoreRecord(component_name="aud", modality="audio", score=0.50, status="SUCCESS"),
        ]
        # weights: 0.50, 0.30, 0.10, 0.10 -> total 1.0
        # expected: 0.50*0.80 + 0.30*0.60 + 0.10*0.40 + 0.10*0.50 = 0.40 + 0.18 + 0.04 + 0.05 = 0.67
        score, conf = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.67, places=2)

    def test_fuse_with_skipped_and_failed_modalities(self):
        records = [
            CollectedScoreRecord(component_name="vis", modality="visual", score=0.90, status="SUCCESS"),
            CollectedScoreRecord(component_name="txt", modality="text", score=None, status="SKIPPED"),
            CollectedScoreRecord(component_name="temp", modality="temporal", score=None, status="FAILED"),
            CollectedScoreRecord(component_name="aud", modality="audio", score=0.30, status="SUCCESS"),
        ]
        # available: visual (0.50), audio (0.10) -> total 0.60
        # normalized: vis = 0.5/0.6 (~0.8333), aud = 0.1/0.6 (~0.1667)
        # expected: (0.5*0.90 + 0.1*0.30) / 0.60 = (0.45 + 0.03)/0.6 = 0.48 / 0.60 = 0.80
        score, _ = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.80, places=2)

    def test_fuse_single_modality(self):
        records = [
            CollectedScoreRecord(component_name="vis", modality="visual", score=0.75, status="SUCCESS"),
        ]
        score, _ = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.75, places=2)

    def test_fuse_empty_records(self):
        records = [
            CollectedScoreRecord(component_name="txt", modality="text", score=None, status="SKIPPED"),
        ]
        score, conf = self.fusion.fuse_records(records)
        self.assertIsNone(score)
        self.assertIsNone(conf)

    def test_aggregate_video_score_and_labels(self):
        # Segment 0 score = 0.80, Segment 1 score = 0.60
        self.seg0.ai_segment_score = 0.80
        self.seg0.save()
        self.seg1.ai_segment_score = 0.60
        self.seg1.save()

        # Both segments 30 seconds -> average = 0.70 -> AI_GENERATED
        self.fusion.aggregate_video_score(self.video)
        self.video.refresh_from_db()

        self.assertAlmostEqual(self.video.ai_reliance_score, 0.70, places=2)
        self.assertEqual(self.video.label, "AI_GENERATED")
        self.assertEqual(self.video.status, "complete")

    def test_verdict_thresholds(self):
        # Human made
        self.seg0.ai_segment_score = 0.20
        self.seg0.save()
        self.seg1.ai_segment_score = 0.20
        self.seg1.save()
        self.fusion.aggregate_video_score(self.video)
        self.video.refresh_from_db()
        self.assertEqual(self.video.label, "HUMAN_MADE")

        # Mixed
        self.seg0.ai_segment_score = 0.50
        self.seg0.save()
        self.seg1.ai_segment_score = 0.50
        self.seg1.save()
        self.fusion.aggregate_video_score(self.video)
        self.video.refresh_from_db()
        self.assertEqual(self.video.label, "MIXED")
