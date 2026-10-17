import type {
  BadgeState,
  BadgeMetadata,
  IBadgeRendererObserver,
} from '../../ports/IBadgeAndFilterExtension';

export class BadgePresenter implements IBadgeRendererObserver {
  public renderBadge(mountPoint: HTMLElement, state: BadgeState, meta?: BadgeMetadata): void {
    if (!mountPoint) return;

    mountPoint.innerHTML = '';
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
    mountPoint.appendChild(badgeEl);
  }
}
