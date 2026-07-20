/**
 * Offline tests for the real transport, driven by an injected fetch.
 *
 * No socket is opened: the fake fetch intercepts every request and lets us
 * assert on exactly what the SDK put on the wire, and control what comes back.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { Nexara } from "../src/index.js";
import { APIConnectionError, APITimeoutError, InternalServerError } from "../src/errors.js";
import { FetchTransport } from "../src/http.js";
import type { HttpxTransportOptions } from "../src/http.js";

const BASE = "https://api.nexara.ru/v1";

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

/** A FetchTransport wired to a handler, with instant retries. */
function transport(handler: Handler, opts: Partial<HttpxTransportOptions> = {}): FetchTransport {
  return new FetchTransport({
    apiKey: "secret-key",
    baseUrl: BASE,
    fetchImpl: (input, init) => Promise.resolve(handler(String(input), init ?? {})),
    sleepImpl: () => Promise.resolve(),
    ...opts,
  });
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

// -- request shaping ---------------------------------------------------------

describe("request shaping", () => {
  it("POST sends auth, url and multipart fields", async () => {
    const seen: Record<string, unknown> = {};

    const handler: Handler = (url, init) => {
      seen["auth"] = (init.headers as Record<string, string>)["Authorization"];
      seen["url"] = url;
      seen["method"] = init.method;
      seen["form"] = init.body;
      return new Response(JSON.stringify({ text: "привет" }), {
        headers: { "content-type": "application/json" },
      });
    };

    const resp = await transport(handler).request("POST", "/audio/transcriptions", {
      form: {
        task: "diarize",
        response_format: "json",
        "timestamp_granularities[]": ["segment"],
        profanity_filter: true,
        model: "whisper-1",
      },
      file: new Uint8Array([0x52, 0x49, 0x46, 0x46]), // "RIFF"
    });

    expect(resp.status_code).toBe(200);
    expect(resp.body).toEqual({ text: "привет" });
    expect(seen["auth"]).toBe("Bearer secret-key");
    // Full /v1 prefix preserved, not dropped by path joining.
    expect(seen["url"]).toBe(`${BASE}/audio/transcriptions`);
    expect(seen["method"]).toBe("POST");

    const form = seen["form"] as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("task")).toBe("diarize");
    // bool serialized lowercase, not JS "true" via some other path.
    expect(form.get("profanity_filter")).toBe("true");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["segment"]);
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect(await (file as Blob).text()).toBe("RIFF");
    expect((file as File).name).toBe("audio");
  });

  it("url mode sends no file part", async () => {
    const seen: Record<string, unknown> = {};
    const handler: Handler = (_url, init) => {
      seen["form"] = init.body;
      return new Response(JSON.stringify({ text: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    };

    await transport(handler).request("POST", "/audio/transcriptions", {
      form: { task: "transcribe", url: "https://example.com/a.mp3" },
      file: null,
    });

    const form = seen["form"] as FormData;
    expect(form.has("file")).toBe(false);
    expect(form.get("url")).toBe("https://example.com/a.mp3");
  });

  it("roles JSON reaches the wire", async () => {
    const seen: Record<string, unknown> = {};
    const handler: Handler = (_url, init) => {
      seen["form"] = init.body;
      return new Response(
        JSON.stringify({ task: "diarize", language: "ru", duration: 1.0, text: "x", segments: [] }),
        { headers: { "content-type": "application/json" } },
      );
    };

    // The resource layer JSON-encodes array roles; here we hand the wire value in.
    await transport(handler).request("POST", "/audio/transcriptions", {
      form: { task: "diarize", roles: '["operator", "client"]' },
      file: new Uint8Array([0x61]),
    });

    const form = seen["form"] as FormData;
    expect(form.get("roles")).toBe('["operator", "client"]');
  });

  it("path upload streams and reopens on retry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexara-"));
    const path = join(dir, "clip.mp3");
    await writeFile(path, "ID3longrecording");
    const bodies: string[] = [];

    const handler: Handler = async (_url, init) => {
      const file = (init.body as FormData).get("file") as Blob;
      bodies.push(await file.text());
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ detail: "slow down" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ text: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    };

    const resp = await transport(handler, { maxRetries: 1 }).request("POST", "/x", { file: path });
    expect(resp.status_code).toBe(200);
    expect(bodies.length).toBe(2);
    for (const body of bodies) {
      expect(body).toBe("ID3longrecording"); // both attempts carry the full file
    }
  });

  it("bytes upload is resent whole on retry", async () => {
    const bodies: string[] = [];
    const handler: Handler = async (_url, init) => {
      const file = (init.body as FormData).get("file") as Blob;
      bodies.push(await file.text());
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ detail: "slow down" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ text: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    };

    const resp = await transport(handler, { maxRetries: 1 }).request("POST", "/x", {
      file: new Uint8Array([0x52, 0x49, 0x46, 0x46]), // "RIFF"
    });
    expect(resp.status_code).toBe(200);
    expect(bodies).toEqual(["RIFF", "RIFF"]);
  });
});

