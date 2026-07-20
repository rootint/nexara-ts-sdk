/**
 * Client-side validation.
 *
 * Everything here fires before the request is sent. Two kinds of rules live
 * together:
 *
 *   - things the server rejects with a 400 — we just fail faster and cheaper;
 *   - things the server accepts and then silently does differently — those are
 *     the reason this module exists. A request that is charged for and quietly
 *     does the wrong thing is worse than one that fails.
 *
 * Where the server is silently permissive, we are deliberately stricter than
 * it is. That is a real trade-off: code that worked against raw curl can throw
 * here. Each such rule says why in its error message.
 *
 * "The caller did not pass X" is `undefined` — TypeScript's natural NOT_GIVEN.
 * Only an *explicitly passed* value can conflict with `prompt`; the defaults
 * must stay compatible or `prompt` could never be used at all.
 */

import { Ajv2020 } from "ajv/dist/2020.js";

import { NexaraValidationError } from "./errors.js";
import type { FileInput } from "./transport.js";

export type Task = "transcribe" | "diarize";
export type ResponseFormat = "json" | "verbose_json" | "text" | "srt" | "vtt";
export type Granularity = "word" | "segment" | "sentence";
export type Roles = string | string[] | Record<string, string>;

export const TASKS: ReadonlySet<string> = new Set(["transcribe", "diarize"]);
export const RESPONSE_FORMATS: ReadonlySet<string> = new Set([
  "json",
  "verbose_json",
  "text",
  "srt",
  "vtt",
]);
export const GRANULARITIES: ReadonlySet<string> = new Set(["word", "segment", "sentence"]);
export const DICTIONARIES: ReadonlySet<string> = new Set(["medical"]);
export const DIARIZATION_SETTINGS: ReadonlySet<string> = new Set(["general", "telephonic"]);
export const AUTO_LANGUAGE: ReadonlySet<string> = new Set(["auto", "automatic", ""]);

// Limits the server enforces on `roles` (role_tagging), published at
// docs.nexara.ru/speakers-roles. Documented numbers, so we check them here and
// fail faster and cheaper than a 400 — unlike the language list, which is not
// published and therefore not mirrored.
export const MAX_ROLES = 10;
export const MAX_ROLE_NAME_LEN = 64;
export const MAX_ROLE_DESC_LEN = 500;

// The server checks `language` against a fixed list of ~100 ISO-639-1 codes.
// We deliberately do NOT mirror that list: we do not have it, and a guessed
// copy that is missing a code would reject a language that actually works — a
// worse failure than the server's own 400. Format check only.
const LANG_RE = /^[a-z]{2}$/;

function fail(msg: string): never {
  throw new NexaraValidationError(msg);
}

export interface CreateParams {
  task?: Task;
  file?: FileInput | null;
  url?: string | null;
  language?: string | null;
  response_format?: ResponseFormat;
  timestamp_granularities?: Granularity[];
  profanity_filter?: boolean;
  dictionary?: "medical" | null;
  prompt?: string | null;
  json_schema?: string | Record<string, unknown> | null;
  num_speakers?: number | null;
  roles?: Roles | null;
  diarization_setting?: "general" | "telephonic";
  model?: string;
}

const DIARIZE_ONLY = ["num_speakers", "roles", "diarization_setting"] as const;

/**
 * Validate, then return the multipart form fields (minus `file` itself).
 *
 * Validation and serialization live in one function on purpose: they read the
 * same set of resolved values, and splitting them would mean deciding twice
 * what "the user asked for X" means.
 */
