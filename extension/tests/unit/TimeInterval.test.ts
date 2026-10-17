import { describe, it, expect } from 'vitest';
import { TimeInterval } from '../../src/domain/models/TimeInterval';
import { VideoSegment } from '../../src/domain/models/VideoSegment';

describe('TimeInterval Domain Math (Test #4 & Test #5)', () => {
  it('enforces half-open interval constraints [startSeconds, endSeconds)', () => {
    const iv = new TimeInterval(0, 30);
    expect(iv.startSeconds).toBe(0);
    expect(iv.endSeconds).toBe(30);
    expect(iv.durationSeconds).toBe(30);

    // Negative start throws
    expect(() => new TimeInterval(-1, 30)).toThrow(RangeError);
    // end <= start throws
    expect(() => new TimeInterval(30, 30)).toThrow(RangeError);
    expect(() => new TimeInterval(40, 30)).toThrow(RangeError);
    // Non-finite throws
    expect(() => new TimeInterval(NaN, 30)).toThrow(RangeError);
    expect(() => new TimeInterval(0, Infinity)).toThrow(RangeError);
  });

  it('correctly determines inclusion in half-open interval [start, end)', () => {
    const iv = new TimeInterval(10, 30);
    expect(iv.contains(9.999)).toBe(false);
    expect(iv.contains(10.0)).toBe(true);
    expect(iv.contains(20.5)).toBe(true);
    expect(iv.contains(29.999)).toBe(true);
    expect(iv.contains(30.0)).toBe(false); // boundary excluded
    expect(iv.contains(30.001)).toBe(false);
  });

  it('calculates exact interval intersections', () => {
    const seg0 = new TimeInterval(0, 30);
    const seg1 = new TimeInterval(30, 60);
    const watchA = new TimeInterval(10, 48); // Viewer A watches 10s to 48s

    const slice0 = seg0.intersect(watchA);
    expect(slice0).not.toBeNull();
    expect(slice0?.startSeconds).toBe(10);
    expect(slice0?.endSeconds).toBe(30);
    expect(slice0?.durationSeconds).toBe(20);

    const slice1 = seg1.intersect(watchA);
    expect(slice1).not.toBeNull();
    expect(slice1?.startSeconds).toBe(30);
    expect(slice1?.endSeconds).toBe(48);
    expect(slice1?.durationSeconds).toBe(18);

    const seg2 = new TimeInterval(60, 90);
    const slice2 = seg2.intersect(watchA);
    expect(slice2).toBeNull();
  });

  it('merges contiguous and overlapping intervals with epsilon tolerance', () => {
    const intervals = [
      new TimeInterval(10, 20),
      new TimeInterval(20.1, 30), // Within 0.25s epsilon
      new TimeInterval(45, 55),
    ];
    const merged = TimeInterval.mergeContiguous(intervals, 0.25);
    expect(merged).toHaveLength(2);
    expect(merged[0].startSeconds).toBe(10);
    expect(merged[0].endSeconds).toBe(30);
    expect(merged[1].startSeconds).toBe(45);
    expect(merged[1].endSeconds).toBe(55);
  });

  it('clamps observations onto VideoSegment without over-claiming coverage', () => {
    const seg0 = new VideoSegment('vid123', 0, new TimeInterval(0, 30), 'missing');
    const updated = seg0.withAddedObservation(new TimeInterval(10, 48)); // viewer watched 10-48s

    expect(updated.observedIntervals).toHaveLength(1);
    expect(updated.observedIntervals[0].startSeconds).toBe(10);
    expect(updated.observedIntervals[0].endSeconds).toBe(30);
    expect(updated.observedDurationSeconds).toBe(20);
  });
});
