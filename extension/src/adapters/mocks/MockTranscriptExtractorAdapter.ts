import type { ITranscriptExtractorAdapter } from '../../ports/ITranscriptExtractorAdapter';
import type { TranscriptPayload, TranscriptScope } from '../../domain/models/EvidencePackage';

export class MockTranscriptExtractorAdapter implements ITranscriptExtractorAdapter {
  constructor(
    private readonly fixtureScope: TranscriptScope = 'full',
    private readonly fixtureLanguage: string = 'en'
  ) {}

  public async extractTranscript(_videoId: string): Promise<TranscriptPayload> {
    if (this.fixtureScope === 'unavailable') {
      return {
        scope: 'unavailable',
        language: null,
        segments: [],
        contentHash: null,
        omissionReason: 'Captions unavailable for this test fixture.',
      };
    }

    const segments = [
      { startSeconds: 0.0, endSeconds: 4.5, text: 'Welcome to this comprehensive video demonstration.' },
      { startSeconds: 4.5, endSeconds: 10.0, text: 'Today we discuss crowdsourced active-watching collection.' },
      { startSeconds: 10.0, endSeconds: 20.0, text: 'Notice how every segment is bounded and timestamped.' },
    ];

    return {
      scope: this.fixtureScope,
      language: this.fixtureLanguage,
      segments: this.fixtureScope === 'partial' ? [segments[0]] : segments,
      contentHash: `sha256_mock_fixture_${this.fixtureScope}`,
    };
  }
}
