/** The transcriptions resource. */

import { errorForStatus } from "../errors.js";
import type { FileInput, Transport } from "../transport.js";
import type { CreateParams, Granularity, Roles } from "../validation.js";
import { validateAndBuildForm } from "../validation.js";
import type { Diarization } from "../types/diarization.js";
import { Job } from "../types/job.js";
import type {
  LLMResult,
  Transcription,
  VerboseTranscription,
} from "../types/transcription.js";

/**
 * Turn a raw payload into the model the overloads promised.
 *
 * The shape is read off the payload itself rather than from the flags that
 * produced it. That is not cleverness for its own sake: a Job fetched by id in
 * another process has no memory of its flags, and defaulting to "probably a
 * transcription" would parse a diarization as a plain transcription — silently
 * dropping every speaker. Wrong data is worse than an error, and the payload
 * already says what it is.
 */
export function parseResult(body: unknown): unknown {
  if (typeof body !== "object" || body === null) {
    return body; // text / srt / vtt come back as plain strings
  }
  const obj = body as Record<string, unknown>;
  if ("llm_output" in obj) return obj as unknown as LLMResult;
  if (obj["task"] === "diarize") return obj as unknown as Diarization;
  if ("task" in obj) return obj as unknown as VerboseTranscription;
  return obj as unknown as Transcription;
}

interface BaseParams {
  file?: FileInput | null;
  url?: string | null;
  language?: string | null;
  profanity_filter?: boolean;
  dictionary?: "medical" | null;
  model?: string;
}

/** `prompt` present → LLMResult (the server forces verbose_json). */
export interface CreateLLMParams extends BaseParams {
  prompt: string;
  task?: "transcribe";
  json_schema?: string | Record<string, unknown> | null;
}

/** task="diarize", json/verbose_json → Diarization. */
export interface CreateDiarizeParams extends BaseParams {
  task: "diarize";
  response_format?: "json" | "verbose_json";
  timestamp_granularities?: Granularity[];
  num_speakers?: number | null;
  roles?: Roles | null;
  /** Per-segment emotion. Also requires model: "nexara-ru". */
  emotions?: boolean;
  diarization_setting?: "general" | "telephonic";
}

/**
 * task="diarize", text/srt/vtt → string.
 *
 * No `emotions` here on purpose: subtitles have nowhere to carry the emotion
 * object, so the server rejects the combination. Leaving it off the type turns
 * that into a compile error instead of a runtime one.
 */
export interface CreateDiarizeStringParams extends BaseParams {
  task: "diarize";
  response_format: "text" | "srt" | "vtt";
  timestamp_granularities?: Granularity[];
  num_speakers?: number | null;
  roles?: Roles | null;
  diarization_setting?: "general" | "telephonic";
}

/** task="transcribe", verbose_json → VerboseTranscription. */
export interface CreateVerboseParams extends BaseParams {
  task?: "transcribe";
  response_format: "verbose_json";
  timestamp_granularities?: Granularity[];
}

/** task="transcribe", text/srt/vtt → string. */
export interface CreateStringParams extends BaseParams {
  task?: "transcribe";
  response_format: "text" | "srt" | "vtt";
  timestamp_granularities?: Granularity[];
}

/** task="transcribe", json (default) → Transcription. */
export interface CreateJsonParams extends BaseParams {
  task?: "transcribe";
  response_format?: "json";
  timestamp_granularities?: Granularity[];
}

export class Transcriptions {
  #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  // -- create ----------------------------------------------------------

