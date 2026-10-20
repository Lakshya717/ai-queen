import { TimeInterval } from '../models/TimeInterval';
import type { ISegmentationStrategy } from '../../ports/ISegmentationStrategy';

export class ConfigurableFixedSegmentationStrategy implements ISegmentationStrategy {
  constructor(private segmentDurationSeconds = 30) {
    if (segmentDurationSeconds <= 0) {
      throw new RangeError('Segment duration must be positive');
    }
  }

  public setSegmentDuration(segmentDurationSeconds: number): void {
    if (!Number.isFinite(segmentDurationSeconds) || segmentDurationSeconds <= 0) {
      throw new RangeError('Segment duration must be positive');
    }
    this.segmentDurationSeconds = segmentDurationSeconds;
  }

  public getSegmentDuration(): number {
    return this.segmentDurationSeconds;
  }

  public getSegmentIndexForTimestamp(timestampSeconds: number): number {
    if (timestampSeconds < 0) return 0;
    return Math.floor(timestampSeconds / this.segmentDurationSeconds);
  }

  public getSegmentBounds(index: number, videoDurationSeconds?: number): TimeInterval {
    const start = index * this.segmentDurationSeconds;
    let end = (index + 1) * this.segmentDurationSeconds;
    if (videoDurationSeconds != null && Number.isFinite(videoDurationSeconds) && videoDurationSeconds > start) {
      end = Math.min(end, videoDurationSeconds);
    }
    return new TimeInterval(start, end);
  }

  public getTotalSegments(videoDurationSeconds: number): number {
    if (!videoDurationSeconds || videoDurationSeconds <= 0) return 0;
    return Math.ceil(videoDurationSeconds / this.segmentDurationSeconds);
  }
}
