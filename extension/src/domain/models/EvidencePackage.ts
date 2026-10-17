import { TimeInterval } from './TimeInterval';

export type TranscriptScope = 'full' | 'partial' | 'unavailable';

export interface ScreenshotSample {
  readonly videoTimestampSeconds: number;
  readonly mimeType: 'image/jpeg' | 'image/webp';
  readonly data: Uint8Array | string; // Binary buffer for Multipart or Base64 string
  readonly width: number;
  readonly height: number;
}

export interface AudioChunkSample {
  readonly interval: TimeInterval;
  readonly mimeType: string; // e.g. 'audio/webm;codecs=opus'
  readonly data: Uint8Array | string;
  readonly alignmentDriftMs: number;
}

export interface TranscriptSegmentDto {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

export interface TranscriptPayload {
  readonly scope: TranscriptScope;
  readonly language: string | null;
  readonly segments: ReadonlyArray<TranscriptSegmentDto>;
  readonly contentHash: string | null; // SHA-256 hash for backend deduplication
  readonly omissionReason?: string;
}

export interface CaptureCapabilities {
  readonly screenshots: boolean;
  readonly tabAudio: boolean;
  readonly transcriptScope: TranscriptScope;
  readonly audioUnavailableReason?: 'permission_denied' | 'gesture_required' | 'unsupported_browser' | null;
}

export class EvidencePackage {
  constructor(
    public readonly videoId: string,
    public readonly policyVersion: string,
    public readonly segmentIndex: number,
    public readonly segmentBounds: TimeInterval,
    public readonly observedIntervals: ReadonlyArray<TimeInterval>,
    public readonly frames: ReadonlyArray<ScreenshotSample>,
    public readonly audioChunks: ReadonlyArray<AudioChunkSample>,
    public readonly transcript: TranscriptPayload | null,
    public readonly capabilities: CaptureCapabilities
  ) {
    if (this.observedIntervals.length === 0) {
      throw new Error('Cannot build EvidencePackage without at least one verified observed interval.');
    }
  }
}
