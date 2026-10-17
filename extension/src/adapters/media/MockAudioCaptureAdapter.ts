import { TimeInterval } from '../../domain/models/TimeInterval';
import type { AudioChunkSample } from '../../domain/models/EvidencePackage';
import type { IAudioCaptureAdapter } from '../../ports/IAudioCaptureAdapter';

export class MockAudioCaptureAdapter implements IAudioCaptureAdapter {
  public isSupportedAndAuthorized = true;
  public unavailableReason: 'permission_denied' | 'gesture_required' | 'unsupported_browser' | null = null;

  private currentSegmentBounds: TimeInterval | null = null;
  private startVideoTime: number | null = null;
  private isRecording = false;

  public async startSegmentRecording(
    segmentBounds: TimeInterval,
    startVideoTime: number
  ): Promise<void> {
    this.currentSegmentBounds = segmentBounds;
    this.startVideoTime = startVideoTime;
    this.isRecording = true;
  }

  public async stopAndFlushRecording(endVideoTime: number): Promise<ReadonlyArray<AudioChunkSample>> {
    if (!this.isRecording || this.startVideoTime == null || endVideoTime <= this.startVideoTime) {
      this.isRecording = false;
      return [];
    }

    const start = Math.max(0, this.startVideoTime);
    const end = Math.max(start + 0.001, endVideoTime);
    const chunkInterval = new TimeInterval(start, end);

    const chunk: AudioChunkSample = {
      interval: chunkInterval,
      mimeType: 'audio/webm;codecs=opus',
      data: `synthetic_audio_chunk_${start}_${end}`,
      alignmentDriftMs: 12,
    };

    this.isRecording = false;
    this.startVideoTime = null;
    this.currentSegmentBounds = null;

    return [chunk];
  }

  public async abortAndDiscard(): Promise<void> {
    this.isRecording = false;
    this.startVideoTime = null;
    this.currentSegmentBounds = null;
  }
}
