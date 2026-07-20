/**
 * The deferred job model.
 *
 * TypeScript is async-only, so there is a single Job (not the sync/async pair
 * the Python SDK needs) whose methods return promises.
 */

import { JobFailedError, JobTimeoutError } from "../errors.js";
import { parseResult } from "../resources/transcriptions.js";
import type { Transcriptions } from "../resources/transcriptions.js";

/**
 * Three values, and it is "complete" — not "completed".
 *
 * The Celery task returns { status: "completed" } into its own result backend,
 * but the API serves the status from Postgres, where the enum value is
 * "complete".
 */
export type JobStatus = "in_progress" | "complete" | "error";

export const DEFAULT_WAIT_TIMEOUT_MS = 1_800_000;

/** Raw job fields as they arrive from the server. */
export interface JobFields {
  job_id: string;
  status: JobStatus;
  created_at: string;
  completed_at?: string | null;
  /**
   * Raw payload — what the sync endpoint would have returned for the same
   * flags, except that the async path does not strip `words`. Use `wait()` to
   * get it parsed. null while in_progress and on error.
   */
  result?: unknown;
  /** Set when status="error". */
  error?: string | null;
}

export interface WaitOptions {
  /**
   * Give up after this many milliseconds. Finite by default on purpose (see
   * `wait`); pass null to wait indefinitely.
   */
  timeoutMs?: number | null;
  pollIntervalMs?: number;
}

/**
 * A deferred job.
 *
 * Lifetime: the row is deleted 12 hours after *creation* (not completion).
 * After that a lookup returns 404 — indistinguishable from a job_id that never
 * existed. NotFoundError means one or the other, and the server does not say
 * which.
 *
 * There is no cancel endpoint, so there is no `cancel()`.
 */
export class Job {
  readonly job_id: string;
  status: JobStatus;
  readonly created_at: string;
  readonly completed_at: string | null;
  readonly result: unknown;
  readonly error: string | null;

  #resource: Transcriptions;

  constructor(fields: JobFields, resource: Transcriptions) {
    this.job_id = fields.job_id;
    this.status = fields.status;
    this.created_at = fields.created_at;
    this.completed_at = fields.completed_at ?? null;
    this.result = fields.result ?? null;
    this.error = fields.error ?? null;
    this.#resource = resource;
  }

  /** Re-fetch this job and return the fresh copy. */
  refresh(): Promise<Job> {
    return this.#resource.retrieveJob(this.job_id);
  }

  /**
   * Poll until the job finishes, then return the parsed result.
   *
   * The default timeout is finite on purpose. A job can stay `in_progress`
   * forever: the worker's finalization is wrapped in a try/except that only
   * logs, so if that write fails the work is done and billed but the status
   * never changes. Waiting forever would hang the caller until the 12-hour
   * cleanup turned the job into a 404. Pass `timeoutMs: null` to wait
   * indefinitely if that is genuinely what you want.
   *
   * Throws JobFailedError on status="error" — note that a failed job is not
   * billed at all, so submitting it again is free.
   */
  async wait(options: WaitOptions = {}): Promise<unknown> {
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_WAIT_TIMEOUT_MS : options.timeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;

    let job: Job = this;
    while (job.status === "in_progress") {
      if (deadline !== null && Date.now() >= deadline) {
        throw new JobTimeoutError(this.job_id, timeoutMs as number);
      }
      await sleep(pollIntervalMs);
      job = await job.refresh();
    }

    if (job.status === "error") {
      throw new JobFailedError(job.job_id, job.error ?? "unknown error");
    }

    return parseResult(job.result);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
