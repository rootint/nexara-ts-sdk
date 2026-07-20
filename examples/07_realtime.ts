/**
 * Realtime transcription.
 *
 * ⚠ The protocol underneath is a GUESS — streaming.nexara.ru's wire format is
 * not documented anywhere we can see. The shape below is what we want to
 * review; the sample rate, encoding and event fields are placeholders. The
 * open questions are listed at the top of src/resources/realtime.ts.
 *
 * connect() throws unless NEXARA_USE_MOCK=1 is set, so a real caller can never
 * receive fabricated transcripts. This example runs under the mock.
 */

import { Nexara } from "nexara-sdk";

async function* fakeMicrophone(): AsyncIterableIterator<Uint8Array> {
  // Whatever produces audio chunks — a mic, a file, a phone bridge.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 50));
    yield new Uint8Array(3200);
  }
}

const client = new Nexara({ apiKey: "mock-key" });

// The convenient path: hand it an audio iterator, read events out.
const session = client.realtime.connect({ sampleRate: 16000 });
for await (const event of session.stream(fakeMicrophone())) {
  const marker = event.is_final ? "FINAL" : "  ...";
  console.log(`${marker}  ${event.text}`);
}

// The manual path, for when audio does not arrive as a neat iterator. Sending
// and receiving are concurrent, so the send runs without awaiting it inline.
const manual = client.realtime.connect();
void (async () => {
  for await (const chunk of fakeMicrophone()) {
    await manual.sendAudio(chunk);
  }
  await manual.finish();
})();
for await (const event of manual) {
  if (event.is_final) console.log("FINAL ", event.text);
}

// Worth knowing: the session stays alive only as long as audio keeps arriving.
// Two minutes without any and it is reaped, because billing ticks are what
// prove it alive. Silence is fine (it is bytes, and it is billed); sending
// nothing is not.
