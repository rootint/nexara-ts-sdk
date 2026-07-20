/** Response models for task="transcribe". */

export interface Word {
  /** Already stripped by the server; no leading whisper-style space. */
  word: string;
  start: number;
  end: number;
  /**
   * Note the name: the server renames `probability` to `prob` when building
   * the response. It is `prob` on the wire and `prob` here.
   */
  prob: number;
}

export interface Segment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

/** Result of response_format="json" — the server sends only the text. */
export interface Transcription {
  text: string;
}

/** Result of response_format="verbose_json". */
export interface VerboseTranscription {
  task: string;
  language: string;
  duration: number;
  text: string;

  /**
   * Absent when timestamp_granularities=["sentence"] — the server drops
   * `segments` and sends `sentences` instead.
   */
  segments?: Segment[];

  /**
   * Absent unless word- or sentence-level timestamps were requested.
   *
   * With the default granularity ("segment") this is undefined: the server
   * strips words from the response. It is also present-vs-absent
   * *inconsistently between create() and createJob()* — the async worker does
   * not strip. See docs/design.md, "words: sync и async возвращают разный JSON".
   */
  words?: Word[];

  /** Only when timestamp_granularities=["sentence"]. */
  sentences?: Sentence[];
}

/** Result when `prompt` is set: the transcription is wrapped. */
export interface LLMResult {
  /** Always verbose_json — `prompt` forces it server-side. */
  transcription: VerboseTranscription;

  /**
   * A string when json_schema was not given, an object shaped by the schema
   * when it was.
   *
   * The server has a `usage` field (tokens, cost) commented out, so it never
   * arrives and is deliberately not modelled here.
   */
  llm_output: string | Record<string, unknown>;
}
