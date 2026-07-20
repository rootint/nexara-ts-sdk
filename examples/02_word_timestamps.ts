/**
 * Word-level timestamps — and the trap in the default.
 *
 * verbose_json alone does NOT give you words: the default granularity is
 * "segment", and the server strips words from the response. You have to ask.
 */

import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

// The default: verbose, but wordless.
const dflt = await client.transcriptions.create({
  url: "https://example.com/audio.mp3",
  response_format: "verbose_json",
});
console.log("words with default granularity:", dflt.words); // undefined

// Ask for words explicitly.
const detailed = await client.transcriptions.create({
  url: "https://example.com/audio.mp3",
  response_format: "verbose_json",
  timestamp_granularities: ["word"],
});
for (const word of detailed.words ?? []) {
  console.log(`${word.start.toFixed(2)}–${word.end.toFixed(2)}  ${word.word}  (prob=${word.prob})`);
}

// Sentence granularity replaces `segments` with `sentences` — segments go away.
const bySentence = await client.transcriptions.create({
  url: "https://example.com/audio.mp3",
  response_format: "verbose_json",
  timestamp_granularities: ["sentence"],
});
console.log("segments:", bySentence.segments); // undefined
for (const sentence of bySentence.sentences ?? []) {
  console.log(`${sentence.start.toFixed(2)}–${sentence.end.toFixed(2)}  ${sentence.text}`);
}
