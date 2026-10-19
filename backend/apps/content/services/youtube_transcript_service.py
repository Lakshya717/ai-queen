"""
YouTube Transcript Extraction Service.
Extracts YouTube video captions and timestamps server-side using youtube-transcript-api
with yt-dlp fallback, language negotiation, and cue normalization.
"""

import re
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from django.conf import settings

logger = logging.getLogger(__name__)

YOUTUBE_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{11}$')


class YouTubeTranscriptService:
    DEFAULT_PREFERRED_LANGUAGES = ['en', 'en-US', 'en-GB']

    @classmethod
    def get_or_fetch_transcript(
        cls,
        video_id: str,
        preferred_languages: Optional[List[str]] = None,
        media_root: Path = None
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves or fetches full transcript for a YouTube video.
        1. Checks if already cached on disk at: <media_root>/youtube/<video_id>/transcripts/transcript.json
        2. If not, fetches captions via youtube-transcript-api with language fallback.
        3. If youtube-transcript-api fails, attempts yt-dlp fallback.
        4. Normalizes cues to standard {startSeconds, endSeconds, start_seconds, end_seconds, text}.
        5. Saves canonical JSON to disk.
        Returns: {
            'video_id': str,
            'language': str,
            'scope': 'full' | 'partial' | 'unavailable',
            'is_generated': bool,
            'segments': List[Dict[str, Any]]
        } or None
        """
        if not video_id or not YOUTUBE_ID_PATTERN.match(video_id):
            return None

        root = Path(media_root or settings.MEDIA_ROOT)
        transcript_dir = root / 'youtube' / video_id / 'transcripts'
        transcript_dir.mkdir(parents=True, exist_ok=True)
        cached_file = transcript_dir / 'transcript.json'

        # 1. Return existing cached transcript if present and valid
        if cached_file.exists():
            try:
                data = json.loads(cached_file.read_text(encoding='utf-8'))
                if data and (data.get('segments') or data.get('cues')):
                    return data
            except Exception:
                pass

        langs = preferred_languages or cls.DEFAULT_PREFERRED_LANGUAGES

        # 2. Primary Engine: youtube-transcript-api
        res = cls._fetch_via_youtube_transcript_api(video_id, langs)
        if res and res.get('segments'):
            cls._save_to_disk(cached_file, res)
            return res

        # 3. Secondary Engine: yt-dlp
        res = cls._fetch_via_ytdlp(video_id, langs, transcript_dir)
        if res and res.get('segments'):
            cls._save_to_disk(cached_file, res)
            return res

        return None

    @classmethod
    def _fetch_via_youtube_transcript_api(
        cls,
        video_id: str,
        preferred_languages: List[str]
    ) -> Optional[Dict[str, Any]]:
        """Fetches transcripts using youtube-transcript-api with intelligent language fallback."""
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            ytta = YouTubeTranscriptApi()
            transcript_list = ytta.list(video_id)

            selected_transcript = None

            # 1. Preferred manual transcript
            try:
                selected_transcript = transcript_list.find_manually_created_transcript(preferred_languages)
            except Exception:
                pass

            # 2. Preferred generated transcript
            if not selected_transcript:
                try:
                    selected_transcript = transcript_list.find_generated_transcript(preferred_languages)
                except Exception:
                    pass

            # 3. Any manual transcript available
            if not selected_transcript:
                for t in transcript_list:
                    if not t.is_generated:
                        selected_transcript = t
                        break

            # 4. Any generated transcript available
            if not selected_transcript:
                for t in transcript_list:
                    selected_transcript = t
                    break

            if not selected_transcript:
                return None

            raw_snippets = selected_transcript.fetch()
            if not raw_snippets:
                return None

            cues = []
            for item in raw_snippets:
                start = getattr(item, 'start', None) if not isinstance(item, dict) else item.get('start')
                duration = getattr(item, 'duration', None) if not isinstance(item, dict) else item.get('duration')
                text = getattr(item, 'text', None) if not isinstance(item, dict) else item.get('text')

                if start is None or text is None:
                    continue

                start_sec = round(float(start), 3)
                dur_sec = round(float(duration or 2.0), 3)
                end_sec = round(start_sec + dur_sec, 3)
                clean_text = ' '.join(str(text).split())

                if not clean_text:
                    continue

                cues.append({
                    'startSeconds': start_sec,
                    'endSeconds': end_sec,
                    'start_seconds': start_sec,
                    'end_seconds': end_sec,
                    'text': clean_text,
                })

            if not cues:
                return None

            return {
                'video_id': video_id,
                'language': selected_transcript.language_code,
                'scope': 'full' if len(cues) >= 5 else 'partial',
                'is_generated': bool(selected_transcript.is_generated),
                'segments': cues,
            }
        except Exception as e:
            logger.warning(f"youtube-transcript-api extraction failed for {video_id}: {e}")
            return None

    @classmethod
    def _fetch_via_ytdlp(
        cls,
        video_id: str,
        preferred_languages: List[str],
        temp_dir: Path
    ) -> Optional[Dict[str, Any]]:
        """Fallback subtitle extraction using yt-dlp."""
        try:
            import yt_dlp
            out_pattern = str(temp_dir / f'ytdlp_{video_id}.%(ext)s')
            ydl_opts = {
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': preferred_languages + ['en', 'all'],
                'subtitlesformat': 'json3',
                'outtmpl': out_pattern,
                'quiet': True,
                'no_warnings': True,
                'js_runtimes': {'node': {}},
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f'https://www.youtube.com/watch?v={video_id}', download=False)
                if not info:
                    return None

            # Check if any .json3 file was downloaded
            for f in temp_dir.glob(f'ytdlp_{video_id}*.json3'):
                try:
                    payload = json.loads(f.read_text(encoding='utf-8'))
                    events = payload.get('events', [])
                    cues = []
                    for ev in events:
                        segs = ev.get('segs')
                        if not segs:
                            continue
                        text = ' '.join(s.get('utf8', '') for s in segs).strip()
                        if not text:
                            continue
                        t_start = float(ev.get('tStartMs', 0)) / 1000.0
                        t_dur = float(ev.get('dDurationMs', 2000)) / 1000.0
                        cues.append({
                            'startSeconds': round(t_start, 3),
                            'endSeconds': round(t_start + t_dur, 3),
                            'start_seconds': round(t_start, 3),
                            'end_seconds': round(t_start + t_dur, 3),
                            'text': text,
                        })
                    f.unlink(missing_ok=True)
                    if cues:
                        return {
                            'video_id': video_id,
                            'language': 'en',
                            'scope': 'full' if len(cues) >= 5 else 'partial',
                            'is_generated': True,
                            'segments': cues,
                        }
                except Exception:
                    f.unlink(missing_ok=True)
            return None
        except Exception as e:
            logger.warning(f"yt-dlp subtitle extraction failed for {video_id}: {e}")
            return None

    @classmethod
    def _save_to_disk(cls, target_path: Path, data: Dict[str, Any]) -> None:
        try:
            target_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to cache transcript to {target_path}: {e}")
