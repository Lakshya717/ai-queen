import type { ScreenshotSample } from '../../domain/models/EvidencePackage';
import type { IScreenshotCaptureAdapter } from '../../ports/IScreenshotCaptureAdapter';

export interface MockScreenshotConfig {
  intervalSeconds: number;
  maxFramesPerSegment: number;
  syntheticWidth: number;
  syntheticHeight: number;
}

export class MockScreenshotCaptureAdapter implements IScreenshotCaptureAdapter {
  private aborted = false;
  private readonly config: MockScreenshotConfig;

  constructor(config: Partial<MockScreenshotConfig> = {}) {
    this.config = {
      intervalSeconds: 5,
      maxFramesPerSegment: 6,
      syntheticWidth: 640,
      syntheticHeight: 360,
      ...config,
    };
  }

  public async captureFrame(videoTimestampSeconds: number): Promise<ScreenshotSample | null> {
    if (this.aborted) {
      this.aborted = false;
      return null;
    }

    // Generate a minimal valid synthetic JPEG base64 or binary payload
    const mockData = `synthetic_jpeg_frame_${videoTimestampSeconds.toFixed(3)}`;

    return {
      videoTimestampSeconds: Number(videoTimestampSeconds.toFixed(3)),
      mimeType: 'image/jpeg',
      data: mockData,
      width: this.config.syntheticWidth,
      height: this.config.syntheticHeight,
    };
  }

  public abortPendingCapture(): void {
    this.aborted = true;
  }
}
