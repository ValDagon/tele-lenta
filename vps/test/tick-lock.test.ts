import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  STALE_LOCK_MS,
  acquireTickLock,
  tickLockPath,
} from '../src/tick/lock.js';

const NOW = 1_700_000_000_000;

let directory: string | null = null;

afterEach(() => {
  if (directory !== null) {
    rmSync(directory, { recursive: true, force: true });
    directory = null;
  }
});

function tempDirectory(): string {
  directory = mkdtempSync(join(tmpdir(), 'tele-lenta-lock-'));
  return directory;
}

function writeLock(path: string, record: { pid: number; startedAt: number }): void {
  writeFileSync(path, JSON.stringify(record));
}

describe('tick file lock', () => {
  it('lets one tick hold the lock and refuses the next', () => {
    const dir = tempDirectory();
    const path = join(dir, 'collector.lock');
    const first = acquireTickLock({
      path,
      pid: 101,
      now: () => NOW,
      isProcessAlive: () => true,
    });

    assert.notEqual(first, null);
    assert.equal(first?.pid, 101);
    assert.equal(existsSync(path), true);

    const second = acquireTickLock({
      path,
      pid: 102,
      now: () => NOW,
      isProcessAlive: () => true,
    });
    assert.equal(second, null, 'an overlapping tick must exit immediately');

    first?.release();
    assert.equal(existsSync(path), false);

    const third = acquireTickLock({
      path,
      pid: 103,
      now: () => NOW,
      isProcessAlive: () => true,
    });
    assert.notEqual(third, null);
    third?.release();
  });

  it('creates missing parent directories', () => {
    const dir = tempDirectory();
    const path = join(dir, 'nested', 'data', 'collector.lock');
    const lock = acquireTickLock({ path, pid: 201, now: () => NOW });

    assert.notEqual(lock, null);
    assert.equal(existsSync(path), true);
    lock?.release();
  });

  it('reclaims a lock older than the staleness threshold', () => {
    const dir = tempDirectory();
    const path = join(dir, 'collector.lock');
    writeLock(path, { pid: 301, startedAt: NOW - STALE_LOCK_MS - 1 });

    const lock = acquireTickLock({
      path,
      pid: 302,
      now: () => NOW,
      isProcessAlive: () => true,
    });

    assert.notEqual(lock, null);
    assert.equal(lock?.pid, 302);
    assert.deepEqual(readdirSync(dir), ['collector.lock']);
    lock?.release();
  });

  it('does not reclaim while another contender holds the reclamation guard', () => {
    const dir = tempDirectory();
    const path = join(dir, 'collector.lock');
    writeLock(path, { pid: 351, startedAt: NOW - STALE_LOCK_MS - 1 });
    writeLock(`${path}.reclaim`, { pid: 352, startedAt: NOW });

    const lock = acquireTickLock({
      path,
      pid: 353,
      now: () => NOW,
      isProcessAlive: () => true,
    });

    assert.equal(lock, null);
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(`${path}.reclaim`), true);
  });

  it('reclaims a fresh lock whose PID is dead', () => {
    const dir = tempDirectory();
    const path = join(dir, 'collector.lock');
    writeLock(path, { pid: 401, startedAt: NOW });

    const lock = acquireTickLock({
      path,
      pid: 402,
      now: () => NOW,
      isProcessAlive: () => false,
    });

    assert.notEqual(lock, null);
    lock?.release();
  });

  it('leaves a live foreign lock untouched', () => {
    const dir = tempDirectory();
    const path = join(dir, 'collector.lock');
    const raw = JSON.stringify({ pid: 501, startedAt: NOW });
    writeFileSync(path, raw);

    const lock = acquireTickLock({
      path,
      pid: 502,
      now: () => NOW,
      isProcessAlive: (pid) => pid === 501,
    });

    assert.equal(lock, null);
    assert.equal(readFileSync(path, 'utf8'), raw);
  });

  it('release removes only its own lock', () => {
    const dir = tempDirectory();
    const path = join(dir, 'collector.lock');
    const lock = acquireTickLock({ path, pid: 601, now: () => NOW });

    assert.notEqual(lock, null);
    const foreign = JSON.stringify({ pid: 602, startedAt: NOW });
    writeFileSync(path, foreign);
    lock?.release();

    assert.equal(readFileSync(path, 'utf8'), foreign);
  });

  it('keeps the lock beside the database by default', () => {
    assert.equal(tickLockPath('/var/lib/tele-lenta/tele-lenta.db'), '/var/lib/tele-lenta/collector.lock');
    assert.equal(tickLockPath('tele-lenta.db'), 'collector.lock');
  });
});
