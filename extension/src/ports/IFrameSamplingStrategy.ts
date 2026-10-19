export interface IFrameSamplingStrategy {
  /**
   * Evaluates whether a visual frame should be sampled at the current playback time.
   * If true, updates internal keyframe reference and capture timestamp.
   *
   * @param video The active HTMLVideoElement being observed.
   * @param currentVideoTime The current playback timestamp in seconds.
   * @returns true if a new keyframe sample is due; false otherwise.
   */
  shouldSample(video: HTMLVideoElement, currentVideoTime: number): boolean;

  /**
   * Resets internal keyframe buffer and timestamps (called on segment rollover, seek, or gate close).
   */
  reset(): void;
}
