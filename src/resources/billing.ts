/**
 * The billing resource: balance and itemized usage.
 *
 * Both endpoints are authenticated with the same API key as transcription and
 * are scoped to the *account*, not the key: `usage()` returns calls made with
 * every key the account owns, including keys that have since been deleted.
 */

import { errorForStatus, NexaraValidationError } from "../errors.js";
import type { Transport } from "../transport.js";
import type { Balance, UsageItem, UsagePage } from "../types/billing.js";

export const DEFAULT_USAGE_LIMIT = 50;
/**
 * The server's own bounds (limit in [1, 100], cursor >= 1). Out-of-range values
 * come back as a 422 with a FastAPI validation body, which the error mapping
 * would surface as a bare APIError — so we check first and fail with a clear
 * message.
 */
export const MAX_USAGE_LIMIT = 100;

export interface UsageParams {
  /** Return rows older than this one. Omit to start at the newest. */
  cursor?: number | null;
  /** Page size, 1..100. Defaults to 50. */
  limit?: number;
}

export interface IterUsageParams {
  /** Page size used for the underlying requests. Defaults to 50. */
  limit?: number;
  /** Stop after this many items. History is unbounded — set it. */
  maxItems?: number;
}

function usageQuery(params: UsageParams): Record<string, number> {
  const limit = params.limit ?? DEFAULT_USAGE_LIMIT;
  if (!Number.isInteger(limit)) {
    throw new NexaraValidationError("limit must be an integer.");
  }
  if (limit < 1 || limit > MAX_USAGE_LIMIT) {
    throw new NexaraValidationError(
      `limit must be between 1 and ${MAX_USAGE_LIMIT}; got ${limit}.`,
    );
  }

  const query: Record<string, number> = { limit };

  const cursor = params.cursor;
  if (cursor !== undefined && cursor !== null) {
    if (!Number.isInteger(cursor)) {
      throw new NexaraValidationError("cursor must be an integer.");
    }
    if (cursor < 1) {
      throw new NexaraValidationError(`cursor must be >= 1; got ${cursor}.`);
    }
    query["cursor"] = cursor;
  }

  return query;
}

export class Billing {
  #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Current balance, per-minute rate and currency for this account.
   *
   * Throws NotFoundError (404) if the API key is unknown to the server.
   */
  async balance(): Promise<Balance> {
    const response = await this.#transport.request("GET", "/billing/balance");
    if (response.status_code >= 400) {
      throw errorForStatus(response.status_code, detail(response.body));
    }
    return response.body as Balance;
  }

  /**
   * One page of billed requests, newest first.
   *
   * Keyset-paginated rather than offset-paginated: pass the previous page's
   * `next_cursor` to get the next (older) page. New calls landing between
   * requests therefore cannot shift rows across the page boundary the way an
   * offset would — they simply appear above the first page.
   *
   *     let page = await client.billing.usage({ limit: 20 });
   *     while (page.has_more) {
   *       page = await client.billing.usage({ cursor: page.next_cursor, limit: 20 });
   *     }
   *
   * `iterUsage()` does that loop for you.
   */
  async usage(params: UsageParams = {}): Promise<UsagePage> {
    const query = usageQuery(params);
    const response = await this.#transport.request("GET", "/billing/usage", { query });
    if (response.status_code >= 400) {
      throw errorForStatus(response.status_code, detail(response.body));
    }
    return response.body as UsagePage;
  }

  /**
   * Iterate billed requests across pages, newest first.
   *
   * Fetches lazily, one page at a time. History is unbounded, so pass
   * `maxItems` unless you really do want to walk the whole account.
   *
   *     for await (const item of client.billing.iterUsage({ maxItems: 100 })) {
   *       console.log(item.request_id, item.cost);
   *     }
   */
  async *iterUsage(params: IterUsageParams = {}): AsyncGenerator<UsageItem, void, undefined> {
    const limit = params.limit ?? DEFAULT_USAGE_LIMIT;
    const maxItems = params.maxItems;
    let yielded = 0;
    let cursor: number | null = null;

    for (;;) {
      const page: UsagePage = await this.usage({ cursor, limit });
      for (const item of page.items) {
        yield item;
        yielded += 1;
        if (maxItems !== undefined && yielded >= maxItems) return;
      }
      // next_cursor is only set alongside has_more; both are checked so a
      // server that ever sends has_more without a cursor stops the loop instead
      // of re-requesting page one forever.
      if (!page.has_more || page.next_cursor === null) return;
      cursor = page.next_cursor;
    }
  }
}

function detail(body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    return String((body as Record<string, unknown>)["detail"]);
  }
  return String(body);
}
