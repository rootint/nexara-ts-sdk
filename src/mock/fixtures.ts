/**
 * Canned payloads, shaped exactly the way the server shapes them.
 *
 * Not invented: these mirror what apigateway actually returns, read off
 * `utils/transcription.py` (build_transcribe_response, build_diarize_response,
 * format_response) and `routes/api/v1/inference.py` on branch `develop`.
 *
 * The shaping functions below are not decoration — they reproduce the server's
 * real quirks, including the ones we consider bugs. A mock that returned the
 * *tidy* shape would validate the interface against an API that does not exist.
 */

export type Json = Record<string, unknown>;

export const TEXT = "Привет, это тестовая запись.";
export const DURATION = 4.42;

const WORDS: Json[] = [
  { word: "Привет,", start: 0.0, end: 0.62, prob: 0.991 },
  { word: "это", start: 0.62, end: 0.94, prob: 0.998 },
  { word: "тестовая", start: 0.94, end: 1.58, prob: 0.987 },
  { word: "запись.", start: 1.58, end: 2.11, prob: 0.994 },
];

const SEGMENTS: Json[] = [
  {
    id: 0,
    seek: 0.0,
    start: 0.0,
    end: DURATION,
    text: TEXT,
    tokens: [50364, 3763, 11, 50564],
    temperature: 0.0,
    avg_logprob: -0.28,
    compression_ratio: 1.21,
    no_speech_prob: 0.008,
  },
];

const SENTENCES: Json[] = [
  { start: 0.0, end: 2.11, text: TEXT },
  { start: 2.3, end: DURATION, text: "Проверяем предложения." },
];

export const DIARIZE_TEXT = "Здравствуйте, чем могу помочь? Да, у меня вопрос по заказу.";
export const DIARIZE_DURATION = 8.14;

const DIARIZE_SEGMENTS: Json[] = [
  { start: 0.0, end: 3.21, text: "Здравствуйте, чем могу помочь?", speaker: "speaker_0" },
  { start: 3.6, end: 8.14, text: "Да, у меня вопрос по заказу.", speaker: "speaker_1" },
];

// Per-segment emotion, in the trimmed shape the server publishes: the backend's
// scoring internals (windows, scored_seconds, group_size, unit_id,
// out_of_distribution) are stripped by _public_emotion before they ever leave
// apigateway, so a mock that included them would be describing an API that does
// not exist. The second segment carries no emotion on purpose — the server
// scores per segment and leaves the key off where it could not.
const DIARIZE_EMOTIONS: Array<Json | null> = [
  {
    label: "neutral",
    confidence: 0.87,
    probs: { angry: 0.03, sad: 0.04, neutral: 0.87, positive: 0.06 },
  },
  null,
];

const DIARIZE_WORDS: Json[] = [
  { word: "Здравствуйте,", start: 0.0, end: 0.88, prob: 0.996, speaker: "speaker_0" },
  { word: "чем", start: 0.88, end: 1.12, prob: 0.993, speaker: "speaker_0" },
  { word: "могу", start: 1.12, end: 1.44, prob: 0.995, speaker: "speaker_0" },
  { word: "помочь?", start: 1.44, end: 3.21, prob: 0.989, speaker: "speaker_0" },
  { word: "Да,", start: 3.6, end: 3.92, prob: 0.997, speaker: "speaker_1" },
  { word: "у", start: 3.92, end: 4.05, prob: 0.999, speaker: "speaker_1" },
  { word: "меня", start: 4.05, end: 4.38, prob: 0.996, speaker: "speaker_1" },
  { word: "вопрос", start: 4.38, end: 4.91, prob: 0.994, speaker: "speaker_1" },
  { word: "по", start: 4.91, end: 5.08, prob: 0.998, speaker: "speaker_1" },
  { word: "заказу.", start: 5.08, end: 8.14, prob: 0.992, speaker: "speaker_1" },
];

function clone(items: Json[]): Json[] {
  return items.map((item) => ({ ...item }));
}

