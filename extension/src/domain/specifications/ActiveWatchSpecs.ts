import type { IGateSpecification, WatchContextSnapshot } from './IGateSpecification';

export class ExtensionEnabledSpec implements IGateSpecification {
  public readonly id = 'extension_enabled';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.extensionEnabled;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Extension is disabled in user settings.';
  }
}

export class PolicyVersionMatchSpec implements IGateSpecification {
  public readonly id = 'policy_version_match';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.acceptedPolicyVersion !== null && ctx.acceptedPolicyVersion === ctx.currentPolicyVersion;
  }
  public failureReason(ctx: WatchContextSnapshot): string | null {
    if (!ctx.acceptedPolicyVersion) return 'Data collection policy has not been accepted.';
    return `Accepted policy version (${ctx.acceptedPolicyVersion}) does not match current version (${ctx.currentPolicyVersion}).`;
  }
}

export class UserContributionEnabledSpec implements IGateSpecification {
  public readonly id = 'user_contribution_enabled';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.contributionEnabled;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Crowdsourced contribution is toggled off in settings.';
  }
}

export class TabAndDocumentVisibleSpec implements IGateSpecification {
  public readonly id = 'tab_and_document_visible';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.isTabActiveInWindow && ctx.documentVisibility === 'visible';
  }
  public failureReason(ctx: WatchContextSnapshot): string | null {
    if (!ctx.isTabActiveInWindow) return 'YouTube tab is not the active tab in focused window.';
    return 'Document visibility is hidden or minimized.';
  }
}

export class VideoPlayingSpec implements IGateSpecification {
  public readonly id = 'video_playing';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.isVideoPlaying;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Video is paused, buffering, or inactive.';
  }
}

export class PlaybackAdvancingSpec implements IGateSpecification {
  public readonly id = 'playback_advancing';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.isPlaybackTimeAdvancing;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Playback currentTime is stalled or not advancing monotonically.';
  }
}

export class VideoNotEndedOrSeekingSpec implements IGateSpecification {
  public readonly id = 'video_not_ended_or_seeking';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return !ctx.isVideoEndedOrSeeking;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Video is seeking or has reached the end.';
  }
}

export class MissingBackendSegmentsSpec implements IGateSpecification {
  public readonly id = 'missing_backend_segments';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.hasMissingBackendSegments;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Current video segment is already sufficiently covered or video analysis is complete.';
  }
}

export class CaptureCapabilityAuthorizedSpec implements IGateSpecification {
  public readonly id = 'capture_capability_authorized';
  public isSatisfiedBy(ctx: WatchContextSnapshot): boolean {
    return ctx.hasScreenshotOrAudioCapability;
  }
  public failureReason(_ctx: WatchContextSnapshot): string | null {
    return 'Neither screenshot nor audio capture capability is authorized or available.';
  }
}

export function createDefaultGateSpecifications(): IGateSpecification[] {
  return [
    new ExtensionEnabledSpec(),
    new PolicyVersionMatchSpec(),
    new UserContributionEnabledSpec(),
    new TabAndDocumentVisibleSpec(),
    new VideoPlayingSpec(),
    new PlaybackAdvancingSpec(),
    new VideoNotEndedOrSeekingSpec(),
    new MissingBackendSegmentsSpec(),
    new CaptureCapabilityAuthorizedSpec(),
  ];
}
