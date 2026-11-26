/**
 * Exclusive file lock for the minute tick.
 *
 * The worker entry point calls `acquireTickLock` before doing any work. The
 * first tick creates the lock file exclusively; an overlapping tick gets `null`
 * and exits immediately, so a slow tick delays the next one instead of
 * overlapping it.
 *
 * The lock holds the writer's PID and start time. It is stale when the PID is
 * gone, or when it is older than `STALE_LOCK_MS` (ten minutes), which covers
 * PID reuse and a lock left behind on another host. Reclamation happens under
 * an exclusive guard file, and the lock is inspected again while the guard is
 * held, so two contenders cannot both believe they removed the same file.
 * `release()` deletes the file only when it still carries this holder's PID
 * and start time.
 *
 * Synchronous `node:fs` throughout: acquisition is a few operations at process
 * start, and a synchronous API keeps the race handling readable.
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** A lock older than this is reclaimed even when its PID still exists. */
export const STALE_LOCK_MS = 10 * 60 * 1_000;

/** Default lock file name, placed next to the SQLite database. */
export const DEFAULT_LOCK_FILENAME = 'collector.lock';

export interface TickLockOptions {
  /** Absolute or relative path to the lock file. */
  readonly path: string;
  /** Defaults to the current process; injectable for tests. */
  readonly pid?: number;
  /** Defaults to `Date.now`; injectable so staleness is testable. */
  readonly now?: () => number;
  /** Defaults to `STALE_LOCK_MS`. */
  readonly staleAfterMs?: number;
  /** Defaults to a `process.kill(pid, 0)` probe; injectable for tests. */
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface TickLock {
  readonly path: string;
  readonly pid: number;
  readonly startedAt: number;
  /** Removes the file only when it is still this holder's lock. */
  release(): void;
}

interface LockRecord {
  readonly pid: number;
  readonly startedAt: number;
}

/** `collector.lock` beside the database, e.g. `./data/tele-lenta.db` → `./data/collector.lock`. */
export function tickLockPath(databasePath: string): string {
  return join(dirname(databasePath), DEFAULT_LOCK_FILENAME);
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function parseRecord(raw: string): LockRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const { pid, startedAt } = parsed as { pid?: unknown; startedAt?: unknown };
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
      return null;
    }
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
      return null;
    }
    return { pid, startedAt };
  } catch {
    return null;
  }
}

type Inspection =
  | { readonly kind: 'free' }
  | { readonly kind: 'held' }
  | { readonly kind: 'stale' };

function inspectLock(
  path: string,
  now: number,
  staleAfterMs: number,
  isProcessAlive: (pid: number) => boolean,
): Inspection {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = readFileSync(path, 'utf8');
    mtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return { kind: 'free' };
    }
    // Unreadable for another reason: treat as held rather than stomping it.
    return { kind: 'held' };
  }

  const record = parseRecord(raw);
  if (record !== null) {
    if (!isProcessAlive(record.pid)) {
      return { kind: 'stale' };
    }
    return now - record.startedAt > staleAfterMs ? { kind: 'stale' } : { kind: 'held' };
  }

  // A corrupt file has no PID to probe, so only its mtime can expire it.
  return Date.now() - mtimeMs > staleAfterMs ? { kind: 'stale' } : { kind: 'held' };
}

/** A reclaimer only holds the guard for a few filesystem calls. */
const RECLAIM_GUARD_STALE_MS = 30_000;

const RECLAIM_GUARD_SUFFIX = '.reclaim';

/**
 * Open the reclamation guard, or return null when another live contender holds
 * it. A guard left by a crashed process is stale by the same rule as the lock.
 */
function openReclaimGuard(
  guardPath: string,
  now: number,
  isProcessAlive: (pid: number) => boolean,
): number | null {
  try {
    return openSync(guardPath, 'wx');
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) {
      throw error;
    }
  }

  const state = inspectLock(guardPath, now, RECLAIM_GUARD_STALE_MS, isProcessAlive);
  if (state.kind === 'held') {
    return null;
  }
  try {
    unlinkSync(guardPath);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) {
      return null;
    }
  }
  try {
    return openSync(guardPath, 'wx');
  } catch {
    return null;
  }
}

type ReclaimResult = 'reclaimed' | 'retry' | 'busy';

/**
 * Reclaim a stale lock under an exclusive guard.
 *
 * The guard makes the decision safe: the lock is inspected again *after* the
 * guard is held, so a contender that inspected a stale file earlier cannot
 * delete a fresh lock that another tick created in the meantime. Without the
 * re-inspection, two reclaimers could each believe they removed the same stale
 * file and then both hold a lock.
 */
function reclaimLock(
  path: string,
  pid: number,
  now: number,
  staleAfterMs: number,
  isProcessAlive: (pid: number) => boolean,
): ReclaimResult {
  const guardPath = `${path}${RECLAIM_GUARD_SUFFIX}`;
  const guardFd = openReclaimGuard(guardPath, now, isProcessAlive);
  if (guardFd === null) {
    return 'busy';
  }

  try {
    try {
      writeSync(guardFd, JSON.stringify({ pid, startedAt: now }));
    } finally {
      closeSync(guardFd);
    }

    const current = inspectLock(path, now, staleAfterMs, isProcessAlive);
    if (current.kind === 'held') {
      return 'busy';
    }
    if (current.kind === 'free') {
      return 'retry';
    }

    try {
      unlinkSync(path);
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        return 'busy';
      }
    }
    return 'reclaimed';
  } finally {
    try {
      unlinkSync(guardPath);
    } catch {
      // Another attempt will see the guard's mtime or a dead PID and clear it.
    }
  }
}

/**
 * Try to take the tick lock. Returns `null` when another live tick holds it,
 * so the caller exits without doing any work.
 */
export function acquireTickLock(options: TickLockOptions): TickLock | null {
  const path = options.path;
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now;
  const staleAfterMs = options.staleAfterMs ?? STALE_LOCK_MS;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;

  mkdirSync(dirname(path), { recursive: true });

  for (let round = 0; round < 3; round += 1) {
    const startedAt = now();
    let created = false;
    try {
      const fd = openSync(path, 'wx');
      created = true;
      try {
        writeSync(fd, JSON.stringify({ pid, startedAt }));
      } finally {
        closeSync(fd);
      }
      return makeLock(path, pid, startedAt);
    } catch (error) {
      if (created) {
        // The file is ours but half-written; do not leave it behind as a lock.
        try {
          unlinkSync(path);
        } catch {
          // Fall through to the original error.
        }
      }
      if (!isErrno(error, 'EEXIST')) {
        throw error;
      }
    }

    const inspection = inspectLock(path, now(), staleAfterMs, isProcessAlive);
    if (inspection.kind === 'free') {
      continue;
    }
    if (inspection.kind === 'held') {
      return null;
    }

    const reclaimed = reclaimLock(path, pid, now(), staleAfterMs, isProcessAlive);
    if (reclaimed === 'busy') {
      return null;
    }
    // 'reclaimed' and 'retry' both attempt the exclusive create again.
  }

  return null;
}

function makeLock(path: string, pid: number, startedAt: number): TickLock {
  let released = false;
  return {
    path,
    pid,
    startedAt,
    release(): void {
      if (released) {
        return;
      }
      released = true;

      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        return;
      }
      const record = parseRecord(raw);
      if (record === null || record.pid !== pid || record.startedAt !== startedAt) {
        // Someone else's lock (or a reclaimed one): leave it alone.
        return;
      }
      try {
        unlinkSync(path);
      } catch {
        // Already gone; nothing to release.
      }
    },
  };
}
