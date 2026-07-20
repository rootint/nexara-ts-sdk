/**
 * Deferred transcription for long audio.
 *
 * `create()` waits for the result. `createJob()` hands you a Job and returns.
 * The word "async" is not used for either — in TypeScript everything is async;
 * "deferred" is the server-side queue, which is `createJob()`.
 */

import { Nexara } from "nexara-sdk";
import type { Diarization } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

const job = await client.transcriptions.createJob({
  url: "https://example.com/long.mp3",
  task: "diarize",
});
console.log(`submitted ${job.job_id}, status=${job.status}`);

const result = (await job.wait({ pollIntervalMs: 100 })) as Diarization;
console.log(result.text);

// The same request through create() and createJob() returns DIFFERENT shapes.
// Diarization always computes word timestamps; the sync handler strips them at
// the default granularity, and the Celery worker does not. This is a server-side
// inconsistency, not an SDK choice — which is why `words` is optional everywhere
// and you should not assume either way.
const syncResult = await client.transcriptions.create({
  url: "https://example.com/long.mp3",
  task: "diarize",
});
console.log(`words via create():    ${syncResult.words ? "present" : "stripped"}`);
console.log(`words via createJob(): ${result.words ? "present" : "stripped"}`);
