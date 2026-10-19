import type {
  BadgeState,
  BadgeMetadata,
  IBadgeRendererObserver,
} from '../../ports/IBadgeAndFilterExtension';

export class BadgePresenter implements IBadgeRendererObserver {
  public renderBadge(mountPoint: HTMLElement, state: BadgeState, meta?: BadgeMetadata): void {
    if (!mountPoint) return;

    mountPoint.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'yt-ai-detect-badge-container';

    const badgeEl = document.createElement('div');
    badgeEl.className = `yt-ai-badge yt-ai-badge-${state}`;

    const iconEl = document.createElement('span');
    iconEl.className = 'yt-ai-badge-icon';

    const textEl = document.createElement('span');
    textEl.className = 'yt-ai-badge-text';

    switch (state) {
      case 'analyzed': {
        const scorePct = meta?.score != null ? Math.round(meta.score * 100) : null;
        const isHigh = scorePct !== null && scorePct >= 70;
        badgeEl.classList.add(isHigh ? 'yt-ai-badge-high' : 'yt-ai-badge-low');
        iconEl.textContent = isHigh ? '⚠️' : '✓';
        textEl.textContent = scorePct !== null
          ? `AI Reliance: ${scorePct}% (${meta?.label || 'UNKNOWN'})`
          : `Analyzed: ${meta?.label || 'UNKNOWN'}`;
        break;
      }

      case 'partially_analyzed': {
        iconEl.textContent = '◐';
        const covered = meta?.coveredSegments ?? 0;
        const total = meta?.totalSegments ?? 0;
        textEl.textContent = total > 0
          ? `Partially Analyzed (${covered}/${total} segments)`
          : 'Partially Analyzed';
        break;
      }

      case 'collecting_evidence':
        iconEl.textContent = '⏺';
        textEl.textContent = 'Active Watching: Collecting Evidence...';
        break;

      case 'processing':
        iconEl.textContent = '⏳';
        textEl.textContent = 'AI Analysis Processing...';
        break;

      case 'not_analyzed':
        iconEl.textContent = '○';
        textEl.textContent = 'Unmapped: Not Analyzed';
        break;

      case 'insufficient_evidence':
        iconEl.textContent = '❓';
        textEl.textContent = 'Insufficient Evidence';
        break;

      case 'unavailable':
      default:
        iconEl.textContent = '⚡';
        textEl.textContent = meta?.statusText || 'Analysis Unavailable';
        break;
    }

    badgeEl.appendChild(iconEl);
    badgeEl.appendChild(textEl);

    // If analyzed or partially analyzed with component details, attach dropdown indicator and popover
    const hasSummaryOrScores = (state === 'analyzed' || state === 'partially_analyzed') &&
      (meta?.componentSummary != null || meta?.score != null);

    if (hasSummaryOrScores) {
      const arrowEl = document.createElement('span');
      arrowEl.className = 'yt-ai-badge-arrow';
      arrowEl.textContent = ' ▾';
      badgeEl.appendChild(arrowEl);
      badgeEl.classList.add('yt-ai-badge-interactive');
      badgeEl.setAttribute('role', 'button');
      badgeEl.setAttribute('tabindex', '0');
      badgeEl.setAttribute('title', 'Click or hover to inspect AI Modality scores');

      const popoverEl = this.buildPopoverCard(meta);
      container.appendChild(badgeEl);
      container.appendChild(popoverEl);

      // Event handlers: click toggle and hover
      let isOpen = false;
      const togglePopover = (open?: boolean) => {
        isOpen = open !== undefined ? open : !isOpen;
        if (isOpen) {
          popoverEl.classList.add('yt-ai-popover-open');
          badgeEl.classList.add('yt-ai-badge-active');
        } else {
          popoverEl.classList.remove('yt-ai-popover-open');
          badgeEl.classList.remove('yt-ai-badge-active');
        }
      };

      badgeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePopover();
      });

