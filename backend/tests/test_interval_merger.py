"""
Unit Tests for Interval Merger & Sufficiency Evaluation.
"""

from django.test import TestCase
from apps.content.services.interval_merger import (
    clamp_interval,
    merge_intervals,
    calculate_coverage_duration,
    compute_remaining_intervals,
    evaluate_segment_sufficiency,
)


class IntervalMergerTests(TestCase):
    def test_clamp_interval(self):
        # Within bounds
        self.assertEqual(clamp_interval((10.0, 20.0), 0.0, 30.0), (10.0, 20.0))
        # Spanning left bound
        self.assertEqual(clamp_interval((-5.0, 15.0), 0.0, 30.0), (0.0, 15.0))
        # Spanning right bound
        self.assertEqual(clamp_interval((25.0, 35.0), 0.0, 30.0), (25.0, 30.0))
        # Spanning entire segment
        self.assertEqual(clamp_interval((-10.0, 40.0), 0.0, 30.0), (0.0, 30.0))
        # Outside bounds
        self.assertIsNone(clamp_interval((35.0, 50.0), 0.0, 30.0))
        self.assertIsNone(clamp_interval((-20.0, -5.0), 0.0, 30.0))
        # Zero duration
        self.assertIsNone(clamp_interval((10.0, 10.0), 0.0, 30.0))

    def test_merge_intervals_disjoint(self):
        existing = [(0.0, 10.0)]
        new_ivs = [(20.0, 30.0)]
        merged = merge_intervals(existing, new_ivs)
        self.assertEqual(merged, [(0.0, 10.0), (20.0, 30.0)])

    def test_merge_intervals_overlapping(self):
        existing = [(10.0, 25.0)]
        new_ivs = [(20.0, 40.0)]
        merged = merge_intervals(existing, new_ivs)
        self.assertEqual(merged, [(10.0, 40.0)])

    def test_merge_intervals_within_epsilon(self):
        # Gap is 0.15s, which is <= default epsilon (0.25s)
        existing = [(0.0, 10.0)]
        new_ivs = [(10.15, 20.0)]
        merged = merge_intervals(existing, new_ivs, epsilon=0.25)
        self.assertEqual(merged, [(0.0, 20.0)])

    def test_merge_intervals_outside_epsilon(self):
        # Gap is 0.5s, which is > epsilon (0.25s)
        existing = [(0.0, 10.0)]
        new_ivs = [(10.5, 20.0)]
        merged = merge_intervals(existing, new_ivs, epsilon=0.25)
        self.assertEqual(merged, [(0.0, 10.0), (10.5, 20.0)])

    def test_multi_viewer_gap_filling(self):
        # Viewer A watches [10, 48)
        # Clamped to seg 0 [0, 30) -> [10, 30)
        # Clamped to seg 1 [30, 60) -> [30, 48)
        seg0_existing = [(10.0, 30.0)]
        # Viewer B later watches [0, 10)
        seg0_merged = merge_intervals(seg0_existing, [(0.0, 10.0)])
        self.assertEqual(seg0_merged, [(0.0, 30.0)])
        self.assertEqual(calculate_coverage_duration(seg0_merged), 30.0)

        # Seg 1: Viewer A [30, 48), Viewer B watches [48, 60)
        seg1_existing = [(30.0, 48.0)]
        seg1_merged = merge_intervals(seg1_existing, [(48.0, 60.0)])
        self.assertEqual(seg1_merged, [(30.0, 60.0)])
        self.assertEqual(calculate_coverage_duration(seg1_merged), 30.0)

    def test_compute_remaining_intervals(self):
        # Empty merged -> whole segment remaining
        self.assertEqual(compute_remaining_intervals(0.0, 30.0, []), [(0.0, 30.0)])

        # Single partial interval in middle
        self.assertEqual(
            compute_remaining_intervals(0.0, 30.0, [(10.0, 20.0)]),
            [(0.0, 10.0), (20.0, 30.0)]
        )

        # Full coverage
        self.assertEqual(
            compute_remaining_intervals(0.0, 30.0, [(0.0, 30.0)]),
            []
        )

    def test_evaluate_segment_sufficiency(self):
        # 30s segment
        # 1. Zero coverage -> missing
        self.assertEqual(evaluate_segment_sufficiency(0.0, 30.0), 'missing')

        # 2. 50% coverage -> partial
        self.assertEqual(evaluate_segment_sufficiency(15.0, 30.0, frame_count=5), 'partial')

        # 3. 96% coverage without enough frames or audio -> partial (needs modality)
        self.assertEqual(evaluate_segment_sufficiency(29.0, 30.0, frame_count=1, audio_duration=5.0), 'partial')

        # 4. 96% coverage with 2 frames -> complete
        self.assertEqual(evaluate_segment_sufficiency(29.0, 30.0, frame_count=2, audio_duration=0.0), 'complete')

        # 5. 96% coverage with >=15s audio -> complete
        self.assertEqual(evaluate_segment_sufficiency(29.0, 30.0, frame_count=0, audio_duration=16.0), 'complete')
