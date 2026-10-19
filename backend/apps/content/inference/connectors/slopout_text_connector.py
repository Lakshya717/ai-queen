"""
SlopOut Transcript NLP Connector.
Hardcodes input preparation (extracting and formatting transcript cues into clean text)
and output collection (gathering chunk statistics and language details) for RoBERTa text scoring.
"""

from typing import Any, Optional
from ..base_connector import BaseComponentConnector, CollectedScoreRecord
from ..context import SegmentContext
from ..scorers import slopout_text


class SlopOutTextConnector(BaseComponentConnector):
    name = "slopout_text"
    modality = "text"

    def prepare_input(self, context: SegmentContext) -> Optional[Any]:
        """
        Hardcoded input preparation:
        Extracts transcript text from context. Returns None if text is absent or insufficient.
        """
        text = context.transcript_text
        if not text or len(text.split()) < 20:
            return None

        return {
            "text": text,
            "cues_count": len(context.transcript_cues),
        }

    def invoke_component(self, component_input: Any) -> Any:
        """
        Calls slopout_text.score_text on the prepared transcript text.
        """
        raw_result = slopout_text.score_text(component_input["text"])
        return {
            "raw": raw_result,
            "cues_count": component_input["cues_count"],
        }

    def collect_output(self, raw_output: Any) -> CollectedScoreRecord:
        """
        Hardcoded output collection:
        Extracts primary score and chunk-level diagnostics.
        """
        raw = raw_output.get("raw")
        if not raw:
            return CollectedScoreRecord(
                component_name=self.name,
                modality=self.modality,
                score=None,
                status="SKIPPED",
                details={"reason": "Transcript text was insufficient or contained no valid chunks"},
            )

        details = {
            "mean_chunk_score": raw.get("mean", 0.0),
            "max_chunk_score": raw.get("max", 0.0),
            "std_chunk_score": raw.get("std", 0.0),
            "chunks_count": raw.get("chunks_count", 0),
            "per_chunk_scores": raw.get("per_chunk", []),
            "total_words": raw.get("total_words", 0),
            "cues_used": raw_output.get("cues_count", 0),
            "model_used": raw.get("model_used", "none"),
        }

        return CollectedScoreRecord(
            component_name=self.name,
            modality=self.modality,
            score=raw.get("mean"),
            confidence=0.85,
            status="SUCCESS",
            details=details,
        )
