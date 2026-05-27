import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  getBatchLockPath,
  createBatchLock,
  loadBatchLock,
  updateBatchProgress,
  deleteBatchLock,
  buildSiteQueue,
} from '../src/batcher.js';

// ---------------------------------------------------------------------------
// Setup: isolate all file I/O inside a temporary directory
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync('batcher-test-');
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Batcher (batch-mode + resume)', () => {
  beforeEach(() => {
    // Clean up any leftover lock file between tests
    if (existsSync(getBatchLockPath())) {
      deleteBatchLock();
    }
  });

  // -----------------------------------------------------------------------
  // create / load
  // -----------------------------------------------------------------------

  it('createBatchLock creates and persists a valid lock', () => {
    const lock = createBatchLock('test-product', ['site-a', 'site-b']);

    expect(lock.product).toBe('test-product');
    expect(lock.site_queue).toEqual(['site-a', 'site-b']);
    expect(lock.current_site).toBe('site-a');
    expect(lock.started_at).toBeDefined();
    expect(lock.timeout_minutes).toBeUndefined();

    // File should exist on disk
    expect(existsSync(getBatchLockPath())).toBe(true);

    // Reload and verify
    const reloaded = loadBatchLock();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.product).toBe('test-product');
    expect(reloaded!.site_queue).toEqual(['site-a', 'site-b']);
    expect(reloaded!.current_site).toBe('site-a');
  });

  it('loadBatchLock returns null when no lock file exists', () => {
    expect(loadBatchLock()).toBeNull();
  });

  it('loadBatchLock returns null for corrupted lock file', () => {
    // Write invalid YAML to the lock path
    const dir = dirname(getBatchLockPath());
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(getBatchLockPath(), '{invalid: yaml:', 'utf-8');

    expect(loadBatchLock()).toBeNull();
  });

  // -----------------------------------------------------------------------
  // progress
  // -----------------------------------------------------------------------

  it('updateBatchProgress advances current_site to the next site', () => {
    createBatchLock('test-product', ['site-a', 'site-b', 'site-c']);

    updateBatchProgress('site-a');
    expect(loadBatchLock()!.current_site).toBe('site-b');

    updateBatchProgress('site-b');
    expect(loadBatchLock()!.current_site).toBe('site-c');
  });

  it('updateBatchProgress sets current_site to empty when last site completes', () => {
    createBatchLock('test-product', ['site-a', 'site-b']);

    updateBatchProgress('site-a');
    expect(loadBatchLock()!.current_site).toBe('site-b');

    updateBatchProgress('site-b');
    expect(loadBatchLock()!.current_site).toBe('');
  });

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------

  it('deleteBatchLock removes the lock file from disk', () => {
    createBatchLock('test-product', ['site-a']);

    expect(existsSync(getBatchLockPath())).toBe(true);

    deleteBatchLock();

    expect(existsSync(getBatchLockPath())).toBe(false);
  });

  // -----------------------------------------------------------------------
  // queue
  // -----------------------------------------------------------------------

  it('buildSiteQueue filters out already-successful sites', () => {
    const allSites = ['site-a', 'site-b', 'site-c', 'site-d'];
    const alreadySuccess = ['site-a', 'site-c'];

    const queue = buildSiteQueue(allSites, alreadySuccess);

    expect(queue).toEqual(['site-b', 'site-d']);
  });

  it('buildSiteQueue returns empty when all sites succeeded', () => {
    const allSites = ['site-a', 'site-b'];
    const alreadySuccess = ['site-a', 'site-b'];

    const queue = buildSiteQueue(allSites, alreadySuccess);

    expect(queue).toEqual([]);
  });
});
