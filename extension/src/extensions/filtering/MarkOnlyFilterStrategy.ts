import type { IFilterStrategy } from '../../ports/IBadgeAndFilterExtension';
import type { VideoLookupResponseDto } from '../../ports/IBackendApiAdapter';

export class MarkOnlyFilterStrategy implements IFilterStrategy {
  public readonly strategyId = 'mark_only' as const;

  public applyFilter(
    _videoElement: HTMLElement,
    _lookup: VideoLookupResponseDto,
    _threshold: number
  ): void {
    // Default mode: display badges only; do not hide or collapse any video elements
  }

  public revealForSession(_videoId: string): void {
    // No-op
  }

  public restoreAll(root: Document = document): void {
    const hiddenCards = root.querySelectorAll('.yt-ai-filtered-card');
    hiddenCards.forEach((card) => {
      card.classList.remove('yt-ai-filtered-card');
      card.querySelector('.yt-ai-filtered-overlay')?.remove();
    });
  }
}