/** verbose_json for task=transcribe. */
export function buildTranscribe(granularity: string): Json {
  const payload: Json = {
    task: "transcribe",
    language: "ru",
    duration: DURATION,
    text: TEXT,
    segments: clone(SEGMENTS),
  };
  if (granularity === "sentence") {
    // The server drops segments entirely and replaces them with sentences.
    delete payload["segments"];
    payload["sentences"] = clone(SENTENCES);
    payload["words"] = clone(WORDS);
    payload["text"] = TEXT + " Проверяем предложения.";
  } else if (granularity === "word") {
    payload["words"] = clone(WORDS);
  }
  return payload;
}

/**
 * The full diarize payload, words included.
 *
 * Diarization always requests word timestamps from the backend
 * (word_timestamps=True is hardcoded), so words are always built here. Whether
 * they survive into the response is decided later, per-endpoint.
 *
 * `emotions` mirrors the server exactly: the key is attached only when the
 * request opted in, only to segments that were scored, and never to words.
 */
export function buildDiarize(emotions = false): Json {
  const segments = clone(DIARIZE_SEGMENTS);
  if (emotions) {
    segments.forEach((segment, i) => {
      const emotion = DIARIZE_EMOTIONS[i];
      if (emotion) segment["emotion"] = { ...emotion };
    });
  }
  return {
    task: "diarize",
    language: "ru",
    duration: DIARIZE_DURATION,
    text: DIARIZE_TEXT,
    segments,
    words: clone(DIARIZE_WORDS),
  };
}

/**
 * The sync handler's word-stripping — and only the sync handler's.
 *
 * This is the divergence the SDK cannot paper over: the Celery worker has no
 * equivalent, so the async path keeps words that the sync path removes. The
 * mock reproduces it deliberately. When the server fixes this (by moving the
 * function next to format_response, where it belongs), delete this call from
 * the sync branch and the two paths agree.
 */
export function stripWordsIfNotRequested(payload: Json, granularity: string): Json {
  if (granularity !== "word" && granularity !== "sentence") {
    delete payload["words"];
  }
  return payload;
}

/** Mirror of the server's format_response. */
export function formatResponse(payload: Json, responseFormat: string, task: string): unknown {
  if (responseFormat === "json") {
    // For transcribe, json collapses to just the text. For diarize it does
    // not — the full object comes back.
    return task !== "diarize" ? { text: payload["text"] } : payload;
  }
  if (responseFormat === "verbose_json") {
    return payload;
  }
  if (responseFormat === "text") {
    if (task === "diarize") {
      return (payload["segments"] as Json[])
        .map((s) => `${title(String(s["speaker"]).replace(/_/g, " "))}: ${String(s["text"])}`)
        .join("\n");
    }
    return payload["text"];
  }
  if (responseFormat === "srt") {
    return toSrt(payload["segments"] as Json[]);
  }
  if (responseFormat === "vtt") {
    return toVtt(payload["segments"] as Json[]);
  }
  throw new Error(`unreachable: response_format=${JSON.stringify(responseFormat)}`);
}

/** The LLM wrapper. `usage` is commented out server-side, so it is absent. */
export function wrapLlm(payload: Json, hasSchema: boolean): Json {
  return {
    transcription: payload,
    llm_output: hasSchema
      ? { summary: "Клиент спрашивает про заказ.", sentiment: "neutral" }
      : "Клиент спрашивает про заказ.",
  };
}

// -- billing ---------------------------------------------------------------

/**
 * GET /billing/balance. rate_per_min is the per-second price × 60, as the
 * server computes it.
 */
export const BALANCE: Json = { balance: 1240.5, rate_per_min: 0.36, currency: "RUB" };

