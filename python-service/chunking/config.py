import os

FILE_SIZE_THRESHOLD_MB = 5
MAX_FILE_SIZE_MB = 100
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

CHUNK_CONFIG = {
    "sql": {
        "statements_per_chunk": 500,
        "overlap_statements": 2,
        "max_workers": 4,
    },
    "csv": {
        "rows_per_chunk": 10000,
        "overlap_rows": 0,
        "max_workers": 6,
    },
    "txt": {
        "chars_per_chunk": 50000,
        "overlap_chars": 500,
        "max_workers": 4,
    },
    "md": {
        "chars_per_chunk": 50000,
        "overlap_chars": 500,
        "max_workers": 4,
    },
    "json": {
        "items_per_chunk": 1000,
        "overlap_items": 0,
        "max_workers": 4,
    },
    "pdf": {
        "pages_per_chunk": 10,
        "overlap_pages": 0,
        "max_workers": 3,
    },
    "docx": {
        "paragraphs_per_chunk": 200,
        "overlap_paragraphs": 2,
        "max_workers": 3,
    },
    "png": {
        "grid_rows": 4,
        "grid_cols": 4,
        "max_workers": 8,
    },
    "jpg": {
        "grid_rows": 4,
        "grid_cols": 4,
        "max_workers": 8,
    },
    "jpeg": {
        "grid_rows": 4,
        "grid_cols": 4,
        "max_workers": 8,
    },
}


def get_chunk_config(file_type: str) -> dict:
    normalized = file_type.lower().lstrip(".")
    return CHUNK_CONFIG.get(
        normalized,
        {
            "chars_per_chunk": 50000,
            "overlap_chars": 500,
            "max_workers": 4,
        },
    )


def needs_chunking(file_path: str) -> bool:
    size_bytes = os.path.getsize(file_path)
    threshold = FILE_SIZE_THRESHOLD_MB * 1024 * 1024
    return size_bytes > threshold


def validate_file_size(file_path: str) -> bool:
    size_bytes = os.path.getsize(file_path)
    return size_bytes <= MAX_FILE_SIZE_BYTES


def get_file_size_mb(file_path: str) -> float:
    return os.path.getsize(file_path) / (1024 * 1024)