  create(params: CreateLLMParams): Promise<LLMResult>;
  create(params: CreateDiarizeStringParams): Promise<string>;
  create(params: CreateDiarizeParams): Promise<Diarization>;
  create(params: CreateStringParams): Promise<string>;
  create(params: CreateVerboseParams): Promise<VerboseTranscription>;
  create(params: CreateJsonParams): Promise<Transcription>;
  /**
   * Transcribe audio and wait for the result.
   *
   * Pass exactly one of `file` or `url`. A string `file` is a path and is
   * streamed from disk by the transport, so long recordings are never held in
   * memory.
   *
   * `profanity_filter: true` masks Russian profanity server-side. The masking
   * is morphological (lemma-based, not substring) and length-preserving, so
   * word timings stay aligned; it carries a per-second billing surcharge.
   *
   * `roles` turns on speaker role_tagging and requires task="diarize". Pass
   * "auto" to let the model invent labels, an array to restrict them, or an
   * object to add descriptions; arrays and objects are JSON-encoded for you.
   *
   * `emotions: true` attaches an `emotion` object to each diarized segment. The
   * scoring happens inside the ASR model, so it needs task="diarize",
   * model="nexara-ru" and a JSON response format — every other combination is a
   * 400 (checked here first). It carries a per-second surcharge, but only for
   * output actually delivered: the server drops the charge when the backend
   * scored nothing.
   *
   * Not in the public docs (docs.nexara.ru) — supported by the server but
   * undocumented, so treat them as unstable and subject to change:
   *   - `dictionary: "medical"` — domain vocabulary correction;
   *   - `timestamp_granularities: ["sentence"]` — sentence-level timestamps
   *     (the server drops `segments` and returns `sentences` instead).
   *
   * Note on retries: a 500 thrown here may arrive *after* your transcription
   * was billed (the LLM step runs after the charge on the sync path), so a
   * retry can pay twice. `createJob()` bills after the LLM instead, which
   * makes a failed job free. See docs/design.md.
   *
   * With a `prompt` on long audio the LLM step can exceed the synchronous
   * budget and throw `SyncLLMTimeoutError` (413). The transcription itself
   * succeeded; retrying synchronously just times out again. Resubmit the same
   * call through `createJob()`, where the LLM step gets a far larger timeout.
   */
  async create(params: CreateParams): Promise<unknown> {
    const form = validateAndBuildForm(params);
    const response = await this.#transport.request("POST", "/audio/transcriptions", {
      form,
      file: params.file ?? null,
    });
    if (response.status_code >= 400) {
      throw errorForStatus(response.status_code, detail(response.body));
    }
    return parseResult(response.body);
  }

  // -- jobs -------------------------------------------------------------

  /**
   * Submit audio for deferred transcription and return immediately.
   *
   * The result is fetched by polling — there are no webhooks. (The API has a
   * `callback_url` field; it is accepted and then dropped on the floor, so
   * this SDK does not expose it.)
   *
   * Results live for 12 hours from creation, then vanish. Up to 200 jobs may
   * be in_progress per key.
   *
   * Takes the same flags as `create()` — including the undocumented
   * `dictionary` and `timestamp_granularities: ["sentence"]` noted there.
   */
  async createJob(params: CreateParams): Promise<Job> {
    const form = validateAndBuildForm(params);
    const response = await this.#transport.request("POST", "/audio/transcriptions/async", {
      form,
      file: params.file ?? null,
    });
    if (response.status_code >= 400) {
      throw errorForStatus(response.status_code, detail(response.body));
    }
    return new Job(response.body as never, this);
  }

  /**
   * Fetch a job by id — including from a process that never submitted it.
   *
   * No flags needed: `wait()` reads the result's shape off the payload.
   *
   * Throws NotFoundError both for an unknown jobId and for one that existed
   * and was swept after 12 hours. The server does not distinguish them.
   */
  async retrieveJob(jobId: string): Promise<Job> {
    const response = await this.#transport.request(
      "GET",
      `/audio/transcriptions/async/${jobId}`,
    );
    if (response.status_code >= 400) {
      throw errorForStatus(response.status_code, detail(response.body));
    }
    return new Job(response.body as never, this);
  }
}

function detail(body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    return String((body as Record<string, unknown>)["detail"]);
  }
  return String(body);
}
