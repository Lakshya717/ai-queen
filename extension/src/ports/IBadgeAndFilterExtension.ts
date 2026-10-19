import type { VideoLookupResponseDto, ComponentSummaryDto, SegmentLookupDto } from './IBackendApiAdapter';

export type BadgeState =
  | 'analyzed'
  | 'partially_analyzed'
  | 'not_analyzed'
  | 'collecting_evidence'
  | 'processing'
  | 'insufficient_evidence'
  | 'unavailable';

export interface BadgeMetadata {
  score?: number | null;
  label?: string | null;
  confidence?: number | null;
  coveredSegments?: number;
  totalSegments?: number;
  analyzedAt?: string | null;
  statusText?: string;
  componentSummary?: ComponentSummaryDto | null;
  segments?: ReadonlyArray<SegmentLookupDto>;
}

export interface IBadgeRendererObserver {
  renderBadge(mountPoint: HTMLElement, state: BadgeState, meta?: BadgeMetadata): void;
}

export interface IFilterStrategy {
  readonly strategyId: 'mark_only' | 'threshold_hide';
  applyFilter(
    videoElement: HTMLElement,
    lookup: VideoLookupResponseDto,
    threshold: number
  ): void;
  revealForSession(videoId: string): void;
  restoreAll(root: Document): void;
}
