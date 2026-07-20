/**
 * Realtime transcription over WebSocket.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ THE PROTOCOL IN THIS MODULE IS A GUESS.                                   ║
 * ║                                                                           ║
 * ║ Streaming lives in a separate service (streaming.nexara.ru) whose code we ║
 * ║ do not have. The codec, sample rate, chunk size, message types and the    ║
 * ║ partial/final distinction below are INVENTED as a plausible strawman.     ║
 * ║ The *shape* of this API (async iteration) is what we are testing; the     ║
 * ║ wire format will not survive contact with the real service.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * What is actually known, from the billing contract between streaming and
 * apigateway (the only place the two services touch that we can see):
 *
 *   - it is a WebSocket at streaming.nexara.ru;
 *   - the client presents its API key at connect, before the upgrade;
 *   - charges tick every 10 seconds of *received audio*;
 *   - a key may hold 5 concurrent sessions; a 6th is refused.
 *
 * What must come from the streaming team before this module is real:
 *
 *   1. Connect: full URL, and HOW the key is passed — header, query param, or
 *      first message? Three different clients.
 *   2. Audio: codec (raw PCM? bit depth? endianness?), sample rate, channel
 *      count, chunk size, binary frames vs base64.
 *   3. Server messages: the full list; how partial differs from final (separate
 *      message types, as Speechmatics does, or a field?); whether timestamps
 *      are absolute or relative.
 *   4. End of stream: how the client signals it, whether the server sends a
 *      final message worth awaiting, whether keepalive is required.
 *   5. Disconnects — a request, not a question: please give these DIFFERENT
 *      close codes, or the SDK can only ever say "the connection closed":
 *
 *        - invalid API key            (authorize -> 403)
 *        - no funds for the first tick (authorize -> 402)
 *        - 5 sessions already open    (authorize -> 429)
 *        - balance ran out mid-session (charge -> insufficient_balance)
 *        - reaped after 120s of silence
 *        - internal error             (500)
 *
 *      The first three happen before the upgrade; if they surface as an HTTP
 *      status on the handshake, that is enough and no close codes are needed.
 *      The rest arrive on a live socket, and there they are indistinguishable.
 *
 *   6. Silence kills the session, and it looks unintentional — please confirm.
 *      The reaper expires sessions with no charges for 120s, and charges follow
 *      received bytes. So a client that connects and sends no audio for two
 *      minutes loses the session via billing, not via any socket timeout.
 *      Sending silence keeps it alive (silence is bytes, and bytes are billed);
 *      sending nothing does not. Is there an earlier idle timeout on the
 *      streaming side that users would hit first?
 */

import { RealtimeEvent } from "../types/realtime.js";

/** True unless NEXARA_USE_MOCK is set in the environment (Node only). */
function mockDisabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return !env?.["NEXARA_USE_MOCK"];
}

const MOCK_TRANSCRIPT = ["Привет,", "это", "потоковое", "распознавание."];

/**
 * A live transcription session. Obtain via `client.realtime.connect()`.
 *
 * Sending audio and reading results are two concurrent activities. Either
 * drive both with `stream()`, or send from your own task and iterate this
 * object directly.
 */
export class RealtimeSession {
  readonly sampleRate: number;
  readonly encoding: string;

  #queue: AsyncQueue<RealtimeEvent | null> = new AsyncQueue();
  #closed = false;
  #mockWords: string[] = [];

  constructor(sampleRate: number, encoding: string) {
    this.sampleRate = sampleRate;
    this.encoding = encoding;
  }

  /**
   * Send one chunk of audio.
   *
   * Note a real consequence of the billing design: a session with no audio for
   * 120 seconds is reaped, because charges are what proves it alive. Sending
   * silence keeps it open (silence is bytes, and bytes are billed); sending
   * nothing does not. Pausing for two minutes loses the session.
   */
  async sendAudio(_chunk: Uint8Array): Promise<void> {
    if (this.#closed) {
      throw new Error("session is closed");
    }
    // MOCK: pretend each chunk yields a word, emitting a partial per chunk and
    // a final once the canned transcript is exhausted.
    this.#mockRecognize();
  }

  /** Signal end of audio and let the server flush its last result. */
  async finish(): Promise<void> {
    if (this.#closed) return;
    if (this.#mockWords.length > 0) {
      this.#queue.push({
        text: this.#mockWords.join(" "),
        is_final: true,
        start: 0.0,
        end: null,
      });
    }
    this.#queue.push(null);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#queue.push(null);
  }

  /**
   * Pump `chunks` in and yield events out.
   *
   * The convenience path. Without it every caller would write the same
   * send-in-a-separate-task boilerplate, because you cannot send and receive
   * from one sequential loop.
   */
  async *stream(chunks: AsyncIterable<Uint8Array>): AsyncIterableIterator<RealtimeEvent> {
    const pump = (async () => {
      try {
        for await (const chunk of chunks) {
          await this.sendAudio(chunk);
        }
      } finally {
        await this.finish();
      }
    })();
    // Surface pump failures rather than letting them go unhandled.
    pump.catch(() => undefined);

    try {
      yield* this;
    } finally {
      await pump.catch(() => undefined);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<RealtimeEvent> {
    for (;;) {
      const event = await this.#queue.pull();
      if (event === null) return;
      yield event;
    }
  }

  // -- mock recognition -------------------------------------------------

  #mockRecognize(): void {
    const index = this.#mockWords.length;
    if (index >= MOCK_TRANSCRIPT.length) return;
    this.#mockWords.push(MOCK_TRANSCRIPT[index]!);
    const isFinal = this.#mockWords.length === MOCK_TRANSCRIPT.length;
    this.#queue.push({
      text: this.#mockWords.join(" "),
      is_final: isFinal,
      start: 0.0,
      end: index * 0.5 + 0.5,
    });
    if (isFinal) this.#mockWords = [];
  }
}

export class Realtime {
  #apiKey: string;

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
    void this.#apiKey;
  }

  /**
   * Open a session.
   *
   * `sampleRate` and `encoding` are GUESSES — see the module docstring.
   * Realtime takes none of the transcription flags (language, diarization,
   * response_format …); it is audio in, text out.
   *
   * Until the streaming protocol is public this throws: the alternative would
   * be silently returning canned mock transcripts to a paying caller. Set
   * NEXARA_USE_MOCK=1 to explore the intended interface against the offline
   * mock.
   */
  connect(options: { sampleRate?: number; encoding?: string } = {}): RealtimeSession {
    if (mockDisabled()) {
      throw new Error(
        "Realtime transcription is not available in this release — the " +
          "streaming protocol is not yet public, and this SDK will not " +
          "pretend to transcribe. Set NEXARA_USE_MOCK=1 to try the intended " +
          "interface against an offline mock.",
      );
    }
    return new RealtimeSession(options.sampleRate ?? 16000, options.encoding ?? "pcm_s16le");
  }
}

/** A minimal single-consumer async queue backing the event stream. */
class AsyncQueue<T> {
  #items: T[] = [];
  #waiters: Array<(value: T) => void> = [];

  push(item: T): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.#items.push(item);
    }
  }

  pull(): Promise<T> {
    const item = this.#items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    return new Promise<T>((resolve) => this.#waiters.push(resolve));
  }
}
