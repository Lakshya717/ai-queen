"""
SegmentContext for Multi-Component AI Inference.
Constructs an immutable snapshot of all multimodal evidence (frames, audio chunks,
transcript cues, observation intervals) for a video segment.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import json


@dataclass(frozen=True)
class SegmentContext:
    video_id: str
    segment_index: int
    segment_bounds: Tuple[float, float]
    coverage_status: str
    frame_paths: Tuple[Path, ...]
    frame_timestamps: Tuple[float, ...]
    audio_paths: Tuple[Path, ...]
    audio_intervals: Tuple[Tuple[float, float], ...]
    transcript_text: Optional[str]
    transcript_cues: Tuple[Dict[str, Any], ...]
    manifest_raw: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_manifest_file(cls, manifest_path: Path, media_root: Path) -> "SegmentContext":
        """
        Parses a manifest.json file and constructs a SegmentContext with absolute paths.
        """
        if not manifest_path.exists():
            raise FileNotFoundError(f"Segment manifest not found at: {manifest_path}")

        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        video_id = raw.get("video_id", "")
        segment_index = int(raw.get("segment_index", 0))
        bounds_raw = raw.get("segment_bounds", {})
        bounds = (float(bounds_raw.get("start_seconds", 0.0)), float(bounds_raw.get("end_seconds", 30.0)))
        coverage_status = raw.get("coverage_status", "missing")

        frame_paths: List[Path] = []
        frame_timestamps: List[float] = []
        for f in raw.get("frames", []):
            rel = f.get("file_path")
            if rel:
                abs_p = (media_root / rel).resolve()
                if abs_p.exists():
                    frame_paths.append(abs_p)
                    frame_timestamps.append(float(f.get("video_timestamp_seconds", 0.0)))

        audio_paths: List[Path] = []
        audio_intervals: List[Tuple[float, float]] = []
        for a in raw.get("audio_chunks", []):
            rel = a.get("file_path")
            if rel:
                abs_p = (media_root / rel).resolve()
                if abs_p.exists():
                    audio_paths.append(abs_p)
                    audio_intervals.append((float(a.get("start_seconds", bounds[0])), float(a.get("end_seconds", bounds[1]))))

        cues = raw.get("segment_cues", [])
        text_parts = [c.get("text", "").strip() for c in cues if c.get("text", "").strip()]
        full_text = " ".join(text_parts) if text_parts else None

        return cls(
            video_id=video_id,
            segment_index=segment_index,
            segment_bounds=bounds,
            coverage_status=coverage_status,
            frame_paths=tuple(frame_paths),
            frame_timestamps=tuple(frame_timestamps),
            audio_paths=tuple(audio_paths),
            audio_intervals=tuple(audio_intervals),
            transcript_text=full_text,
            transcript_cues=tuple(cues),
            manifest_raw=raw,
        )
