import type { TimeInterval } from '../domain/models/TimeInterval';

export interface ISegmentationStrategy {
  getSegmentDuration(): number;
  getSegmentIndexForTimestamp(timestampSeconds: number): number;
  getSegmentBounds(index: number, videoDurationSeconds?: number): TimeInterval;
  getTotalSegments(videoDurationSeconds: number): number;
}
