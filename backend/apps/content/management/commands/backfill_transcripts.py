"""
Django Management Command: backfill_transcripts
Retroactively fetches and extracts YouTube captions/transcripts for videos stored in the database,
creates VideoTranscript records, updates Contributions, and recompiles multimodal segment manifests.
"""

from pathlib import Path
import json
from django.core.management.base import BaseCommand
from django.conf import settings
from apps.content.models import Video, VideoSegment, VideoTranscript, Contribution
from apps.content.services.youtube_transcript_service import YouTubeTranscriptService
from apps.content.services.transcript_service import compute_transcript_content_hash
from apps.content.services.manifest_builder import ManifestBuilder


class Command(BaseCommand):
    help = "Retroactively fetches YouTube captions/transcripts and rebuilds segment manifests."

    def add_arguments(self, parser):
        parser.add_argument(
            '--video-id',
            type=str,
            help='Specific 11-character YouTube video ID to backfill (default: all videos)',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Re-fetch even if video already has a VideoTranscript in database',
        )

    def handle(self, *args, **options):
        video_id = options.get('video_id')
        force = options.get('force', False)

        qs = Video.objects.all()
        if video_id:
            qs = qs.filter(video_id=video_id)

        if not qs.exists():
            self.stdout.write(self.style.WARNING(f"No videos found matching query."))
            return

        media_root = Path(settings.MEDIA_ROOT)
        manifest_builder = ManifestBuilder(media_root=media_root)

        total_videos = qs.count()
        self.stdout.write(self.style.MIGRATE_HEADING(f"Backfilling transcripts for {total_videos} video(s)..."))

        for video in qs:
            vid = video.video_id
            existing_trans = VideoTranscript.objects.filter(video=video).first()

            if existing_trans and not force:
                self.stdout.write(
                    self.style.NOTICE(f"[-] Video {vid}: Already has transcript {existing_trans.content_hash[:8]}... (skipping, use --force to overwrite)")
                )
                continue

            self.stdout.write(f"[*] Video {vid}: Fetching captions via YouTubeTranscriptService...")
            res = YouTubeTranscriptService.get_or_fetch_transcript(vid, media_root=media_root)
            if not res or not res.get('segments'):
                self.stdout.write(self.style.WARNING(f"[!] Video {vid}: No captions accessible on YouTube."))
                continue

            cues = res.get('segments', [])
            lang = res.get('language', 'en')
            scope = res.get('scope', 'full')
            thash = compute_transcript_content_hash(cues)

            # 1. Update or create VideoTranscript
            vt, created = VideoTranscript.objects.update_or_create(
                content_hash=thash,
                defaults={
                    'video': video,
                    'language': lang,
                    'scope': scope,
                    'cues_json': cues,
                }
            )

            # 2. Update Contribution records for this video
            updated_contribs = Contribution.objects.filter(video=video).update(
                transcript_scope=scope,
                transcript_hash=thash,
            )

            # 3. Rebuild manifests for all segments of this video
            rebuilt_segments = 0
            for segment in video.segments.all():
                seg_dir = media_root / 'youtube' / vid / 'segments' / f'seg_{segment.segment_index}'
                manifest_file = seg_dir / 'manifest.json'

                frames = []
                audio_chunks = []
                merged_intervals = [
                    (float(iv.start_seconds), float(iv.end_seconds))
                    for iv in segment.intervals.all()
                ]

                if manifest_file.exists():
                    try:
                        old_m = json.loads(manifest_file.read_text(encoding='utf-8'))
                        frames = old_m.get('frames', [])
                        audio_chunks = old_m.get('audio_chunks', [])
                    except Exception:
                        pass

                manifest_builder.build_segment_manifest(
                    video_id=vid,
                    segment_index=segment.segment_index,
                    segment_bounds=(segment.start_seconds, segment.end_seconds),
                    coverage_status=segment.coverage_status,
                    merged_intervals=merged_intervals,
                    frames=frames,
                    audio_chunks=audio_chunks,
                    transcript_cues=cues,
                    transcript_hash=thash,
                )
                rebuilt_segments += 1

            self.stdout.write(
                self.style.SUCCESS(
                    f"[+] Video {vid}: Saved {len(cues)} cues ({lang}, hash={thash[:8]}...), "
                    f"updated {updated_contribs} contributions, rebuilt {rebuilt_segments} segment manifests."
                )
            )

        self.stdout.write(self.style.SUCCESS("\nBackfill process complete!"))
