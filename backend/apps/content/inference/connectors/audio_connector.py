"""
Audio Signal Connector.
Hardcodes input preparation (validating WebM Opus audio chunks) and output collection
(gathering duration, silence ratio, and acoustic metrics) for audio signal analysis.
"""

from typing import Any, List, Tuple, Optional
from pathlib import Path
from ..base_connector import BaseComponentConnector, CollectedScoreRecord
from ..context import SegmentContext
from ..scorers import audio_scorer


class AudioSignalConnector(BaseComponentConnector):
    name = "audio_signal"
    modality = "audio"

    def prepare_input(self, context: SegmentContext) -> Optional[Any]:
        """
        Hardcoded input preparation:
        Extracts valid, non-empty audio files paired with observation intervals.
        Returns None if no audio files exist in the segment.
        """
        if not context.audio_paths:
            return None

        audio_chunks: List[Tuple[Path, float, float]] = []
        for idx, path in enumerate(context.audio_paths):
            if path.exists() and path.stat().st_size > 0:
                s, e = context.audio_intervals[idx] if idx < len(context.audio_intervals) else context.segment_bounds
                audio_chunks.append((path, s, e))

        if not audio_chunks:
            return None

        return audio_chunks

    def invoke_component(self, component_input: Any) -> Any:
        """
        Calls audio_scorer.analyze_audio on the validated audio chunks.
        """
        return audio_scorer.analyze_audio(component_input)

    def collect_output(self, raw_output: Any) -> CollectedScoreRecord:
        """
        Hardcoded output collection:
        Extracts duration, byte count, chunk metrics, and synthetic audio score.
        """
        if not raw_output:
            return CollectedScoreRecord(
                component_name=self.name,
                modality=self.modality,
                score=None,
                status="SKIPPED",
                details={"reason": "No valid audio chunks found for this segment"},
            )

        details = {
            "chunks_count": raw_output.get("chunks_count", 0),
            "total_duration_seconds": raw_output.get("total_duration_seconds", 0.0),
            "total_bytes": raw_output.get("total_bytes", 0),
            "mime_type": raw_output.get("mime_type", "audio/webm;codecs=opus"),
            "chunks_summary": raw_output.get("chunks_summary", []),
        }

        return CollectedScoreRecord(
            component_name=self.name,
            modality=self.modality,
            score=raw_output.get("audio_score"),
            confidence=0.60,
            status="SUCCESS",
            details=details,
        )
