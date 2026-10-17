import type { TimeInterval } from '../domain/models/TimeInterval';
import type { AudioChunkSample } from '../domain/models/EvidencePackage';

export interface IAudioCaptureAdapter {
  readonly isSupportedAndAuthorized: boolean;
  readonly unavailableReason: 'permission_denied' | 'gesture_required' | 'unsupported_browser' | null;
  startSegmentRecording(segmentBounds: TimeInterval, startVideoTime: number): Promise<void>;
  stopAndFlushRecording(endVideoTime: number): Promise<ReadonlyArray<AudioChunkSample>>;
  abortAndDiscard(): Promise<void>;
}
