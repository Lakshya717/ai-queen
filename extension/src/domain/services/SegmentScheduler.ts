import type { ISegmentationStrategy } from '../../ports/ISegmentationStrategy';

export class SegmentScheduler {
  private missingIndices = new Set<number>();
  private isUnmapped = false;

  constructor(private readonly segmentationStrategy: ISegmentationStrategy) {}

  public setUnmapped(unmapped: boolean): void {
    this.isUnmapped = unmapped;
  }

  public isUnmappedVideo(): boolean {
    return this.isUnmapped;
  }

  public updateMissingIndices(indices: ReadonlyArray<number>): void {
    this.missingIndices = new Set(indices);
    if (indices.length > 0) {
      this.isUnmapped = false;
    }
  }

  public isTimestampInMissingSegment(timestampSeconds: number): boolean {
    if (this.isUnmapped) {
      return true;
    }
    const segmentIndex = this.segmentationStrategy.getSegmentIndexForTimestamp(timestampSeconds);
    return this.missingIndices.has(segmentIndex);
  }

  public getSegmentIndex(timestampSeconds: number): number {
    return this.segmentationStrategy.getSegmentIndexForTimestamp(timestampSeconds);
  }

  public getMissingSegmentIndices(): number[] {
    return Array.from(this.missingIndices).sort((a, b) => a - b);
  }

  public hasAnyMissingSegments(): boolean {
    return this.isUnmapped || this.missingIndices.size > 0;
  }
}
