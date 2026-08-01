/**
 * TypeScript SDK for the Nexara speech-to-text API.
 *
 * A single async client (`Nexara`) talks to the API over fetch. Realtime is
 * not yet available. See docs/design.md.
 */

export const VERSION = "0.4.0";

export { Nexara, DEFAULT_BASE_URL } from "./client.js";
export type { NexaraOptions } from "./client.js";

export {
  NexaraError,
  NexaraValidationError,
  APIError,
  BadRequestError,
  InsufficientBalanceError,
  AuthenticationError,
  NotFoundError,
  SyncLLMTimeoutError,
  RateLimitError,
  InternalServerError,
  BadGatewayError,
  APIConnectionError,
  APITimeoutError,
  JobFailedError,
  JobTimeoutError,
} from "./errors.js";

export type {
  Task,
  ResponseFormat,
  Granularity,
  Roles,
  CreateParams,
} from "./validation.js";

export { Transcriptions } from "./resources/transcriptions.js";
export type {
  CreateLLMParams,
  CreateDiarizeParams,
  CreateDiarizeStringParams,
  CreateVerboseParams,
  CreateStringParams,
  CreateJsonParams,
} from "./resources/transcriptions.js";

export { Billing, DEFAULT_USAGE_LIMIT, MAX_USAGE_LIMIT } from "./resources/billing.js";
export type { UsageParams, IterUsageParams } from "./resources/billing.js";

export { Realtime, RealtimeSession } from "./resources/realtime.js";

export { Job, DEFAULT_WAIT_TIMEOUT_MS } from "./types/job.js";
export type { JobStatus, JobFields, WaitOptions } from "./types/job.js";

export type {
  Word,
  Segment,
  Sentence,
  Transcription,
  VerboseTranscription,
  LLMResult,
} from "./types/transcription.js";
export type {
  DiarizedWord,
  DiarizedSegment,
  Diarization,
  Emotion,
  EmotionLabel,
} from "./types/diarization.js";
export type {
  Currency,
  Balance,
  UsageApiKey,
  UsageItem,
  UsagePage,
} from "./types/billing.js";
export type { RealtimeEvent } from "./types/realtime.js";

export type { Transport, TransportResponse, RequestOptions, FileInput } from "./transport.js";
