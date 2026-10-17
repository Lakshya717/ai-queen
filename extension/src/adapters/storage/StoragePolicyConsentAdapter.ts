import type { IPolicyAndPermissionAdapter } from '../../ports/IPolicyAndPermissionAdapter';
import {
  type UserPreferences,
  DEFAULT_USER_PREFERENCES,
} from '../../domain/models/PolicyState';

export class StoragePolicyConsentAdapter implements IPolicyAndPermissionAdapter {
  private inMemoryPreferences: UserPreferences = { ...DEFAULT_USER_PREFERENCES };

  public async getPreferences(): Promise<UserPreferences> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get('preferences');
      if (result.preferences) {
        return { ...DEFAULT_USER_PREFERENCES, ...result.preferences };
      }
    }
    return { ...this.inMemoryPreferences };
  }

  public async savePreferences(
    partial: Partial<UserPreferences>
  ): Promise<UserPreferences> {
    const current = await this.getPreferences();
    const updated: UserPreferences = { ...current, ...partial };

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ preferences: updated });
    } else {
      this.inMemoryPreferences = updated;
    }

    return updated;
  }

  public async isPolicyAccepted(currentVersion: string): Promise<boolean> {
    const prefs = await this.getPreferences();
    return prefs.acceptedPolicyVersion === currentVersion;
  }

  public async recordPolicyAcceptance(version: string): Promise<void> {
    await this.savePreferences({
      acceptedPolicyVersion: version,
      acceptedAt: new Date().toISOString(),
    });
  }

  public async withdrawPolicyAcceptance(): Promise<void> {
    await this.savePreferences({
      acceptedPolicyVersion: null,
      acceptedAt: null,
      contributionEnabled: false,
    });
  }
}
