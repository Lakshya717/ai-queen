import type { UserPreferences } from '../domain/models/PolicyState';

export interface IPolicyAndPermissionAdapter {
  getPreferences(): Promise<UserPreferences>;
  savePreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences>;
  isPolicyAccepted(currentVersion: string): Promise<boolean>;
  recordPolicyAcceptance(version: string): Promise<void>;
  withdrawPolicyAcceptance(): Promise<void>;
}
