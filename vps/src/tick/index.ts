/** Tick entry points: the lock, the two scans, the shared write path, and orchestration. */

export { scanChannel, type ChannelScanOptions } from './channel.js';
export {
  HOT_WINDOW_MS,
  RECHECK_AFTER_MS,
  RECHECK_BUDGET_RESERVE,
  deriveGroupWindow,
  scanGroup,
  type GroupScanOptions,
} from './group.js';
export {
  DEFAULT_LOCK_FILENAME,
  STALE_LOCK_MS,
  acquireTickLock,
  tickLockPath,
  type TickLock,
  type TickLockOptions,
} from './lock.js';
export type { AlertResult } from '../alert/index.js';
export type { RetentionResult } from '../retention/index.js';
export {
  INGEST_ENABLED_KEY,
  LAST_INGEST_AT_KEY,
  LAST_INGEST_SOURCE_KEY,
  runTick,
  type TickOptions,
  type TickResult,
  type TickSourceRun,
} from './tick.js';
export {
  describeFailure,
  emptyScanCounts,
  type ScanCounts,
  type ScanResult,
  type ScanStatus,
} from './types.js';
export {
  clusterableFromListing,
  ingestBatch,
  markListingDeleted,
  messageUrl,
  type BatchCounts,
  type IngestBatchOptions,
} from './write.js';
