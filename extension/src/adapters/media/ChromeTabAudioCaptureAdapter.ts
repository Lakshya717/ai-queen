import { TimeInterval } from '../../domain/models/TimeInterval';
import type { AudioChunkSample } from '../../domain/models/EvidencePackage';
import type { IAudioCaptureAdapter } from '../../ports/IAudioCaptureAdapter';

export class ChromeTabAudioCaptureAdapter implements IAudioCaptureAdapter {
  public isSupportedAndAuthorized = false;
  public unavailableReason: 'permission_denied' | 'gesture_required' | 'unsupported_browser' | null =
    'gesture_required';

  private isRecording = false;
  private startVideoTime: number | null = null;
  private streamId: string | null = null;

  constructor(
    private readonly streamIdProvider: () => string | null = () => null
  ) {}

  public setActive(active: boolean): void {
    this.isSupportedAndAuthorized = active;
    this.unavailableReason = active ? null : 'gesture_required';
  }

  public setStreamId(streamId: string): void {
    this.streamId = streamId;
    this.setActive(true);
  }

  public async startSegmentRecording(
    _segmentBounds: TimeInterval,
    startVideoTime: number
  ): Promise<void> {
    if (!this.isSupportedAndAuthorized) {
      const streamId = this.streamId ?? this.streamIdProvider();
      if (!streamId) {
        this.unavailableReason = 'gesture_required';
        return;
      }
      this.setActive(true);
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const resp = await chrome.runtime.sendMessage({
          type: 'proxy-audio-begin',
        });
        if (resp && !resp.ok) {
          this.isSupportedAndAuthorized = false;
          this.unavailableReason = 'permission_denied';
          return;
        }
      }

      this.isRecording = true;
      this.startVideoTime = startVideoTime;
    } catch {
      this.unavailableReason = 'permission_denied';
    }
  }

  public async stopAndFlushRecording(endVideoTime: number): Promise<ReadonlyArray<AudioChunkSample>> {
    if (!this.isRecording || this.startVideoTime == null || endVideoTime <= this.startVideoTime) {
      this.isRecording = false;
      this.startVideoTime = null;
      return [];
    }

    const start = this.startVideoTime;
    this.isRecording = false;
    this.startVideoTime = null;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({
          type: 'proxy-audio-end',
        });

        if (!response || !response.ok || !response.data) {
          return [];
        }

        return [
          {
            interval: new TimeInterval(start, endVideoTime),
            mimeType: response.mimeType || 'audio/webm;codecs=opus',
            data: response.data,
            alignmentDriftMs: 0,
          },
        ];
      }
      return [];
    } catch {
      return [];
    }
  }

  public async abortAndDiscard(): Promise<void> {
    this.isRecording = false;
    this.startVideoTime = null;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        await chrome.runtime.sendMessage({
          type: 'proxy-audio-cancel',
        });
      }
    } catch {
      // Ignore
    }
  }
}
