import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadMappings, getMapping, setMapping, saveMappings,
  getMappedCategories, setMappingsPath,
} from '../src/category-mapper.js';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const TEST_MAPPINGS_PATH = join(__dirname, '..', 'knowledge', '__test_category-mappings.yaml');

beforeEach(() => {
  mkdirSync(join(__dirname, '..', 'knowledge'), { recursive: true });
  writeFileSync(TEST_MAPPINGS_PATH, yaml.dump({ global_tags: {} }));
  setMappingsPath(TEST_MAPPINGS_PATH);
});

afterEach(() => {
  if (existsSync(TEST_MAPPINGS_PATH)) rmSync(TEST_MAPPINGS_PATH);
});

describe('CategoryMapper', () => {
  it('loads mappings from file', () => {
    const m = loadMappings();
    expect(m.global_tags).toBeDefined();
  });

  it('sets and gets a mapping', () => {
    setMapping('AI', 'test.com', 'artificial-intelligence');
    const value = getMapping('AI', 'test.com');
    expect(value).toBe('artificial-intelligence');
  });

  it('returns null for unknown mapping', () => {
    expect(getMapping('Unknown', 'test.com')).toBeNull();
  });

  it('gets mapped categories for a site', () => {
    setMapping('AI', 'test.com', 'ai-cat');
    setMapping('DevTools', 'test.com', 'dev-cat');
    const cats = getMappedCategories(['AI', 'DevTools'], 'test.com');
    expect(cats).toEqual({ AI: 'ai-cat', DevTools: 'dev-cat' });
  });

  it('omits categories with no mapping', () => {
    setMapping('AI', 'test.com', 'ai-cat');
    const cats = getMappedCategories(['AI', 'Unknown'], 'test.com');
    expect(cats).toEqual({ AI: 'ai-cat' });
  });
});
