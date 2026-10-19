import { describe, it, expect } from 'vitest';
import {
  MotionAdaptiveFrameSampler,
  DEFAULT_MOTION_SAMPLER_CONFIG,
} from '../../src/adapters/media/MotionAdaptiveFrameSampler';

function createMockCanvas(pixelDataProvider: () => Uint8ClampedArray): HTMLCanvasElement {
  const w = DEFAULT_MOTION_SAMPLER_CONFIG.downscaleWidth;
  const h = DEFAULT_MOTION_SAMPLER_CONFIG.downscaleHeight;

  const mockCtx = {
    drawImage: () => {},
    getImageData: (_sx: number, _sy: number, sw: number, sh: number) => {
      const full = pixelDataProvider();
      // Extract sw x sh sub-slice (activeRows)
      const sub = new Uint8ClampedArray(sw * sh * 4);
      sub.set(full.subarray(0, sw * sh * 4));
      return {
        data: sub,
        width: sw,
        height: sh,
        colorSpace: 'srgb' as PredefinedColorSpace,
      };
    },
  };

  return {
    width: w,
    height: h,
    getContext: () => mockCtx,
  } as unknown as HTMLCanvasElement;
}

describe('MotionAdaptiveFrameSampler with pixelmatch', () => {
  const mockVideo = {} as HTMLVideoElement;
  const w = DEFAULT_MOTION_SAMPLER_CONFIG.downscaleWidth;
  const h = DEFAULT_MOTION_SAMPLER_CONFIG.downscaleHeight;
  const totalBytes = w * h * 4;

  it('samples the first frame unconditionally and sets baseline keyframe', () => {
    let currentPixels = new Uint8ClampedArray(totalBytes);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    const shouldSample = sampler.shouldSample(mockVideo, 0.0);
    expect(shouldSample).toBe(true);
    expect(sampler.getLastCaptureTime()).toBe(0.0);
  });

  it('enforces debounce ceiling and suppresses captures faster than 1.25s', () => {
    let currentPixels = new Uint8ClampedArray(totalBytes);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    // Initial capture at t = 0s
    expect(sampler.shouldSample(mockVideo, 0.0)).toBe(true);

    // Completely invert pixels at t = 0.5s (massive motion/cut)
    currentPixels = new Uint8ClampedArray(totalBytes).fill(255);
    // Debounce should prevent sampling
    expect(sampler.shouldSample(mockVideo, 0.5)).toBe(false);
    expect(sampler.shouldSample(mockVideo, 1.20)).toBe(false);
  });

  it('skips sampling for static content between 1.25s and 9.99s', () => {
    const currentPixels = new Uint8ClampedArray(totalBytes).fill(128);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    expect(sampler.shouldSample(mockVideo, 0.0)).toBe(true);

    // Static content (same pixels) across time
    expect(sampler.shouldSample(mockVideo, 1.5)).toBe(false);
    expect(sampler.shouldSample(mockVideo, 3.0)).toBe(false);
    expect(sampler.shouldSample(mockVideo, 5.0)).toBe(false);
    expect(sampler.shouldSample(mockVideo, 9.9)).toBe(false);
  });

  it('forces a heartbeat sample at t >= 10.0s for static content', () => {
    const currentPixels = new Uint8ClampedArray(totalBytes).fill(128);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    expect(sampler.shouldSample(mockVideo, 0.0)).toBe(true);
    expect(sampler.shouldSample(mockVideo, 5.0)).toBe(false);

    // At 10.0s, heartbeat fires even with 0 motion
    expect(sampler.shouldSample(mockVideo, 10.0)).toBe(true);
    expect(sampler.getLastCaptureTime()).toBe(10.0);

    // Next heartbeat should be at 20.0s
    expect(sampler.shouldSample(mockVideo, 15.0)).toBe(false);
    expect(sampler.shouldSample(mockVideo, 20.0)).toBe(true);
  });

  it('triggers fast sampling on scene cuts (mismatch >= 15%) once debounce passes', () => {
    let currentPixels = new Uint8ClampedArray(totalBytes).fill(50);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    expect(sampler.shouldSample(mockVideo, 0.0)).toBe(true);

    // Invert pixels to simulate hard scene cut
    currentPixels = new Uint8ClampedArray(totalBytes).fill(220);

    // Debounce at 1.0s prevents capture
    expect(sampler.shouldSample(mockVideo, 1.0)).toBe(false);

    // At 1.25s (debounce ceiling), scene cut immediately triggers capture
    expect(sampler.shouldSample(mockVideo, 1.25)).toBe(true);
    expect(sampler.getLastCaptureTime()).toBe(1.25);
  });

  it('scales sampling cadence dynamically for moderate motion', () => {
    let currentPixels = new Uint8ClampedArray(totalBytes).fill(100);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    expect(sampler.shouldSample(mockVideo, 0.0)).toBe(true);

    // Modify approximately 8% of the pixels
    const modified = new Uint8ClampedArray(currentPixels);
    const activePixels = w * (h - DEFAULT_MOTION_SAMPLER_CONFIG.ignoreBottomRows);
    const pixelsToChange = Math.floor(activePixels * 0.08);
    for (let i = 0; i < pixelsToChange * 4; i += 4) {
      modified[i] = 255;
      modified[i + 1] = 255;
      modified[i + 2] = 255;
    }
    currentPixels = modified;

    // At 1.5s, moderate motion shouldn't trigger yet (requires ~3.2s)
    expect(sampler.shouldSample(mockVideo, 1.5)).toBe(false);

    // At 3.5s, required dynamic interval has elapsed
    expect(sampler.shouldSample(mockVideo, 3.5)).toBe(true);
  });

  it('ignores pixel changes in the bottom rows (subtitle/ticker immunity)', () => {
    let currentPixels = new Uint8ClampedArray(totalBytes).fill(100);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    expect(sampler.shouldSample(mockVideo, 0.0)).toBe(true);

    // Change ONLY the bottom 5 rows (e.g. YouTube captions popping up)
    const modified = new Uint8ClampedArray(currentPixels);
    const startByte = w * (h - DEFAULT_MOTION_SAMPLER_CONFIG.ignoreBottomRows) * 4;
    for (let i = startByte; i < totalBytes; i++) {
      modified[i] = 255;
    }
    currentPixels = modified;

    // Even after 3.0s, because the changes are in excluded rows, it should NOT sample
    expect(sampler.shouldSample(mockVideo, 3.0)).toBe(false);
    expect(sampler.shouldSample(mockVideo, 6.0)).toBe(false);
  });

  it('clears state and timestamps on reset()', () => {
    const currentPixels = new Uint8ClampedArray(totalBytes).fill(100);
    const canvas = createMockCanvas(() => currentPixels);
    const sampler = new MotionAdaptiveFrameSampler(DEFAULT_MOTION_SAMPLER_CONFIG, () => canvas);

    expect(sampler.shouldSample(mockVideo, 5.0)).toBe(true);
    expect(sampler.getLastCaptureTime()).toBe(5.0);

    sampler.reset();
    expect(sampler.getLastCaptureTime()).toBe(-1);

    // Next call is treated as initial keyframe
    expect(sampler.shouldSample(mockVideo, 12.0)).toBe(true);
    expect(sampler.getLastCaptureTime()).toBe(12.0);
  });
});
