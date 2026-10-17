import { TimeInterval } from '../../domain/models/TimeInterval';
import type { ScreenshotSample, AudioChunkSample } from '../../domain/models/EvidencePackage';
import type { IScreenshotCaptureAdapter } from '../../ports/IScreenshotCaptureAdapter';
import type { IAudioCaptureAdapter } from '../../ports/IAudioCaptureAdapter';

export interface InPageMediaConfig {
  maxWidthPx: number;
  jpegQuality: number;
  maxFrameBytes: number;
  audioBitrateBps: number;
}

export const DEFAULT_IN_PAGE_MEDIA_CONFIG: InPageMediaConfig = {
  maxWidthPx: 1280,
  jpegQuality: 0.75,
  maxFrameBytes: 150 * 1024, // 150 KB ceiling
  audioBitrateBps: 32000,
};

export class InPageMediaCaptureAdapter
  implements IScreenshotCaptureAdapter, IAudioCaptureAdapter
{
  public isSupportedAndAuthorized = true;
  public unavailableReason: 'permission_denied' | 'gesture_required' | 'unsupported_browser' | null = null;

  private aborted = false;
  private currentSegmentBounds: TimeInterval | null = null;
  private startVideoTime: number | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private mediaStream: MediaStream | null = null;

  constructor(
    private readonly videoElementProvider: () => HTMLVideoElement | null,
    private readonly config: InPageMediaConfig = DEFAULT_IN_PAGE_MEDIA_CONFIG
  ) {}

  public isCanvasReadable(): boolean {
    const video = this.videoElementProvider();
    if (!video || video.readyState < 2) return false;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, 8, 8);
      ctx.getImageData(0, 0, 1, 1);
      return true;
    } catch {
      return false;
    }
  }

  public async captureFrame(videoTimestampSeconds: number): Promise<ScreenshotSample | null> {
    if (this.aborted) {
      this.aborted = false;
      return null;
    }

    const video = this.videoElementProvider();
    if (!video || video.readyState < 2) return null;

    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) return null;

    try {
      const scale = Math.min(1, this.config.maxWidthPx / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

      const base64Data = canvas.toDataURL('image/jpeg', this.config.jpegQuality);

      return {
        videoTimestampSeconds: Number(videoTimestampSeconds.toFixed(3)),
        mimeType: 'image/jpeg',
        data: base64Data,
        width: targetWidth,
        height: targetHeight,
      };
    } catch {
      return null;
    }
  }

  public abortPendingCapture(): void {
    this.aborted = true;
  }

  public isAudioCaptureSupported(): boolean {
    const video = this.videoElementProvider();
    if (!video) return false;
    return typeof (video as unknown as { captureStream?: () => MediaStream }).captureStream === 'function';
  }

  public async startSegmentRecording(
    segmentBounds: TimeInterval,
    startVideoTime: number
  ): Promise<void> {
    const video = this.videoElementProvider();
    if (!video) {
      this.unavailableReason = 'unsupported_browser';
      return;
    }

    try {
      const captureStreamFn =
        (video as unknown as { captureStream?: () => MediaStream }).captureStream ||
        (video as unknown as { mozCaptureStream?: () => MediaStream }).mozCaptureStream;

      if (typeof captureStreamFn !== 'function') {
        this.unavailableReason = 'unsupported_browser';
        return;
      }

      this.mediaStream = captureStreamFn.call(video);
      const audioTracks = this.mediaStream.getAudioTracks();
      if (!audioTracks.length) {
        this.unavailableReason = 'unsupported_browser';
        return;
      }

      // Do NOT touch video audio destination; user audio plays naturally through video element
      const audioOnlyStream = new MediaStream(audioTracks);
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.recordedChunks = [];
      this.currentSegmentBounds = segmentBounds;
      this.startVideoTime = startVideoTime;

      this.mediaRecorder = new MediaRecorder(audioOnlyStream, {
        mimeType,
        audioBitsPerSecond: this.config.audioBitrateBps,
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.start();
    } catch {
      this.unavailableReason = 'unsupported_browser';
    }
  }

  public async stopAndFlushRecording(endVideoTime: number): Promise<ReadonlyArray<AudioChunkSample>> {
    const recorder = this.mediaRecorder;
    const start = this.startVideoTime;
    const localChunks = this.recordedChunks;

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.startVideoTime = null;
    this.currentSegmentBounds = null;

    if (!recorder || start == null || endVideoTime <= start) {
      this.cleanupStream();
      return [];
    }

    return new Promise((resolve) => {
      const finish = async () => {
        this.cleanupStream();
        if (!localChunks.length) {
          resolve([]);
          return;
        }

        const blob = new Blob(localChunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 64) {
          resolve([]);
          return;
        }

        const buffer = await blob.arrayBuffer();
        const base64 = this.arrayBufferToBase64(buffer);
        const chunkInterval = new TimeInterval(start, endVideoTime);

        resolve([
          {
            interval: chunkInterval,
            mimeType: recorder.mimeType || 'audio/webm;codecs=opus',
            data: base64,
            alignmentDriftMs: 0,
          },
        ]);
      };

      if (recorder.state !== 'inactive') {
        recorder.onstop = finish;
        try {
          recorder.stop();
        } catch {
          finish();
        }
      } else {
        finish();
      }
    });
  }

  public async abortAndDiscard(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore
      }
    }
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.startVideoTime = null;
    this.currentSegmentBounds = null;
    this.cleanupStream();
  }

  private cleanupStream(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
