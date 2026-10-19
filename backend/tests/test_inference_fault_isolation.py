"""
Tests for Component Fault Isolation.
Verifies that runtime failures, crashes, and exceptions in one component do not affect
the execution of other components, database transactions, or overall system stability.
"""

import tempfile
import json
from pathlib import Path
from PIL import Image
from django.test import TestCase

from apps.content.models import Video, VideoSegment, SegmentComponentScore
from apps.content.inference.base_connector import BaseComponentConnector, CollectedScoreRecord
from apps.content.inference.context import SegmentContext
from apps.content.inference.dispatcher import InferenceDispatcher


class CrashingComponentConnector(BaseComponentConnector):
    name = "crashing_component"
    modality = "experimental"

    def prepare_input(self, context: SegmentContext):
        return {"data": "test"}

    def invoke_component(self, component_input):
        raise RuntimeError("Simulated fatal CUDA out-of-memory or division by zero in component")

    def collect_output(self, raw_output):
        return CollectedScoreRecord(
            component_name=self.name,
            modality=self.modality,
            score=0.5,
        )


class WorkingComponentConnector(BaseComponentConnector):
    name = "working_component"
    modality = "visual"

    def prepare_input(self, context: SegmentContext):
        return {"data": "test"}

    def invoke_component(self, component_input):
        return {"score": 0.85, "diagnostic": "all good"}

    def collect_output(self, raw_output):
        return CollectedScoreRecord(
            component_name=self.name,
            modality=self.modality,
            score=raw_output["score"],
            confidence=0.90,
            status="SUCCESS",
            details={"diagnostic": raw_output["diagnostic"]},
        )


class FaultIsolationTestCase(TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.media_root = Path(self.tmp_dir.name)

        # Create video and segment in DB
        self.video = Video.objects.create(
            video_id="crashTestVid",
            duration_seconds=30.0,
            status="partial",
        )
        self.segment = VideoSegment.objects.create(
            video=self.video,
            segment_index=0,
            start_seconds=0.0,
            end_seconds=30.0,
            coverage_status="complete",
        )

        # Write dummy manifest
        seg_dir = self.media_root / "youtube" / self.video.video_id / "segments" / "seg_0"
        seg_dir.mkdir(parents=True, exist_ok=True)
        manifest_data = {
            "schema": "aidetect-segment-manifest/v1",
            "video_id": self.video.video_id,
            "segment_index": 0,
            "segment_bounds": {"start_seconds": 0.0, "end_seconds": 30.0},
            "coverage_status": "complete",
            "frames": [],
            "audio_chunks": [],
            "segment_cues": [],
        }
        (seg_dir / "manifest.json").write_text(json.dumps(manifest_data), encoding="utf-8")

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_crashing_component_does_not_halt_pipeline(self):
        # Configure dispatcher with one crashing connector and one working connector
        connectors = [
            CrashingComponentConnector(),
            WorkingComponentConnector(),
        ]
        dispatcher = InferenceDispatcher(media_root=self.media_root, connectors=connectors)

        # Execution should succeed without throwing an uncaught exception
        records = dispatcher.dispatch_segment(self.segment.id)
        self.assertEqual(len(records), 2)

        crash_rec = next(r for r in records if r.component_name == "crashing_component")
        work_rec = next(r for r in records if r.component_name == "working_component")

        # Verify failing component status and error capture
        self.assertEqual(crash_rec.status, "FAILED")
        self.assertIsNone(crash_rec.score)
        self.assertIn("Simulated fatal CUDA", crash_rec.error_message)
        self.assertIn("traceback", crash_rec.details)

        # Verify working component completed normally
        self.assertEqual(work_rec.status, "SUCCESS")
        self.assertEqual(work_rec.score, 0.85)

        # Verify both records were persisted to the database
        db_scores = SegmentComponentScore.objects.filter(segment=self.segment)
        self.assertEqual(db_scores.count(), 2)

        db_crash = db_scores.get(component_name="crashing_component")
        self.assertEqual(db_crash.status, "FAILED")
        self.assertIn("RuntimeError", db_crash.error_message)

        db_work = db_scores.get(component_name="working_component")
        self.assertEqual(db_work.status, "SUCCESS")
        self.assertEqual(db_work.score, 0.85)

        # Verify segment score was successfully computed using the working component
        self.segment.refresh_from_db()
        self.assertIsNotNone(self.segment.ai_segment_score)
        self.assertAlmostEqual(self.segment.ai_segment_score, 0.85, places=2)
