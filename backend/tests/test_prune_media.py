"""
Tests for prune_media management command.
Verifies raw media files on disk are pruned after buffer time while database records
(Video, VideoSegment, SegmentComponentScore) are permanently preserved.
"""

import shutil
import tempfile
from pathlib import Path
from datetime import timedelta
from io import StringIO
from django.test import TestCase, override_settings
from django.utils import timezone
from django.core.management import call_command
from apps.content.models import Video, VideoSegment, SegmentComponentScore


class PruneMediaCommandTestCase(TestCase):
    def setUp(self):
        self.temp_media_root = tempfile.mkdtemp()
        self.override = override_settings(MEDIA_ROOT=self.temp_media_root)
        self.override.enable()

        self.media_path = Path(self.temp_media_root)

        # 1. Old analyzed video (analyzed 10 days ago)
        self.old_analyzed_video = Video.objects.create(
            video_id="oldAnalyzedVid",
            duration_seconds=60.0,
            status="complete",
            label="HUMAN_MADE",
            ai_reliance_score=0.25,
            confidence=0.85,
            analyzed_at=timezone.now() - timedelta(days=10),
        )
        self.old_seg = VideoSegment.objects.create(
            video=self.old_analyzed_video,
            segment_index=0,
            start_seconds=0.0,
            end_seconds=30.0,
            coverage_status="complete",
            ai_segment_score=0.25,
        )
        SegmentComponentScore.objects.create(
            segment=self.old_seg,
            component_name="slopout_visual",
            modality="visual",
            score=0.25,
            status="SUCCESS",
        )

        # Create physical segment files on disk
        old_seg_dir = self.media_path / "youtube" / "oldAnalyzedVid" / "segments" / "seg_0"
        old_seg_dir.mkdir(parents=True, exist_ok=True)
        (old_seg_dir / "frame_0.jpg").write_text("fake_image_bytes")

        # 2. Fresh analyzed video (analyzed 2 days ago)
        self.fresh_analyzed_video = Video.objects.create(
            video_id="freshAnalyzedVid",
            duration_seconds=60.0,
            status="complete",
            label="AI_GENERATED",
            ai_reliance_score=0.88,
            confidence=0.90,
            analyzed_at=timezone.now() - timedelta(days=2),
        )
        fresh_seg_dir = self.media_path / "youtube" / "freshAnalyzedVid" / "segments" / "seg_0"
        fresh_seg_dir.mkdir(parents=True, exist_ok=True)
        (fresh_seg_dir / "frame_0.jpg").write_text("fresh_image_bytes")

    def tearDown(self):
        self.override.disable()
        shutil.rmtree(self.temp_media_root, ignore_errors=True)

    def test_dry_run_does_not_delete_files(self):
        out = StringIO()
        call_command("prune_media", "--days=7", "--dry-run", stdout=out)
        output = out.getvalue()
        self.assertIn("[DRY RUN]", output)
        self.assertIn("oldAnalyzedVid", output)

        old_seg_dir = self.media_path / "youtube" / "oldAnalyzedVid" / "segments"
        self.assertTrue(old_seg_dir.exists())

    def test_prunes_old_media_and_preserves_database_records(self):
        out = StringIO()
        call_command("prune_media", "--days=7", stdout=out)

        old_seg_dir = self.media_path / "youtube" / "oldAnalyzedVid" / "segments"
        fresh_seg_dir = self.media_path / "youtube" / "freshAnalyzedVid" / "segments"

        # On-disk files for old video pruned
        self.assertFalse(old_seg_dir.exists())
        # Fresh video media preserved
        self.assertTrue(fresh_seg_dir.exists())

        # CRITICAL INVARIANT: Database records strictly preserved
        v = Video.objects.get(video_id="oldAnalyzedVid")
        self.assertEqual(v.status, "complete")
        self.assertEqual(v.ai_reliance_score, 0.25)
        self.assertEqual(v.segments.count(), 1)
        self.assertEqual(v.segments.first().component_scores.count(), 1)
