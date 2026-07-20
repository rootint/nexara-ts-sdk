/**
 * The real transport: fetch against api.nexara.ru.
 *
 * This is the other side of the seam described in `transport.ts`. It turns the
 * resource layer's `request(method, path, { form, file })` calls into actual
 * HTTP and hands back a TransportResponse in exactly the shape the mock
 * produced, so nothing above this file changes.
 *
 * Retry policy is deliberately narrow. We retry 429 (rate limit) and genuine
 * connection/timeout failures, but NOT 500: on the sync `create()` path the LLM
 * step is billed *before* a 500 can be raised, so a blind retry pays twice. See
 * docs/design.md.
 */

import { openAsBlob } from "node:fs";

import { APIConnectionError, APITimeoutError } from "./errors.js";
import type { FileInput, RequestOptions, Transport, TransportResponse } from "./transport.js";

// Statuses worth another attempt. 500 is intentionally absent (see module docs).
const RETRY_STATUSES: ReadonlySet<number> = new Set([429]);

const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

export interface HttpxTransportOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injection point for tests: a fetch-compatible function. */
  fetchImpl?: typeof fetch;
  /**
   * Injection point for tests: the backoff delay between retries. Defaults to
   * real setTimeout; tests pass an instant no-op so retries don't wait.
   */
  sleepImpl?: (ms: number) => Promise<void>;
}

export class FetchTransport implements Transport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(options: HttpxTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? sleep;
  }

  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<TransportResponse> {
    // Build the URL ourselves rather than lean on URL joining: an absolute-path
    // reference would drop the "/v1" prefix.
    const url = `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    const headers = { Authorization: `Bearer ${this.apiKey}` };

    let attempt = 0;
    // A caller-provided stream must be re-read from the start on a retry. Blobs
    // and Uint8Arrays are re-read for free; a path is reopened fresh in _send.
    for (;;) {
      let resp: Response;
      try {
        resp = await this.send(method, url, headers, options.form, options.file ?? null);
      } catch (exc) {
        if (isTimeout(exc)) {
          if (attempt < this.maxRetries) {
            attempt += 1;
            await this.sleepImpl(backoff(attempt));
            continue;
          }
          throw new APITimeoutError(`request to ${url} timed out`);
        }
        if (attempt < this.maxRetries) {
          attempt += 1;
          await this.sleepImpl(backoff(attempt));
          continue;
        }
        throw new APIConnectionError(`could not reach ${url}: ${String(exc)}`);
      }

      if (RETRY_STATUSES.has(resp.status) && attempt < this.maxRetries) {
        attempt += 1;
        await this.sleepImpl(retryAfter(resp) ?? backoff(attempt));
        continue;
      }

      return { status_code: resp.status, body: await body(resp) };
    }
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string>,
    form: Record<string, unknown> | undefined,
    file: FileInput | null,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      if (method === "GET") {
        return await this.fetchImpl(url, { method, headers, signal: controller.signal });
      }

      const data = new FormData();
      wireForm(form ?? {}, data);
      if (file !== null) {
        // The filename is a constant "audio": the server detects the container
        // from the bytes, not the name.
        data.append("file", await toBlob(file), "audio");
      }
      return await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: data,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Turn a `file` argument into a Blob. A path is opened with openAsBlob, which
 * streams the file from disk chunk by chunk, so an hours-long recording — the
 * whole point of createJob() — is never held in memory. Reopening per attempt
 * also makes retries restart from byte 0 with no seek bookkeeping.
 */
async function toBlob(file: FileInput): Promise<Blob> {
  if (typeof file === "string") {
    return openAsBlob(file);
  }
  if (file instanceof Blob) {
    return file;
  }
  // Uint8Array is a valid BlobPart at runtime; the DOM lib's generic buffer
  // types just don't line up. Copy into a fresh ArrayBuffer-backed view.
  return new Blob([new Uint8Array(file)] as BlobPart[]);
}

/**
 * Serialize native form values to what multipart expects.
 *
 * boolean -> "true"/"false", arrays append one field per element (which is how
 * `timestamp_granularities[]` is meant to arrive), everything else -> String.
 */
function wireForm(form: Record<string, unknown>, data: FormData): void {
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === "boolean") {
      data.append(key, value ? "true" : "false");
    } else if (Array.isArray(value)) {
      for (const v of value) data.append(key, String(v));
    } else {
      data.append(key, String(value));
    }
  }
}

/** Parsed JSON for json-ish responses, a plain string for text/srt/vtt. */
async function body(resp: Response): Promise<unknown> {
  if ((resp.headers.get("content-type") ?? "").includes("application/json")) {
    return resp.json();
  }
  return resp.text();
}

function retryAfter(resp: Response): number | null {
  const raw = resp.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function backoff(attempt: number): number {
  return Math.min(DEFAULT_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

function isTimeout(exc: unknown): boolean {
  return exc instanceof Error && exc.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
