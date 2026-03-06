from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ChunkMetadata:
    chunk_index: int
    total_chunks: int
    file_type: str
    start_boundary: int
    end_boundary: int
    overlap_before: int
    overlap_after: int
    temp_input_path: str
    temp_output_path: str
    extra_info: dict = field(default_factory=dict)


@dataclass
class ChunkResult:
    chunk_index: int
    success: bool
    pii_summary: dict
    layer_breakdown: dict
    strategies_applied: dict
    error: Optional[str] = None


@dataclass
class ProcessingResult:
    success: bool
    total_chunks: int
    completed_chunks: int
    failed_chunks: int
    pii_summary: dict
    layer_breakdown: dict
    strategies_applied: dict
    total_pii: int
    error: Optional[str] = None
