/** App-wide constants for file processing limits and polling configuration. */

export const MAX_FILE_SIZE_BYTES = 52_428_800;       // 50 MB
export const MAX_FILE_SIZE_LABEL = "50MB";
export const LARGE_FILE_THRESHOLD_BYTES = 5_242_880; // 5 MB
export const PYTHON_REQUEST_TIMEOUT_MS = 600_000;    // 10 minutes
export const POLL_INTERVAL_MS = 3_000;               // 3 seconds
export const MAX_POLL_ATTEMPTS = 200;                // 10 min total at 3 s intervals