export function validateAndBuildForm(params: CreateParams): Record<string, unknown> {
  const task = params.task ?? "transcribe";
  if (!TASKS.has(task)) {
    fail(`task must be one of ${JSON.stringify([...TASKS].sort())}, got ${JSON.stringify(task)}`);
  }

  // --- audio source ---------------------------------------------------
  const file = params.file ?? null;
  const url = params.url ?? null;
  if (file !== null && url !== null) {
    fail("pass either file or url, not both — the server accepts exactly one");
  }
  if (file === null && url === null) {
    fail("pass either file or url");
  }

  // --- diarize-only parameters ---------------------------------------
  if (task !== "diarize") {
    for (const name of DIARIZE_ONLY) {
      const value = params[name];
      if (value !== undefined && value !== null) {
        fail(
          `${name} requires task='diarize'. With task='transcribe' the server ` +
            (name === "roles"
              ? "rejects it with a 400."
              : "accepts it and silently ignores it."),
        );
      }
    }
  }

  // --- granularity ----------------------------------------------------
  let gran = [...(params.timestamp_granularities ?? ["segment"])];
  for (const g of gran) {
    if (!GRANULARITIES.has(g)) {
      fail(
        `timestamp_granularities values must be in ${JSON.stringify([...GRANULARITIES].sort())}, ` +
          `got ${JSON.stringify(g)}`,
      );
    }
  }
  if (gran.length !== 1) {
    fail(
      `timestamp_granularities takes exactly one value, got ${JSON.stringify(gran)}. ` +
        "The field is a list for OpenAI compatibility, but the server reads " +
        "only the first element and silently ignores the rest.",
    );
  }
  if (task === "diarize" && gran[0] === "sentence") {
    fail("timestamp_granularities=['sentence'] is not supported with task='diarize'");
  }

  // --- response_format ------------------------------------------------
  let fmt: string = params.response_format ?? "json";
  if (!RESPONSE_FORMATS.has(fmt)) {
    fail(
      `response_format must be one of ${JSON.stringify([...RESPONSE_FORMATS].sort())}, ` +
        `got ${JSON.stringify(fmt)}`,
    );
  }

  // --- prompt / json_schema -------------------------------------------
  const hasPrompt = params.prompt !== undefined && params.prompt !== null;
  const hasSchema = params.json_schema !== undefined && params.json_schema !== null;

  if (hasSchema && !hasPrompt) {
    fail(
      "json_schema requires prompt. Without a prompt the server ignores " +
        "the schema entirely — no error, no structured output, and the " +
        "request is still billed.",
    );
  }

  if (hasPrompt) {
    // The server force-sets both of these when a prompt is present. Rather
    // than let it silently overwrite what was asked for, refuse. Only an
    // *explicit* value conflicts: the defaults must stay compatible or
    // prompt could never be used at all.
    if (params.response_format !== undefined && fmt !== "verbose_json") {
      fail(
        `prompt cannot be combined with response_format=${JSON.stringify(fmt)}: the ` +
          "server forces verbose_json whenever a prompt is set, so you " +
          `would be charged for a request and not get ${fmt}.`,
      );
    }
    if (params.timestamp_granularities !== undefined && gran[0] !== "segment") {
      fail(
        `prompt cannot be combined with timestamp_granularities=${JSON.stringify(gran)}: ` +
          "the server forces ['segment'] whenever a prompt is set.",
      );
    }
    fmt = "verbose_json";
    gran = ["segment"];
  }

  let schemaStr: string | null = null;
  if (hasSchema) {
    schemaStr = validateJsonSchema(params.json_schema as string | Record<string, unknown>);
  }

  // --- misc ------------------------------------------------------------
  const dic = params.dictionary ?? null;
  if (dic !== null && !DICTIONARIES.has(dic)) {
    fail(
      `dictionary must be one of ${JSON.stringify([...DICTIONARIES].sort())} or null, ` +
        `got ${JSON.stringify(dic)}`,
    );
  }

  // Only two presets are documented (docs.nexara.ru/diarization); an unknown
  // value is a 400. The default "general" is in the set, so checking the
  // resolved value is harmless on the transcribe path.
  const diarSetting = params.diarization_setting ?? "general";
  if (!DIARIZATION_SETTINGS.has(diarSetting)) {
    fail(
      `diarization_setting must be one of ${JSON.stringify([...DIARIZATION_SETTINGS].sort())}, ` +
        `got ${JSON.stringify(diarSetting)}`,
    );
  }

  const lang = params.language ?? null;
  if (lang !== null && !AUTO_LANGUAGE.has(lang) && !LANG_RE.test(lang)) {
    fail(
      `language must be a lowercase ISO-639-1 code (e.g. 'ru', 'en'), ` +
        `'auto', or null for auto-detection — got ${JSON.stringify(lang)}`,
    );
  }

  const nSpeakers = params.num_speakers ?? null;
  if (nSpeakers !== null) {
    if (!Number.isInteger(nSpeakers)) {
      fail(`num_speakers must be an integer, got ${nSpeakers}`);
    }
    if (nSpeakers < 1) {
      fail(`num_speakers must be >= 1, got ${nSpeakers}`);
    }
  }

  const rolesForm =
    params.roles !== undefined && params.roles !== null ? validateRoles(params.roles) : null;

  // --- build form -------------------------------------------------------
  const form: Record<string, unknown> = {
    task,
    response_format: fmt,
    // The key carries the brackets: a field named without them is not seen
    // by the server at all.
    "timestamp_granularities[]": gran,
    profanity_filter: params.profanity_filter ?? false,
    model: params.model ?? "whisper-1",
  };
  if (url !== null) form["url"] = url;
  if (lang !== null) form["language"] = lang;
  if (dic !== null) form["dictionary"] = dic;
  if (hasPrompt) form["prompt"] = params.prompt;
  if (schemaStr !== null) form["json_schema"] = schemaStr;
  if (task === "diarize") {
    form["diarization_setting"] = diarSetting;
    if (nSpeakers !== null) form["num_speakers"] = nSpeakers;
    if (rolesForm !== null) form["roles"] = rolesForm;
  }

  return form;
}

