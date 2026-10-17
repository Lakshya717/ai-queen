import type { TimeInterval } from '../../domain/models/TimeInterval';
import type { AudioChunkSample } from '../../domain/models/EvidencePackage';
import type { IAudioCaptureAdapter } from '../../ports/IAudioCaptureAdapter';

export class UnsupportedAudioCaptureAdapter implements IAudioCaptureAdapter {
  public readonly isSupportedAndAuthorized = false;

  constructor(
    public readonly unavailableReason: 'permission_denied' | 'gesture_required' | 'unsupported_browser' = 'unsupported_browser'
  ) {}

  public async startSegmentRecording(_segmentBounds: TimeInterval, _startVideoTime: number): Promise<void> {
    // Null object: audio capture is unsupported or unauthorized
  }

  public async stopAndFlushRecording(_endVideoTime: number): Promise<ReadonlyArray<AudioChunkSample>> {
    return [];
  }

  public async abortAndDiscard(): Promise<void> {
    // No-op
  }
}
