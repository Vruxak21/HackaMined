/**
 * Simple in-memory async job queue.
 *
 * Jobs are processed sequentially so the Node.js event loop stays alive
 * until every enqueued job completes — preventing the serverless race
 * condition where a fire-and-forget promise is abandoned when the response
 * is flushed.
 *
 * Usage:
 *   enqueueJob(() => processFileInBackground(...));
 */

type Job = () => Promise<void>;

const queue: Job[] = [];
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    await job().catch(() => {
      // Individual job errors are handled inside the job itself;
      // swallow here so the queue never stops.
    });
  }
  draining = false;
}

export function enqueueJob(job: Job): void {
  queue.push(job);
  void drain();
}
