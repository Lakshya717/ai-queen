"""
Tests for Video Analysis Endpoint & Multi-Component Reporting.
Verifies GET /v1/content/youtube/<video_id>/analysis returns side-by-side component scores,
diagnostics, and strategy comparisons.
"""

from unittest.mock import patch
from django.test import override_settings
from rest_framework.test import APITestCase
from rest_framework import status
from apps.content.models import Video, VideoSegment, SegmentComponentScore


class VideoAnalysisEndpointTestCase(APITestCase):
    def setUp(self):
        self.video = Video.objects.create(
            video_id="analysisTestVid",
            duration_seconds=60.0,
            segment_duration_seconds=30,
            status="complete",
            label="AI_GENERATED",
            ai_reliance_score=0.82,
            confidence=0.88,
        )
        self.segment = VideoSegment.objects.create(
            video=self.video,
            segment_index=0,
            start_seconds=0.0,
            end_seconds=30.0,
            coverage_status="complete",
            ai_segment_score=0.82,
        )

        # Add visual component score
        SegmentComponentScore.objects.create(
            segment=self.segment,
            component_name="slopout_visual",
            modality="visual",
            score=0.80,
            confidence=0.85,
            status="SUCCESS",
            execution_time_ms=12.5,
            details={
                "mean_prob": 0.80,
                "max_prob": 0.95,
                "std_prob": 0.12,
                "peak_frame_timestamp": 15.2,
                "model_used": "trained_clip",
            },
        )

        # Add text component score
        SegmentComponentScore.objects.create(
            segment=self.segment,
            component_name="slopout_text",
            modality="text",
            score=0.88,
            confidence=0.85,
            status="SUCCESS",
            execution_time_ms=8.3,
            details={
                "chunks_count": 2,
                "per_chunk_scores": [0.86, 0.90],
                "total_words": 210,
            },
        )

        # Add temporal component score
        SegmentComponentScore.objects.create(
            segment=self.segment,
            component_name="temporal_consistency",
            modality="temporal",
            score=0.72,
            confidence=0.75,
            status="SUCCESS",
            execution_time_ms=5.1,
            details={
                "temporal_jitter_index": 0.68,
                "mean_abs_luminance_delta": 18.4,
            },
        )

        # Add audio component score (skipped)
        SegmentComponentScore.objects.create(
            segment=self.segment,
            component_name="audio_signal",
            modality="audio",
            score=None,
            confidence=0.60,
            status="SKIPPED",
            execution_time_ms=1.2,
            details={"reason": "No audio files present in segment"},
        )

    def test_analysis_endpoint_not_found(self):
        url = "/v1/content/youtube/nonExistent123/analysis"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("error", response.data)

    @patch("apps.content.views.InferenceDispatcher")
    def test_recalculate_endpoint_replays_with_default_weights(self, mock_dispatcher_cls):
        response = self.client.post(
            f"/v1/content/youtube/{self.video.video_id}/analysis/recalculate",
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_dispatcher_cls.return_value.dispatch_video.assert_called_once_with(self.video.video_id)

    def test_analysis_endpoint_returns_component_matrix(self):
        url = f"/v1/content/youtube/{self.video.video_id}/analysis"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.data
        self.assertEqual(data["videoId"], self.video.video_id)
        self.assertEqual(data["status"], "complete")
        self.assertEqual(data["label"], "AI_GENERATED")
        self.assertEqual(data["aiRelianceScore"], 0.82)

        # Segments breakdown
        self.assertEqual(len(data["segments"]), 1)
        seg0 = data["segments"][0]
        self.assertEqual(seg0["segmentIndex"], 0)
        self.assertEqual(seg0["aiSegmentScore"], 0.82)

        # Components
        comps = {c["componentName"]: c for c in seg0["components"]}
        self.assertIn("slopout_visual", comps)
        self.assertIn("slopout_text", comps)
        self.assertIn("temporal_consistency", comps)
        self.assertIn("audio_signal", comps)

        # Check visual details
        vis = comps["slopout_visual"]
        self.assertEqual(vis["status"], "SUCCESS")
        self.assertEqual(vis["score"], 0.80)
        self.assertEqual(vis["details"]["model_used"], "trained_clip")
        self.assertEqual(vis["details"]["peak_frame_timestamp"], 15.2)

        # Check audio skipped
        aud = comps["audio_signal"]
        self.assertEqual(aud["status"], "SKIPPED")
        self.assertIsNone(aud["score"])

        # Strategy comparison
        strat = data["strategyComparison"]
        self.assertIn("visual", strat["modalityAverages"])
        self.assertEqual(strat["modalityAverages"]["visual"], 0.80)
        self.assertIn("text", strat["modalityAverages"])
        self.assertEqual(strat["modalityAverages"]["text"], 0.88)
        self.assertEqual(strat["modalityWeights"]["visual"], 0.30)
        self.assertEqual(strat["totalEvaluations"], 3)  # 3 SUCCESS evaluations

    def test_lookup_endpoint_returns_component_summary_and_segment_components(self):
        url = f"/v1/content/youtube/{self.video.video_id}"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        data = response.data
        self.assertEqual(data["videoId"], self.video.video_id)
        self.assertIn("componentSummary", data)
        self.assertIsNotNone(data["componentSummary"])

        summary = data["componentSummary"]
        self.assertIn("visual", summary["modalityAverages"])
        self.assertEqual(summary["modalityAverages"]["visual"], 0.80)
        self.assertIn("text", summary["modalityAverages"])
        self.assertEqual(summary["modalityAverages"]["text"], 0.88)
        self.assertIn("slopout_visual", summary["componentsEvaluated"])
        self.assertEqual(summary["totalEvaluations"], 3)

        # Segments
        self.assertTrue(len(data["segments"]) >= 1)
        seg0 = data["segments"][0]
        self.assertEqual(seg0["aiSegmentScore"], 0.82)
        self.assertIn("components", seg0)
        self.assertEqual(len(seg0["components"]), 4)

    @patch("apps.content.views.InferenceDispatcher")
    def test_lookup_auto_triggers_analysis_when_coverage_meets_threshold(self, mock_dispatcher_cls):
        mock_dispatcher = mock_dispatcher_cls.return_value

        # 12 expected segments (360s / 30s)
        unscored_video = Video.objects.create(
            video_id="highCoverageVid",
            duration_seconds=360.0,
            segment_duration_seconds=30,
            status="partial",
            ai_reliance_score=None,
        )
        # Create 11 complete segments (11/12 = 91.67% >= 90% threshold)
        for i in range(11):
            VideoSegment.objects.create(
                video=unscored_video,
                segment_index=i,
                start_seconds=float(i * 30),
                end_seconds=float((i + 1) * 30),
                coverage_status="complete",
            )

        url = f"/v1/content/youtube/{unscored_video.video_id}"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Assert dispatch_video was triggered
        mock_dispatcher.dispatch_video.assert_called_once_with("highCoverageVid")

    @patch("apps.content.views.InferenceDispatcher")
    def test_lookup_does_not_trigger_analysis_when_coverage_below_threshold(self, mock_dispatcher_cls):
        mock_dispatcher = mock_dispatcher_cls.return_value

        # 12 expected segments, only 5 complete (5/12 = 41.67% < 90%)
        low_coverage_video = Video.objects.create(
            video_id="lowCoverageVid",
            duration_seconds=360.0,
            segment_duration_seconds=30,
            status="partial",
            ai_reliance_score=None,
        )
        for i in range(5):
            VideoSegment.objects.create(
                video=low_coverage_video,
                segment_index=i,
                start_seconds=float(i * 30),
                end_seconds=float((i + 1) * 30),
                coverage_status="complete",
            )

        url = f"/v1/content/youtube/{low_coverage_video.video_id}"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        mock_dispatcher.dispatch_video.assert_not_called()

    @patch("apps.content.views.InferenceDispatcher")
    def test_lookup_respects_custom_threshold_from_settings(self, mock_dispatcher_cls):
        mock_dispatcher = mock_dispatcher_cls.return_value

        custom_video = Video.objects.create(
            video_id="customThresholdVid",
            duration_seconds=300.0,
            segment_duration_seconds=30,
            status="partial",
            ai_reliance_score=None,
        )
        # 8 of 10 complete = 80.0%
        for i in range(8):
            VideoSegment.objects.create(
                video=custom_video,
                segment_index=i,
                start_seconds=float(i * 30),
                end_seconds=float((i + 1) * 30),
                coverage_status="complete",
            )

        # When threshold is 85%, 80% should NOT trigger
        with override_settings(ANALYSIS_COVERAGE_THRESHOLD_PERCENT=85.0):
            response = self.client.get(f"/v1/content/youtube/{custom_video.video_id}")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            mock_dispatcher.dispatch_video.assert_not_called()

        # When threshold is 75%, 80% SHOULD trigger
        with override_settings(ANALYSIS_COVERAGE_THRESHOLD_PERCENT=75.0):
            response = self.client.get(f"/v1/content/youtube/{custom_video.video_id}")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            mock_dispatcher.dispatch_video.assert_called_once_with("customThresholdVid")
