"""
API Views for Video Lookup and Evidence Contribution Ingestion.
Interacts with the Chrome Extension and organizes multimodal evidence packages for AI inference.
"""

import uuid
import math
import threading
from pathlib import Path
from typing import List, Tuple
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.conf import settings
import logging
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .models import Video, VideoSegment, SegmentInterval, Contribution, VideoTranscript, InferenceJob

logger = logging.getLogger(__name__)
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
from .inference.dispatcher import InferenceDispatcher

_active_video_dispatches = set()
_active_video_dispatches_lock = threading.Lock()


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

        logger.info("📥 Lookup request for video '%s' (duration_param=%s)", video_id, duration_param)

        try:
            video = Video.objects.prefetch_related('segments', 'segments__component_scores').get(video_id=video_id)
            logger.debug(
                "  Found video '%s': status=%s, score=%s, label=%s, segments=%d, duration=%.1fs",
                video_id, video.status, video.ai_reliance_score, video.label,
                video.segments.count(), video.duration_seconds,
            )
            if video_duration > 0 and video.duration_seconds <= 0:
                video.duration_seconds = video_duration
                video.save(update_fields=['duration_seconds'])

            # Auto-Trigger Analysis when coverage is over/at threshold (configured in settings.py, default 90)
            threshold = getattr(settings, 'ANALYSIS_COVERAGE_THRESHOLD_PERCENT', 90.0)
            total_expected_segments = (
                int(math.ceil(video.duration_seconds / video.segment_duration_seconds))
                if video.duration_seconds > 0
                else video.segments.count()
            )
            complete_segments_count = video.segments.filter(coverage_status='complete').count()
            coverage_pct = (complete_segments_count / total_expected_segments * 100.0) if total_expected_segments > 0 else 0.0

            logger.info(
                "  Coverage: %d/%d segments complete (%.1f%%), threshold=%.0f%%",
                complete_segments_count, total_expected_segments, coverage_pct, threshold,
            )

            if total_expected_segments > 0 and coverage_pct >= threshold:
                # Check if analysis is needed: score not yet computed, or unscored complete segments, or pending jobs
                has_unscored = video.segments.filter(coverage_status='complete', component_scores__isnull=True).exists()
                has_pending_jobs = InferenceJob.objects.filter(video=video, status='PENDING').exists()
                needs_analysis = video.ai_reliance_score is None or has_unscored or has_pending_jobs
                logger.info(
                    "  Analysis check: needs_analysis=%s (score=%s, has_unscored=%s, has_pending_jobs=%s)",
                    needs_analysis, video.ai_reliance_score, has_unscored, has_pending_jobs,
                )

                if needs_analysis:
                    with _active_video_dispatches_lock:
                        already_running = video_id in _active_video_dispatches
                        if not already_running:
                            _active_video_dispatches.add(video_id)

                    if not already_running:
                        # Mark video as processing before dispatching
                        if video.status not in ('processing', 'complete'):
                            video.status = 'processing'
                            video.save(update_fields=['status'])
                        logger.info("  🔄 Launching inference dispatch for video '%s'", video_id)

                        try:
                            InferenceDispatcher().dispatch_video(video.video_id)
                            video = Video.objects.prefetch_related('segments', 'segments__component_scores').get(video_id=video_id)
                            logger.info("  ✅ Dispatch completed for video '%s': score=%s, label=%s",
                                        video_id, video.ai_reliance_score, video.label)
                        except Exception as e:
                            logger.exception("Auto-analysis failed for video %s: %s", video_id, e)
                        finally:
                            with _active_video_dispatches_lock:
                                _active_video_dispatches.discard(video_id)
                    else:
                        logger.info("  ⏳ Inference dispatch already running for video '%s', skipping", video_id)

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
                        "aiSegmentScore": None,
                        "components": [],
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
                    "componentSummary": None,
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
            logger.warning("📦 Invalid contribution payload for video '%s': %s", video_id, serializer.errors)
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

        logger.info(
            "📦 Contribution '%s' for video '%s' seg #%d [%.1fs-%.1fs]: %d intervals, %d frames, %d audio chunks",
            contribution_id, video_id, segment_index, seg_start, seg_end,
            len(raw_intervals), len(frames_data), len(audio_data),
        )

        # Instantiate services
        media_storage = MediaStorageService()
        transcript_service = TranscriptService()
        manifest_builder = ManifestBuilder()

        # 1. Deterministic Interval Clamping (Pure memory calculation)
        clamped_new: List[Tuple[float, float]] = []
        for iv in raw_intervals:
            clamped = clamp_interval((iv['start_seconds'], iv['end_seconds']), seg_start, seg_end)
            if clamped:
                clamped_new.append(clamped)

        # 2. Media Storage & Decoding (JPEG frames & Opus audio) - OUTSIDE database transaction
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

        # 3. Transcript Deduplication & Automated Server Fallback - OUTSIDE database transaction
        transcript_hash = None
        active_cues = []
        transcript_scope = 'unavailable'
        trans_lang = 'en'
        is_new_transcript = False

        res = transcript_service.process_transcript(
            video_id=video_id,
            transcript_data=transcript_data,
            allow_server_fallback=True,
        )
        if res:
            thash, tscope, is_new, _ = res
            transcript_hash = thash
            transcript_scope = tscope
            is_new_transcript = is_new
            active_cues = getattr(res, 'cues', [])
            trans_lang = getattr(res, 'language', 'en')

        # 4. Fast Atomic Database Persist Block (< 5ms lock time)
        with transaction.atomic():
            # Video Entity
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

            # Segment Entity
            segment, _ = VideoSegment.objects.get_or_create(
                video=video,
                segment_index=segment_index,
                defaults={
                    'start_seconds': seg_start,
                    'end_seconds': seg_end,
                    'coverage_status': 'missing',
                }
            )

            # Deterministic Half-Open Interval Merging
            existing_intervals = [
                (iv.start_seconds, iv.end_seconds)
                for iv in segment.intervals.all()
            ]
            merged = merge_intervals(existing_intervals, clamped_new, epsilon=0.25)

            # Persist updated intervals
            segment.intervals.all().delete()
            for s, e in merged:
                SegmentInterval.objects.create(segment=segment, start_seconds=s, end_seconds=e)

            # Persist transcript entity if newly fetched
            if is_new_transcript and transcript_hash:
                VideoTranscript.objects.get_or_create(
                    content_hash=transcript_hash,
                    defaults={
                        'video': video,
                        'language': trans_lang,
                        'scope': transcript_scope,
                        'cues_json': active_cues,
                    }
                )

            # Evaluate Segment Sufficiency
            covered_sec = calculate_coverage_duration(merged)
            audio_dur = sum(
                float(a.get('end_seconds', 0.0)) - float(a.get('start_seconds', 0.0))
                for a in saved_audio
            )

            # Periodic extension flushes intentionally submit small evidence packages
            # (often one frame and roughly ten seconds of audio).  Sufficiency is a
            # segment-level decision, so accumulate contribution evidence instead of
            # treating each package as a replacement snapshot.
            prior_frame_count = (
                Contribution.objects
                .filter(video=video, segment_index=segment_index)
                .aggregate(total=Sum('frame_count'))
                .get('total') or 0
            )
            prior_audio_duration = (
                Contribution.objects
                .filter(video=video, segment_index=segment_index)
                .aggregate(total=Sum('audio_duration_seconds'))
                .get('total') or 0.0
            )
            segment.frame_count = int(prior_frame_count) + len(saved_frames)
            segment.audio_duration_seconds = min(
                covered_sec,
                float(prior_audio_duration) + audio_dur,
            )
            segment.coverage_status = evaluate_segment_sufficiency(
                covered_duration=covered_sec,
                seg_duration=(seg_end - seg_start),
                frame_count=segment.frame_count,
                audio_duration=segment.audio_duration_seconds,
            )
            segment.save()

            logger.info(
                "  Segment #%d sufficiency: status=%s, covered=%.1fs/%.1fs, frames=%d, audio=%.1fs",
                segment_index, segment.coverage_status, covered_sec, (seg_end - seg_start),
                segment.frame_count, segment.audio_duration_seconds,
            )

            # Record Contribution
            Contribution.objects.create(
                contribution_id=contribution_id,
                video=video,
                segment_index=segment_index,
                policy_version=policy_version,
                frame_count=len(saved_frames),
                audio_duration_seconds=audio_dur,
                transcript_scope=transcript_scope,
                transcript_hash=transcript_hash or '',
            )

            manifest_target_path = str(
                Path(settings.MEDIA_ROOT) / 'youtube' / video_id / 'segments' / f'seg_{segment_index}' / 'manifest.json'
            )
            job = InferenceJob.objects.create(
                video=video,
                segment_index=segment_index,
                status='PENDING',
                manifest_path=manifest_target_path,
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

            logger.info(
                "  Video '%s' status after contribution: %s (%d/%d segments, %d remaining intervals)",
                video_id, video.status, len(all_segments), total_expected, len(remaining),
            )

        # 5. Multimodal Manifest Generation - OUTSIDE database transaction
        manifest_path = manifest_builder.build_segment_manifest(
            video_id=video_id,
            segment_index=segment_index,
            segment_bounds=(seg_start, seg_end),
            coverage_status=segment.coverage_status,
            merged_intervals=merged,
            frames=saved_frames,
            audio_chunks=saved_audio,
            transcript_cues=active_cues,
            transcript_hash=transcript_hash,
        )


        # Trigger modular inference engine on the segment if enabled
        import os
        if os.getenv("AUTO_DISPATCH_INFERENCE", "0") == "1":
            try:
                InferenceDispatcher().dispatch_segment(segment_id=segment.id, job_id=job.id)
                video.refresh_from_db()
            except Exception:
                pass

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


class VideoAnalysisView(APIView):
    """
    GET /v1/content/youtube/<video_id>/analysis
    Returns detailed multi-component score breakdown, individual metrics, and strategy comparisons.
    """
    def get(self, request, video_id: str):
        try:
            video = Video.objects.prefetch_related(
                'segments',
                'segments__component_scores'
            ).get(video_id=video_id)
        except Video.DoesNotExist:
            return Response(
                {"error": "Video not found", "videoId": video_id},
                status=status.HTTP_404_NOT_FOUND
            )

        segment_data = []
        all_component_scores = []
        modality_totals = {}
        modality_counts = {}

        for seg in video.segments.all():
            comp_list = []
            for cs in seg.component_scores.all():
                comp_list.append({
                    "componentName": cs.component_name,
                    "modality": cs.modality,
                    "score": cs.score,
                    "confidence": cs.confidence,
                    "status": cs.status,
                    "executionTimeMs": cs.execution_time_ms,
                    "details": cs.details,
                    "errorMessage": cs.error_message,
                })
                if cs.status == "SUCCESS" and cs.score is not None:
                    all_component_scores.append(cs)
                    modality_totals[cs.modality] = modality_totals.get(cs.modality, 0.0) + cs.score
                    modality_counts[cs.modality] = modality_counts.get(cs.modality, 0) + 1

            segment_data.append({
                "segmentIndex": seg.segment_index,
                "bounds": [seg.start_seconds, seg.end_seconds],
                "coverageStatus": seg.coverage_status,
                "aiSegmentScore": seg.ai_segment_score,
                "components": comp_list,
            })

        modality_averages = {
            m: round(modality_totals[m] / modality_counts[m], 4)
            for m in modality_totals
        }

        response_data = {
            "videoId": video.video_id,
            "status": video.status,
            "label": video.label,
            "aiRelianceScore": video.ai_reliance_score,
            "confidence": video.confidence,
            "analyzedAt": video.analyzed_at.isoformat() if video.analyzed_at else None,
            "segments": segment_data,
            "strategyComparison": {
                "modalityAverages": modality_averages,
                "componentsEvaluated": sorted(list({cs.component_name for cs in all_component_scores})),
                "totalEvaluations": len(all_component_scores),
            }
        }
        return Response(response_data, status=status.HTTP_200_OK)
