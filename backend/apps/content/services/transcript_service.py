"""
Transcript Deduplication & Normalization Service.
Calculates SHA-256 content hashes, deduplicates full YouTube transcripts,
provides automated server-side caption extraction fallback via YouTubeTranscriptService,
and saves canonical JSON representations for NLP / LLM perplexity analysis.
"""

import hashlib
import json
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from django.conf import settings
from .youtube_transcript_service import YouTubeTranscriptService


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


class TranscriptProcessResult:
    """
    Result container that supports both attribute access and backward-compatible
    4-item tuple unpacking: (content_hash, scope, is_new, file_path).
    """
    def __init__(
        self,
        content_hash: str,
        scope: str,
        is_new: bool,
        file_path: Path,
        cues: List[Dict[str, Any]],
        language: str
    ):
        self.content_hash = content_hash
        self.scope = scope
        self.is_new = is_new
        self.file_path = file_path
        self.cues = cues
        self.language = language

    def __iter__(self):
        return iter((self.content_hash, self.scope, self.is_new, self.file_path))

    def __getitem__(self, index):
        return (self.content_hash, self.scope, self.is_new, self.file_path)[index]

    def __len__(self):
        return 4


class TranscriptService:
    def __init__(self, media_root: Path = None):
        self.media_root = Path(media_root or settings.MEDIA_ROOT)

    def process_transcript(
        self,
        video_id: str,
        transcript_data: Optional[Dict[str, Any]] = None,
        allow_server_fallback: bool = True
    ) -> Optional[TranscriptProcessResult]:
        """
        Processes incoming transcript:
        1. Validates presence and extracts cues from client payload.
        2. If client cues are empty or absent, attempts automated server-side fallback.
        3. Computes or verifies SHA-256 hash.
        4. Saves canonical JSON file if not already stored.
        Returns: TranscriptProcessResult (unpacks as content_hash, scope, is_new, file_path) or None.
        """
        cues = []
        provided_hash = None
        scope = 'unavailable'
        language = 'en'

        if transcript_data:
            cues = transcript_data.get('segments') or transcript_data.get('cues') or []
            provided_hash = transcript_data.get('contentHash') or transcript_data.get('content_hash')
            scope = transcript_data.get('scope') or ('full' if cues else 'unavailable')
            language = transcript_data.get('language') or 'en'

        # Automated server-side YouTube caption extraction fallback
        if not cues and allow_server_fallback:
            server_res = YouTubeTranscriptService.get_or_fetch_transcript(
                video_id=video_id,
                media_root=self.media_root
            )
            if server_res and server_res.get('segments'):
                cues = server_res.get('segments', [])
                scope = server_res.get('scope', 'full')
                language = server_res.get('language', 'en')

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

        return TranscriptProcessResult(
            content_hash=content_hash,
            scope=scope,
            is_new=is_new,
            file_path=file_path,
            cues=cues,
            language=language,
        )
