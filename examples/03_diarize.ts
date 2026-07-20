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
