"""
Temporal Consistency Connector.
Hardcodes input preparation (ordering frames by timestamp and loading images) and output collection
(gathering luminance deltas, jitter indices, and freeze ratios) for temporal frame dynamics.
"""

from typing import Any, List, Tuple, Optional
from PIL import Image
from ..base_connector import BaseComponentConnector, CollectedScoreRecord
from ..context import SegmentContext
from ..scorers import temporal_scorer


class TemporalConsistencyConnector(BaseComponentConnector):
    name = "temporal_consistency"
    modality = "temporal"

    def prepare_input(self, context: SegmentContext) -> Optional[Any]:
        """
        Hardcoded input preparation:
        Sorts frames chronologically by video_timestamp_seconds and loads PIL Images.
        Requires at least 2 valid frames.
        """
        if len(context.frame_paths) < 2:
            return None

        paired = []
        for idx, path in enumerate(context.frame_paths):
            if path.exists():
                t = context.frame_timestamps[idx] if idx < len(context.frame_timestamps) else float(idx)
                paired.append((t, path))

        paired.sort(key=lambda x: x[0])
        if len(paired) < 2:
            return None

        ordered_frames: List[Tuple[float, Image.Image]] = []
        for t, path in paired:
            try:
                img = Image.open(path)
                ordered_frames.append((t, img))
            except Exception:
                pass

        if len(ordered_frames) < 2:
            return None

        return ordered_frames

    def invoke_component(self, component_input: Any) -> Any:
        """
        Calls temporal_scorer.analyze_temporal on the chronologically ordered frames.
        """
        return temporal_scorer.analyze_temporal(component_input)

    def collect_output(self, raw_output: Any) -> CollectedScoreRecord:
        """
        Hardcoded output collection:
        Extracts temporal score, jitter index, luminance variance, and pair metrics.
        """
        if not raw_output:
            return CollectedScoreRecord(
                component_name=self.name,
                modality=self.modality,
                score=None,
                status="SKIPPED",
                details={"reason": "Insufficient consecutive frames for temporal pairwise analysis"},
            )

        details = {
            "mean_abs_luminance_delta": raw_output.get("mean_abs_luminance_delta", 0.0),
            "max_abs_luminance_delta": raw_output.get("max_abs_luminance_delta", 0.0),
            "delta_variance": raw_output.get("delta_variance", 0.0),
            "temporal_jitter_index": raw_output.get("temporal_jitter_index", 0.0),
            "static_freeze_ratio": raw_output.get("static_freeze_ratio", 0.0),
            "frame_pairs_analyzed": raw_output.get("frame_pairs_analyzed", 0),
            "pair_metrics": raw_output.get("pair_metrics", []),
        }

        return CollectedScoreRecord(
            component_name=self.name,
            modality=self.modality,
            score=raw_output.get("temporal_score"),
            confidence=0.75,
            status="SUCCESS",
            details=details,
        )
