# Nexara TypeScript SDK

TypeScript/JavaScript SDK for the [Nexara](https://nexara.ru) speech-to-text
API: transcription, speaker diarization, speaker role tagging, and structured
LLM post-processing. Full API documentation lives at
[docs.nexara.ru](https://docs.nexara.ru).

Requires Node.js 20+. Fully typed; ships its own `.d.ts`.

```bash
npm install nexara-sdk
```

## Quickstart

```ts
import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "..." }); // or set NEXARA_API_KEY

const { text } = await client.transcriptions.create({ file: "audio.mp3" });
```

Pass exactly one of `file` (a path, `Uint8Array`, or `Blob` — paths are
streamed from disk, not read into memory) or `url`. The return type is narrowed
from `task` × `response_format`: `create({ file })` gives `{ text }`,
`response_format: "verbose_json"` gives the full object, `"srt"`/`"vtt"`/`"text"`
give a `string`, and passing `prompt` gives an `LLMResult`.

## Diarization

```ts
const call = await client.transcriptions.create({ file: "call.mp3", task: "diarize" });
for (const segment of call.segments) {
  console.log(`${segment.speaker}: ${segment.text}`);
}
```

Add meaningful speaker labels with `roles` — `"auto"` lets the model invent
labels, an array restricts them, an object adds descriptions:

```ts
await client.transcriptions.create({
  file: "call.mp3",
  task: "diarize",
  roles: ["client", "agent"],
});
```

## Long audio: deferred jobs

`createJob()` submits the audio and returns immediately; the result is fetched
by polling. A failed job is never billed, so resubmitting is free.

```ts
const job = await client.transcriptions.createJob({ file: "long_recording.mp3" });
const result = await job.wait(); // polls; default timeout 1800s

// ...or pick it up later, even from another process:
const same = await client.transcriptions.retrieveJob(jobId);
```

Job results live for 12 hours from creation; up to 200 jobs may be in progress
per API key. In this SDK the deferred mode is `createJob()` — "async" refers
only to Promises, not to the queue.

## LLM post-processing

Pass `prompt` to run an LLM over the transcript, and optionally `json_schema`
to force structured output:

```ts
const result = await client.transcriptions.create({
  file: "meeting.mp3",
  prompt: "Summarize the key decisions",
  json_schema: { type: "object", properties: { decisions: { type: "array" } } },
});
console.log(result.llm_output); // object, validated against your schema
console.log(result.transcription.text); // the transcript it was derived from
```

## Errors and validation

Requests that the server would reject — or, worse, accept, charge for, and
silently do something else with — throw `NexaraValidationError` before any
network call. Server errors map to typed classes by status code:

```ts
import { InsufficientBalanceError } from "nexara-sdk";

try {
  await client.transcriptions.create({ file: "audio.mp3" });
} catch (e) {
  if (e instanceof InsufficientBalanceError) console.log(e.detail); // 402
}
```

429 and connection/timeout failures are retried with exponential backoff
(honoring `Retry-After`). 500 is deliberately **not** retried: on the
synchronous path the request may already have been billed, so a blind retry
could pay twice. Deferred jobs bill only on success, which makes `createJob()`
the safe path for retry-heavy workloads.

## Not yet available

- **Realtime streaming** — the protocol is not yet public; `client.realtime`
  throws for now.
- **Webhooks** — job results are fetched by polling.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest, no network needed
npm run build       # emit dist/
./run_examples.sh   # every example, offline, on the mock transport
```

Tests run against an injected transport / mock fetch; `NEXARA_USE_MOCK=1` runs
the client and examples against an in-memory mock. See `docs/design.md` for the
design rationale behind the interface. This SDK is a port of the
[Python SDK](https://nexara.ru); the two share behavior and diverge only where
the languages do.

## License

MIT
