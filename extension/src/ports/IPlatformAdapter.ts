import type { ITranscriptExtractorAdapter } from './ITranscriptExtractorAdapter';

export interface IPlatformAdapter {
  readonly platformId: 'youtube' | 'tiktok' | 'instagram_reels' | 'x_video';
  extractVideoIdFromUrl(url: string): string | null;
  locatePrimaryVideoElement(root: Document): HTMLVideoElement | null;
  observeSpaNavigation(onVideoChange: (newVideoId: string | null) => void): () => void;
  createTranscriptExtractor(): ITranscriptExtractorAdapter;
  createBadgeMountPoint(root: Document): HTMLElement | null;
}
