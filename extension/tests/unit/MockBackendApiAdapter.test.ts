import { describe, it, expect, beforeEach } from 'vitest';
import { TimeInterval } from '../../src/domain/models/TimeInterval';
import { EvidencePackage } from '../../src/domain/models/EvidencePackage';
import { MockBackendApiAdapter } from '../../src/adapters/mocks/MockBackendApiAdapter';

describe('MockBackendApiAdapter Interval Merging (Test #6 & Test #7)', () => {
  let backend: MockBackendApiAdapter;

  beforeEach(() => {
    backend = new MockBackendApiAdapter({
      defaultSegmentDurationSeconds: 30,
      defaultVideoDurationSeconds: 120, // 4 segments: [0, 30), [30, 60), [60, 90), [90, 120)
      sufficiencyRatioThreshold: 0.95,
      simulateNetworkLatencyMs: 0,
    });
  });

  it('returns not_found status when no evidence has been contributed', async () => {
    const lookup = await backend.lookupVideoCoverage('vid_new');
    expect(lookup.status).toBe('not_found');
    expect(lookup.segments).toHaveLength(4);
    expect(lookup.missingSegmentIndices).toEqual([0, 1, 2, 3]);
    expect(lookup.aiRelianceScore).toBeNull();
  });

  it('records partial contribution and leaves remaining intervals uncovered (Test #6)', async () => {
    // Viewer A watches [10, 30) for Segment 0
    const pkg0 = new EvidencePackage(
      'vid_test',
      'v1',
      0,
      new TimeInterval(0, 30),
      [new TimeInterval(10, 30)],
      [],
      [],
      null,
      { screenshots: true, tabAudio: true, transcriptScope: 'unavailable' }
    );

    const uploadRes = await backend.submitContribution(pkg0);
    expect(uploadRes.videoStatus).toBe('partial');
    expect(uploadRes.acceptedIntervals).toEqual([{ startSeconds: 10, endSeconds: 30 }]);
    expect(uploadRes.remainingIntervals).toEqual([{ startSeconds: 0, endSeconds: 10 }]);

    const lookup = await backend.lookupVideoCoverage('vid_test');
    expect(lookup.status).toBe('partial');
    expect(lookup.segments[0].coverage).toBe('partial'); // 20s / 30s = 66% < 95%
    expect(lookup.segments[1].coverage).toBe('missing');
    expect(lookup.missingSegmentIndices).toContain(0);
  });

  it('atomically merges intervals from multiple viewers to achieve complete coverage (Test #7)', async () => {
    const videoId = 'vid_multi_viewer';

    // Viewer A watches 10s to 48s:
    // Contributes [10, 30) to Segment 0
    await backend.submitContribution(
      new EvidencePackage(
        videoId,
        'v1',
        0,
        new TimeInterval(0, 30),
        [new TimeInterval(10, 30)],
        [],
        [],
        null,
        { screenshots: true, tabAudio: true, transcriptScope: 'unavailable' }
      )
    );

    // Contributes [30, 48) to Segment 1
    await backend.submitContribution(
      new EvidencePackage(
        videoId,
        'v1',
        1,
        new TimeInterval(30, 60),
        [new TimeInterval(30, 48)],
        [],
        [],
        null,
        { screenshots: true, tabAudio: true, transcriptScope: 'unavailable' }
      )
    );

    // Check intermediate state
    let lookup = await backend.lookupVideoCoverage(videoId);
    expect(lookup.segments[0].coverage).toBe('partial');
    expect(lookup.segments[1].coverage).toBe('partial');

    // Viewer B watches 0s to 10s and 48s to 60s:
    // Contributes [0, 10) to Segment 0
    await backend.submitContribution(
      new EvidencePackage(
        videoId,
        'v1',
        0,
        new TimeInterval(0, 30),
        [new TimeInterval(0, 10)],
        [],
        [],
        null,
        { screenshots: true, tabAudio: true, transcriptScope: 'unavailable' }
      )
    );

    // Segment 0 should now be complete (covers 0 to 30 -> 100% >= 95%)
    lookup = await backend.lookupVideoCoverage(videoId);
    expect(lookup.segments[0].coverage).toBe('complete');
    expect(lookup.missingSegmentIndices).not.toContain(0);

    // Contributes [48, 60) to Segment 1
    await backend.submitContribution(
      new EvidencePackage(
        videoId,
        'v1',
        1,
        new TimeInterval(30, 60),
        [new TimeInterval(48, 60)],
        [],
        [],
        null,
        { screenshots: true, tabAudio: true, transcriptScope: 'unavailable' }
      )
    );

    // Segment 1 should now be complete (covers 30 to 60 -> 100% >= 95%)
    lookup = await backend.lookupVideoCoverage(videoId);
    expect(lookup.segments[1].coverage).toBe('complete');
    expect(lookup.missingSegmentIndices).not.toContain(1);

    // Segments 2 and 3 remain missing
    expect(lookup.segments[2].coverage).toBe('missing');
    expect(lookup.segments[3].coverage).toBe('missing');
    expect(lookup.missingSegmentIndices).toEqual([2, 3]);
    expect(lookup.status).toBe('partial');
  });

  it('deduplicates full transcripts by SHA-256 contentHash', async () => {
    const videoId = 'vid_transcript_dedup';
    const transcriptHash = 'sha256_mock_hash_1234567890abcdef';

    const pkg = new EvidencePackage(
      videoId,
      'v1',
      0,
      new TimeInterval(0, 30),
      [new TimeInterval(0, 30)],
      [],
      [],
      {
        scope: 'full',
        language: 'en',
        segments: [{ startSeconds: 0, endSeconds: 5, text: 'Hello' }],
        contentHash: transcriptHash,
      },
      { screenshots: true, tabAudio: true, transcriptScope: 'full' }
    );

    await backend.submitContribution(pkg);
    expect(backend.getTranscriptHashes(videoId).has(transcriptHash)).toBe(true);

    // Submit again with same hash
    await backend.submitContribution(pkg);
    expect(backend.getTranscriptHashes(videoId).size).toBe(1);
  });
});
