"""
Django Management Command: run_inference
Executes modular multi-component inference on video segments.

Usage:
  python manage.py run_inference --video-id <video_id>
  python manage.py run_inference --video-id <video_id> --segment 0
  python manage.py run_inference --all
"""

from django.core.management.base import BaseCommand
from apps.content.models import Video, VideoSegment, InferenceJob
from apps.content.inference.dispatcher import InferenceDispatcher


class Command(BaseCommand):
    help = "Runs modular multi-component inference and multimodal fusion across video segments."

    def add_arguments(self, parser):
        parser.add_argument(
            "--video-id",
            type=str,
            help="Specific YouTube video ID to evaluate",
        )
        parser.add_argument(
            "--segment",
            type=int,
            help="Optional segment index to evaluate",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Evaluate all video segments in the database",
        )

    def handle(self, *args, **options):
        video_id = options.get("video_id")
        segment_idx = options.get("segment")
        run_all = options.get("all")

        dispatcher = InferenceDispatcher()

        if video_id:
            try:
                video = Video.objects.get(video_id=video_id)
            except Video.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Video '{video_id}' not found in database."))
                return

            segments = video.segments.all()
            if segment_idx is not None:
                segments = segments.filter(segment_index=segment_idx)

            self.stdout.write(self.style.NOTICE(f"Running inference for video '{video_id}' ({segments.count()} segments)..."))
            for seg in segments:
                self._process_segment(dispatcher, seg)

            video.refresh_from_db()
            self.stdout.write(self.style.SUCCESS(
                f"Video {video_id} complete: Score={video.ai_reliance_score}, Label={video.label}, Status={video.status}"
            ))

        elif run_all:
            pending_segments = VideoSegment.objects.all()
            self.stdout.write(self.style.NOTICE(f"Processing all {pending_segments.count()} segments..."))
            for seg in pending_segments:
                self._process_segment(dispatcher, seg)
            self.stdout.write(self.style.SUCCESS("All segments evaluated."))
        else:
            # Process pending jobs
            pending_jobs = InferenceJob.objects.filter(status="PENDING")
            self.stdout.write(self.style.NOTICE(f"Processing {pending_jobs.count()} pending inference jobs..."))
            for job in pending_jobs:
                try:
                    seg = VideoSegment.objects.get(video=job.video, segment_index=job.segment_index)
                    self._process_segment(dispatcher, seg, job.id)
                except VideoSegment.DoesNotExist:
                    job.status = "FAILED"
                    job.error_message = "VideoSegment record missing"
                    job.save()

    def _process_segment(self, dispatcher: InferenceDispatcher, segment: VideoSegment, job_id=None):
        self.stdout.write(f"  Segment #{segment.segment_index} (Video {segment.video.video_id})...")
        records = dispatcher.dispatch_segment(segment.id, job_id=job_id)
        for r in records:
            color = self.style.SUCCESS if r.status == "SUCCESS" else self.style.WARNING if r.status == "SKIPPED" else self.style.ERROR
            self.stdout.write(color(
                f"    -> [{r.component_name}] status={r.status} score={r.score} latency={r.execution_time_ms}ms"
            ))
        segment.refresh_from_db()
        self.stdout.write(self.style.MIGRATE_HEADING(f"    Fused Segment Score: {segment.ai_segment_score}"))
