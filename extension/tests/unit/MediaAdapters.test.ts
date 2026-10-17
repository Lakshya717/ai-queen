import { describe, it, expect } from 'vitest';
import { TimeInterval } from '../../src/domain/models/TimeInterval';
import { MockScreenshotCaptureAdapter } from '../../src/adapters/media/MockScreenshotCaptureAdapter';
import { MockAudioCaptureAdapter } from '../../src/adapters/media/MockAudioCaptureAdapter';
import { UnsupportedAudioCaptureAdapter } from '../../src/adapters/media/UnsupportedAudioCaptureAdapter';
import { InPageMediaCaptureAdapter } from '../../src/adapters/media/InPageMediaCaptureAdapter';
import { ChromeTabAudioCaptureAdapter } from '../../src/adapters/media/ChromeTabAudioCaptureAdapter';

describe('Media Capture Adapters (Review Loop 2)', () => {
  it('MockScreenshotCaptureAdapter captures timestamped frames and handles abort', async () => {
    const adapter = new MockScreenshotCaptureAdapter({ intervalSeconds: 5, maxFramesPerSegment: 6 });
    const sample = await adapter.captureFrame(12.345);

    expect(sample).not.toBeNull();
    expect(sample?.videoTimestampSeconds).toBe(12.345);
    expect(sample?.mimeType).toBe('image/jpeg');
    expect(sample?.data).toContain('synthetic_jpeg_frame_12.345');

    adapter.abortPendingCapture();
    const abortedSample = await adapter.captureFrame(15.0);
    expect(abortedSample).toBeNull();
  });

  it('MockAudioCaptureAdapter records bounded chunks aligned with video timeline', async () => {
    const adapter = new MockAudioCaptureAdapter();
    const bounds = new TimeInterval(0, 30);

    await adapter.startSegmentRecording(bounds, 10.0);
    const chunks = await adapter.stopAndFlushRecording(25.5);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].interval.startSeconds).toBe(10.0);
    expect(chunks[0].interval.endSeconds).toBe(25.5);
    expect(chunks[0].mimeType).toBe('audio/webm;codecs=opus');
    expect(chunks[0].alignmentDriftMs).toBeLessThanOrEqual(100);
  });

  it('UnsupportedAudioCaptureAdapter gracefully degrades without throwing', async () => {
    const adapter = new UnsupportedAudioCaptureAdapter('gesture_required');
    expect(adapter.isSupportedAndAuthorized).toBe(false);
    expect(adapter.unavailableReason).toBe('gesture_required');

    await adapter.startSegmentRecording(new TimeInterval(0, 30), 0);
    const chunks = await adapter.stopAndFlushRecording(30);
    expect(chunks).toEqual([]);
    await expect(adapter.abortAndDiscard()).resolves.not.toThrow();
  });

  it('InPageMediaCaptureAdapter handles missing video element gracefully', async () => {
    const adapter = new InPageMediaCaptureAdapter(() => null);

    expect(adapter.isCanvasReadable()).toBe(false);
    const frame = await adapter.captureFrame(5.0);
    expect(frame).toBeNull();

    await adapter.startSegmentRecording(new TimeInterval(0, 30), 0);
    expect(adapter.unavailableReason).toBe('unsupported_browser');

    const chunks = await adapter.stopAndFlushRecording(10.0);
    expect(chunks).toEqual([]);
  });

  it('ChromeTabAudioCaptureAdapter reports gesture_required until streamId is granted', async () => {
    const adapter = new ChromeTabAudioCaptureAdapter();
    expect(adapter.isSupportedAndAuthorized).toBe(false);
    expect(adapter.unavailableReason).toBe('gesture_required');

    adapter.setStreamId('mock_stream_123');
    expect(adapter.isSupportedAndAuthorized).toBe(true);
    expect(adapter.unavailableReason).toBeNull();
  });
});