// -- response parsing --------------------------------------------------------

describe("response parsing", () => {
  it("parses JSON, leaves text as a string", async () => {
    const jsonBody = await transport(
      () =>
        new Response(JSON.stringify({ text: "hi" }), {
          headers: { "content-type": "application/json" },
        }),
    ).request("POST", "/x", { file: new Uint8Array([1]) });
    expect(jsonBody.body).toEqual({ text: "hi" });

    const textBody = await transport(
      () =>
        new Response("1\n00:00:00,000 --> 00:00:01,000\nhi\n", {
          headers: { "content-type": "application/x-subrip" },
        }),
    ).request("POST", "/x", { file: new Uint8Array([1]) });
    expect(typeof textBody.body).toBe("string");
    expect(textBody.body as string).toMatch(/^1\n/);
  });
});

// -- retry policy ------------------------------------------------------------

describe("retry policy", () => {
  it("retries 429 then succeeds", async () => {
    let n = 0;
    const handler: Handler = () => {
      n += 1;
      if (n === 1) {
        return new Response(JSON.stringify({ detail: "slow down" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ text: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    };

    const resp = await transport(handler, { maxRetries: 2 }).request("POST", "/x", {
      file: new Uint8Array([1]),
    });
    expect(resp.status_code).toBe(200);
    expect(n).toBe(2);
  });

  it("does not retry 500", async () => {
    let n = 0;
    const handler: Handler = () => {
      n += 1;
      return new Response("boom", { status: 500 });
    };

    const resp = await transport(handler, { maxRetries: 3 }).request("POST", "/x", {
      file: new Uint8Array([1]),
    });
    expect(resp.status_code).toBe(500);
    expect(n).toBe(1); // billed-before-500 hazard: never retried
  });

  it("retries connection errors then throws", async () => {
    let n = 0;
    const handler: Handler = () => {
      n += 1;
      throw new TypeError("fetch failed");
    };

    await expect(
      transport(handler, { maxRetries: 2 }).request("POST", "/x", { file: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(APIConnectionError);
    expect(n).toBe(3); // initial + 2 retries
  });

  it("maps timeout to APITimeoutError", async () => {
    const handler: Handler = () => {
      throw abortError();
    };

    await expect(
      transport(handler, { maxRetries: 1 }).request("POST", "/x", { file: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(APITimeoutError);
  });
});

// -- job polling path --------------------------------------------------------

describe("job path", () => {
  it("GET builds the job path", async () => {
    const seen: Record<string, string> = {};
    const handler: Handler = (url, init) => {
      seen["method"] = init.method ?? "";
      seen["url"] = url;
      return new Response(
        JSON.stringify({ job_id: "abc", status: "complete", created_at: "2026-07-18T00:00:00Z" }),
        { headers: { "content-type": "application/json" } },
      );
    };

    await transport(handler).request("GET", "/audio/transcriptions/async/abc");
    expect(seen["method"]).toBe("GET");
    expect(seen["url"]).toBe(`${BASE}/audio/transcriptions/async/abc`);
  });
});

// -- end to end through the client -------------------------------------------

describe("end to end", () => {
  it("client.create round-trips", async () => {
    const handler: Handler = () =>
      new Response(JSON.stringify({ text: "распознанный текст" }), {
        headers: { "content-type": "application/json" },
      });

    const nx = new Nexara({ apiKey: "k", transport: transport(handler) });
    const result = await nx.transcriptions.create({ file: new Uint8Array([1]) });
    expect(result.text).toBe("распознанный текст");
  });

  it("500 surfaces as InternalServerError", async () => {
    const handler: Handler = () => new Response("boom", { status: 500 });
    const nx = new Nexara({ apiKey: "k", transport: transport(handler) });
    await expect(nx.transcriptions.create({ file: new Uint8Array([1]) })).rejects.toBeInstanceOf(
      InternalServerError,
    );
  });
});
