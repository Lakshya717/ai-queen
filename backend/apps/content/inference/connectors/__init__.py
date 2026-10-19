"""
Hardcoded Backend Component Connectors.
Provides explicit input-shaping and output-collection logic for each independent component.
"""

from .slopout_visual_connector import SlopOutVisualConnector
from .slopout_text_connector import SlopOutTextConnector
from .temporal_connector import TemporalConsistencyConnector
from .audio_connector import AudioSignalConnector

__all__ = [
    "SlopOutVisualConnector",
    "SlopOutTextConnector",
    "TemporalConsistencyConnector",
    "AudioSignalConnector",
]
