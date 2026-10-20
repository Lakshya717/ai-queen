import { TimeInterval } from '../models/TimeInterval';

export interface IntervalFlushEvent {
  readonly segmentIndex: number;
  readonly interval: TimeInterval;
  readonly reason: 'boundary_rollover' | 'seek_jump' | 'gate_closed' | 'session_stop' | 'periodic_chunk';
}

export class ObservedIntervalTracker {
  private openIntervalStart: number | null = null;
  private lastObservedTime: number | null = null;
  private currentSegmentIndex: number | null = null;

  constructor(
    private segmentDurationSeconds = 30,
    private readonly onIntervalFlush?: (event: IntervalFlushEvent) => void
  ) {}

  public setSegmentDuration(segmentDurationSeconds: number): void {
    if (!Number.isFinite(segmentDurationSeconds) || segmentDurationSeconds <= 0) {
      throw new RangeError('Segment duration must be positive');
    }
    this.segmentDurationSeconds = segmentDurationSeconds;
  }

  public onPlaybackTick(
    currentTime: number,
    wallClockDeltaMs: number,
    playbackRate = 1.0
  ): TimeInterval | null {
    if (!Number.isFinite(currentTime) || currentTime < 0) return null;

    const segmentIndex = Math.floor(currentTime / this.segmentDurationSeconds);
    const segmentBoundaryEnd = (segmentIndex + 1) * this.segmentDurationSeconds;

    // 1. First tick or after flush
    if (this.openIntervalStart === null || this.lastObservedTime === null) {
      this.openIntervalStart = currentTime;
      this.lastObservedTime = currentTime;
      this.currentSegmentIndex = segmentIndex;
      return null;
    }

    const deltaVideo = currentTime - this.lastObservedTime;
    const maxExpectedAdvance = (wallClockDeltaMs / 1000) * playbackRate + 0.35;

    // 2. Seek / scrub jump detected (gap > 1.25s or backward seek)
    if (deltaVideo < 0 || deltaVideo > 1.25) {
      const sealed = this.sealInterval(this.lastObservedTime, 'seek_jump');
      this.openIntervalStart = currentTime;
      this.lastObservedTime = currentTime;
      this.currentSegmentIndex = segmentIndex;
      return sealed;
    }

    // 3. Segment boundary rollover (e.g. crossed from 29.8s to 30.2s)
    if (segmentIndex !== this.currentSegmentIndex) {
      const prevBoundary = (this.currentSegmentIndex! + 1) * this.segmentDurationSeconds;
      const sealed = this.sealInterval(prevBoundary, 'boundary_rollover');
      this.openIntervalStart = prevBoundary;
      this.lastObservedTime = currentTime;
      this.currentSegmentIndex = segmentIndex;
      return sealed;
    }

    // 4. Normal playback advancement
    if (deltaVideo > 0 && deltaVideo <= maxExpectedAdvance) {
      this.lastObservedTime = currentTime;

      // Periodic chunk flush: if continuous playback within the segment reaches >= 10s,
      // flush the chunk to persist progress and update UI without waiting for full 30s
      if (this.openIntervalStart !== null && (currentTime - this.openIntervalStart) >= 10.0) {
        const sealed = this.sealInterval(currentTime, 'periodic_chunk');
        this.openIntervalStart = currentTime;
        this.lastObservedTime = currentTime;
        this.currentSegmentIndex = segmentIndex;
        return sealed;
      }
    }

    return null;
  }

  public flushOnGateClose(currentPlaybackTime?: number): TimeInterval | null {
    if (this.openIntervalStart === null || this.lastObservedTime === null) return null;
    const end = currentPlaybackTime != null && Number.isFinite(currentPlaybackTime)
      ? Math.max(this.openIntervalStart, currentPlaybackTime)
      : this.lastObservedTime;

    return this.sealInterval(end, 'gate_closed');
  }

  public reset(): void {
    this.openIntervalStart = null;
    this.lastObservedTime = null;
    this.currentSegmentIndex = null;
  }

  public getCurrentTrackingState(): {
    openIntervalStart: number | null;
    lastObservedTime: number | null;
    segmentIndex: number | null;
  } {
    return {
      openIntervalStart: this.openIntervalStart,
      lastObservedTime: this.lastObservedTime,
      segmentIndex: this.currentSegmentIndex,
    };
  }

  private sealInterval(
    endTime: number,
    reason: IntervalFlushEvent['reason']
  ): TimeInterval | null {
    if (this.openIntervalStart === null) return null;

    const start = this.openIntervalStart;
    const end = Math.max(start, endTime);
    this.openIntervalStart = null;
    this.lastObservedTime = null;

    if (end - start < 0.1) {
      // Discard sub-100ms noise
      return null;
    }

    try {
      const interval = new TimeInterval(start, end);
      const segmentIndex = this.currentSegmentIndex ?? Math.floor(start / this.segmentDurationSeconds);

      if (this.onIntervalFlush) {
        this.onIntervalFlush({
          segmentIndex,
          interval,
          reason,
        });
      }

      return interval;
    } catch {
      return null;
    }
  }
}
