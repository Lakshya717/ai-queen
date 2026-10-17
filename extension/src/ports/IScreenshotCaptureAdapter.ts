import type { ScreenshotSample } from '../domain/models/EvidencePackage';

export interface IScreenshotCaptureAdapter {
  captureFrame(videoTimestampSeconds: number): Promise<ScreenshotSample | null>;
  abortPendingCapture(): void;
}
