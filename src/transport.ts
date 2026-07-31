/**
 * The transport seam.
 *
 * Everything above this line (resources, validation, models) is the real SDK.
 * Below it sit the production fetch transport (`http.ts`) and the in-memory
 * mock (`mock/`). The point of the seam is that swapping them changes no
 * public API — which also means validation runs for real even on the mock.
 */

/**
 * What `file` may be by the time it reaches a transport. Paths (string) are
 * opened by the transport itself, so uploads stream from disk instead of
 * being loaded into memory first.
 */
export type FileInput = string | Uint8Array | Blob;

export interface TransportResponse {
  status_code: number;
  /** Parsed JSON for json-ish formats, a string for text/srt/vtt. */
  body: unknown;
}

export interface RequestOptions {
  /** Multipart body of a POST. */
  form?: Record<string, unknown>;
  file?: FileInput | null;
  /** Query string of a GET — only the billing usage endpoint takes one. */
  query?: Record<string, string | number | boolean>;
}

/** The only thing that touches the network — or pretends to. */
export interface Transport {
  request(method: string, path: string, options?: RequestOptions): Promise<TransportResponse>;
}
