"""
SlopOut Visual Connector.
Hardcodes input preparation (loading saved JPEG files into PIL Images) and output collection
(gathering per-frame probabilities, variance, and peak anomaly metadata) for SlopOut visual scoring.
"""

from typing import Any, List, Optional
from PIL import Image
from ..base_connector import BaseComponentConnector, CollectedScoreRecord
from ..context import SegmentContext
from ..scorers import slopout_visual


class SlopOutVisualConnector(BaseComponentConnector):
    name = "slopout_visual"
    modality = "visual"

    def prepare_input(self, context: SegmentContext) -> Optional[Any]:
        """
        Hardcoded input preparation:
        Extracts frame paths, verifies their existence on disk, and opens them as RGB PIL Images.
        """
        if not context.frame_paths:
            return None

        images: List[Image.Image] = []
        timestamps: List[float] = []
        filenames: List[str] = []

        for idx, path in enumerate(context.frame_paths):
            if path.exists():
                try:
                    img = Image.open(path).convert("RGB")
                    images.append(img)
                    t = context.frame_timestamps[idx] if idx < len(context.frame_timestamps) else 0.0
                    timestamps.append(t)
                    filenames.append(path.name)
                except Exception:
                    pass

        if not images:
            return None

        return {
            "images": images,
            "timestamps": timestamps,
            "filenames": filenames,
        }

    def invoke_component(self, component_input: Any) -> Any:
        """
        Calls slopout_visual.score_frames on the opened images.
        """
        images = component_input["images"]
        raw_result = slopout_visual.score_frames(images)
        return {
            "raw": raw_result,
            "timestamps": component_input["timestamps"],
            "filenames": component_input["filenames"],
        }

    def collect_output(self, raw_output: Any) -> CollectedScoreRecord:
        """
        Hardcoded output collection:
        Extracts primary score, standard deviation, and attaches timestamps/filenames to per-frame details.
        """
        raw = raw_output["raw"]
        timestamps = raw_output["timestamps"]
        filenames = raw_output["filenames"]
        per_frame_probs = raw.get("per_frame", [])

        # Build detailed frame breakdown
        frame_details = []
        for i, p in enumerate(per_frame_probs):
            t = timestamps[i] if i < len(timestamps) else 0.0
            name = filenames[i] if i < len(filenames) else f"frame_{i}.jpg"
            frame_details.append({
                "index": i,
                "timestamp": round(t, 3),
                "prob": p,
                "filename": name,
            })

        peak_idx = raw.get("peak_frame_index", 0)
        peak_t = timestamps[peak_idx] if peak_idx < len(timestamps) else 0.0

        model_used = raw.get("model_used", "none")
        confidence = 0.85 if "clip" in model_used else 0.70 if "vit" in model_used else 0.50

        # Collect variety of structured details
        details = {
            "mean_prob": raw.get("mean", 0.0),
            "max_prob": raw.get("max", 0.0),
            "std_prob": raw.get("std", 0.0),
            "frame_count": raw.get("frame_count", len(frame_details)),
            "peak_frame_index": peak_idx,
            "peak_frame_timestamp": round(peak_t, 3),
            "model_used": model_used,
            "per_frame": frame_details,
        }

        return CollectedScoreRecord(
            component_name=self.name,
            modality=self.modality,
            score=raw.get("mean"),
            confidence=confidence,
            status="SUCCESS",
            details=details,
        )
