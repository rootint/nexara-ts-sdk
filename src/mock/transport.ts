/**
 * In-memory transport. No sockets, no network.
 *
 * Its job is to be wrong in exactly the ways the real server is wrong, so that
 * the interface above it is validated against reality rather than against a
 * tidier API we wish existed.
 */

import type { RequestOptions, Transport, TransportResponse } from "../transport.js";
import * as fixtures from "./fixtures.js";

const JOB_PATH = /^\/audio\/transcriptions\/async\/(?<jobId>[^/]+)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How many polls a mock job stays in_progress. Non-zero on purpose: a job that
// is complete on the first poll would let a broken wait() loop pass.
const POLLS_BEFORE_COMPLETE = 2;

interface JobState {
  form: Record<string, unknown>;
  polls: number;
  createdAt: string;
}

export interface MockTransportOptions {
  pollsBeforeComplete?: number;
  /**
   * Finish every job with status="error" instead of "complete". Without this
   * the JobFailedError path is unreachable and would never be exercised.
   */
  failJobs?: boolean;
}

export class MockTransport implements Transport {
  #jobs = new Map<string, JobState>();
  #pollsBeforeComplete: number;
  #failJobs: boolean;

  constructor(options: MockTransportOptions = {}) {
    this.#pollsBeforeComplete = options.pollsBeforeComplete ?? POLLS_BEFORE_COMPLETE;
    this.#failJobs = options.failJobs ?? false;
  }

  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<TransportResponse> {
    const form = options.form ?? {};

    if (method === "POST" && path === "/audio/transcriptions") {
      return { status_code: 200, body: this.#transcribe(form, true) };
    }

    if (method === "POST" && path === "/audio/transcriptions/async") {
      return this.#createJob(form);
    }

    const match = JOB_PATH.exec(path);
    if (method === "GET" && match) {
      return this.#pollJob(match.groups!["jobId"]!);
    }

    if (method === "GET" && path === "/billing/balance") {
      return { status_code: 200, body: fixtures.buildBalance() };
    }

    if (method === "GET" && path === "/billing/usage") {
      return this.#usage(options.query ?? {});
    }

    return { status_code: 404, body: { detail: `Not Found: ${method} ${path}` } };
  }

  // -- billing -----------------------------------------------------------

  /**
   * One page of billed calls, with the server's own 422 on bad bounds.
   *
   * The SDK checks these before sending, so this branch is only reachable by a
   * caller going through the transport directly — which is exactly the case
   * worth keeping honest.
   */
  #usage(query: Record<string, string | number | boolean>): TransportResponse {
    const limit = query["limit"] === undefined ? 50 : Number(query["limit"]);
    const cursor = query["cursor"] === undefined ? null : Number(query["cursor"]);

    if (!(limit >= 1 && limit <= 100) || (cursor !== null && cursor < 1)) {
      return { status_code: 422, body: { detail: "Input should be a valid page bound" } };
    }

    return { status_code: 200, body: fixtures.buildUsagePage(cursor, limit) };
  }

  // -- transcription ---------------------------------------------------

  #transcribe(form: Record<string, unknown>, sync: boolean): unknown {
    const task = (form["task"] as string) ?? "transcribe";
    const fmt = (form["response_format"] as string) ?? "json";
    const granularity = ((form["timestamp_granularities[]"] as string[]) ?? ["segment"])[0]!;

    let payload: fixtures.Json | undefined;
    if (task === "diarize") {
      payload = fixtures.buildDiarize(Boolean(form["emotions"]));
      if (sync) {
        // Only the sync handler strips. The Celery worker does not, so the same
        // request returns words via the async path. This one line is the whole
        // divergence.
        payload = fixtures.stripWordsIfNotRequested(payload, granularity);
      }
    } else {
      payload = fixtures.buildTranscribe(granularity);
    }

    if (form["prompt"]) {
      return fixtures.wrapLlm(payload, Boolean(form["json_schema"]));
    }

    return fixtures.formatResponse(payload, fmt, task);
  }

  // -- jobs -------------------------------------------------------------

  #createJob(form: Record<string, unknown>): TransportResponse {
    const jobId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.#jobs.set(jobId, { form, polls: 0, createdAt });
    return {
      status_code: 200,
      body: { job_id: jobId, status: "in_progress", created_at: createdAt },
    };
  }

  #pollJob(jobId: string): TransportResponse {
    if (!UUID_RE.test(jobId)) {
      return { status_code: 400, body: { detail: `Invalid job_id: ${jobId}` } };
    }

    const job = this.#jobs.get(jobId);
    if (job === undefined) {
      // Indistinguishable from "created more than 12 hours ago and swept by
      // cleanup_old_async_jobs". The server cannot tell these apart either,
      // which is exactly why NotFoundError documents both.
      return { status_code: 404, body: { detail: "Job not found" } };
    }

    job.polls += 1;
    if (job.polls <= this.#pollsBeforeComplete) {
      return {
        status_code: 200,
        body: {
          job_id: jobId,
          status: "in_progress",
          created_at: job.createdAt,
          result: null,
          error: null,
        },
      };
    }

    const completedAt = new Date(Date.parse(job.createdAt) + 44_000).toISOString();

    if (this.#failJobs) {
      // A failed job is not billed at all: the async path charges after the LLM
      // step, so a failure anywhere before that costs nothing.
      return {
        status_code: 200,
        body: {
          job_id: jobId,
          status: "error",
          created_at: job.createdAt,
          completed_at: completedAt,
          result: null,
          error: "pipeline failed: backend returned no audio stream",
        },
      };
    }

    return {
      status_code: 200,
      body: {
        job_id: jobId,
        status: "complete", // not "completed" — the API serves the enum
        created_at: job.createdAt,
        completed_at: completedAt,
        result: this.#transcribe(job.form, false),
        error: null,
      },
    };
  }
}
