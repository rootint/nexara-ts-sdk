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
 */
export function buildDiarize(): Json {
  return {
    task: "diarize",
    language: "ru",
    duration: DIARIZE_DURATION,
    text: DIARIZE_TEXT,
    segments: clone(DIARIZE_SEGMENTS),
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
