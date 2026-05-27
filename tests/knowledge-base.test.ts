import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadKnowledge, saveKnowledge, saveDraft, loadDraft,
  promoteDraft, listSites, deleteDraft,
  validateKnowledgeStructure,
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

describe('validateKnowledgeStructure', () => {
  it('returns valid for complete knowledge', () => {
    const result = validateKnowledgeStructure(makeKnowledge());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for missing site field', () => {
    const k = { workflow: { steps: [] } } as any;
    const result = validateKnowledgeStructure(k);
    expect(result.valid).toBe(false);
  });

  it('returns errors for step with invalid action', () => {
    const k = makeKnowledge();
    k.workflow.steps.push({ action: 'invalid_action' as any });
    const result = validateKnowledgeStructure(k);
    expect(result.valid).toBe(false);
  });

  it('checks fill step has source or value', () => {
    const k = makeKnowledge();
    k.workflow.steps = [{ action: 'fill', field: 'name' } as any];
    const result = validateKnowledgeStructure(k);
    expect(result.valid).toBe(false);
  });
});
