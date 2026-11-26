/**
 * Result shapes shared by the two scan paths and the tick orchestration.
 *
 * A scan never throws for an ordinary network or markup problem: it returns
 * `status: 'failed'` with an `errorSample`, and the tick records that as one
 * source's `ingest_runs` row while the other sources keep running.
 */

export interface ScanCounts {
  /** Parsed messages the run saw, before album collapse. */
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Transport attempts the polite client made for this source. */
  requests: number;
}

export type ScanStatus = 'ok' | 'failed';

export interface ScanResult {
  status: ScanStatus;
  counts: ScanCounts;
  cursorBefore: number | null;
  cursorAfter: number | null;
  /** The first infrastructure or markup failure, short and log-safe. */
  errorSample: string | null;
}

export function emptyScanCounts(): ScanCounts {
  return { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0, requests: 0 };
}

/** A short, log-safe description of a polite-client failure (no HTML, no body). */
export function describeFailure(failure: {
  readonly outcome: string;
  readonly status?: number;
}): string {
  return failure.status === undefined ? failure.outcome : `${failure.outcome} ${failure.status}`;
}
