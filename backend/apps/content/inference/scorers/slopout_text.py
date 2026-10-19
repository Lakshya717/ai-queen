"""
SlopOut Transcript NLP Scorer.
Evaluates video transcripts by chunking text into 120-word windows and scoring them
with the team's RoBERTa classifier (Hello-SimpleAI/chatgpt-detector-roberta).
"""

import re
import numpy as np
from typing import Dict, Any, Optional

AI_LABELS = {"chatgpt", "ai", "fake", "machine", "synthetic"}
_pipe_txt = None


def _get_txt_pipeline():
    global _pipe_txt
    if _pipe_txt is None:
        import os
        if os.getenv("MOCK_INFERENCE_MODELS", "0") == "1":
            return None
        try:
            from transformers import pipeline
            _pipe_txt = pipeline("text-classification", model="Hello-SimpleAI/chatgpt-detector-roberta", top_k=None)
        except Exception:
            return None
    return _pipe_txt


def _extract_ai_prob(pipe_output) -> float:
    if pipe_output and isinstance(pipe_output[0], list):
        pipe_output = pipe_output[0]
    for d in pipe_output:
        label = d.get("label", "").lower()
        if any(k in label for k in AI_LABELS):
            return float(d.get("score", 0.0))
    for d in pipe_output:
        label = d.get("label", "").lower()
        if "human" in label or "real" in label:
            return 1.0 - float(d.get("score", 0.0))
    return 0.5


def score_text(text: str, words_per_chunk: int = 120, max_chunks: int = 15) -> Optional[Dict[str, Any]]:
    """
    Evaluates a transcript string.
    Returns per-chunk probabilities, mean, max, and chunk count.
    """
    if not text or not text.strip():
        return None

    words = re.sub(r"\s+", " ", text).split()
    if len(words) < 20:
        return None

    chunks = [" ".join(words[i:i + words_per_chunk]) for i in range(0, len(words), words_per_chunk)]
    chunks = [c for c in chunks if len(c.split()) >= 20][:max_chunks]
    if not chunks:
        return None

    try:
        pipe = _get_txt_pipeline()
        probs = []
        for c in chunks:
            out = pipe(c, truncation=True, max_length=512)
            probs.append(_extract_ai_prob(out))
        model_used = "roberta_hc3"
    except Exception:
        # Fallback for offline or test environments
        probs = [0.5 for _ in chunks]
        model_used = "heuristic_fallback"

    mean_val = float(np.mean(probs))
    max_val = float(np.max(probs))
    std_val = float(np.std(probs)) if len(probs) > 1 else 0.0

    return {
        "mean": round(mean_val, 4),
        "max": round(max_val, 4),
        "std": round(std_val, 4),
        "chunks_count": len(chunks),
        "per_chunk": [round(p, 4) for p in probs],
        "total_words": len(words),
        "model_used": model_used,
    }
