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

const VALID_ACTIONS = new Set([
  'open', 'click', 'fill', 'upload', 'select', 'select_category',
  'check', 'uncheck', 'press', 'wait', 'verify', 'eval', 'record_result',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateKnowledgeStructure(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data.site?.name) errors.push('Missing site.name');
  if (!data.site?.url) errors.push('Missing site.url');
  if (!data.auth?.method) errors.push('Missing auth.method');
  if (!data.workflow?.steps?.length) errors.push('workflow.steps must be non-empty array');

  data.workflow?.steps?.forEach((step: any, i: number) => {
    if (!step.action || !VALID_ACTIONS.has(step.action)) {
      errors.push(`Step ${i}: invalid or missing action '${step.action}'`);
    }
    if (step.action === 'fill' && !step.source && !step.value) {
      errors.push(`Step ${i}: fill action requires 'source' or 'value'`);
    }
    if (step.action === 'upload' && !step.source) {
      errors.push(`Step ${i}: upload action requires 'source'`);
    }
    if (step.action === 'open' && !step.target) {
      errors.push(`Step ${i}: open action requires 'target'`);
    }
  });

  return { valid: errors.length === 0, errors };
}