// GET /billing/usage rows, newest first — the order the server returns them in.
// The leading number is the row id the cursor is keyed on; it is not part of the
// item the server sends, which is why it is carried alongside rather than inside.
const USAGE_ROWS: Array<[number, Json]> = [
  [
    207,
    {
      timestamp: "2026-02-11T09:41:02.512000+00:00",
      seconds: 612.4,
      bytes: 9812004,
      task: "diarize",
      model: "nexara-1",
      language: "ru",
      cost: 3.67,
      profanity_filter: false,
      role_tagging: true,
      emotions: false,
      llm_input_tokens: null,
      llm_output_tokens: null,
      request_id: "b41f0a8c-2d0e-4d9b-9a41-2f6f2c9a1e77",
      api_key: { id: 12, name: "production", deleted: false },
    },
  ],
  [
    206,
    {
      timestamp: "2026-02-11T08:03:44.108000+00:00",
      seconds: 44.2,
      bytes: 707200,
      task: "transcribe",
      model: "nexara-1",
      language: "ru",
      cost: 0.27,
      profanity_filter: false,
      role_tagging: false,
      emotions: false,
      llm_input_tokens: 1204,
      llm_output_tokens: 96,
      request_id: "5f2a9f30-9b1e-4f0a-8a2d-7c4b1d6e0f11",
      api_key: { id: 12, name: "production", deleted: false },
    },
  ],
  [
    205,
    {
      timestamp: "2026-02-10T19:22:17.900000+00:00",
      seconds: 8.1,
      bytes: 129600,
      task: "transcribe",
      model: "whisper-1",
      language: "en",
      cost: 0.05,
      profanity_filter: true,
      role_tagging: false,
      emotions: false,
      llm_input_tokens: null,
      llm_output_tokens: null,
      request_id: "0c7c3a51-3f77-4a6c-91e0-1f5a2d8b4c33",
      // A key that has since been deleted: the call stays in the history.
      api_key: { id: 9, name: "Key #9", deleted: true },
    },
  ],
  [
    204,
    {
      timestamp: "2026-02-10T11:05:00.000000+00:00",
      seconds: 120.0,
      bytes: 1920000,
      task: "transcribe",
      model: "nexara-ru",
      language: "ru",
      // Written before per-request costs were recorded: null, not 0.
      cost: null,
      profanity_filter: false,
      role_tagging: false,
      emotions: false,
      llm_input_tokens: null,
      llm_output_tokens: null,
      request_id: null,
      api_key: { id: 12, name: "production", deleted: false },
    },
  ],
  [
    203,
    {
      timestamp: "2026-02-09T15:47:31.220000+00:00",
      seconds: 300.5,
      bytes: 4808000,
      task: "diarize",
      // emotions is only ever true alongside diarize on nexara-ru — the server
      // rejects every other combination, so no other row can carry it.
      model: "nexara-ru",
      language: "ru",
      cost: 1.8,
      profanity_filter: false,
      role_tagging: false,
      emotions: true,
      llm_input_tokens: null,
      llm_output_tokens: null,
      request_id: "9d1b7e42-6a55-4f18-b0c3-8e2f5a7d9b04",
      api_key: { id: 3, name: "staging", deleted: false },
    },
  ],
];

export function buildBalance(): Json {
  return { ...BALANCE };
}

/**
 * Mirror of get_usage_page: keyset over the row id, newest first.
 *
 * `has_more` comes from fetching one row past the page, and `next_cursor` is
 * set *only* when there is more — same as the server, so a client that pages on
 * `next_cursor` alone terminates here exactly as it does in production.
 */
export function buildUsagePage(cursor: number | null, limit: number): Json {
  const rows = USAGE_ROWS.filter(([id]) => cursor === null || id < cursor);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map(([, item]) => ({ ...item })),
    next_cursor: hasMore && page.length > 0 ? page[page.length - 1]![0] : null,
    has_more: hasMore,
    currency: BALANCE["currency"],
  };
}

function title(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function pad(n: number, width: number): string {
  return String(Math.floor(n)).padStart(width, "0");
}

function ts(seconds: number, sep: string): string {
  const h = Math.floor(seconds / 3600);
  const rem = seconds % 3600;
  const m = Math.floor(rem / 60);
  const s = rem % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad((s % 1) * 1000, 3)}`;
}

function toSrt(segments: Json[]): string {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${ts(Number(s["start"]), ",")} --> ${ts(Number(s["end"]), ",")}\n${String(s["text"])}\n`,
    )
    .join("\n");
}

function toVtt(segments: Json[]): string {
  const body = segments
    .map(
      (s) =>
        `${ts(Number(s["start"]), ".")} --> ${ts(Number(s["end"]), ".")}\n${String(s["text"])}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
