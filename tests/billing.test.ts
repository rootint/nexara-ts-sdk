/**
 * The billing resource: balance, usage paging, and what goes on the wire.
 *
 * Shape assertions run against the in-memory mock; the wire shape (query
 * string, method, auth) is pinned with a stubbed fetch so a regression in the
 * transport's query handling cannot hide behind the mock.
 */

import { describe, expect, it, vi } from "vitest";

import { MockTransport } from "../src/mock/transport.js";
import { Nexara, NexaraValidationError, NotFoundError } from "../src/index.js";
import type { UsageItem } from "../src/index.js";

const BASE = "https://api.nexara.ru/v1";

function mockClient(): Nexara {
  return new Nexara({ apiKey: "k", transport: new MockTransport() });
}

/** A client whose transport is the real one, talking to a stubbed fetch. */
function fetchClient(handler: (url: string, init: RequestInit) => Response): {
  client: Nexara;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl as unknown as typeof fetch);
  return { client: new Nexara({ apiKey: "secret-key" }), calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const EMPTY_PAGE = { items: [], next_cursor: null, has_more: false, currency: "RUB" };

// -- balance ----------------------------------------------------------------

describe("balance", () => {
  it("parses the payload", async () => {
    const balance = await mockClient().billing.balance();
    expect(balance.balance).toBe(1240.5);
    expect(balance.rate_per_min).toBe(0.36);
    expect(balance.currency).toBe("RUB");
  });

  it("maps 404 to NotFoundError", async () => {
    const { client } = fetchClient(() => json({ detail: "API key not found." }, 404));
    await expect(client.billing.balance()).rejects.toThrow(NotFoundError);
    vi.restoreAllMocks();
  });

  it("sends no query string", async () => {
    const { client, calls } = fetchClient(() =>
      json({ balance: 1, rate_per_min: 0.36, currency: "RUB" }),
    );
    await client.billing.balance();
    expect(calls[0]!.url).toBe(`${BASE}/billing/balance`);
    expect(calls[0]!.init.method).toBe("GET");
    vi.restoreAllMocks();
  });
});

// -- usage ------------------------------------------------------------------

describe("usage", () => {
  it("returns a page, newest first", async () => {
    const page = await mockClient().billing.usage({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).not.toBeNull();
    expect(page.currency).toBe("RUB");

    const first = page.items[0]!;
    expect(first.task).toBe("diarize");
    expect(first.role_tagging).toBe(true);
    expect(first.api_key.name).toBe("production");
    expect(new Date(first.timestamp).getUTCFullYear()).toBe(2026);
  });

  it("pages backwards without overlap", async () => {
    const client = mockClient();
    const first = await client.billing.usage({ limit: 2 });
    const second = await client.billing.usage({ cursor: first.next_cursor, limit: 2 });

    expect(Date.parse(second.items[0]!.timestamp)).toBeLessThan(
      Date.parse(first.items[first.items.length - 1]!.timestamp),
    );
    const ids = [...first.items, ...second.items].map((i) => i.request_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("last page carries no cursor", async () => {
    const page = await mockClient().billing.usage({ limit: 100 });
    expect(page.has_more).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  it("keeps deleted keys and null costs", async () => {
    const items: UsageItem[] = [];
    for await (const item of mockClient().billing.iterUsage({ limit: 2 })) items.push(item);

    const deleted = items.filter((i) => i.api_key.deleted);
    expect(deleted[0]!.api_key.name).toBe("Key #9");

    // cost is null — "not recorded", not zero. Coercing it to 0 would silently
    // under-report a bill.
    const uncosted = items.filter((i) => i.cost === null);
    expect(uncosted).not.toHaveLength(0);
    expect(uncosted[0]!.request_id).toBeNull();
  });
});

describe("iterUsage", () => {
  it("walks every page", async () => {
    const client = mockClient();
    const onePage = await client.billing.usage({ limit: 100 });

    const paged: UsageItem[] = [];
    for await (const item of client.billing.iterUsage({ limit: 2 })) paged.push(item);

    expect(paged.map((i) => i.request_id)).toEqual(onePage.items.map((i) => i.request_id));
  });

  it("stops at maxItems", async () => {
    const items: UsageItem[] = [];
    for await (const item of mockClient().billing.iterUsage({ limit: 2, maxItems: 3 })) {
      items.push(item);
    }
    expect(items).toHaveLength(3);
  });
});

// -- client-side bounds -----------------------------------------------------

describe("bounds", () => {
  it.each([0, -1, 101, 1.5])("rejects limit=%s", async (limit) => {
    await expect(mockClient().billing.usage({ limit })).rejects.toThrow(NexaraValidationError);
  });

  it("rejects cursor below 1", async () => {
    await expect(mockClient().billing.usage({ cursor: 0 })).rejects.toThrow(
      NexaraValidationError,
    );
  });

  it("checks bounds before sending", async () => {
    // The server's own answer is a 422 that maps to a bare APIError, which says
    // much less than the validation error.
    const { client, calls } = fetchClient(() => json(EMPTY_PAGE));
    await expect(client.billing.usage({ limit: 500 })).rejects.toThrow(NexaraValidationError);
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

// -- wire shape -------------------------------------------------------------

describe("wire shape", () => {
  it("sends limit and cursor as query params", async () => {
    const { client, calls } = fetchClient(() => json({ ...EMPTY_PAGE, currency: "EUR" }));
    const page = await client.billing.usage({ cursor: 207, limit: 25 });

    expect(calls[0]!.url).toBe(`${BASE}/billing/usage?limit=25&cursor=207`);
    expect(calls[0]!.init.method).toBe("GET");
    expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer secret-key",
    );
    expect(page.currency).toBe("EUR");
    vi.restoreAllMocks();
  });

  it("omits cursor when not given", async () => {
    const { client, calls } = fetchClient(() => json(EMPTY_PAGE));
    await client.billing.usage();
    expect(calls[0]!.url).toBe(`${BASE}/billing/usage?limit=50`);
    vi.restoreAllMocks();
  });
});

// -- the mock's own bounds --------------------------------------------------

describe("mock transport", () => {
  it("rejects bad bounds like the server", async () => {
    // Bypassing the resource layer reaches the mock's 422 — the same answer the
    // real server gives, so the mock stays honest about what it is imitating.
    const response = await new MockTransport().request("GET", "/billing/usage", {
      query: { limit: 0 },
    });
    expect(response.status_code).toBe(422);
  });
});
