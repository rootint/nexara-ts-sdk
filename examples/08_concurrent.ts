/**
 * The client is async throughout — there is no sync/async split like the
 * Python SDK's Nexara/AsyncNexara. "async" here just means Promises, so
 * running several requests at once is a plain `Promise.all`.
 */

import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

// Three transcriptions concurrently — they overlap rather than run in series.
const urls = [
  "https://example.com/a.mp3",
  "https://example.com/b.mp3",
  "https://example.com/c.mp3",
];
const results = await Promise.all(urls.map((url) => client.transcriptions.create({ url })));
for (const result of results) {
  console.log(result.text);
}

// Deferred jobs poll with `await`, so the event loop stays free while you wait.
const job = await client.transcriptions.createJob({ url: "https://example.com/long.mp3" });
console.log("job:", job.job_id, job.status);
const done = await job.wait({ pollIntervalMs: 100 });
console.log((done as { text: string }).text);
