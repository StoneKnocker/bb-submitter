import { describe, it, expect } from 'vitest';
import type { SubmissionTracker } from '../src/types.js';
import {
  createEmpty,
  updateEntry,
  getStatus,
  getSummary,
  getPendingSites,
} from '../src/tracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTracker(): SubmissionTracker {
  return createEmpty('test-product');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Submission Tracker (in-memory)', () => {
  it('initializes an empty tracker', () => {
    const tracker = makeTracker();

    expect(tracker.product).toBe('test-product');
    expect(tracker.entries).toHaveLength(0);
    expect(tracker.status_summary).toEqual({
      success: 0,
      failed: 0,
      pending: 0,
      not_started: 0,
    });
    expect(tracker.last_updated).toBeDefined();
  });

  it('updates an entry from not_started to success', () => {
    const tracker = makeTracker();

    updateEntry(tracker, 'site-a', 'success', {
      confirmation_url: 'https://example.com/confirmed',
    });

    expect(tracker.entries).toHaveLength(1);
    expect(tracker.entries[0].site).toBe('site-a');
    expect(tracker.entries[0].status).toBe('success');
    expect(tracker.entries[0].confirmation_url).toBe(
      'https://example.com/confirmed',
    );
    expect(tracker.entries[0].retry_count).toBe(0);
    expect(tracker.entries[0].attempted_at).toBeDefined();
    expect(tracker.status_summary.success).toBe(1);
  });

  it('merges updates to existing entries (retry_count increments)', () => {
    const tracker = makeTracker();

    // First update: create entry
    updateEntry(tracker, 'site-a', 'failed', { error: 'timeout' });
    expect(tracker.entries[0].retry_count).toBe(0);
    expect(tracker.entries[0].error).toBe('timeout');

    // Second update: retry_count should increment
    updateEntry(tracker, 'site-a', 'pending');
    expect(tracker.entries).toHaveLength(1);
    expect(tracker.entries[0].status).toBe('pending');
    expect(tracker.entries[0].retry_count).toBe(1);
    // error field should be cleared? No — update only sets what's passed
    // so the old error remains unless explicitly cleared
    expect(tracker.entries[0].error).toBe('timeout');
    expect(tracker.status_summary.pending).toBe(1);
    expect(tracker.status_summary.failed).toBe(0);
  });

  it('getStatus returns correct status', () => {
    const tracker = makeTracker();

    expect(getStatus(tracker, 'site-unknown')).toBe('not_started');

    updateEntry(tracker, 'site-a', 'success');
    expect(getStatus(tracker, 'site-a')).toBe('success');

    updateEntry(tracker, 'site-b', 'failed');
    expect(getStatus(tracker, 'site-b')).toBe('failed');
  });

  it('getPendingSites returns sites needing submission', () => {
    const tracker = makeTracker();
    const allSites = ['site-a', 'site-b', 'site-c', 'site-d'];

    updateEntry(tracker, 'site-a', 'success');
    updateEntry(tracker, 'site-b', 'failed');
    updateEntry(tracker, 'site-c', 'needs_review');
    // site-d is not_started (not in entries)

    const pending = getPendingSites(tracker, allSites);
    // success and needs_review should be excluded
    expect(pending).not.toContain('site-a');
    expect(pending).not.toContain('site-c');
    // failed and not_started should be included
    expect(pending).toContain('site-b');
    expect(pending).toContain('site-d');
  });

  it('getSummary returns correct counts', () => {
    const tracker = makeTracker();

    updateEntry(tracker, 'site-a', 'success');
    updateEntry(tracker, 'site-b', 'success');
    updateEntry(tracker, 'site-c', 'failed');
    updateEntry(tracker, 'site-d', 'pending');

    const summary = getSummary(tracker);
    expect(summary).toEqual({
      success: 2,
      failed: 1,
      pending: 1,
      not_started: 0,
    });
  });

  it('getPendingSites includes failed and pending sites', () => {
    const tracker = makeTracker();
    const allSites = ['s1', 's2', 's3', 's4'];

    updateEntry(tracker, 's1', 'success');
    updateEntry(tracker, 's2', 'failed');
    updateEntry(tracker, 's3', 'pending');
    // s4 is not_started

    const pending = getPendingSites(tracker, allSites);
    expect(pending).toContain('s2');
    expect(pending).toContain('s3');
    expect(pending).toContain('s4');
    expect(pending).not.toContain('s1');
  });
});
