/** Deferred-job polling, driven end to end through Job.wait(). */

import { describe, expect, it } from "vitest";

import { Nexara } from "../src/index.js";
import { JobFailedError } from "../src/errors.js";
import { FetchTransport } from "../src/http.js";
import type { Transcription } from "../src/index.js";

const BASE = "https://api.nexara.ru/v1";
const CREATED = "2026-07-20T00:00:00Z";

type Handler = (url: string, init: RequestInit) => Response;

function client(handler: Handler): Nexara {
  const transport = new FetchTransport({
    apiKey: "k",
    baseUrl: BASE,
    fetchImpl: (input, init) => Promise.resolve(handler(String(input), init ?? {})),
    sleepImpl: () => Promise.resolve(),
  });
  return new Nexara({ apiKey: "k", transport });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("job wait", () => {
  it("createJob -> in_progress twice -> complete", async () => {
    let polls = 0;
    const handler: Handler = (url, init) => {
      if (url.endsWith("/async") && init.method === "POST") {
        return json({ job_id: "j1", status: "in_progress", created_at: CREATED });
      }
      polls += 1;
      if (polls < 2) {
        return json({ job_id: "j1", status: "in_progress", created_at: CREATED, result: null });
      }
      return json({ job_id: "j1", status: "complete", created_at: CREATED, result: { text: "done" } });
    };

    const nx = client(handler);
    const job = await nx.transcriptions.createJob({ file: new Uint8Array([1]) });
    expect(job.status).toBe("in_progress");

    const result = (await job.wait({ pollIntervalMs: 1 })) as Transcription;
    expect(result.text).toBe("done");
  });

  it("throws JobFailedError on status=error", async () => {
    const handler: Handler = (url, init) => {
      if (url.endsWith("/async") && init.method === "POST") {
        return json({ job_id: "j2", status: "in_progress", created_at: CREATED });
      }
      return json({
        job_id: "j2",
        status: "error",
        created_at: CREATED,
        result: null,
        error: "pipeline failed",
      });
    };

    const nx = client(handler);
    const job = await nx.transcriptions.createJob({ file: new Uint8Array([1]) });
    await expect(job.wait({ pollIntervalMs: 1 })).rejects.toBeInstanceOf(JobFailedError);
  });
});
