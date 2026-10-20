"""
Management command to prune raw media assets (JPEG frames, Opus/WebM audio chunks)
for videos that have been analyzed and whose analysis is older than a configurable
retention buffer period.

Core Invariant: Only deletes binary files from disk. Database records (Video,
VideoSegment, SegmentComponentScore, SegmentInterval, Contribution) are NEVER
touched, ensuring that analysis results, scores, labels, and coverage persist
indefinitely.

Usage:
    python manage.py prune_media                    # Prune media older than 7 days (default)
    python manage.py prune_media --days 0 --force   # Prune all analyzed media immediately
    python manage.py prune_media --dry-run           # Preview what would be deleted
"""

import shutil
import logging
from pathlib import Path
from datetime import timedelta
from django.core.management.base import BaseCommand
from django.conf import settings
from django.utils import timezone
from apps.content.models import Video

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Prune raw media assets for analyzed videos after a retention buffer period.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days',
            type=int,
            default=7,
            help='Retention buffer in days since analysis completion (default: 7).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            default=False,
            help='Preview which directories would be deleted without actually deleting.',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            default=False,
            help='Allow pruning with --days 0 (immediate pruning of all analyzed media).',
        )

    def handle(self, *args, **options):
        days = options['days']
        dry_run = options['dry_run']
        force = options['force']

        if days == 0 and not force and not dry_run:
            self.stderr.write(self.style.ERROR(
                'Refusing to prune with --days 0 without --force or --dry-run. '
                'Use --force to confirm immediate pruning of all analyzed media.'
            ))
            return

        media_root = Path(settings.MEDIA_ROOT)
        cutoff = timezone.now() - timedelta(days=days)

        # Find videos that are analyzed (have a score) and whose analysis is older than the cutoff
        eligible_videos = Video.objects.filter(
            ai_reliance_score__isnull=False,
            analyzed_at__isnull=False,
            analyzed_at__lt=cutoff,
        )

        total_pruned = 0
        total_bytes_freed = 0

        self.stdout.write(self.style.NOTICE(
            f'Pruning raw media for videos analyzed before {cutoff.isoformat()} '
            f'(buffer={days} days, dry_run={dry_run})'
        ))

        for video in eligible_videos:
            video_media_dir = media_root / 'youtube' / video.video_id / 'segments'
            if not video_media_dir.exists():
                continue

            # Calculate directory size
            dir_size = sum(f.stat().st_size for f in video_media_dir.rglob('*') if f.is_file())

            if dry_run:
                self.stdout.write(
                    f'  [DRY RUN] Would delete {video_media_dir} '
                    f'({dir_size / 1024 / 1024:.2f} MB) for video {video.video_id} '
                    f'(analyzed at {video.analyzed_at.isoformat()}, '
                    f'score={video.ai_reliance_score:.4f}, label={video.label})'
                )
            else:
                try:
                    shutil.rmtree(str(video_media_dir))
                    logger.info(
                        "🗑️ Pruned segment media for video '%s' (%.2f MB freed, analyzed_at=%s)",
                        video.video_id, dir_size / 1024 / 1024, video.analyzed_at.isoformat(),
                    )
                    self.stdout.write(self.style.SUCCESS(
                        f'  Pruned {video_media_dir} ({dir_size / 1024 / 1024:.2f} MB) '
                        f'for video {video.video_id}'
                    ))
                except Exception as e:
                    logger.error("Failed to prune media for video '%s': %s", video.video_id, e)
                    self.stderr.write(self.style.ERROR(
                        f'  Failed to prune {video_media_dir}: {e}'
                    ))
                    continue

            total_pruned += 1
            total_bytes_freed += dir_size

        action = 'Would prune' if dry_run else 'Pruned'
        self.stdout.write(self.style.SUCCESS(
            f'\n{action} media for {total_pruned} video(s), '
            f'freeing {total_bytes_freed / 1024 / 1024:.2f} MB total.'
        ))

        if not dry_run and total_pruned > 0:
            self.stdout.write(self.style.NOTICE(
                'Note: All database records (scores, labels, coverage) remain fully intact.'
            ))
