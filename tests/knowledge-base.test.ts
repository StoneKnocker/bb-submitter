import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadKnowledge, saveKnowledge, saveDraft, loadDraft,
  promoteDraft, listSites, deleteDraft,
} from '../src/knowledge-base.js';
import { rmSync } from 'fs';
import { join } from 'path';
import { SiteKnowledge } from '../src/types.js';

function makeKnowledge(): SiteKnowledge {
  return {
    site: { name: 'Test Site', url: 'https://test.com/submit' },
    auth: { method: 'google_oauth' },
    workflow: {
      steps: [
        { action: 'open', target: 'https://test.com/submit' },
        { action: 'fill', field: 'name', ref: '@1', source: 'product.name' },
      ],
    },
  };
}

beforeEach(() => {
  rmSync(join(__dirname, '..', 'knowledge', 'sites', '__test__'), { recursive: true, force: true });
  rmSync(join(__dirname, '..', 'knowledge', 'sites', '.drafts', '__test__'), { recursive: true, force: true });
});

describe('saveKnowledge / loadKnowledge', () => {
  it('saves and loads site knowledge', () => {
    const k = makeKnowledge();
    saveKnowledge('__test__', k);
    const loaded = loadKnowledge('__test__');
    expect(loaded.site.name).toBe('Test Site');
    expect(loaded.workflow.steps).toHaveLength(2);
  });
});

describe('draft operations', () => {
  it('saves and loads drafts', () => {
    const k = makeKnowledge();
    saveDraft('__test__', k);
    const loaded = loadDraft('__test__');
    expect(loaded).not.toBeNull();
    expect(loaded!.site.name).toBe('Test Site');
  });

  it('promotes draft to full knowledge and deletes draft', () => {
    const k = makeKnowledge();
    saveDraft('__test__', k);
    promoteDraft('__test__');
    expect(loadKnowledge('__test__')).toBeDefined();
    expect(loadDraft('__test__')).toBeNull();
  });

  it('deletes draft', () => {
    saveDraft('__test__', makeKnowledge());
    deleteDraft('__test__');
    expect(loadDraft('__test__')).toBeNull();
  });
});

describe('listSites', () => {
  it('lists all site ids', () => {
    saveKnowledge('__test__', makeKnowledge());
    saveKnowledge('__test__2', makeKnowledge());
    const sites = listSites();
    expect(sites).toContain('__test__');
    expect(sites).toContain('__test__2');
  });
});
