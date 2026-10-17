import { TimeInterval } from './TimeInterval';

export type CoverageStatus = 'missing' | 'partial' | 'complete';

export class VideoSegment {
  constructor(
    public readonly videoId: string,
    public readonly index: number,
    public readonly bounds: TimeInterval,
    public readonly backendCoverage: CoverageStatus,
    public readonly observedIntervals: ReadonlyArray<TimeInterval> = []
  ) {}

  public clampObservation(rawInterval: TimeInterval): TimeInterval | null {
    return this.bounds.intersect(rawInterval);
  }

  public withAddedObservation(rawInterval: TimeInterval): VideoSegment {
    const clamped = this.clampObservation(rawInterval);
    if (!clamped) return this;
    const merged = TimeInterval.mergeContiguous([...this.observedIntervals, clamped]);
    return new VideoSegment(this.videoId, this.index, this.bounds, this.backendCoverage, merged);
  }

  public get observedDurationSeconds(): number {
    return this.observedIntervals.reduce((acc, interval) => acc + interval.durationSeconds, 0);
  }
}
