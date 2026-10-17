export interface WatchContextSnapshot {
  readonly extensionEnabled: boolean;
  readonly acceptedPolicyVersion: string | null;
  readonly currentPolicyVersion: string;
  readonly contributionEnabled: boolean;
  readonly isTabActiveInWindow: boolean;
  readonly documentVisibility: DocumentVisibilityState;
  readonly isVideoPlaying: boolean;
  readonly isPlaybackTimeAdvancing: boolean; // Verified via monotonic delta > 0 across 250ms ticks
  readonly isVideoEndedOrSeeking: boolean;
  readonly hasMissingBackendSegments: boolean;
  readonly hasScreenshotOrAudioCapability: boolean;
}

export interface IGateSpecification {
  readonly id: string;
  isSatisfiedBy(ctx: WatchContextSnapshot): boolean;
  failureReason(ctx: WatchContextSnapshot): string | null;
}
