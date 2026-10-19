"""
Inference Dispatcher.
Coordinates loading SegmentContext from manifest.json, executing all hardcoded
component connectors with strict fault isolation, persisting component scores,
and triggering multimodal fusion.
"""

import logging
from pathlib import Path
from typing import List, Optional
from django.conf import settings
from ..models import Video, VideoSegment, InferenceJob, SegmentComponentScore
from .context import SegmentContext
from .base_connector import BaseComponentConnector, CollectedScoreRecord
from .connectors import (
    SlopOutVisualConnector,
    SlopOutTextConnector,
    TemporalConsistencyConnector,
    AudioSignalConnector,
)
from .fusion import FusionEngine

logger = logging.getLogger(__name__)


class InferenceDispatcher:
    def __init__(self, media_root: Optional[Path] = None, connectors: Optional[List[BaseComponentConnector]] = None):
        self.media_root = Path(media_root or settings.MEDIA_ROOT)
        self.connectors = connectors or [
            SlopOutVisualConnector(),
            SlopOutTextConnector(),
            TemporalConsistencyConnector(),
            AudioSignalConnector(),
        ]
        self.fusion = FusionEngine()

    def dispatch_segment(self, segment_id: int, job_id: Optional[int] = None) -> List[CollectedScoreRecord]:
        """
        Executes inference across all connectors for a specific VideoSegment.
        """
        try:
            segment = VideoSegment.objects.select_related("video").get(id=segment_id)
        except VideoSegment.DoesNotExist:
            logger.error(f"VideoSegment with id {segment_id} not found")
            return []

        video = segment.video
        manifest_path = self.media_root / "youtube" / video.video_id / "segments" / f"seg_{segment.segment_index}" / "manifest.json"

        if not manifest_path.exists():
            logger.warning(f"Manifest not found at {manifest_path} for video {video.video_id} segment {segment.segment_index}")
            return []

        context = SegmentContext.from_manifest_file(manifest_path, self.media_root)

        records: List[CollectedScoreRecord] = []
        for connector in self.connectors:
            record = connector.run(context)
            records.append(record)

            # Persist individual component score record
            SegmentComponentScore.objects.update_or_create(
                segment=segment,
                component_name=record.component_name,
                defaults={
                    "modality": record.modality,
                    "score": record.score,
                    "confidence": record.confidence,
                    "status": record.status,
                    "execution_time_ms": record.execution_time_ms,
                    "details": record.details,
                    "error_message": record.error_message or "",
                },
            )

        # Multimodal fusion
        self.fusion.update_segment_score(segment, records)
        self.fusion.aggregate_video_score(video)

        # Update InferenceJob status if provided
        if job_id:
            try:
                job = InferenceJob.objects.get(id=job_id)
                job.status = "COMPLETED"
                job.save(update_fields=["status", "updated_at"])
            except InferenceJob.DoesNotExist:
                pass
        else:
            # Update any pending jobs for this segment
            InferenceJob.objects.filter(
                video=video,
                segment_index=segment.segment_index,
                status="PENDING",
            ).update(status="COMPLETED")

        return records

    def dispatch_video(self, video_id: str) -> List[CollectedScoreRecord]:
        """
        Executes inference across all available segments for a video and updates whole-video aggregation.
        """
        try:
            video = Video.objects.prefetch_related("segments").get(video_id=video_id)
        except Video.DoesNotExist:
            logger.error(f"Video '{video_id}' not found for dispatch")
            return []

        all_records: List[CollectedScoreRecord] = []
        for segment in video.segments.all().order_by("segment_index"):
            records = self.dispatch_segment(segment.id)
            all_records.extend(records)

        video.refresh_from_db()
        return all_records
