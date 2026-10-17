import type { ScreenshotSample } from '../../domain/models/EvidencePackage';
import type { IScreenshotCaptureAdapter } from '../../ports/IScreenshotCaptureAdapter';

export interface ChromeVisibleTabConfig {
  intervalSeconds: number;
  maxFramesPerSegment: number;
  maxWidthPx: number;
  jpegQuality: number;
}

export const DEFAULT_VISIBLE_TAB_CONFIG: ChromeVisibleTabConfig = {
  intervalSeconds: 5,
  maxFramesPerSegment: 6,
  maxWidthPx: 1280,
  jpegQuality: 0.75,
};

export class ChromeVisibleTabScreenshotAdapter implements IScreenshotCaptureAdapter {
  private aborted = false;

  constructor(
    private readonly config: ChromeVisibleTabConfig = DEFAULT_VISIBLE_TAB_CONFIG,
    private readonly windowIdProvider: () => number | null = () => null
  ) {}

  public async captureFrame(videoTimestampSeconds: number): Promise<ScreenshotSample | null> {
    if (this.aborted) {
      this.aborted = false;
      return null;
    }

    if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
      return null;
    }

    return new Promise((resolve) => {
      const windowId = this.windowIdProvider();
      const options = { format: 'jpeg' as const, quality: Math.round(this.config.jpegQuality * 100) };

      const callback = (dataUrl?: string) => {
        if (chrome.runtime.lastError || !dataUrl) {
          resolve(null);
          return;
        }

        resolve({
          videoTimestampSeconds: Number(videoTimestampSeconds.toFixed(3)),
          mimeType: 'image/jpeg',
          data: dataUrl,
          width: this.config.maxWidthPx,
          height: Math.round((this.config.maxWidthPx * 9) / 16),
        });
      };

      if (windowId != null) {
        chrome.tabs.captureVisibleTab(windowId, options, callback);
      } else {
        chrome.tabs.captureVisibleTab(options, callback);
      }
    });
  }

  public abortPendingCapture(): void {
    this.aborted = true;
  }
}
