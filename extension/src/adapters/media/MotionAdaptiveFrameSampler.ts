import pixelmatch from 'pixelmatch';
import type { IFrameSamplingStrategy } from '../../ports/IFrameSamplingStrategy';

// Handle ESM / CommonJS default export interop cleanly across bundlers and test runners
const matchPixels =
  typeof pixelmatch === 'function'
    ? pixelmatch
    : (pixelmatch as unknown as { default: typeof pixelmatch }).default;

export interface MotionSamplerConfig {
  /**
   * Minimum debounce interval in seconds between samples (caps rapid burst captures).
   * Default: 1.25s (~0.8 fps ceiling).
   */
  minIntervalSeconds: number;

  /**
   * Maximum heartbeat interval in seconds before forcing a sample even with zero motion.
   * Default: 10.0s (guarantees at least 3 frames per 30s segment, satisfying backend sufficiency).
   */
  maxIntervalSeconds: number;

  /**
   * Motion score threshold (0.0 to 1.0) above which dynamic sampling accelerates.
   * Default: 0.05 (5% mismatched pixels).
   */
  motionThreshold: number;

  /**
   * Motion score threshold (0.0 to 1.0) representing an immediate scene cut or high-action shift.
   * Default: 0.15 (15% mismatched pixels).
   */
  sceneCutThreshold: number;

  /**
   * Sensitivity of pixelmatch comparison (0.0 to 1.0; smaller is more sensitive).
   * Default: 0.10.
   */
  pixelmatchThreshold: number;

  /**
   * Width of the downscaled analysis canvas.
   * Default: 64px (16:9 aspect).
   */
  downscaleWidth: number;

  /**
   * Height of the downscaled analysis canvas.
   * Default: 36px (16:9 aspect).
   */
  downscaleHeight: number;

  /**
   * Number of rows to exclude from the bottom of the canvas to eliminate subtitle/ticker false positives.
   * Default: 6 rows (~16.7% bottom margin).
   */
  ignoreBottomRows: number;
}

export const DEFAULT_MOTION_SAMPLER_CONFIG: MotionSamplerConfig = {
  minIntervalSeconds: 1.25,
  maxIntervalSeconds: 10.0,
  motionThreshold: 0.05,
  sceneCutThreshold: 0.15,
  pixelmatchThreshold: 0.10,
  downscaleWidth: 64,
  downscaleHeight: 36,
  ignoreBottomRows: 6,
};

export class MotionAdaptiveFrameSampler implements IFrameSamplingStrategy {
  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;
  private previousImageData: ImageData | null = null;
  private lastCaptureTime: number = -1;
  private readonly activeRows: number;
  private readonly totalPixels: number;

  constructor(
    private readonly config: MotionSamplerConfig = DEFAULT_MOTION_SAMPLER_CONFIG,
    canvasFactory?: () => HTMLCanvasElement | null
  ) {
    this.activeRows = Math.max(1, this.config.downscaleHeight - this.config.ignoreBottomRows);
    this.totalPixels = this.config.downscaleWidth * this.activeRows;

    if (canvasFactory) {
      this.scratchCanvas = canvasFactory();
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        this.scratchCanvas = document.createElement('canvas');
      } catch {
        this.scratchCanvas = null;
      }
    }

    if (this.scratchCanvas) {
      this.scratchCanvas.width = this.config.downscaleWidth;
      this.scratchCanvas.height = this.config.downscaleHeight;
      this.scratchCtx =
        typeof this.scratchCanvas.getContext === 'function'
          ? this.scratchCanvas.getContext('2d', { willReadFrequently: true })
          : null;
    }
  }

  /**
   * Determines whether a full visual sample should be captured at the current video playback timestamp.
   * Evaluates minimum debounce, maximum heartbeat, and pixelmatch motion ratio.
   */
  public shouldSample(video: HTMLVideoElement, currentVideoTime: number): boolean {
    // 1. First frame of session or segment is always captured
    if (this.lastCaptureTime < 0) {
      this.recordKeyframe(video, currentVideoTime);
      return true;
    }

    const elapsed = Math.abs(currentVideoTime - this.lastCaptureTime);

    // 2. Minimum Debounce: never capture faster than minIntervalSeconds (caps burst uploads)
    if (elapsed < this.config.minIntervalSeconds) {
      return false;
    }

    // 3. Maximum Heartbeat: always capture if maxIntervalSeconds has elapsed (static content floor)
    if (elapsed >= this.config.maxIntervalSeconds) {
      this.recordKeyframe(video, currentVideoTime);
      return true;
    }

    // 4. Compute pixel difference score using pixelmatch
    const motionScore = this.computeMotionScore(video);

    // 5. Scene Cut / High Action: trigger immediately once minIntervalSeconds has elapsed
    if (motionScore >= this.config.sceneCutThreshold) {
      this.recordKeyframe(video, currentVideoTime);
      return true;
    }

    // 6. Moderate Motion: dynamically scale required interval between minInterval and 4.0s
    if (motionScore >= this.config.motionThreshold) {
      const progress =
        (motionScore - this.config.motionThreshold) /
        (this.config.sceneCutThreshold - this.config.motionThreshold);
      const requiredInterval =
        this.config.minIntervalSeconds +
        (4.0 - this.config.minIntervalSeconds) * (1 - Math.min(1, Math.max(0, progress)));
      if (elapsed >= requiredInterval) {
        this.recordKeyframe(video, currentVideoTime);
        return true;
      }
    }

    return false;
  }

  /**
   * Measures pixel motion against the recorded keyframe using pixelmatch over active rows.
   * Returns a normalized mismatch ratio in [0.0, 1.0].
   */
  public computeMotionScore(video: HTMLVideoElement): number {
    if (!this.scratchCtx || !this.previousImageData) return 1.0;

    try {
      this.scratchCtx.drawImage(
        video,
        0,
        0,
        this.config.downscaleWidth,
        this.config.downscaleHeight
      );
      const currentImageData = this.scratchCtx.getImageData(
        0,
        0,
        this.config.downscaleWidth,
        this.activeRows
      );

      const mismatchedPixels = matchPixels(
        this.previousImageData.data,
        currentImageData.data,
        null, // Omit visual diff output buffer for maximum performance and zero garbage allocation
        this.config.downscaleWidth,
        this.activeRows,
        {
          threshold: this.config.pixelmatchThreshold,
          includeAA: false,
        }
      );

      return mismatchedPixels / this.totalPixels;
    } catch {
      return 1.0; // Fallback to capture on canvas security or read error
    }
  }

  /**
   * Records the current downscaled frame as the new baseline keyframe and updates the capture timestamp.
   */
  public recordKeyframe(video: HTMLVideoElement, currentVideoTime: number): void {
    this.lastCaptureTime = currentVideoTime;
    if (!this.scratchCtx) return;

    try {
      this.scratchCtx.drawImage(
        video,
        0,
        0,
        this.config.downscaleWidth,
        this.config.downscaleHeight
      );
      this.previousImageData = this.scratchCtx.getImageData(
        0,
        0,
        this.config.downscaleWidth,
        this.activeRows
      );
    } catch {
      this.previousImageData = null;
    }
  }

  /**
   * Resets internal timestamps and keyframe buffers (called on seek, segment rollover, or gate close).
   */
  public reset(): void {
    this.lastCaptureTime = -1;
    this.previousImageData = null;
  }

  public getLastCaptureTime(): number {
    return this.lastCaptureTime;
  }
}
