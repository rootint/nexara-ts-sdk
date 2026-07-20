/**
 * Realtime event model.
 *
 * HYPOTHESIS — see resources/realtime.ts. The real service may name these
 * fields differently or split partial/final into separate message types the
 * way Speechmatics does.
 */

export interface RealtimeEvent {
  text: string;

  /**
   * False while the text may still change, true once it is settled.
   *
   * Not to be confused with the `is_final` in the billing contract, which
   * marks the last *charge tick* of a session and has nothing to do with
   * transcripts.
   */
  is_final: boolean;

  start?: number | null;
  end?: number | null;
}
