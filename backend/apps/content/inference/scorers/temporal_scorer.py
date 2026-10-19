"""
Temporal Dynamics & Inter-Frame Consistency Scorer.
Analyzes frame-to-frame pixel and luminance deltas across ordered video frames
to detect unnatural temporal jitter, generative warping, and motionless frame freezes.
"""

import numpy as np
from typing import List, Tuple, Dict, Any, Optional
from PIL import Image


def analyze_temporal(ordered_frames: List[Tuple[float, Image.Image]]) -> Optional[Dict[str, Any]]:
    """
    Analyzes pairwise temporal changes across chronologically sorted (timestamp, PIL_Image) frames.
    Returns dictionary with temporal metrics, delta statistics, jitter index, and freeze ratio.
    """
    if len(ordered_frames) < 2:
        return None

    # Resize to standardized low resolution (128x128) grayscale for fast, lightweight vectorized math
    small_grays = []
    for t, img in ordered_frames:
        g = np.array(img.convert("L").resize((128, 128), Image.Resampling.BILINEAR), dtype=np.float32)
        small_grays.append((t, g))

    pair_metrics = []
    deltas = []
    static_count = 0

    for i in range(len(small_grays) - 1):
        t_prev, g_prev = small_grays[i]
        t_curr, g_curr = small_grays[i + 1]
        dt = max(0.01, t_curr - t_prev)

        # Mean absolute difference in pixel intensity (0 to 255)
        diff = np.mean(np.abs(g_curr - g_prev))
        deltas.append(diff)

        if diff < 1.0:
            static_count += 1

        pair_metrics.append({
            "t_prev": round(t_prev, 3),
            "t_curr": round(t_curr, 3),
            "dt": round(dt, 3),
            "luminance_delta": round(float(diff), 3),
        })

    mean_delta = float(np.mean(deltas))
    max_delta = float(np.max(deltas))
    var_delta = float(np.var(deltas)) if len(deltas) > 1 else 0.0
    static_ratio = float(static_count / len(deltas))

    # Jitter index: high variance in frame deltas without camera cut indicates morphing/warping
    # Scaled to [0.0, 1.0] sigmoid-like metric
    jitter_index = float(min(1.0, max(0.0, (var_delta / 100.0))))

    # Synthetic temporal score: combines high jitter with static freezing heuristics
    # (pure static presentation is neutral ~0.5; unnatural jitter approaches 1.0; natural smooth motion ~0.2)
    if static_ratio > 0.8:
        temporal_score = 0.50  # Neutral for slideshows/static graphics
    else:
        temporal_score = float(np.clip(0.20 + 0.60 * jitter_index, 0.0, 1.0))

    return {
        "temporal_score": round(temporal_score, 4),
        "frame_pairs_analyzed": len(deltas),
        "mean_abs_luminance_delta": round(mean_delta, 3),
        "max_abs_luminance_delta": round(max_delta, 3),
        "delta_variance": round(var_delta, 3),
        "temporal_jitter_index": round(jitter_index, 3),
        "static_freeze_ratio": round(static_ratio, 3),
        "pair_metrics": pair_metrics,
    }
