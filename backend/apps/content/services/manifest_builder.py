"""
Manifest Builder Service.
Generates structured multimodal dataset manifests (manifest.json & llm-input.md)
aligning video frames, audio chunks, and transcript cues along a unified playback timeline
for downstream deep learning classifiers (ViT, Wav2Vec2, DeBERTa).
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from django.conf import settings


class ManifestBuilder:
    def __init__(self, media_root: Path = None):
        self.media_root = Path(media_root or settings.MEDIA_ROOT)

    def build_segment_manifest(
        self,
        video_id: str,
        segment_index: int,
        segment_bounds: tuple[float, float],
        coverage_status: str,
        merged_intervals: List[tuple[float, float]],
        frames: List[Dict[str, Any]],
        audio_chunks: List[Dict[str, Any]],
        transcript_cues: Optional[List[Dict[str, Any]]] = None,
        transcript_hash: Optional[str] = None,
    ) -> Path:
        """
        Builds and writes media/youtube/<video_id>/segments/seg_<idx>/manifest.json
        """
        seg_dir = self.media_root / 'youtube' / video_id / 'segments' / f'seg_{segment_index}'
        seg_dir.mkdir(parents=True, exist_ok=True)

        seg_start, seg_end = segment_bounds

        # Filter transcript cues to this segment if provided
        segment_cues = []
        if transcript_cues:
            for c in transcript_cues:
                c_start = float(c.get('startSeconds') or c.get('start') or 0.0)
                c_end = float(c.get('endSeconds') or c.get('end') or c_start)
                if c_end >= seg_start and c_start <= seg_end:
                    segment_cues.append({
                        'start_seconds': c_start,
                        'end_seconds': c_end,
                        'text': c.get('text', ''),
                    })

        manifest = {
            'schema': 'aidetect-segment-manifest/v1',
            'video_id': video_id,
            'segment_index': segment_index,
            'segment_bounds': {
                'start_seconds': seg_start,
                'end_seconds': seg_end,
            },
            'coverage_status': coverage_status,
            'covered_intervals': [
                {'start_seconds': s, 'end_seconds': e} for s, e in merged_intervals
            ],
            'frame_count': len(frames),
            'frames': sorted(frames, key=lambda x: x.get('video_timestamp_seconds', 0.0)),
            'audio_count': len(audio_chunks),
            'audio_chunks': sorted(audio_chunks, key=lambda x: x.get('start_seconds', 0.0)),
            'transcript_hash': transcript_hash,
            'segment_cues': segment_cues,
        }

        manifest_path = seg_dir / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')

        # Also generate aligned llm-input.md for prompt/LLM style models
        self.generate_llm_markdown(seg_dir, video_id, segment_index, manifest)

        return manifest_path

    def generate_llm_markdown(
        self,
        seg_dir: Path,
        video_id: str,
        segment_index: int,
        manifest: Dict[str, Any]
    ) -> Path:
        """Generates a human- and LLM-readable aligned timeline of evidence."""
        lines = [
            f"# Evidence Manifest: YouTube Video {video_id} (Segment {segment_index})",
            f"Bounds: [{manifest['segment_bounds']['start_seconds']}s - {manifest['segment_bounds']['end_seconds']}s]",
            f"Status: {manifest['coverage_status'].upper()}",
            "",
            "## Timeline Aligned Evidence",
            "",
        ]

        # Combine cues and frames into an ordered sequence
        events = []
        for cue in manifest.get('segment_cues', []):
            events.append((cue['start_seconds'], f"[Speech {cue['start_seconds']:.1f}s-{cue['end_seconds']:.1f}s] \"{cue['text']}\""))

        for frame in manifest.get('frames', []):
            t = frame['video_timestamp_seconds']
            events.append((t, f"[Frame {t:.1f}s] {frame['file_path']} ({frame.get('width', '?')}x{frame.get('height', '?')})"))

        for audio in manifest.get('audio_chunks', []):
            s = audio['start_seconds']
            e = audio['end_seconds']
            events.append((s, f"[Audio {s:.1f}s-{e:.1f}s] {audio['file_path']} ({audio.get('mime_type', 'audio/webm')}, {audio.get('size_bytes', 0)} bytes)"))

        events.sort(key=lambda x: x[0])

        for _, desc in events:
            lines.append(desc)

        md_path = seg_dir / 'llm-input.md'
        md_path.write_text("\n".join(lines), encoding='utf-8')
        return md_path
