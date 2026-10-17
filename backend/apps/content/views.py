"""
API Views for Video Lookup and Evidence Contribution Ingestion.
Interacts with the Chrome Extension and organizes multimodal evidence packages for AI inference.
"""

import uuid
import math
from typing import List, Tuple
from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .models import Video, VideoSegment, SegmentInterval, Contribution, VideoTranscript, InferenceJob
from .serializers import (
    VideoLookupSerializer,
    ContributionInputSerializer,
)
from .services.interval_merger import (
    clamp_interval,
    merge_intervals,
    calculate_coverage_duration,
    compute_remaining_intervals,
    evaluate_segment_sufficiency,
)
from .services.media_storage import MediaStorageService
from .services.transcript_service import TranscriptService
from .services.manifest_builder import ManifestBuilder


class VideoLookupView(APIView):
    """
    GET /v1/content/youtube/<video_id>
    Returns cached classification results, segment coverage, and missing segment indices.
    """
    def get(self, request, video_id: str):
        duration_param = request.query_params.get('duration')
        video_duration = 0.0
        if duration_param:
            try:
                video_duration = float(duration_param)
            except ValueError:
                video_duration = 0.0

        try:
            video = Video.objects.prefetch_related('segments').get(video_id=video_id)
            if video_duration > 0 and video.duration_seconds <= 0:
                video.duration_seconds = video_duration
                video.save(update_fields=['duration_seconds'])
            serializer = VideoLookupSerializer(video)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Video.DoesNotExist:
            # Spec Section 2.1: Graceful not_found body, populated with duration if supplied
            segments = []
            missing_indices = []
            seg_dur = 30
            if video_duration > 0:
                total_segs = int(math.ceil(video_duration / seg_dur))
                for i in range(total_segs):
                    start = float(i * seg_dur)
                    end = float(min((i + 1) * seg_dur, video_duration))
                    segments.append({
                        "index": i,
                        "startSeconds": start,
                        "endSeconds": end,
                        "coverage": "missing",
                    })
                    missing_indices.append(i)

            return Response(
                {
                    "videoId": video_id,
                    "status": "not_found",
                    "label": "UNKNOWN",
                    "aiRelianceScore": None,
                    "confidence": None,
                    "segmentDurationSeconds": seg_dur,
                    "segments": segments,
                    "missingSegmentIndices": missing_indices,
                    "analyzedAt": None,
                    "requiredPolicyVersion": "v1",
                },
                status=status.HTTP_200_OK,
            )


