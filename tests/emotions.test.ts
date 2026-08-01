/**
 * The `emotions` parameter: its guardrails, its wire form, and its result shape.
 *
 * Emotion recognition is billed per second, so every rule here exists to stop a
 * request being charged for output it could never receive. The server 400s each
 * of these combinations; failing client-side just makes it free.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Nexara, NexaraValidationError } from "../src/index.js";
import type { CreateParams } from "../src/index.js";
import { validateAndBuildForm } from "../src/validation.js";

const AUDIO = "https://example.com/call.mp3";

let client: Nexara;

beforeEach(() => {
  process.env["NEXARA_USE_MOCK"] = "1";
  client = new Nexara({ apiKey: "mock-key" });
});

function diarizeForm(overrides: Partial<CreateParams> = {}): Record<string, unknown> {
  return validateAndBuildForm({
    url: AUDIO,
    task: "diarize",
    model: "nexara-ru",
    emotions: true,
    ...overrides,
  });
}

describe("emotions guardrails", () => {
  it("requires diarize", () => {
    expect(() => diarizeForm({ task: "transcribe" })).toThrow(NexaraValidationError);
  });

  it("requires nexara-ru", () => {
    for (const model of ["whisper-1", "nexara-1"]) {
      expect(() => diarizeForm({ model })).toThrow(NexaraValidationError);
    }
  });

  it("rejects the default model", () => {
    // The SDK default is whisper-1, so `emotions: true` alone must not sail
    // through and be rejected only after the audio was uploaded.
    expect(() => validateAndBuildForm({ url: AUDIO, task: "diarize", emotions: true })).toThrow(
      NexaraValidationError,
    );
  });

  it("rejects subtitle formats", () => {
    // The emotion object hangs off a segment; text/srt/vtt have nowhere to put it.
    for (const response_format of ["text", "srt", "vtt"] as const) {
      expect(() => diarizeForm({ response_format })).toThrow(NexaraValidationError);
    }
  });

  it("allows both JSON formats", () => {
    for (const response_format of ["json", "verbose_json"] as const) {
      expect(diarizeForm({ response_format })["emotions"]).toBe(true);
    }
  });

  it("never conflicts when false", () => {
    // A caller who did not ask for emotion must not be rejected for using
    // whisper-1, transcribe, or srt.
    const form = validateAndBuildForm({
      url: AUDIO,
      task: "transcribe",
      emotions: false,
      response_format: "srt",
    });
    expect(form["emotions"]).toBeUndefined();
  });

  it("survives a prompt", () => {
    // A prompt rewrites response_format to verbose_json, which is allowed. The
    // check has to run *after* that rewrite — as it does on the server.
    const form = diarizeForm({ response_format: "verbose_json", prompt: "Summarise." });
    expect(form["response_format"]).toBe("verbose_json");
    expect(form["emotions"]).toBe(true);
  });
});

describe("emotions on the wire", () => {
  it("is omitted when not requested", () => {
    // The server defaults the field to false; sending it says nothing extra.
    expect(validateAndBuildForm({ url: AUDIO, task: "diarize" })["emotions"]).toBeUndefined();
  });

  it("is sent as a boolean the transport can serialize", () => {
    expect(diarizeForm()["emotions"]).toBe(true);
  });
});

describe("emotions in the result", () => {
  it("lands on scored segments", async () => {
    const result = await client.transcriptions.create({
      url: AUDIO,
      task: "diarize",
      model: "nexara-ru",
      emotions: true,
    });
    const emotion = result.segments[0]!.emotion!;
    expect(emotion.label).toBe("neutral");
    expect(emotion.confidence).toBe(0.87);
    expect(Object.keys(emotion.probs!).sort()).toEqual(["angry", "neutral", "positive", "sad"]);
  });

  it("is absent on a segment the model could not score", async () => {
    // A scored response can still contain unscored segments — the key is missing
    // there, not a zero-confidence emotion.
    const result = await client.transcriptions.create({
      url: AUDIO,
      task: "diarize",
      model: "nexara-ru",
      emotions: true,
    });
    expect(result.segments[1]!.emotion).toBeUndefined();
  });

  it("is absent entirely without the flag", async () => {
    const result = await client.transcriptions.create({ url: AUDIO, task: "diarize" });
    expect(result.segments.every((s) => s.emotion === undefined)).toBe(true);
  });

  it("never lands on words", async () => {
    const result = await client.transcriptions.create({
      url: AUDIO,
      task: "diarize",
      model: "nexara-ru",
      emotions: true,
      timestamp_granularities: ["word"],
    });
    expect(result.words!.every((w) => !("emotion" in w))).toBe(true);
  });

  it("survives a deferred job", async () => {
    const job = await client.transcriptions.createJob({
      url: AUDIO,
      task: "diarize",
      model: "nexara-ru",
      emotions: true,
    });
    const result = (await job.wait({ pollIntervalMs: 1 })) as { segments: Array<{ emotion?: { label: string } }> };
    expect(result.segments[0]!.emotion!.label).toBe("neutral");
  });
});

describe("emotions in billing", () => {
  it("is reported per usage row", async () => {
    const page = await client.billing.usage({ limit: 100 });
    const scored = page.items.filter((item) => item.emotions);
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0]!.model).toBe("nexara-ru");
    expect(scored[0]!.task).toBe("diarize");
  });
});
