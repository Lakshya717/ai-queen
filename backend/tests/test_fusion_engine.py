"""
Tests for Multimodal Fusion Engine.
Verifies stable configured weights, missing modality handling, time-weighted video
aggregation, and verdict thresholding.
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
        # weights: 0.30, 0.70, 0.0, 0.0 -> total 1.0
        # expected: 0.30*0.80 + 0.70*0.60 = 0.24 + 0.42 = 0.66
        score, conf = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.66, places=2)

    def test_missing_active_modality_uses_neutral_score_without_weight_promotion(self):
        records = [
            CollectedScoreRecord(component_name="vis", modality="visual", score=0.90, status="SUCCESS"),
            CollectedScoreRecord(component_name="txt", modality="text", score=None, status="SKIPPED"),
            CollectedScoreRecord(component_name="temp", modality="temporal", score=None, status="FAILED"),
            CollectedScoreRecord(component_name="aud", modality="audio", score=0.30, status="SUCCESS"),
        ]
        # Text remains 70% of the configured policy and contributes neutral
        # uncertainty instead of promoting visual to 100%.
        score, _ = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.62, places=2)

    def test_zero_weight_modalities_do_not_affect_fusion(self):
        records = [
            CollectedScoreRecord(component_name="vis", modality="visual", score=0.90, status="SUCCESS"),
            CollectedScoreRecord(component_name="temp", modality="temporal", score=0.10, status="SUCCESS"),
            CollectedScoreRecord(component_name="aud", modality="audio", score=0.10, status="SUCCESS"),
        ]
        score, _ = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.62, places=2)

    def test_fuse_single_modality(self):
        records = [
            CollectedScoreRecord(component_name="vis", modality="visual", score=0.75, status="SUCCESS"),
        ]
        score, _ = self.fusion.fuse_records(records)
        self.assertAlmostEqual(score, 0.575, places=2)

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
