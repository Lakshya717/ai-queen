import type { IFilterStrategy } from '../../ports/IBadgeAndFilterExtension';
import type { VideoLookupResponseDto } from '../../ports/IBackendApiAdapter';

export class ThresholdHideFilterStrategy implements IFilterStrategy {
  public readonly strategyId = 'threshold_hide' as const;
  private readonly revealedSessionIds = new Set<string>();

  public applyFilter(
    cardElement: HTMLElement,
    lookup: VideoLookupResponseDto,
    threshold: number
  ): void {
    if (!cardElement || !lookup) return;

    // Fail-open invariant: HIDE ONLY IF complete and score >= threshold
    if (lookup.status !== 'complete' || lookup.aiRelianceScore === null) {
      this.unhide(cardElement);
      return;
    }

    if (this.revealedSessionIds.has(lookup.videoId)) {
      this.unhide(cardElement);
      return;
    }

    if (lookup.aiRelianceScore >= threshold) {
      this.hide(cardElement, lookup.videoId, lookup.aiRelianceScore);
    } else {
      this.unhide(cardElement);
    }
  }

  public revealForSession(videoId: string): void {
    this.revealedSessionIds.add(videoId);
    if (typeof document !== 'undefined') {
      const card = document.querySelector(`[data-yt-ai-videoid="${videoId}"]`) as HTMLElement;
      if (card) {
        this.unhide(card);
      }
    }
  }

  public restoreAll(root: Document = document): void {
    const hiddenCards = root.querySelectorAll('.yt-ai-filtered-card');
    hiddenCards.forEach((card) => this.unhide(card as HTMLElement));
  }

  private hide(card: HTMLElement, videoId: string, score: number): void {
    card.setAttribute('data-yt-ai-videoid', videoId);
    card.classList.add('yt-ai-filtered-card');

    let overlay = card.querySelector('.yt-ai-filtered-overlay') as HTMLElement;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'yt-ai-filtered-overlay';
      overlay.innerHTML = `
        <span>🤖 AI-Generated (${Math.round(score * 100)}% reliance)</span>
        <button class="yt-ai-reveal-btn" style="background:#3b82f6;color:white;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">
          Reveal
        </button>
      `;
      overlay.querySelector('.yt-ai-reveal-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.revealForSession(videoId);
      });
      card.appendChild(overlay);
    }
  }

  private unhide(card: HTMLElement): void {
    card.classList.remove('yt-ai-filtered-card');
    card.querySelector('.yt-ai-filtered-overlay')?.remove();
  }
}
