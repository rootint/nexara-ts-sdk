/**
 * Response models for task="diarize".
 *
 * The diarization schema is not the transcription schema with a `speaker`
 * field bolted on: its segments carry *fewer* fields (no id/seek/tokens/
 * avg_logprob/compression_ratio/no_speech_prob), because a different pipeline
 * builds them. Modelling them as one type would promise fields that never
 * arrive.
 */

import type { Word } from "./transcription.js";

export interface DiarizedWord extends Word {
  speaker: string;
}

/**
 * The labels the server emits. It filters anything else out before the response
 * is built, so this union is the whole set in practice.
 *
 * (The Python SDK types the same field as a plain `str`: pydantic validates at
 * runtime, so pinning the set there would turn a new server label into a parse
 * failure for the entire diarization. TypeScript types are erased, so a union is
 * free here — it buys autocomplete and costs nothing at runtime.)
 */
export type EmotionLabel = "angry" | "sad" | "neutral" | "positive";

/**
 * Per-segment emotion, present only when `emotions: true` was requested.
 *
 * The server strips its scoring internals (windows, scored_seconds, group_size,
 * unit_id, out_of_distribution) before sending, so what arrives is exactly these
 * three fields.
 */
export interface Emotion {
  label: EmotionLabel;
  /** How sure the model is of `label`, 0..1. */
  confidence: number;
  /**
   * Per-label probabilities. Absent when the backend did not send them —
   * `label` and `confidence` always arrive.
   */
  probs?: Partial<Record<EmotionLabel, number>>;
}

/** Note the absence of everything Segment has beyond these four fields. */
export interface DiarizedSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
  /**
   * Set only when the request passed `emotions: true`, and only on segments the
   * model could actually score — a scored response can still contain segments
   * without it, so check per segment rather than per response.
   *
   * Never present on `words`: emotion is scored over a segment's audio.
   */
  emotion?: Emotion;
}

/**
 * Result of task="diarize".
 *
 * Returned for both response_format="json" and "verbose_json": unlike the
 * transcribe path, `json` does not collapse to { text } here.
 */
export interface Diarization {
  task: string;
  language: string;
  duration: number;
  text: string;

  segments: DiarizedSegment[];

  /**
   * Present or absent depending on which endpoint produced this.
   *
   * Diarization always asks the backend for word timestamps, but the sync
   * handler strips them when granularity is "segment" and the async worker
   * does not. Same parameters, different shape. Do not assume.
   */
  words?: DiarizedWord[];
}
