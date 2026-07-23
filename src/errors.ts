/**
 * Exception hierarchy.
 *
 * Mapped from the HTTP status alone. The API has no machine-readable error
 * code — only a status and a human `detail` string whose *language depends on
 * the account* (RU accounts get Russian, ROW gets English). So `detail` is
 * carried verbatim into the message and never parsed.
 */

/** Base for everything this SDK throws. */
export class NexaraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Thrown before the request is sent.
 *
 * The server would either reject this with a 400 or — worse — accept it,
 * charge for it, and silently do something other than what was asked.
 */
export class NexaraValidationError extends NexaraError {}

/** The server returned an error status. */
export class APIError extends NexaraError {
  readonly status_code: number;
  readonly detail: string;

  constructor(status_code: number, detail: string) {
    super(`[${status_code}] ${detail}`);
    this.status_code = status_code;
    this.detail = detail;
  }
}

/** 400. */
export class BadRequestError extends APIError {}

/** 402 — estimated cost exceeds balance plus overdraft. */
export class InsufficientBalanceError extends APIError {}

/**
 * 403 — missing or unknown API key.
 *
 * The API answers 403 here, not 401, for both "no Authorization header" and
 * "key not found".
 */
export class AuthenticationError extends APIError {}

/** 404. */
export class NotFoundError extends APIError {}

/**
 * 413 — the synchronous LLM enrichment step ran out of time.
 *
 * Only the sync `create()` path with a `prompt` throws this, and only on long
 * audio. Despite the HTTP status, it is *not* about payload size: the
 * transcription itself succeeded, but the LLM post-processing could not finish
 * within the synchronous time budget.
 *
 * Do not retry synchronously — it will time out again. Resubmit the identical
 * request through `createJob()`, where the LLM step gets a far larger timeout.
 */
export class SyncLLMTimeoutError extends APIError {}

/** 429 — 10 req/sec per endpoint, or more than 200 in-progress jobs per key. */
export class RateLimitError extends APIError {}

/**
 * 500.
 *
 * The sync handler wraps everything in a catch-all and returns a bare 500 with
 * no detail, so a transient GPU-provider blip and a permanent failure are
 * indistinguishable from the response body.
 */
export class InternalServerError extends APIError {}

/**
 * 502 — the LLM provider genuinely failed (empty or invalid output).
 *
 * Distinct from `SyncLLMTimeoutError` (413), which is a timeout you recover from
 * by switching to async mode: here the enrichment provider returned nothing
 * usable. Treat it as an ordinary server error and retry later.
 */
export class BadGatewayError extends APIError {}

/** The request never reached the server. */
export class APIConnectionError extends NexaraError {}

/** The request timed out. */
export class APITimeoutError extends APIConnectionError {}

/** An async job finished with status="error". */
export class JobFailedError extends NexaraError {
  readonly job_id: string;
  readonly error: string;

  constructor(job_id: string, error: string) {
    super(`job ${job_id} failed: ${error}`);
    this.job_id = job_id;
    this.error = error;
  }
}

/**
 * `job.wait()` gave up.
 *
 * The job is not cancelled — there is no cancel endpoint. It may still finish;
 * retrieveJob() will find it until the 12-hour cleanup removes it.
 */
export class JobTimeoutError extends NexaraError {
  readonly job_id: string;
  readonly timeoutMs: number;

  constructor(job_id: string, timeoutMs: number) {
    super(
      `job ${job_id} still in_progress after ${timeoutMs}ms. ` +
        `It was not cancelled; retrieveJob("${job_id}") can pick it up later.`,
    );
    this.job_id = job_id;
    this.timeoutMs = timeoutMs;
  }
}

const STATUS_MAP: Record<number, new (status: number, detail: string) => APIError> = {
  400: BadRequestError,
  402: InsufficientBalanceError,
  403: AuthenticationError,
  404: NotFoundError,
  413: SyncLLMTimeoutError,
  429: RateLimitError,
  500: InternalServerError,
  502: BadGatewayError,
};

export function errorForStatus(statusCode: number, detail: string): APIError {
  const cls = STATUS_MAP[statusCode] ?? APIError;
  return new cls(statusCode, detail);
}
