"""
Tests for Video Analysis Endpoint & Multi-Component Reporting.
Verifies GET /v1/content/youtube/<video_id>/analysis returns side-by-side component scores,
diagnostics, and strategy comparisons.
"""

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
        self.assertEqual(strat["totalEvaluations"], 3)  # 3 SUCCESS evaluations
