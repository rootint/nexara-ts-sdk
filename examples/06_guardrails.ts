/**
 * What the SDK refuses to send, and why.
 *
 * Every call below is accepted by the raw API. Every one is also billed, and
 * every one quietly does something other than what was asked. Failing here
 * costs nothing.
 *
 * Two layers catch these, and it is worth knowing which is which:
 *
 *   - The TYPE CHECKER rejects some of them before the code ever runs — no
 *     overload accepts json_schema without prompt, or num_speakers without
 *     task="diarize". Those lines carry a `@ts-expect-error` here precisely
 *     *because* the compiler is doing its job; without it this file would not
 *     type-check.
 *   - RUNTIME validation catches all of them, for callers who compile away the
 *     types or call from plain JavaScript — which is most callers.
 */

import { Nexara, NexaraValidationError } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });
const AUDIO = "https://example.com/audio.mp3";

async function show(label: string, call: () => Promise<unknown>): Promise<void> {
  try {
    await call();
    console.log(`${label}: no error (unexpected)\n`);
  } catch (exc) {
    if (exc instanceof NexaraValidationError) {
      console.log(`${label}:\n  ${exc.message}\n`);
    } else {
      throw exc;
    }
  }
}

// --- caught by the type checker AND at runtime ---------------------------

await show("json_schema without prompt", () =>
  // @ts-expect-error json_schema is not accepted without prompt
  client.transcriptions.create({ url: AUDIO, json_schema: { type: "object" } }),
);

await show("prompt + response_format='srt'", () =>
  // @ts-expect-error prompt forces verbose_json
  client.transcriptions.create({ url: AUDIO, prompt: "Summarise.", response_format: "srt" }),
);

await show("num_speakers without diarize", () =>
  // @ts-expect-error num_speakers requires task='diarize'
  client.transcriptions.create({ url: AUDIO, num_speakers: 2 }),
);

// --- caught at runtime only ----------------------------------------------
// The type system cannot express "a list of exactly one" or "these two fields
// are mutually exclusive", so these need the validator.

await show("two granularities", () =>
  client.transcriptions.create({
    url: AUDIO,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  }),
);

await show("sentence granularity + diarize", () =>
  client.transcriptions.create({
    url: AUDIO,
    task: "diarize",
    timestamp_granularities: ["sentence"],
  }),
);

await show("file and url together", () =>
  client.transcriptions.create({ url: AUDIO, file: new Uint8Array([1]) }),
);

await show("invalid json_schema", () =>
  client.transcriptions.create({ url: AUDIO, prompt: "Summarise.", json_schema: { type: "nonsense" } }),
);
