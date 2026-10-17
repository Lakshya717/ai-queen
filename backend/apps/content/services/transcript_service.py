"""
Transcript Deduplication & Normalization Service.
Calculates SHA-256 content hashes, deduplicates full YouTube transcripts,
and saves canonical JSON representations for NLP / LLM perplexity analysis.
"""

import hashlib
import json
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from django.conf import settings


def compute_transcript_content_hash(cues: list) -> str:
    """
    Computes a deterministic SHA-256 digest of transcript cues.
    Matches the extension's Web Crypto SHA-256 hashing format.
    """
    normalized_texts = []
    for c in cues:
        txt = (c.get('text') or '').strip()
        normalized_texts.append(txt)
    raw_str = "|".join(normalized_texts)
    return hashlib.sha256(raw_str.encode('utf-8')).hexdigest()


class TranscriptService:
    def __init__(self, media_root: Path = None):
        self.media_root = Path(media_root or settings.MEDIA_ROOT)

    def process_transcript(
        self,
        video_id: str,
        transcript_data: Optional[Dict[str, Any]]
    ) -> Optional[Tuple[str, str, bool, Path]]:
        """
        Processes incoming transcript:
        1. Validates presence and extracts cues.
        2. Computes or verifies SHA-256 hash.
        3. Saves canonical JSON file if not already stored.
        Returns: (content_hash, scope, is_new, file_path) or None
        """
        if not transcript_data:
            return None

        cues = transcript_data.get('segments') or transcript_data.get('cues') or []
        provided_hash = transcript_data.get('contentHash') or transcript_data.get('content_hash')
        scope = transcript_data.get('scope') or ('full' if cues else 'unavailable')
        language = transcript_data.get('language') or 'en'

        if not cues:
            return None

        # Compute canonical hash
        canonical_hash = compute_transcript_content_hash(cues)
        content_hash = provided_hash if provided_hash else canonical_hash

        transcripts_dir = self.media_root / 'youtube' / video_id / 'transcripts'
        transcripts_dir.mkdir(parents=True, exist_ok=True)

        file_path = transcripts_dir / f"{content_hash}.json"
        is_new = not file_path.exists()

        if is_new:
            payload = {
                'videoId': video_id,
                'contentHash': content_hash,
                'scope': scope,
                'language': language,
                'cueCount': len(cues),
                'cues': cues,
            }
            file_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')

        return (content_hash, scope, is_new, file_path)
