import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { dump, load } from 'js-yaml';
import type {
  SubmissionTracker,
  SubmissionEntry,
  SubmissionStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the on-disk path for a product's submission YAML.
 */
function trackerPath(productId: string): string {
  return resolve(process.cwd(), 'submissions', `${productId}.yaml`);
}

/**
 * Recompute `status_summary` from the current entries array.
 * `needs_review` entries are not counted in the summary.
 */
function recomputeSummary(tracker: SubmissionTracker): void {
  const summary = { success: 0, failed: 0, pending: 0, not_started: 0 };
  for (const entry of tracker.entries) {
    switch (entry.status) {
      case 'success':
        summary.success++;
        break;
      case 'failed':
        summary.failed++;
        break;
      case 'pending':
        summary.pending++;
        break;
      case 'not_started':
        summary.not_started++;
        break;
      // 'needs_review' intentionally omitted — no bucket in status_summary
    }
  }
  tracker.status_summary = summary;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new empty tracker for the given product.
 */
export function createEmpty(productId: string): SubmissionTracker {
  return {
    product: productId,
    last_updated: new Date().toISOString(),
    entries: [],
    status_summary: { success: 0, failed: 0, pending: 0, not_started: 0 },
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load a tracker from disk (`submissions/<productId>.yaml`).
 *
 * Returns a fresh empty tracker when the file does not exist.
 */
export function loadTracker(productId: string): SubmissionTracker {
  const path = trackerPath(productId);
  if (!existsSync(path)) {
    return createEmpty(productId);
  }
  const raw = readFileSync(path, 'utf-8');
  return load(raw) as SubmissionTracker;
}

/**
 * Persist a tracker to disk.
 *
 * Creates the `submissions/` directory if it does not exist.
 * Always updates `tracker.last_updated` before writing.
 */
export function saveTracker(tracker: SubmissionTracker): void {
  const path = trackerPath(tracker.product);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  tracker.last_updated = new Date().toISOString();
  const yaml = dump(tracker, { indent: 2 });
  writeFileSync(path, yaml, 'utf-8');
}

// ---------------------------------------------------------------------------
// In-memory operations
// ---------------------------------------------------------------------------

/**
 * Update (or create) a submission entry for a site.
 *
 * - If an entry already exists for `siteId`: updates its status, sets
 *   `attempted_at` to now, increments `retry_count`, and merges any
 *   optional fields from `extra`.
 * - If no entry exists: pushes a new `SubmissionEntry`.
 *
 * The tracker's `status_summary` is recomputed after every update.
 */
export function updateEntry(
  tracker: SubmissionTracker,
  siteId: string,
  status: SubmissionStatus,
  extra?: Partial<
    Pick<SubmissionEntry, 'confirmation_url' | 'error' | 'reason' | 'submitted_at'>
  >,
): void {
  const existing = tracker.entries.find((e) => e.site === siteId);

  if (existing) {
    existing.status = status;
    existing.attempted_at = new Date().toISOString();
    existing.retry_count = (existing.retry_count ?? 0) + 1;

    if (extra) {
      if (extra.confirmation_url !== undefined) {
        existing.confirmation_url = extra.confirmation_url;
      }
      if (extra.error !== undefined) {
        existing.error = extra.error;
      }
      if (extra.reason !== undefined) {
        existing.reason = extra.reason;
      }
      if (extra.submitted_at !== undefined) {
        existing.submitted_at = extra.submitted_at;
      }
    }
  } else {
    const entry: SubmissionEntry = {
      site: siteId,
      status,
      attempted_at: new Date().toISOString(),
      retry_count: 0,
      ...extra,
    };
    tracker.entries.push(entry);
  }

  recomputeSummary(tracker);
}

/**
 * Return the current status for a site.
 *
 * Returns `'not_started'` when the site has no entry in the tracker.
 */
export function getStatus(
  tracker: SubmissionTracker,
  siteId: string,
): SubmissionStatus {
  const entry = tracker.entries.find((e) => e.site === siteId);
  return entry ? entry.status : 'not_started';
}

/**
 * Return a copy of the tracker's status summary.
 */
export function getSummary(
  tracker: SubmissionTracker,
): { success: number; failed: number; pending: number; not_started: number } {
  return { ...tracker.status_summary };
}

/**
 * Return the subset of `allSites` that still need processing.
 *
 * Excludes sites with status `'success'` or `'needs_review'`.
 */
export function getPendingSites(
  tracker: SubmissionTracker,
  allSites: string[],
): string[] {
  const excluded = new Set<SubmissionStatus>(['success', 'needs_review']);
  return allSites.filter((site) => !excluded.has(getStatus(tracker, site)));
}