      // Hover support
      container.addEventListener('mouseenter', () => {
        togglePopover(true);
      });
      container.addEventListener('mouseleave', () => {
        togglePopover(false);
      });

      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('click', (e) => {
          if (!container.contains(e.target as Node)) {
            togglePopover(false);
          }
        });
      }
    } else {
      container.appendChild(badgeEl);
    }

    mountPoint.appendChild(container);
  }

  private buildPopoverCard(meta?: BadgeMetadata): HTMLElement {
    const card = document.createElement('div');
    card.className = 'yt-ai-popover';

    // Header
    const header = document.createElement('div');
    header.className = 'yt-ai-popover-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'yt-ai-popover-title';
    titleEl.textContent = 'Multimodal AI Detection Breakdown';

    const scorePct = meta?.score != null ? Math.round(meta.score * 100) : null;
    const scoreBadge = document.createElement('span');
    scoreBadge.className = `yt-ai-popover-badge ${scorePct !== null && scorePct >= 70 ? 'badge-high' : 'badge-low'}`;
    scoreBadge.textContent = scorePct !== null ? `${scorePct}% ${meta?.label || ''}` : (meta?.label || 'UNKNOWN');

    header.appendChild(titleEl);
    header.appendChild(scoreBadge);
    card.appendChild(header);

    // Modality Grid
    const modalities = [
      { key: 'visual', label: 'Visual Synthesis', icon: '👁️', default: meta?.score != null ? meta.score : null },
      { key: 'text', label: 'Script / Text Model', icon: '📝', default: null },
      { key: 'temporal', label: 'Temporal Continuity', icon: '⏱️', default: null },
      { key: 'audio', label: 'Audio / Voice Clone', icon: '🎙️', default: null },
    ];

    const averages = meta?.componentSummary?.modalityAverages || {};
    const grid = document.createElement('div');
    grid.className = 'yt-ai-popover-grid';

    for (const m of modalities) {
      const scoreVal = averages[m.key] !== undefined ? averages[m.key] : m.default;
      const row = document.createElement('div');
      row.className = 'yt-ai-modality-row';

      const labelCol = document.createElement('div');
      labelCol.className = 'yt-ai-modality-label';
      labelCol.textContent = `${m.icon} ${m.label}`;

      const scoreCol = document.createElement('div');
      scoreCol.className = 'yt-ai-modality-score';
      const pct = scoreVal !== null && scoreVal !== undefined ? Math.round(scoreVal * 100) : null;
      scoreCol.textContent = pct !== null ? `${pct}%` : 'N/A';

      const barBg = document.createElement('div');
      barBg.className = 'yt-ai-meter-bg';
      const barFill = document.createElement('div');
      barFill.className = `yt-ai-meter-fill ${pct !== null && pct >= 70 ? 'fill-high' : pct !== null && pct >= 40 ? 'fill-medium' : 'fill-low'}`;
      barFill.style.width = pct !== null ? `${pct}%` : '0%';
      barBg.appendChild(barFill);

      row.appendChild(labelCol);
      row.appendChild(scoreCol);
      row.appendChild(barBg);
      grid.appendChild(row);
    }
    card.appendChild(grid);

    // Diagnostics / Peak Anomaly Analysis
    const diagnostics = document.createElement('div');
    diagnostics.className = 'yt-ai-popover-diagnostics';

    let peakAnomalyTimestamp: number | null = null;
    let peakAnomalyExplanation: string | null = null;

    if (meta?.segments) {
      for (const seg of meta.segments) {
        if (seg.components) {
          for (const c of seg.components) {
            if (c.details?.peakAnomalyTimestamp !== undefined) {
              peakAnomalyTimestamp = c.details.peakAnomalyTimestamp;
              peakAnomalyExplanation = c.details.anomalyExplanation || null;
              break;
            } else if (c.details?.peak_frame_timestamp !== undefined) {
              peakAnomalyTimestamp = c.details.peak_frame_timestamp;
              peakAnomalyExplanation = c.details.anomalyExplanation || `Peak anomaly identified in ${c.componentName}`;
              break;
            }
          }
        }
        if (peakAnomalyTimestamp !== null) break;
      }
    }

    const diagIcon = document.createElement('span');
    diagIcon.className = 'yt-ai-diag-icon';
    const diagText = document.createElement('span');
    diagText.className = 'yt-ai-diag-text';

    if (peakAnomalyTimestamp !== null) {
      diagIcon.textContent = '⚠️';
      const mins = Math.floor(peakAnomalyTimestamp / 60);
      const secs = Math.floor(peakAnomalyTimestamp % 60);
      const formattedTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      diagText.textContent = `Peak Anomaly at ${formattedTime}: ${peakAnomalyExplanation || 'Synthetic cutaway detected'}`;
      diagnostics.classList.add('has-anomaly');
    } else if (scorePct !== null && scorePct >= 70) {
      diagIcon.textContent = '⚠️';
      diagText.textContent = 'High probability of synthetic generation detected across evaluated modalities.';
      diagnostics.classList.add('has-anomaly');
    } else {
      diagIcon.textContent = '✓';
      diagText.textContent = 'No significant synthetic anomalies flagged across active components.';
      diagnostics.classList.add('no-anomaly');
    }

    diagnostics.appendChild(diagIcon);
    diagnostics.appendChild(diagText);
    card.appendChild(diagnostics);

    // Footer with evaluated components chips
    const footer = document.createElement('div');
    footer.className = 'yt-ai-popover-footer';

    const components = meta?.componentSummary?.componentsEvaluated || [];
    if (components.length > 0) {
      const chipsLabel = document.createElement('span');
      chipsLabel.className = 'yt-ai-footer-label';
      chipsLabel.textContent = 'Evaluated:';
      footer.appendChild(chipsLabel);

      for (const comp of components) {
        const chip = document.createElement('span');
        chip.className = 'yt-ai-comp-chip';
        chip.textContent = comp.replace(/_scorer$/, '');
        footer.appendChild(chip);
      }
    }

    if (meta?.confidence != null) {
      const confSpan = document.createElement('span');
      confSpan.className = 'yt-ai-conf-text';
      confSpan.textContent = `Confidence: ${Math.round(meta.confidence * 100)}%`;
      footer.appendChild(confSpan);
    }

    card.appendChild(footer);
    return card;
  }
}
