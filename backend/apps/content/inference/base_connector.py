"""
BaseComponentConnector and CollectedScoreRecord.
Provides the template lifecycle for hardcoded input-preparation, component execution,
output-collection, and strict fault isolation.
"""

import time
import logging
import traceback
from abc import ABC, abstractmethod
from typing import Any, Optional, Dict
from dataclasses import dataclass, field
from .context import SegmentContext

logger = logging.getLogger(__name__)


@dataclass
class CollectedScoreRecord:
    component_name: str
    modality: str
    score: Optional[float]
    confidence: Optional[float] = None
    status: str = "SUCCESS"  # "SUCCESS", "SKIPPED", "FAILED"
    execution_time_ms: float = 0.0
    details: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None


class BaseComponentConnector(ABC):
    """
    Abstract base class for all hardcoded backend component connectors.
    Each connector encapsulates:
      1. prepare_input: Shapes data from SegmentContext for the specific component.
      2. invoke_component: Calls the underlying component module.
      3. collect_output: Gathers and structures the variety of details into a CollectedScoreRecord.
    """
    name: str = ""
    modality: str = ""

    @abstractmethod
    def prepare_input(self, context: SegmentContext) -> Any:
        """
        Extracts and formats the exact input structure the component expects.
        Returns None if required inputs are missing, causing the connector to skip gracefully.
        """
        pass

    @abstractmethod
    def invoke_component(self, component_input: Any) -> Any:
        """
        Invokes the specific component function, class, or model pipeline.
        """
        pass

    @abstractmethod
    def collect_output(self, raw_output: Any) -> CollectedScoreRecord:
        """
        Interprets the component's raw return dictionary/object and collects all details.
        """
        pass

    def run(self, context: SegmentContext) -> CollectedScoreRecord:
        """
        Executes the connector lifecycle with execution timing and fault isolation.
        Any exception raised inside prepare_input, invoke_component, or collect_output
        is caught and logged without disrupting other components or the overall system.
        """
        t0 = time.perf_counter()
        try:
            component_input = self.prepare_input(context)
            if component_input is None:
                elapsed = round((time.perf_counter() - t0) * 1000, 2)
                return CollectedScoreRecord(
                    component_name=self.name,
                    modality=self.modality,
                    score=None,
                    status="SKIPPED",
                    execution_time_ms=elapsed,
                    details={"reason": f"Required evidence for {self.modality} not present in segment"},
                )

            raw_output = self.invoke_component(component_input)
            record = self.collect_output(raw_output)
            record.execution_time_ms = round((time.perf_counter() - t0) * 1000, 2)
            return record

        except Exception as exc:
            elapsed = round((time.perf_counter() - t0) * 1000, 2)
            tb = traceback.format_exc()
            logger.exception(f"Component connector '{self.name}' failed during execution: {exc}")
            return CollectedScoreRecord(
                component_name=self.name,
                modality=self.modality,
                score=None,
                confidence=None,
                status="FAILED",
                execution_time_ms=elapsed,
                error_message=f"{type(exc).__name__}: {str(exc)}",
                details={"traceback": tb},
            )
