import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { dump, load } from 'js-yaml';
import type { BatchLock } from './types.js';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the batch lock file.
 */
export function getBatchLockPath(): string {
  return resolve(process.cwd(), 'submissions', '.batch-running');
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Persist a batch lock to disk.
 *
 * Creates the `submissions/` directory if it does not exist.
 */
export function saveBatchLock(lock: BatchLock): void {
  const path = getBatchLockPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const yaml = dump(lock, { indent: 2 });
  writeFileSync(path, yaml, 'utf-8');
}

/**
 * Load a batch lock from disk.
 *
 * Returns `null` when:
 * - The lock file does not exist.
 * - The file content is not valid YAML.
 * - Required fields are missing or have the wrong type.
 */
export function loadBatchLock(): BatchLock | null {
  const path = getBatchLockPath();

  if (!existsSync(path)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = load(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.product !== 'string') return null;
  if (!Array.isArray(obj.site_queue)) return null;
  if (typeof obj.current_site !== 'string') return null;

  return obj as unknown as BatchLock;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new batch lock and persist it to disk.
 */
export function createBatchLock(product: string, siteQueue: string[]): BatchLock {
  const lock: BatchLock = {
    product,
    site_queue: siteQueue,
    current_site: siteQueue.length > 0 ? siteQueue[0] : '',
    started_at: new Date().toISOString(),
  };
  saveBatchLock(lock);
  return lock;
}

/**
 * Advance the lock after a site completes.
 *
 * Loads the current lock, locates `completedSite` in the queue, and:
 * - If there are more sites after it: sets `current_site` to the next one.
 * - If it was the last site: sets `current_site` to `''`.
 *
 * Does nothing if the lock file does not exist or `completedSite` is not found.
 */
export function updateBatchProgress(completedSite: string): void {
  const lock = loadBatchLock();
  if (!lock) return;

  const idx = lock.site_queue.indexOf(completedSite);
  if (idx === -1) return;

  if (idx < lock.site_queue.length - 1) {
    lock.current_site = lock.site_queue[idx + 1];
  } else {
    lock.current_site = '';
  }

  saveBatchLock(lock);
}

/**
 * Remove the batch lock file from disk, if it exists.
 */
export function deleteBatchLock(): void {
  const path = getBatchLockPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

// ---------------------------------------------------------------------------
// Queue helpers
// ---------------------------------------------------------------------------

/**
 * Build the remaining site queue by filtering out already-successful sites.
 */
export function buildSiteQueue(
  allSites: string[],
  alreadySuccess: string[],
): string[] {
  const excluded = new Set(alreadySuccess);
  return allSites.filter((site) => !excluded.has(site));
}
