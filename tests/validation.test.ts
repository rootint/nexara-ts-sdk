/**
 * Client-side validation — every call here is accepted by the raw API, billed,
 * and quietly does something other than what was asked. Failing here is free.
 *
 * These mirror examples/06_guardrails and the validation table in
 * docs/design.md. They run entirely on the mock (no network, no key gymnastics).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Nexara, NexaraValidationError } from "../src/index.js";

const AUDIO = "https://example.com/audio.mp3";

let client: Nexara;

beforeEach(() => {
  process.env["NEXARA_USE_MOCK"] = "1";
  client = new Nexara({ apiKey: "mock-key" });
});

describe("validation guardrails", () => {
  it("json_schema without prompt", async () => {
    await expect(
      // @ts-expect-error json_schema is not accepted without prompt in the types
      client.transcriptions.create({ url: AUDIO, json_schema: { type: "object" } }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("prompt + response_format='srt'", async () => {
    await expect(
      // @ts-expect-error prompt forces verbose_json; srt is not allowed
      client.transcriptions.create({ url: AUDIO, prompt: "Summarise.", response_format: "srt" }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("num_speakers without diarize", async () => {
    await expect(
      // @ts-expect-error num_speakers requires task='diarize'
      client.transcriptions.create({ url: AUDIO, num_speakers: 2 }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("two granularities", async () => {
    await expect(
      client.transcriptions.create({
        url: AUDIO,
        response_format: "verbose_json",
        timestamp_granularities: ["word", "segment"],
      }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("sentence granularity + diarize", async () => {
    await expect(
      client.transcriptions.create({
        url: AUDIO,
        task: "diarize",
        timestamp_granularities: ["sentence"],
      }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("file and url together", async () => {
    await expect(
      client.transcriptions.create({ url: AUDIO, file: new Uint8Array([1]) }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("neither file nor url", async () => {
    await expect(client.transcriptions.create({})).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("invalid json_schema", async () => {
    await expect(
      client.transcriptions.create({
        url: AUDIO,
        prompt: "Summarise.",
        json_schema: { type: "nonsense" },
      }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("roles requires diarize", async () => {
    await expect(
      // @ts-expect-error roles requires task='diarize'
      client.transcriptions.create({ url: AUDIO, roles: "auto" }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("too many roles", async () => {
    const roles = Array.from({ length: 11 }, (_, i) => `role_${i}`);
    await expect(
      client.transcriptions.create({ url: AUDIO, task: "diarize", roles }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });

  it("bad language code", async () => {
    await expect(
      client.transcriptions.create({ url: AUDIO, language: "english" }),
    ).rejects.toBeInstanceOf(NexaraValidationError);
  });
});

describe("validation lets good calls through", () => {
  it("returns text for a plain transcribe", async () => {
    const result = await client.transcriptions.create({ url: AUDIO });
    expect(result.text).toBe("Привет, это тестовая запись.");
  });
});
