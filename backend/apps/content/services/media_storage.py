"""
Media Storage Service.
Decodes Base64 JPEG frames and manages segment audio storage.
If client audio is omitted, seamlessly uses YouTubeAudioService to slice pristine
audio intervals directly from the YouTube audio stream via yt-dlp and FFmpeg.
"""

import base64
import os
import re
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from django.conf import settings
from .youtube_audio_service import YouTubeAudioService


def sanitize_filename_part(val: Any) -> str:
    """Sanitizes identifier strings for safe filesystem paths."""
    return re.sub(r'[^a-zA-Z0-9_\-\.]', '_', str(val))


def strip_base64_data_uri(raw_data: str) -> str:
    """Strips data URI prefix if present (e.g. 'data:image/jpeg;base64,...')."""
    if ',' in raw_data and 'base64' in raw_data[:50]:
        return raw_data.split(',', 1)[1]
    return raw_data


class MediaStorageService:
    def __init__(self, media_root: Path = None):
        self.media_root = Path(media_root or settings.MEDIA_ROOT)

    def get_segment_dir(self, video_id: str, segment_index: int, contribution_id: str) -> Path:
        """Constructs target directory for a contribution's media files."""
        safe_vid = sanitize_filename_part(video_id)
        safe_contrib = sanitize_filename_part(contribution_id)
        path = self.media_root / 'youtube' / safe_vid / 'segments' / f'seg_{segment_index}' / f'contrib_{safe_contrib}'
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_frames(
        self,
        video_id: str,
        segment_index: int,
        contribution_id: str,
        frames_data: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Decodes Base64 frames and writes JPEG stills to disk.
        Returns metadata for each saved frame with relative file paths.
        """
        if not frames_data:
            return []

        contrib_dir = self.get_segment_dir(video_id, segment_index, contribution_id)
        frames_dir = contrib_dir / 'frames'
        frames_dir.mkdir(parents=True, exist_ok=True)

        saved_records = []
        for f in frames_data:
            t = float(f.get('videoTimestampSeconds') or f.get('video_timestamp_seconds') or 0.0)
            raw_b64 = f.get('data', '')
            if not raw_b64:
                continue

            clean_b64 = strip_base64_data_uri(raw_b64)
            try:
                img_bytes = base64.b64decode(clean_b64)
            except Exception:
                continue

            # Standardized 5-digit integer + 3-digit decimal timestamp naming: 00035.000.jpg
            filename = f"{t:09.3f}.jpg"
            file_path = frames_dir / filename
            file_path.write_bytes(img_bytes)

            rel_path = file_path.relative_to(self.media_root).as_posix()
            saved_records.append({
                'video_timestamp_seconds': t,
                'file_path': rel_path,
                'filename': filename,
                'width': f.get('width'),
                'height': f.get('height'),
                'size_bytes': len(img_bytes),
                'mime_type': f.get('mimeType') or f.get('mime_type') or 'image/jpeg',
            })

        return saved_records

    def save_audio_chunks(
        self,
        video_id: str,
        segment_index: int,
        contribution_id: str,
        audio_data: List[Dict[str, Any]] = None,
        observed_intervals: List[Tuple[float, float]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Saves audio for a contribution:
        1. If client provided valid Base64 chunks (e.g. in test suites), decodes and writes them.
        2. If client audio is empty/absent, calls YouTubeAudioService to slice exact observed intervals
           from the native YouTube audio stream using yt-dlp and FFmpeg.
        """
        contrib_dir = self.get_segment_dir(video_id, segment_index, contribution_id)
        audio_dir = contrib_dir / 'audio'
        audio_dir.mkdir(parents=True, exist_ok=True)

        saved_records = []

        # 1. Process client audio data if present
        if audio_data:
            for a in audio_data:
                start_s = float(a.get('startSeconds') or a.get('start_seconds') or 0.0)
                end_s = float(a.get('endSeconds') or a.get('end_seconds') or 0.0)
                drift_ms = int(a.get('alignmentDriftMs') or a.get('alignment_drift_ms') or 0)
                raw_b64 = a.get('data', '')
                if not raw_b64:
                    continue

                clean_b64 = strip_base64_data_uri(raw_b64)
                try:
                    audio_bytes = base64.b64decode(clean_b64)
                except Exception:
                    continue

                if len(audio_bytes) == 0:
                    continue

                # Standardized interval naming: 00030.000_00048.000.webm
                filename = f"{start_s:09.3f}_{end_s:09.3f}.webm"
                file_path = audio_dir / filename
                file_path.write_bytes(audio_bytes)

                rel_path = file_path.relative_to(self.media_root).as_posix()
                saved_records.append({
                    'start_seconds': start_s,
                    'end_seconds': end_s,
                    'alignment_drift_ms': drift_ms,
                    'file_path': rel_path,
                    'filename': filename,
                    'size_bytes': len(audio_bytes),
                    'mime_type': a.get('mimeType') or a.get('mime_type') or 'audio/webm;codecs=opus',
                })

        # 2. Automated server-side YouTube audio extraction fallback
        if not saved_records and observed_intervals:
            for s_start, s_end in observed_intervals:
                if s_end <= s_start:
                    continue
                filename = f"{s_start:09.3f}_{s_end:09.3f}.webm"
                target_path = audio_dir / filename
                slice_info = YouTubeAudioService.slice_segment_audio(
                    video_id=video_id,
                    start_seconds=s_start,
                    end_seconds=s_end,
                    target_path=target_path,
                    media_root=self.media_root,
                )
                if slice_info:
                    saved_records.append(slice_info)

        return saved_records
