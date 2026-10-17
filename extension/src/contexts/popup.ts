import { StoragePolicyConsentAdapter } from '../adapters/storage/StoragePolicyConsentAdapter';
import { CURRENT_POLICY_VERSION } from '../domain/models/PolicyState';

const consentAdapter = new StoragePolicyConsentAdapter();

async function initPopup() {
  const policyBanner = document.getElementById('policy-banner') as HTMLElement;
  const acceptPolicyBtn = document.getElementById('accept-policy-btn') as HTMLButtonElement;
  const liveBadge = document.getElementById('live-state-badge') as HTMLElement;
  const videoIdDisplay = document.getElementById('video-id-display') as HTMLElement;
  const coverageText = document.getElementById('video-coverage-text') as HTMLElement;
  const progressFill = document.getElementById('coverage-progress-fill') as HTMLElement;

  const toggleContribution = document.getElementById('toggle-contribution') as HTMLInputElement;
  const toggleBadges = document.getElementById('toggle-badges') as HTMLInputElement;
  const selectFilterMode = document.getElementById('select-filter-mode') as HTMLSelectElement;
  const thresholdContainer = document.getElementById('threshold-container') as HTMLElement;
  const rangeThreshold = document.getElementById('range-threshold') as HTMLInputElement;
  const thresholdVal = document.getElementById('threshold-val') as HTMLElement;

  // 1. Load preferences and policy status
  const prefs = await consentAdapter.getPreferences();
  const policyAccepted = prefs.acceptedPolicyVersion === CURRENT_POLICY_VERSION;

  if (!policyAccepted && policyBanner) {
    policyBanner.classList.remove('hidden');
  }

  if (toggleContribution) toggleContribution.checked = prefs.contributionEnabled;
  if (toggleBadges) toggleBadges.checked = prefs.showBadges;
  if (selectFilterMode) selectFilterMode.value = prefs.filterMode;
  if (rangeThreshold) rangeThreshold.value = String(Math.round(prefs.threshold * 100));
  if (thresholdVal && rangeThreshold) thresholdVal.textContent = `${rangeThreshold.value}%`;

  if (prefs.filterMode === 'threshold_hide' && thresholdContainer) {
    thresholdContainer.classList.remove('hidden');
  }

  // 2. Policy acceptance click handler
  acceptPolicyBtn?.addEventListener('click', async () => {
    await consentAdapter.recordPolicyAcceptance(CURRENT_POLICY_VERSION);
    policyBanner?.classList.add('hidden');
  });

  // 3. Preference change listeners
  toggleContribution?.addEventListener('change', async () => {
    await consentAdapter.savePreferences({ contributionEnabled: toggleContribution.checked });
  });

  toggleBadges?.addEventListener('change', async () => {
    await consentAdapter.savePreferences({ showBadges: toggleBadges.checked });
  });

  selectFilterMode?.addEventListener('change', async () => {
    const isHide = selectFilterMode.value === 'threshold_hide';
    thresholdContainer?.classList.toggle('hidden', !isHide);
    await consentAdapter.savePreferences({ filterMode: selectFilterMode.value as 'mark_only' | 'threshold_hide' });
  });

  rangeThreshold?.addEventListener('input', async () => {
    if (thresholdVal) thresholdVal.textContent = `${rangeThreshold.value}%`;
    const thresholdNum = Number(rangeThreshold.value) / 100;
    await consentAdapter.savePreferences({ threshold: thresholdNum });
  });

  // 4. Query active YouTube tab for status
  async function refreshStatus() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !tab.url || !tab.url.includes('youtube.com')) {
        if (videoIdDisplay) videoIdDisplay.textContent = 'No active YouTube tab';
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: 'get-status' }, (response) => {
        if (chrome.runtime.lastError || !response) return;

        if (response.videoId && videoIdDisplay) {
          videoIdDisplay.textContent = `Video ID: ${response.videoId}`;
        }

        if (response.stateName && liveBadge) {
          liveBadge.textContent = response.stateName.toUpperCase();
          liveBadge.className = `badge badge-${response.stateName}`;
        }

        if (response.coverageText && coverageText) {
          coverageText.textContent = response.coverageText;
        }

        if (response.coverageRatio != null && progressFill) {
          progressFill.style.width = `${Math.round(response.coverageRatio * 100)}%`;
        }
      });
    } catch {
      // Ignore
    }
  }

  refreshStatus();
  setInterval(refreshStatus, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPopup);
} else {
  initPopup();
}
