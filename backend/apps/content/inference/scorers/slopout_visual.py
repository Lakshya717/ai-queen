"""
SlopOut Visual Scorer.
Evaluates sampled video frames using the team's visual AI detection pipeline
(CLIP ViT-B/32 + Logistic Regression with fallback to umm-maybe/AI-image-detector).
"""

import os
import math
import numpy as np
from typing import List, Dict, Any, Optional
from pathlib import Path
from PIL import Image

AI_LABELS = {"artificial", "ai", "fake", "generated", "ai-generated", "synthetic", "chatgpt", "machine"}
MODEL_SEARCH_PATHS = [
    Path("clip_lr.joblib"),
    Path("../kannabiran_AI_Project/slopout/backend/clip_lr.joblib"),
    Path("C:/Users/Lakshya/Desktop/kannabiran_AI_Project/slopout/backend/clip_lr.joblib"),
]

_pipe_vit = None
_clip_model = None
_clip_proc = None
_clf = None
_clf_attempted = False


def _load_trained_clf():
    global _clf, _clf_attempted
    if _clf_attempted:
        return _clf
    _clf_attempted = True
    for p in MODEL_SEARCH_PATHS:
        if p.exists():
            try:
                import joblib
                _clf = joblib.load(str(p))
                return _clf
            except Exception:
                pass
    return None


def _get_vit_pipeline():
    global _pipe_vit
    if _pipe_vit is None:
        if os.getenv("MOCK_INFERENCE_MODELS", "0") == "1":
            return None
        try:
            from transformers import pipeline
            _pipe_vit = pipeline("image-classification", model="umm-maybe/AI-image-detector", top_k=None)
        except Exception:
            return None
    return _pipe_vit


def _extract_ai_prob(pipe_output) -> float:
    if pipe_output and isinstance(pipe_output[0], list):
        pipe_output = pipe_output[0]
    for d in pipe_output:
        label = d.get("label", "").lower()
        if any(k in label for k in AI_LABELS):
            return float(d.get("score", 0.0))
    # If no AI label matched, default to 1.0 - human score or fallback to 0.5
    for d in pipe_output:
        label = d.get("label", "").lower()
        if "human" in label or "real" in label:
            return 1.0 - float(d.get("score", 0.0))
    return 0.5


def _score_with_clip(images: List[Image.Image], clf) -> List[float]:
    global _clip_model, _clip_proc
    import torch
    from transformers import CLIPModel, CLIPProcessor
    if _clip_model is None:
        _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval()
        _clip_proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    with torch.no_grad():
        out = _clip_model.get_image_features(**_clip_proc(images=images, return_tensors="pt"))
    if not isinstance(out, torch.Tensor):
        out = getattr(out, "pooler_output", None)
    v = out.cpu().numpy()
    v_norm = v / np.linalg.norm(v, axis=1, keepdims=True)
    probs = clf.predict_proba(v_norm)[:, 1]
    return [float(p) for p in probs]


def score_frames(images: List[Image.Image]) -> Dict[str, Any]:
    """
    Evaluates a list of PIL Images.
    Returns dictionary with per_frame probabilities, mean, max, std, peak index, and model provenance.
    """
    if not images:
        return {
            "mean": 0.0,
            "max": 0.0,
            "std": 0.0,
            "per_frame": [],
            "peak_frame_index": 0,
            "model_used": "none",
            "frame_count": 0,
        }

    clf = _load_trained_clf()
    if clf is not None:
        try:
            probs = _score_with_clip(images, clf)
            model_used = "trained_clip"
        except Exception:
            clf = None

    if clf is None:
        try:
            pipe = _get_vit_pipeline()
            probs = []
            for img in images:
                out = pipe(img)
                probs.append(_extract_ai_prob(out))
            model_used = "pretrained_vit"
        except Exception:
            # Synthetic heuristic fallback when models are not loaded (e.g. offline testing)
            probs = [0.5 for _ in images]
            model_used = "heuristic_fallback"

    mean_val = float(np.mean(probs))
    max_val = float(np.max(probs))
    std_val = float(np.std(probs)) if len(probs) > 1 else 0.0
    peak_idx = int(np.argmax(probs))

    return {
        "mean": round(mean_val, 4),
        "max": round(max_val, 4),
        "std": round(std_val, 4),
        "per_frame": [round(p, 4) for p in probs],
        "peak_frame_index": peak_idx,
        "model_used": model_used,
        "frame_count": len(images),
    }
