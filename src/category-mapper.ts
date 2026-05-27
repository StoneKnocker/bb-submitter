import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { CategoryMappings } from './types.js';

const DEFAULT_PATH = resolve(process.cwd(), 'knowledge', 'category-mappings.yaml');

let _path = DEFAULT_PATH;
let _cache: CategoryMappings | null = null;

export function setMappingsPath(path: string): void {
  _path = path;
  _cache = null;
}

export function loadMappings(): CategoryMappings {
  if (_cache) return _cache;
  ensureFile();
  const raw = readFileSync(_path, 'utf-8');
  _cache = yaml.load(raw) as CategoryMappings;
  return _cache!;
}

export function saveMappings(): void {
  if (!_cache) return;
  const dir = resolve(_path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(_path, yaml.dump(_cache, { lineWidth: 120 }), 'utf-8');
}

export function getMapping(tag: string, siteId: string): string | null {
  const m = loadMappings();
  return m.global_tags[tag]?.[siteId] ?? null;
}

export function setMapping(tag: string, siteId: string, siteCategory: string): void {
  const m = loadMappings();
  if (!m.global_tags[tag]) m.global_tags[tag] = {};
  m.global_tags[tag][siteId] = siteCategory;
}

export function getMappedCategories(tags: string[], siteId: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const tag of tags) {
    const mapped = getMapping(tag, siteId);
    if (mapped) result[tag] = mapped;
  }
  return result;
}

function ensureFile(): void {
  const dir = resolve(_path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(_path)) {
    writeFileSync(_path, 'global_tags: {}\n', 'utf-8');
  }
}
