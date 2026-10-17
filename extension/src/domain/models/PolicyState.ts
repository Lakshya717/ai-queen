export interface UserPreferences {
  readonly enabled: boolean;
  readonly contributionEnabled: boolean;
  readonly acceptedPolicyVersion: string | null;
  readonly acceptedAt: string | null;
  readonly showBadges: boolean;
  readonly filterMode: 'mark_only' | 'threshold_hide';
  readonly threshold: number; // e.g. 0.8
}

export const CURRENT_POLICY_VERSION = 'v1';

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  enabled: true,
  contributionEnabled: true,
  acceptedPolicyVersion: null,
  acceptedAt: null,
  showBadges: true,
  filterMode: 'mark_only',
  threshold: 0.8,
};