/**
 * Validate `roles` (which turns on role_tagging) and return the wire string.
 *
 * Three modes, mirroring parse_roles_param server-side:
 *   - "auto"             — the LLM invents short labels in the dialogue's language;
 *   - ["client", ...]    — roles are limited to this set (+ "unknown");
 *   - {client: "…"}      — the same, with descriptions handed to the LLM.
 *
 * Arrays/objects are serialized to JSON here — the server field is a single
 * string — exactly as json_schema is. A plain string (e.g. "auto", or a
 * pre-built JSON string) is passed through untouched.
 *
 * The role-count and name/description length limits below are the ones the
 * server documents (docs.nexara.ru/speakers-roles): a 400 otherwise, so we
 * catch it client-side.
 */
function validateRoles(roles: Roles): string {
  if (typeof roles === "string") {
    if (!roles.trim()) {
      fail("roles must be a non-empty string (e.g. 'auto'), an array, or an object");
    }
    return roles;
  }

  if (Array.isArray(roles)) {
    if (roles.length === 0) {
      fail("roles=[] is empty; pass 'auto', a non-empty array, or an object");
    }
    if (roles.length > MAX_ROLES) {
      fail(`roles takes at most ${MAX_ROLES} roles, got ${roles.length}`);
    }
    for (const item of roles) {
      if (typeof item !== "string" || !item.trim()) {
        fail(`roles array entries must be non-empty strings, got ${JSON.stringify(item)}`);
      }
      if (item.length > MAX_ROLE_NAME_LEN) {
        fail(`role name exceeds ${MAX_ROLE_NAME_LEN} chars: ${JSON.stringify(item)}`);
      }
    }
    if (new Set(roles).size !== roles.length) {
      fail(`roles must not contain duplicates, got ${JSON.stringify(roles)}`);
    }
    return JSON.stringify(roles);
  }

  if (typeof roles === "object") {
    const entries = Object.entries(roles);
    if (entries.length === 0) {
      fail("roles={} is empty; pass 'auto', an array, or a non-empty object");
    }
    if (entries.length > MAX_ROLES) {
      fail(`roles takes at most ${MAX_ROLES} roles, got ${entries.length}`);
    }
    for (const [key, value] of entries) {
      if (!key.trim()) {
        fail(`roles object keys must be non-empty strings, got ${JSON.stringify(key)}`);
      }
      if (key.length > MAX_ROLE_NAME_LEN) {
        fail(`role name exceeds ${MAX_ROLE_NAME_LEN} chars: ${JSON.stringify(key)}`);
      }
      if (typeof value !== "string" || !value.trim()) {
        fail(
          `roles[${JSON.stringify(key)}] must be a non-empty string description, ` +
            `got ${JSON.stringify(value)}`,
        );
      }
      if (value.length > MAX_ROLE_DESC_LEN) {
        fail(`role description for ${JSON.stringify(key)} exceeds ${MAX_ROLE_DESC_LEN} chars`);
      }
    }
    return JSON.stringify(roles);
  }

  fail(`roles must be a string, string[], or Record<string, string>, got ${typeof roles}`);
}

/**
 * Check the schema here so a bad one costs nothing.
 *
 * On `develop` the server validates this and returns 400. On the
 * `steaming_billing` branch it does not — the schema reaches Fireworks and
 * fails only *after* a paid transcription. Validating client-side makes the
 * SDK behave the same either way.
 */
function validateJsonSchema(schema: string | Record<string, unknown>): string {
  let parsed: unknown;
  if (typeof schema === "string") {
    try {
      parsed = JSON.parse(schema);
    } catch (exc) {
      throw new NexaraValidationError(`json_schema is not valid JSON: ${exc}`);
    }
  } else if (typeof schema === "object" && schema !== null && !Array.isArray(schema)) {
    parsed = schema;
  } else {
    fail(`json_schema must be an object or a JSON string, got ${typeof schema}`);
  }

  const ajv = new Ajv2020({ strict: false });
  if (!ajv.validateSchema(parsed as object)) {
    const detail = ajv.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    throw new NexaraValidationError(
      `json_schema is not a valid JSON Schema Draft 2020-12: ${detail}`,
    );
  }

  return JSON.stringify(parsed);
}
