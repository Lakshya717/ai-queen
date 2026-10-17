"""
Deterministic Half-Open Interval Merging & Coverage Sufficiency Service.
Enforces the exact interval math required by the Chrome Extension and Backend Specification.
"""

from typing import List, Tuple, Optional


def clamp_interval(
    interval: Tuple[float, float],
    seg_start: float,
    seg_end: float
) -> Optional[Tuple[float, float]]:
    """
    Clamps a half-open interval [start, end) to segment bounds [seg_start, seg_end).
    Returns None if there is no valid overlap.
    """
    start, end = interval
    clamped_start = max(start, seg_start)
    clamped_end = min(end, seg_end)
    if clamped_end > clamped_start:
        return (round(clamped_start, 3), round(clamped_end, 3))
    return None


def merge_intervals(
    existing: List[Tuple[float, float]],
    new_intervals: List[Tuple[float, float]],
    epsilon: float = 0.25
) -> List[Tuple[float, float]]:
    """
    Deterministic half-open interval merging with epsilon tolerance (default 0.25s).
    Intervals are sorted by start time. Contiguous or near-contiguous intervals
    within epsilon are merged into a single atomic interval.
    """
    valid = [iv for iv in (existing + new_intervals) if iv[1] > iv[0]]
    if not valid:
        return []

    sorted_ivs = sorted(valid, key=lambda x: (x[0], x[1]))
    merged: List[Tuple[float, float]] = [sorted_ivs[0]]

    for curr_start, curr_end in sorted_ivs[1:]:
        prev_start, prev_end = merged[-1]
        if curr_start <= prev_end + epsilon:
            # Overlapping or within epsilon tolerance
            merged[-1] = (prev_start, max(prev_end, curr_end))
        else:
            merged.append((curr_start, curr_end))

    return [(round(s, 3), round(e, 3)) for s, e in merged]


def calculate_coverage_duration(intervals: List[Tuple[float, float]]) -> float:
    """Calculates total duration in seconds across disjoint merged intervals."""
    return round(sum(end - start for start, end in intervals), 3)


def compute_remaining_intervals(
    seg_start: float,
    seg_end: float,
    merged_intervals: List[Tuple[float, float]]
) -> List[Tuple[float, float]]:
    """
    Calculates uncovered gap intervals within [seg_start, seg_end)
    given already merged coverage intervals.
    """
    if not merged_intervals:
        return [(round(seg_start, 3), round(seg_end, 3))]

    remaining: List[Tuple[float, float]] = []
    current = seg_start

    for iv_start, iv_end in merged_intervals:
        # Clamp observation inside bounds
        effective_start = max(current, iv_start)
        effective_end = min(seg_end, iv_end)

        if effective_start > current:
            remaining.append((round(current, 3), round(effective_start, 3)))
        current = max(current, effective_end)

    if current < seg_end:
        remaining.append((round(current, 3), round(seg_end, 3)))

    return remaining


def evaluate_segment_sufficiency(
    covered_duration: float,
    seg_duration: float = 30.0,
    frame_count: int = 0,
    audio_duration: float = 0.0,
    threshold_ratio: float = 0.95
) -> str:
    """
    Evaluates segment coverage status according to Section 3.2 of the backend spec:
    - Complete: Coverage Ratio >= 0.95 AND (frame_count >= 2 OR audio_duration >= 15.0s)
    - Partial: Coverage Ratio > 0.0 but not yet complete
    - Missing: Coverage Ratio == 0.0
    """
    if seg_duration <= 0:
        return 'missing'

    ratio = covered_duration / seg_duration

    has_required_modality = (frame_count >= 2) or (audio_duration >= 15.0)

    if ratio >= threshold_ratio and has_required_modality:
        return 'complete'
    elif ratio > 0.0:
        return 'partial'
    else:
        return 'missing'
