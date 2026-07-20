/** Client construction: transport selection and env handling. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Nexara } from "../src/index.js";

const ENV_KEYS = ["NEXARA_API_KEY", "NEXARA_BASE_URL", "NEXARA_USE_MOCK"] as const;

describe("client construction", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it("default transport is the real one (hits the public URL)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ text: "x" }), {
          headers: { "content-type": "application/json" },
        }),
      );

    const nx = new Nexara({ apiKey: "k" });
    await nx.transcriptions.create({ url: "https://example.com/a.mp3" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://api.nexara.ru/v1/audio/transcriptions",
    );
  });

  it("NEXARA_USE_MOCK selects the in-memory mock (no network)", async () => {
    process.env["NEXARA_USE_MOCK"] = "1";
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const nx = new Nexara({ apiKey: "k" });
    const result = await nx.transcriptions.create({ url: "https://example.com/a.mp3" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.text).toBe("Привет, это тестовая запись.");
  });

  it("baseUrl precedence: arg over env over default", () => {
    process.env["NEXARA_BASE_URL"] = "http://localhost:8000/v1";
    expect(new Nexara({ apiKey: "k" }).baseUrl).toBe("http://localhost:8000/v1");
    expect(new Nexara({ apiKey: "k", baseUrl: "http://other/v1" }).baseUrl).toBe("http://other/v1");
  });

  it("missing key throws", () => {
    expect(() => new Nexara()).toThrow(/No API key/);
  });

  it("realtime is unavailable without the mock opt-in", () => {
    expect(() => new Nexara({ apiKey: "k" }).realtime.connect()).toThrow(/not available/);
  });

  it("realtime works against the mock when opted in", () => {
    process.env["NEXARA_USE_MOCK"] = "1";
    const session = new Nexara({ apiKey: "k" }).realtime.connect();
    expect(session).toBeDefined();
  });
});
