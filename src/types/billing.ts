/** Response models for the billing endpoints. */

/**
 * Fixed per account by the account's location (RU -> RUB, rest of world -> EUR).
 *
 * Not a per-request choice and not settable from the API: it follows the
 * `location` on the account, so every number in these types is in the same
 * currency.
 */
export type Currency = "RUB" | "EUR";

/** Result of `billing.balance()`. */
export interface Balance {
  /**
   * What is left on the account. Can be negative: the server allows an
   * overdraft (a per-account limit) before it starts refusing requests, so a
   * balance at or below zero does not by itself mean the next call fails.
   */
  balance: number;
  /**
   * Price of one minute of transcription for *this* account — pricing is
   * per-account, not a public list price.
   *
   * The server stores a per-second price and multiplies by 60 for this field.
   * It covers plain transcription only: `profanity_filter`, `roles`
   * (role_tagging), `emotions` and `prompt` (LLM) each add a surcharge not
   * reflected here.
   */
  rate_per_min: number;
  currency: Currency;
}

/** Which key made the call. */
export interface UsageApiKey {
  id: number;
  /** Never empty: the server substitutes "Key #<id>" for an unnamed key. */
  name: string;
  /**
   * True if the key has since been (soft-)deleted. Calls made with a deleted
   * key stay in the history — that is why this flag exists instead of the row
   * simply disappearing.
   */
  deleted: boolean;
}

/** One billed request. */
export interface UsageItem {
  /** ISO-8601, as the server sends it. */
  timestamp: string;
  /** Audio duration billed for this call. */
  seconds: number;
  bytes: number;
  task: string;
  model: string | null;
  language: string | null;
  /**
   * What this call was charged, in the page's `currency`.
   *
   * null for rows written before per-request costs were recorded — not zero.
   * Treat null as "unknown", not "free".
   */
  cost: number | null;
  /** All three are billed as surcharges on top of the per-minute rate. */
  profanity_filter: boolean;
  role_tagging: boolean;
  /**
   * Whether emotion recognition *produced* output, not merely whether it was
   * asked for: a call that requested it and got nothing back is not charged for
   * it, and shows false here.
   */
  emotions: boolean;
  /** Set only when the call carried a `prompt`. Already folded into `cost`. */
  llm_input_tokens: number | null;
  llm_output_tokens: number | null;
  /**
   * Matches the `request_id` in the server logs — quote it in support requests
   * about a specific call.
   */
  request_id: string | null;
  api_key: UsageApiKey;
}

/** One keyset-paginated page of billed requests, newest first. */
export interface UsagePage {
  items: UsageItem[];
  /**
   * Pass as `cursor` to fetch the next (older) page. Set only when `hasMore`
   * is true.
   */
  next_cursor: number | null;
  has_more: boolean;
  /** null only for an account with no wallet yet, which also has no items. */
  currency: Currency | null;
}
