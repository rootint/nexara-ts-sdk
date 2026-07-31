/** Client constructor. */

import { FetchTransport } from "./http.js";
import { MockTransport } from "./mock/transport.js";
import { Billing } from "./resources/billing.js";
import { Realtime } from "./resources/realtime.js";
import { Transcriptions } from "./resources/transcriptions.js";
import type { Transport } from "./transport.js";

/**
 * The server also serves /api/v1 as an alias. /v1 is shorter and matches the
 * shape OpenAI users expect. Override per-client with baseUrl or globally with
 * the NEXARA_BASE_URL env var — handy for pointing at a locally-run instance.
 */
export const DEFAULT_BASE_URL = "https://api.nexara.ru/v1";

export interface NexaraOptions {
  /** Defaults to the NEXARA_API_KEY environment variable. */
  apiKey?: string;
  /**
   * API root. Defaults to the NEXARA_BASE_URL env var, then to the public
   * endpoint. Point it at your local instance to test.
   */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Retries on 429 and on connection/timeout failures.
   *
   * 500 is deliberately NOT retried: on the sync path the LLM step is billed
   * before a 500 can be thrown, so a retry pays twice. Deferred jobs bill
   * after the LLM, so a failed job costs nothing and resubmitting is free.
   */
  maxRetries?: number;
  /**
   * Internal seam. Leave unset in normal use; the test suite injects a mock
   * here. Setting NEXARA_USE_MOCK=1 selects the in-memory mock transport
   * instead (used to run examples offline).
   */
  transport?: Transport;
}

function envVar(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    name
  ];
}

/**
 * Client for the Nexara speech-to-text API.
 *
 *     const client = new Nexara({ apiKey: "..." });
 *     const { text } = await client.transcriptions.create({ file: "audio.mp3" });
 *
 * The SDK is async throughout — there is no separate sync client (unlike the
 * Python SDK's Nexara/AsyncNexara split). Realtime is not yet available (see
 * resources/realtime.ts).
 */
export class Nexara {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly transcriptions: Transcriptions;
  readonly billing: Billing;
  readonly realtime: Realtime;

  constructor(options: NexaraOptions = {}) {
    const key = options.apiKey ?? envVar("NEXARA_API_KEY");
    if (!key) {
      throw new Error(
        "No API key. Pass apiKey or set the NEXARA_API_KEY environment variable.",
      );
    }

    this.apiKey = key;
    this.baseUrl = options.baseUrl ?? envVar("NEXARA_BASE_URL") ?? DEFAULT_BASE_URL;

    const transport =
      options.transport ??
      (envVar("NEXARA_USE_MOCK")
        ? // Test/demo only: the in-memory mock, so examples run without a
          // network or a real key. Never the default in production use.
          new MockTransport()
        : new FetchTransport({
            apiKey: key,
            baseUrl: this.baseUrl,
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
          }));

    this.transcriptions = new Transcriptions(transport);
    this.billing = new Billing(transport);
    this.realtime = new Realtime(this.apiKey);
  }
}
