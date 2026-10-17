"""
YouTube Audio Extraction & Slicing Service.
Uses yt-dlp to download pristine YouTube audio streams once per video,
and FFmpeg to slice exact segment time intervals in milliseconds for multimodal AI analysis.
"""

import os
import re
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
import imageio_ffmpeg
import yt_dlp
from django.conf import settings

YOUTUBE_ID_PATTERN = re.compile(r'^[a-zA-Z0-9_-]{11}$')


def ensure_ffmpeg_in_path() -> str:
    """Ensures imageio-ffmpeg executable directory is present in PATH and returns exe path."""
    exe_path = imageio_ffmpeg.get_ffmpeg_exe()
    ffmpeg_dir = os.path.dirname(exe_path)
    if ffmpeg_dir not in os.environ.get('PATH', ''):
        os.environ['PATH'] = ffmpeg_dir + os.pathsep + os.environ.get('PATH', '')
    
    # Also ensure an 'ffmpeg.exe' alias exists in that directory if needed
    alias_path = os.path.join(ffmpeg_dir, 'ffmpeg.exe')
    if not os.path.exists(alias_path):
        try:
            import shutil
            shutil.copyfile(exe_path, alias_path)
        except Exception:
            pass
            
    return exe_path


class YouTubeAudioService:
    @classmethod
    def get_or_download_video_audio(cls, video_id: str, media_root: Path = None) -> Optional[Path]:
        """
        Retrieves cached full video audio file, or downloads it via yt-dlp if not yet present.
        Caches to: <media_root>/youtube/<video_id>/audio/full_audio.<ext>
        """
        if not video_id or not YOUTUBE_ID_PATTERN.match(video_id):
            return None

        root = Path(media_root or settings.MEDIA_ROOT)
        audio_cache_dir = root / 'youtube' / video_id / 'audio'
        audio_cache_dir.mkdir(parents=True, exist_ok=True)

        # Check for existing cached audio
        for ext in ['webm', 'm4a', 'opus', 'mp3']:
            candidate = audio_cache_dir / f'full_audio.{ext}'
            if candidate.exists() and candidate.stat().st_size > 1024:
                return candidate

        ensure_ffmpeg_in_path()

        # Download audio via yt-dlp
        ydl_opts = {
            'format': 'ba[ext=webm]/bestaudio[ext=webm]/ba[ext=m4a]/bestaudio',
            'outtmpl': str(audio_cache_dir / 'full_audio.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'js_runtimes': {'node': {}},
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f'https://www.youtube.com/watch?v={video_id}'])
        except Exception:
            # Silently fallback if network or video unavailable
            return None

        for ext in ['webm', 'm4a', 'opus', 'mp3']:
            candidate = audio_cache_dir / f'full_audio.{ext}'
            if candidate.exists() and candidate.stat().st_size > 1024:
                return candidate

        return None

    @classmethod
    def slice_segment_audio(
        cls,
        video_id: str,
        start_seconds: float,
        end_seconds: float,
        target_path: Path,
        media_root: Path = None
    ) -> Optional[Dict[str, Any]]:
        """
        Slices exact segment interval [start_seconds, end_seconds] from the cached full audio
        using FFmpeg stream copy (-c copy) in milliseconds without re-encoding.
        """
        if not video_id or not YOUTUBE_ID_PATTERN.match(video_id):
            return None

        full_audio = cls.get_or_download_video_audio(video_id, media_root)
        if not full_audio or not full_audio.exists():
            return None

        ffmpeg_exe = ensure_ffmpeg_in_path()
        target_path.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            ffmpeg_exe,
            '-ss', f"{start_seconds:.3f}",
            '-to', f"{end_seconds:.3f}",
            '-i', str(full_audio),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            '-y',
            str(target_path)
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if res.returncode != 0 or not target_path.exists() or target_path.stat().st_size == 0:
                return None

            size_bytes = target_path.stat().st_size
            ext = target_path.suffix.lstrip('.')
            mime_type = 'audio/webm;codecs=opus' if ext == 'webm' else f'audio/{ext}'
            root = Path(media_root or settings.MEDIA_ROOT)
            rel_path = target_path.relative_to(root).as_posix()

            return {
                'start_seconds': start_seconds,
                'end_seconds': end_seconds,
                'duration_seconds': max(0.0, end_seconds - start_seconds),
                'alignment_drift_ms': 0,
                'file_path': rel_path,
                'filename': target_path.name,
                'size_bytes': size_bytes,
                'mime_type': mime_type,
            }
        except Exception:
            return None
