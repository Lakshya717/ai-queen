/**
 * Immutable half-open interval [startSeconds, endSeconds)
 * Enforces boundary clamping, overlap detection, and contiguous interval merging.
 */
export class TimeInterval {
  public readonly startSeconds: number;
  public readonly endSeconds: number;

  constructor(startSeconds: number, endSeconds: number) {
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0) {
      throw new RangeError(`Invalid interval bounds: [${startSeconds}, ${endSeconds})`);
    }
    if (endSeconds <= startSeconds) {
      throw new RangeError(
        `Half-open interval requires endSeconds > startSeconds: [${startSeconds}, ${endSeconds})`
      );
    }
    this.startSeconds = Number(startSeconds.toFixed(3));
    this.endSeconds = Number(endSeconds.toFixed(3));
  }

  public get durationSeconds(): number {
    return Number((this.endSeconds - this.startSeconds).toFixed(3));
  }

  public contains(timestampSeconds: number): boolean {
    return timestampSeconds >= this.startSeconds && timestampSeconds < this.endSeconds;
  }

  public intersect(other: TimeInterval): TimeInterval | null {
    const start = Math.max(this.startSeconds, other.startSeconds);
    const end = Math.min(this.endSeconds, other.endSeconds);
    return end > start ? new TimeInterval(start, end) : null;
  }

  public static mergeContiguous(
    intervals: ReadonlyArray<TimeInterval>,
    epsilonSeconds = 0.25
  ): TimeInterval[] {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.startSeconds - b.startSeconds);
    const merged: TimeInterval[] = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = sorted[i];
      if (curr.startSeconds <= prev.endSeconds + epsilonSeconds) {
        merged[merged.length - 1] = new TimeInterval(
          prev.startSeconds,
          Math.max(prev.endSeconds, curr.endSeconds)
        );
      } else {
        merged.push(curr);
      }
    }
    return merged;
  }

  public toJSON(): { startSeconds: number; endSeconds: number } {
    return {
      startSeconds: this.startSeconds,
      endSeconds: this.endSeconds,
    };
  }
}