class ContributionIngestionView(APIView):
    """
    POST /v1/content/youtube/<video_id>/contributions
    Accepts crowdsourced multimodal evidence packages, decodes media assets into organized
    directories, atomically merges observation intervals, updates segment sufficiency, and
    generates aligned dataset manifests for inference workers.
    """
    def post(self, request, video_id: str):
        serializer = ContributionInputSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        data = serializer.validated_data
        contribution_id = f"contrib_{uuid.uuid4().hex[:12]}"

        # Resolve field aliases (camelCase / snake_case)
        segment_index = data.get('segmentIndex') if data.get('segmentIndex') is not None else data.get('segment_index', 0)
        seg_start = float(data.get('segmentStartSeconds') if data.get('segmentStartSeconds') is not None else data.get('segment_start_seconds', segment_index * 30.0))
        seg_end = float(data.get('segmentEndSeconds') if data.get('segmentEndSeconds') is not None else data.get('segment_end_seconds', (segment_index + 1) * 30.0))
        policy_version = data.get('policyVersion') or data.get('policy_version') or 'v1'
        video_dur_val = (
            data.get('videoDurationSeconds')
            or data.get('video_duration_seconds')
            or request.data.get('videoDurationSeconds')
            or request.data.get('video_duration_seconds')
        )
        video_duration = float(video_dur_val) if video_dur_val is not None else 0.0

        raw_intervals = data.get('observedIntervals') or data.get('observed_intervals') or []
        frames_data = request.data.get('frames') or []
        audio_data = request.data.get('audioChunks') or request.data.get('audio_chunks') or []
        transcript_data = request.data.get('transcript')

        # Instantiate services
        media_storage = MediaStorageService()
        transcript_service = TranscriptService()
        manifest_builder = ManifestBuilder()

        with transaction.atomic():
            # 1. Video Entity
            video, _ = Video.objects.get_or_create(
                video_id=video_id,
                defaults={
                    'segment_duration_seconds': 30,
                    'status': 'partial',
                    'label': 'UNKNOWN',
                    'required_policy_version': policy_version,
                    'duration_seconds': video_duration,
                }
            )
            if video_duration > 0 and video.duration_seconds <= 0:
                video.duration_seconds = video_duration
                video.save(update_fields=['duration_seconds'])

            # 2. Segment Entity
            segment, _ = VideoSegment.objects.get_or_create(
                video=video,
                segment_index=segment_index,
                defaults={
                    'start_seconds': seg_start,
                    'end_seconds': seg_end,
                    'coverage_status': 'missing',
                }
            )

            # 3. Deterministic Half-Open Interval Merging
            existing_intervals = [
                (iv.start_seconds, iv.end_seconds)
                for iv in segment.intervals.all()
            ]

            clamped_new: List[Tuple[float, float]] = []
            for iv in raw_intervals:
                clamped = clamp_interval((iv['start_seconds'], iv['end_seconds']), seg_start, seg_end)
                if clamped:
                    clamped_new.append(clamped)

            merged = merge_intervals(existing_intervals, clamped_new, epsilon=0.25)

            # Persist updated intervals
            segment.intervals.all().delete()
            for s, e in merged:
                SegmentInterval.objects.create(segment=segment, start_seconds=s, end_seconds=e)

            # 4. Media Storage & Decoding (JPEG frames & Opus audio)
            saved_frames = media_storage.save_frames(
                video_id=video_id,
                segment_index=segment_index,
                contribution_id=contribution_id,
                frames_data=frames_data,
            )

            saved_audio = media_storage.save_audio_chunks(
                video_id=video_id,
                segment_index=segment_index,
                contribution_id=contribution_id,
                audio_data=audio_data,
                observed_intervals=clamped_new,
            )

            # 5. Transcript Deduplication
            transcript_hash = None
            if transcript_data:
                res = transcript_service.process_transcript(video_id, transcript_data)
                if res:
                    thash, tscope, is_new, _ = res
                    transcript_hash = thash
                    if is_new:
                        VideoTranscript.objects.get_or_create(
                            content_hash=thash,
                            defaults={
                                'video': video,
                                'language': transcript_data.get('language', 'en'),
                                'scope': tscope,
                                'cues_json': transcript_data.get('segments') or [],
                            }
                        )

            # 6. Evaluate Segment Sufficiency
            covered_sec = calculate_coverage_duration(merged)
            audio_dur = sum(
                float(a.get('end_seconds', 0.0)) - float(a.get('start_seconds', 0.0))
                for a in saved_audio
            )

            segment.frame_count = max(segment.frame_count, len(saved_frames))
            segment.audio_duration_seconds = max(segment.audio_duration_seconds, audio_dur)
            segment.coverage_status = evaluate_segment_sufficiency(
                covered_duration=covered_sec,
                seg_duration=(seg_end - seg_start),
                frame_count=segment.frame_count,
                audio_duration=segment.audio_duration_seconds,
            )
            segment.save()

            # 7. Record Contribution
            Contribution.objects.create(
                contribution_id=contribution_id,
                video=video,
                segment_index=segment_index,
                policy_version=policy_version,
                frame_count=len(saved_frames),
                audio_duration_seconds=audio_dur,
                transcript_scope=transcript_data.get('scope', 'unavailable') if transcript_data else 'unavailable',
                transcript_hash=transcript_hash or '',
            )

            # 8. Multimodal Manifest Generation & Inference Job Creation
            manifest_path = manifest_builder.build_segment_manifest(
                video_id=video_id,
                segment_index=segment_index,
                segment_bounds=(seg_start, seg_end),
                coverage_status=segment.coverage_status,
                merged_intervals=merged,
                frames=saved_frames,
                audio_chunks=saved_audio,
                transcript_cues=transcript_data.get('segments') if transcript_data else None,
                transcript_hash=transcript_hash,
            )

            InferenceJob.objects.create(
                video=video,
                segment_index=segment_index,
                status='PENDING',
                manifest_path=str(manifest_path),
            )

            # Update video status if all segments complete
            all_segments = list(video.segments.all())
            total_expected = (
                int(math.ceil(video.duration_seconds / video.segment_duration_seconds))
                if video.duration_seconds > 0
                else len(all_segments)
            )
            has_missing = (
                len(all_segments) < total_expected
                or any(s.coverage_status != 'complete' for s in all_segments)
            )
            if not has_missing and len(all_segments) > 0 and video.status != 'complete':
                # Video coverage complete, ready for full inference score aggregation
                video.status = 'processing'
                video.save()
            elif video.status == 'not_found':
                video.status = 'partial'
                video.save()

            remaining = compute_remaining_intervals(seg_start, seg_end, merged)

        # Output response matching ContributionUploadResponseDto
        response_dto = {
            "contributionId": contribution_id,
            "acceptedIntervals": [
                {"startSeconds": s, "endSeconds": e} for s, e in merged
            ],
            "remainingIntervals": [
                {"startSeconds": s, "endSeconds": e} for s, e in remaining
            ],
            "videoStatus": video.status if video.status in ['partial', 'processing', 'complete'] else 'partial',
        }

        return Response(response_dto, status=status.HTTP_200_OK)
