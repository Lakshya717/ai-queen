"""
Multimodal Fusion Engine.
Fuses collected component scores into segment-level and video-level AI-reliance ratings,
normalizing weights across available modalities and applying classification thresholds.
"""

import math
from typing import List, Dict, Optional, Tuple
from django.utils import timezone
from ..models import Video, VideoSegment
from .base_connector import CollectedScoreRecord

DEFAULT_MODALITY_WEIGHTS: Dict[str, float] = {
    "visual": 0.50,
    "text": 0.30,
    "temporal": 0.10,
    "audio": 0.10,
}

AI_THRESHOLD = 0.70
MIXED_THRESHOLD = 0.35


class FusionEngine:
    def __init__(self, weights: Optional[Dict[str, float]] = None):
        self.weights = weights or dict(DEFAULT_MODALITY_WEIGHTS)

    def fuse_records(self, records: List[CollectedScoreRecord]) -> Tuple[Optional[float], Optional[float]]:
        """
        Combines a list of CollectedScoreRecords for a single segment.
        Returns (fused_score, fused_confidence).
        """
        valid_records = [r for r in records if r.status == "SUCCESS" and r.score is not None]
        if not valid_records:
            return None, None

        # Group by modality (average if multiple components in same modality)
        by_modality: Dict[str, List[CollectedScoreRecord]] = {}
        for r in valid_records:
            by_modality.setdefault(r.modality, []).append(r)

        modality_scores: Dict[str, float] = {}
        modality_confidences: Dict[str, float] = {}

        for m, recs in by_modality.items():
            modality_scores[m] = sum(r.score for r in recs) / len(recs)
            confs = [r.confidence for r in recs if r.confidence is not None]
            modality_confidences[m] = (sum(confs) / len(confs)) if confs else 0.70

        # Normalize weights over available modalities
        total_w = sum(self.weights.get(m, 0.10) for m in modality_scores)
        if total_w <= 0:
            total_w = 1.0

        fused_score = 0.0
        fused_conf = 0.0
        for m, s in modality_scores.items():
            w = self.weights.get(m, 0.10) / total_w
            fused_score += w * s
            fused_conf += w * modality_confidences.get(m, 0.70)

        return round(fused_score, 4), round(fused_conf, 4)

    def update_segment_score(self, segment: VideoSegment, records: List[CollectedScoreRecord]) -> Optional[float]:
        """
        Fuses records and saves ai_segment_score on VideoSegment.
        """
        score, _ = self.fuse_records(records)
        segment.ai_segment_score = score
        segment.save(update_fields=["ai_segment_score", "updated_at"])
        return score

    def aggregate_video_score(self, video: Video) -> Video:
        """
        Calculates whole-video score as a time-weighted average of completed segments.
        Updates video.ai_reliance_score, confidence, label, and status.
        """
        segments = list(video.segments.all())
        scored_segs = [s for s in segments if s.ai_segment_score is not None]

        if not scored_segs:
            return video

        total_weight = 0.0
        weighted_score_sum = 0.0

        for s in scored_segs:
            dur = max(1.0, s.end_seconds - s.start_seconds)
            weighted_score_sum += dur * s.ai_segment_score
            total_weight += dur

        final_score = weighted_score_sum / total_weight if total_weight > 0 else 0.0
        final_score = round(final_score, 4)

        if final_score >= AI_THRESHOLD:
            label = "AI_GENERATED"
        elif final_score >= MIXED_THRESHOLD:
            label = "MIXED"
        else:
            label = "HUMAN_MADE"

        video.ai_reliance_score = final_score
        video.confidence = 0.85
        video.label = label
        video.analyzed_at = timezone.now()

        # Check completeness
        total_expected = (
            int(math.ceil(video.duration_seconds / video.segment_duration_seconds))
            if video.duration_seconds > 0
            else len(segments)
        )
        all_done = (
            len(segments) >= total_expected
            and all(s.coverage_status == "complete" and s.ai_segment_score is not None for s in segments)
        )
        if all_done:
            video.status = "complete"
        elif video.status == "not_found":
            video.status = "partial"

        video.save()
        return video
