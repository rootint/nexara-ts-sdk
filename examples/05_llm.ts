/** Structured output: run a prompt over the transcript. */

import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

// A prompt alone gives free-form text back.
const plain = await client.transcriptions.create({
  url: "https://example.com/call.mp3",
  prompt: "Summarise this call in one sentence.",
});
console.log(plain.llm_output);
console.log(plain.transcription.text);

// Add a schema to get an object instead.
const structured = await client.transcriptions.create({
  url: "https://example.com/call.mp3",
  prompt: "Summarise this call and judge its sentiment.",
  json_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      sentiment: { enum: ["positive", "neutral", "negative"] },
    },
    required: ["summary", "sentiment"],
  },
});
console.log(JSON.stringify(structured.llm_output, null, 2));
