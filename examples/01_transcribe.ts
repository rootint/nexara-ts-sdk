/** Basic transcription: audio in, text out. */

import { Nexara } from "nexara-sdk";

const client = new Nexara({ apiKey: "mock-key" });

const result = await client.transcriptions.create({ url: "https://example.com/audio.mp3" });
console.log(result.text);

// Other output formats come back as plain strings, not objects.
const srt = await client.transcriptions.create({
  url: "https://example.com/audio.mp3",
  response_format: "srt",
});
console.log(srt);
