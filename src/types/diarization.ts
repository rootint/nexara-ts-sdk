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

/** Note the absence of everything Segment has beyond these four fields. */
export interface DiarizedSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
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
