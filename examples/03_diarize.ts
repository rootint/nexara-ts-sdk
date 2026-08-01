/** Speaker diarization. */

import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

const result = await client.transcriptions.create({
  url: "https://example.com/call.mp3",
  task: "diarize",
  num_speakers: 2,
});

for (const segment of result.segments) {
  console.log(`${segment.speaker}: ${segment.text}`);
}

// Diarization needs audio of at least 3 seconds (plain transcription needs 0.3).

// `text` gives you the readable form directly.
console.log();
console.log(
  await client.transcriptions.create({
    url: "https://example.com/call.mp3",
    task: "diarize",
    response_format: "text",
  }),
);

// role_tagging: `roles` replaces speaker_0/speaker_1 with meaningful roles the
// model infers from the dialogue. Three modes:
//   "auto"                          — the model invents short labels;
//   ["operator", "client"]          — roles restricted to this set (+ "unknown");
//   { operator: "the support rep" } — same, with descriptions for the model.
// Arrays and objects are JSON-encoded for you. roles requires task="diarize".
//
// CAVEAT: the mock transport does not apply role_tagging — it returns the canned
// speaker_0/speaker_1 fixture regardless. Against the real server the segments
// would come back with these roles in the `speaker` field.
console.log();
const tagged = await client.transcriptions.create({
  url: "https://example.com/call.mp3",
  task: "diarize",
  roles: ["operator", "client"],
});
for (const segment of tagged.segments) {
  console.log(`${segment.speaker}: ${segment.text}`);
}

// emotions: per-segment emotion recognition. Scoring happens inside the ASR
// model, so this needs task="diarize" AND model="nexara-ru" AND a JSON response
// format — anything else is a client-side error here (and a 400 on the server)
// rather than a paid request that quietly returns no emotion.
console.log();
const scored = await client.transcriptions.create({
  url: "https://example.com/call.mp3",
  task: "diarize",
  model: "nexara-ru",
  emotions: true,
});
for (const segment of scored.segments) {
  // Not every segment gets scored — check before reading. `probs` carries the
  // full distribution when the backend sends it.
  const emotion = segment.emotion
    ? `${segment.emotion.label} ${Math.round(segment.emotion.confidence * 100)}%`
    : "not scored";
  console.log(`${segment.speaker}: ${segment.text} [${emotion}]`);
}
