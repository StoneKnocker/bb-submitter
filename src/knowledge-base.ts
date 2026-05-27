import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { SiteKnowledge } from './types.js';

const SITES_DIR = resolve(process.cwd(), 'knowledge', 'sites');
const DRAFTS_DIR = resolve(SITES_DIR, '.drafts');

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function filePath(siteId: string): string {
  return resolve(SITES_DIR, `${siteId}.yaml`);
}

function draftPath(siteId: string): string {
  return resolve(DRAFTS_DIR, `${siteId}.yaml`);
}

export function loadKnowledge(siteId: string): SiteKnowledge {
  const raw = readFileSync(filePath(siteId), 'utf-8');
  return yaml.load(raw) as SiteKnowledge;
}

export function saveKnowledge(siteId: string, data: SiteKnowledge): void {
  ensureDir(SITES_DIR);
  writeFileSync(filePath(siteId), yaml.dump(data, { lineWidth: 120 }), 'utf-8');
}

export function saveDraft(siteId: string, data: SiteKnowledge): void {
  ensureDir(DRAFTS_DIR);
  writeFileSync(draftPath(siteId), yaml.dump(data, { lineWidth: 120 }), 'utf-8');
}

export function loadDraft(siteId: string): SiteKnowledge | null {
  const p = draftPath(siteId);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf-8');
  return yaml.load(raw) as SiteKnowledge;
}

export function deleteDraft(siteId: string): void {
  const p = draftPath(siteId);
  if (existsSync(p)) unlinkSync(p);
}

export function promoteDraft(siteId: string): void {
  const draft = loadDraft(siteId);
  if (!draft) throw new Error(`No draft found for ${siteId}`);
  saveKnowledge(siteId, draft);
  deleteDraft(siteId);
}

export function listSites(): string[] {
  ensureDir(SITES_DIR);
  return readdirSync(SITES_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace('.yaml', ''));
}

export function siteExists(siteId: string): boolean {
  return existsSync(filePath(siteId));
}
