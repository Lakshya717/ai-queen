import { StoragePolicyConsentAdapter } from '../adapters/storage/StoragePolicyConsentAdapter';
import { CURRENT_POLICY_VERSION } from '../domain/models/PolicyState';

const consentAdapter = new StoragePolicyConsentAdapter();

async function initPopup() {
  const isSidePanel = document.body.dataset.surface === 'side-panel';
  const debugModeBanner = document.getElementById('debug-mode-banner') as HTMLElement;
  const debugOnlySections = Array.from(document.querySelectorAll<HTMLElement>('.debug-only'));
  const policyBanner = document.getElementById('policy-banner') as HTMLElement;
  const acceptPolicyBtn = document.getElementById('accept-policy-btn') as HTMLButtonElement;
  const liveBadge = document.getElementById('live-state-badge') as HTMLElement;
  const videoIdDisplay = document.getElementById('video-id-display') as HTMLElement;
  const coverageText = document.getElementById('video-coverage-text') as HTMLElement;
  const progressFill = document.getElementById('coverage-progress-fill') as HTMLElement;

  const toggleDebugMode = document.getElementById('toggle-debug-mode') as HTMLInputElement;
  const toggleContribution = document.getElementById('toggle-contribution') as HTMLInputElement;
  const toggleBadges = document.getElementById('toggle-badges') as HTMLInputElement;
  const selectFilterMode = document.getElementById('select-filter-mode') as HTMLSelectElement;
  const thresholdContainer = document.getElementById('threshold-container') as HTMLElement;
  const rangeThreshold = document.getElementById('range-threshold') as HTMLInputElement;
  const thresholdVal = document.getElementById('threshold-val') as HTMLElement;

  const analysisSummaryBadge = document.getElementById('analysis-summary-badge') as HTMLElement;
  const modalityVals: Record<string, HTMLElement | null> = {
    visual: document.getElementById('modality-val-visual'),
    text: document.getElementById('modality-val-text'),
    temporal: document.getElementById('modality-val-temporal'),
    audio: document.getElementById('modality-val-audio'),
  };
  const meterFills: Record<string, HTMLElement | null> = {
    visual: document.getElementById('meter-fill-visual'),
    text: document.getElementById('meter-fill-text'),
    temporal: document.getElementById('meter-fill-temporal'),
    audio: document.getElementById('meter-fill-audio'),
  };
  const anomalyBox = document.getElementById('popup-anomaly-box') as HTMLElement;
  const anomalyIcon = document.getElementById('popup-anomaly-icon') as HTMLElement;
  const anomalyText = document.getElementById('popup-anomaly-text') as HTMLElement;
  const componentsContainer = document.getElementById('popup-components-container') as HTMLElement;
  const componentsList = document.getElementById('popup-components-list') as HTMLElement;
  const recalculateBtn = document.getElementById('recalculate-btn') as HTMLButtonElement;
  const recalculateStatus = document.getElementById('recalculate-status') as HTMLElement;
  let displayedVideoId: string | null = null;
  let displayedTabId: number | null = null;
  let refreshGeneration = 0;

  const resetAnalysisDisplay = () => {
    if (analysisSummaryBadge) {
      analysisSummaryBadge.textContent = 'Awaiting Data';
      analysisSummaryBadge.className = 'badge badge-inactive';
    }

    for (const key of ['visual', 'text', 'temporal', 'audio']) {
      if (modalityVals[key]) modalityVals[key]!.textContent = '--';
      if (meterFills[key]) {
        meterFills[key]!.style.width = '0%';
        meterFills[key]!.className = 'meter-bar-fill fill-low';
      }
    }

    anomalyBox?.classList.add('hidden');
    if (componentsContainer) componentsContainer.classList.add('hidden');
    if (componentsList) componentsList.innerHTML = '';
  };

  const resetStatusDisplay = () => {
    displayedVideoId = null;
    displayedTabId = null;
    if (videoIdDisplay) videoIdDisplay.textContent = 'No active YouTube tab';
    if (liveBadge) {
      liveBadge.textContent = 'INACTIVE';
      liveBadge.className = 'badge badge-inactive';
    }
    if (coverageText) coverageText.textContent = 'Open a YouTube video to detect AI reliance';
    if (progressFill) progressFill.style.width = '0%';
    resetAnalysisDisplay();
  };

  // 1. Load preferences and policy status
  const prefs = await consentAdapter.getPreferences();
  const policyAccepted = prefs.acceptedPolicyVersion === CURRENT_POLICY_VERSION;

  if (!policyAccepted && policyBanner) {
    policyBanner.classList.remove('hidden');
  }

  if (toggleContribution) toggleContribution.checked = prefs.contributionEnabled;
  if (toggleDebugMode) toggleDebugMode.checked = prefs.debugMode;
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

  const updateDebugSurface = (debugMode: boolean) => {
    if (!isSidePanel) return;
    debugOnlySections.forEach((section: HTMLElement) => section.classList.toggle('hidden', !debugMode));
    debugModeBanner?.classList.toggle('hidden', debugMode);
  };

  updateDebugSurface(prefs.debugMode);

  recalculateBtn?.addEventListener('click', async () => {
    if (!displayedVideoId) {
      recalculateStatus.textContent = 'Open a YouTube video first.';
      return;
    }
    recalculateBtn.disabled = true;
    recalculateStatus.textContent = 'Recalculating stored evidence...';
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'recalculate-video',
        videoId: displayedVideoId,
      });
      if (!response?.ok) throw new Error(response?.error || 'Recalculation failed');
      recalculateStatus.textContent = 'Recalculated. Refreshing display...';
      if (displayedTabId !== null) {
        await new Promise<void>((resolve, reject) => {
          chrome.tabs.sendMessage(displayedTabId!, { type: 'refresh-analysis' }, (refreshResponse) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (refreshResponse?.ok === false) {
              reject(new Error(refreshResponse.error || 'Unable to refresh the tab'));
            } else {
              resolve();
            }
          });
        });
      }
      await refreshStatus();
      recalculateStatus.textContent = 'Done.';
    } catch (error) {
      recalculateStatus.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      recalculateBtn.disabled = false;
    }
  });

  toggleDebugMode?.addEventListener('change', async () => {
    await consentAdapter.savePreferences({ debugMode: toggleDebugMode.checked });
    updateDebugSurface(toggleDebugMode.checked);
  });

  // 4. Query active YouTube tab for status
  async function refreshStatus() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    try {
      const generation = ++refreshGeneration;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !tab.url || !tab.url.includes('youtube.com')) {
        resetStatusDisplay();
        return;
      }

      const requestedTabId = tab.id;
      chrome.tabs.sendMessage(tab.id, { type: 'get-status' }, (response) => {
        if (generation !== refreshGeneration) return;
        if (chrome.runtime.lastError || !response) {
          resetStatusDisplay();
          return;
        }

        const responseVideoId = typeof response.videoId === 'string' ? response.videoId : null;
        if (displayedTabId !== requestedTabId || displayedVideoId !== responseVideoId) {
          resetAnalysisDisplay();
          displayedTabId = requestedTabId;
          displayedVideoId = responseVideoId;
        }

        if (responseVideoId && videoIdDisplay) {
          videoIdDisplay.textContent = `Video ID: ${responseVideoId}`;
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

        // 5. Update AI Modality Analysis
        const summary = response.componentSummary;
        const score = response.aiRelianceScore;
        const label = response.label;

        if (summary || score != null) {
          if (analysisSummaryBadge) {
            const scorePct = score != null ? Math.round(score * 100) : null;
            analysisSummaryBadge.textContent = scorePct !== null ? `${scorePct}% (${label || 'ANALYZED'})` : (label || 'ANALYZED');
            analysisSummaryBadge.className = `badge ${scorePct !== null && scorePct >= 70 ? 'badge-capturing' : 'badge-complete'}`;
          }

          const averages = summary?.modalityAverages || {};
          const weights = summary?.modalityWeights || {};
          const modalityKeys = ['visual', 'text', 'temporal', 'audio'];

          for (const key of modalityKeys) {
            const valEl = modalityVals[key];
            const fillEl = meterFills[key];
            const val = averages[key] !== undefined ? averages[key] : (key === 'visual' && score != null ? score : null);
            const isExcluded = weights[key] !== undefined && weights[key] <= 0;

            if (isExcluded) {
              if (valEl) valEl.textContent = 'Excluded';
              if (fillEl) {
                fillEl.style.width = '0%';
                fillEl.className = 'meter-bar-fill fill-low';
              }
            } else if (val !== null && val !== undefined) {
              const pct = Math.round(val * 100);
              if (valEl) valEl.textContent = `${pct}%`;
              if (fillEl) {
                fillEl.style.width = `${pct}%`;
                fillEl.className = `meter-bar-fill ${pct >= 70 ? 'fill-high' : pct >= 40 ? 'fill-medium' : 'fill-low'}`;
              }
            } else {
              if (valEl) valEl.textContent = 'N/A';
              if (fillEl) {
                fillEl.style.width = '0%';
                fillEl.className = 'meter-bar-fill fill-low';
              }
            }
          }

          // Peak Anomaly Detection
          let peakTime: number | null = null;
          let peakExpl: string | null = null;
          if (response.segments && Array.isArray(response.segments)) {
            for (const seg of response.segments) {
              if (seg.components) {
                for (const c of seg.components) {
                  if (c.details?.peakAnomalyTimestamp !== undefined) {
                    peakTime = c.details.peakAnomalyTimestamp;
                    peakExpl = c.details.anomalyExplanation || null;
                    break;
                  } else if (c.details?.peak_frame_timestamp !== undefined) {
                    peakTime = c.details.peak_frame_timestamp;
                    peakExpl = c.details.anomalyExplanation || `Peak anomaly identified in ${c.componentName}`;
                    break;
                  }
                }
              }
              if (peakTime !== null) break;
            }
          }

          if (anomalyBox) {
            anomalyBox.classList.remove('hidden');
            if (peakTime !== null) {
              if (anomalyIcon) anomalyIcon.textContent = '⚠️';
              const mins = Math.floor(peakTime / 60);
              const secs = Math.floor(peakTime % 60);
              const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              if (anomalyText) anomalyText.textContent = `Peak Anomaly at ${timeStr}: ${peakExpl || 'Synthetic cutaway detected'}`;
              anomalyBox.className = 'anomaly-box has-anomaly';
            } else if (score != null && score >= 0.70) {
              if (anomalyIcon) anomalyIcon.textContent = '⚠️';
              if (anomalyText) anomalyText.textContent = 'High probability of synthetic generation detected.';
              anomalyBox.className = 'anomaly-box has-anomaly';
            } else {
              if (anomalyIcon) anomalyIcon.textContent = '✓';
              if (anomalyText) anomalyText.textContent = 'No significant synthetic anomalies flagged across active components.';
              anomalyBox.className = 'anomaly-box no-anomaly';
            }
          }

          // Components Tags
          const components = summary?.componentsEvaluated || [];
          if (components.length > 0 && componentsContainer && componentsList) {
            componentsContainer.classList.remove('hidden');
            componentsList.innerHTML = '';
            for (const comp of components) {
              const tag = document.createElement('span');
              tag.className = 'comp-tag';
              tag.textContent = comp.replace(/_scorer$/, '');
              componentsList.appendChild(tag);
            }
          }
        } else {
          if (analysisSummaryBadge) {
            if (response.coverageRatio != null && response.coverageRatio >= 0.90) {
              analysisSummaryBadge.textContent = 'Auto-Analyzing (90%+)...';
              analysisSummaryBadge.className = 'badge badge-capturing';
            } else {
              analysisSummaryBadge.textContent = 'Awaiting Data';
              analysisSummaryBadge.className = 'badge badge-inactive';
            }
          }
          if (anomalyBox) {
            if (response.coverageRatio != null && response.coverageRatio >= 0.90) {
              anomalyBox.classList.remove('hidden');
              anomalyBox.className = 'anomaly-box';
              if (anomalyIcon) anomalyIcon.textContent = '⏳';
              if (anomalyText) anomalyText.textContent = 'Coverage threshold (90%) reached. Initiating backend AI analysis...';
            } else {
              anomalyBox.classList.add('hidden');
            }
          }
          if (componentsContainer) componentsContainer.classList.add('hidden');
          if (modalityVals.visual) modalityVals.visual.textContent = '--';
          if (modalityVals.text) modalityVals.textContent = '--';
          if (modalityVals.temporal) modalityVals.temporal.textContent = '--';
          if (modalityVals.audio) modalityVals.audio.textContent = '--';
          for (const key of ['visual', 'text', 'temporal', 'audio']) {
            if (meterFills[key]) {
              meterFills[key]!.style.width = '0%';
              meterFills[key]!.className = 'meter-bar-fill fill-low';
            }
          }
        }
      });
    } catch {
      resetStatusDisplay();
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
