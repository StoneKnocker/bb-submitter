# bb-submitter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool + library that automates submitting web products to 100+ navigation sites, with Teaching Mode (learn form structure) and Replay Mode (auto-fill from knowledge).

**Architecture:** TypeScript library handles all deterministic operations (YAML I/O, bb-browser command execution, dual-match ref resolution with semantic fallback, tracker). Claude Code Agent handles intelligent parts (form semantic analysis, field mapping inference, exception judgment). The CLI is a thin orchestration layer; teach/submit/batch flows are driven by Claude invoking the library + bb-browser.

**Tech Stack:** TypeScript, Node.js, YAML (js-yaml), bb-browser CLI, Commander.js (CLI parsing)

**Spec:** `docs/superpowers/specs/2026-05-27-bb-submitter-design.md`

**IMPORTANT implementation notes:**
- `__dirname` is not available in ESM (`"module": "NodeNext"`). Vitest transforms it at test time, but for any non-test usage, use `import.meta.url` with `fileURLToPath`. Tests can safely use `__dirname` since vitest handles the transform.
- Before each element interaction in executor, take a fresh snapshot and resolve the ref via `matchRef()` (dual-match: direct index → semantic CSS fallback → Agent intervention).
- Upload file paths in site knowledge (e.g., `source: "product.logo-256x256.png"`) must be resolved to actual filesystem paths: `products/<id>/logo-256x256.png`.
- All network-failing steps must be retried 3 times with delays (5s/10s/30s) before giving up.

---

## File Structure

```
bb-submitter/
├── src/
│   ├── types.ts              # All shared TypeScript interfaces
│   ├── product-store.ts      # Product YAML loading/validation
│   ├── knowledge-base.ts     # Site knowledge YAML CRUD + validation
│   ├── category-mapper.ts    # Category mapping queries + update
│   ├── bb-browser.ts         # bb-browser CLI wrapper (spawn commands)
│   ├── ref-utils.ts          # Ref matching, semantic selector generation
│   ├── executor.ts           # Deterministic workflow step executor
│   ├── hitl.ts               # Human-in-the-loop pause protocol
│   ├── tracker.ts            # Submission tracker read/write
│   ├── batcher.ts            # Batch mode with resume + lock file
│   └── cli.ts                # CLI entry (Commander.js)
├── knowledge/
│   ├── sites/                # *.yaml site knowledge files
│   ├── sites/.drafts/        # Teaching drafts
│   └── category-mappings.yaml
├── products/                 # Product data
├── submissions/              # Submission tracker YAML files
├── tests/
│   ├── product-store.test.ts
│   ├── knowledge-base.test.ts
│   ├── category-mapper.test.ts
│   ├── ref-utils.test.ts
│   ├── executor.test.ts
│   ├── tracker.test.ts
│   └── batcher.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Chunk 1: Project Scaffold + Types + Product Store

### Task 1.1: Initialize project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```bash
cd /home/stoneknocker/code/bb-submitter
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install js-yaml commander zod
npm install -D typescript vitest @types/node @types/js-yaml
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit
```
Expected: no errors (no source files yet)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: init project with TypeScript and Vitest"
```

### Task 1.2: Define shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write types**

```typescript
// Product types

export interface ProductData {
  name: string;
  tagline: string;
  description: Record<string, string>; // key = lang code or 'short'/'full'
  url: string;
  category_tags: string[];
  tech_stack?: string[];
  social?: Record<string, string>;
  launch_date?: string;
  pricing?: {
    model: string;
    starting_price?: string;
  };
  contact_email: string;
  // Extension fields site knowledge can reference
  [key: string]: unknown;
}

// Site knowledge types

export type AuthMethod = 'google_oauth' | 'github' | 'email_password' | 'none';

export type StepAction =
  | 'open'
  | 'click'
  | 'fill'
  | 'upload'
  | 'select'
  | 'select_category'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'wait'
  | 'verify'
  | 'eval'
  | 'record_result';

export interface WorkflowStep {
  action: StepAction;
  // Common optional
  ref?: string;
  semantic?: string;
  field?: string;
  source?: string;
  target?: string;
  value?: string;
  wait?: number;             // ms
  wait_for?: string;         // ref pattern
  human_intervention?: string; // reason text
  verify?: string;           // ref pattern to verify
  mapping?: Record<string, string>; // for select_category
  multi?: boolean;           // for upload, multi-file
  max?: number;              // for upload, max count
}

export interface SiteAuth {
  method: AuthMethod;
}

export interface SiteMeta {
  name: string;
  url: string;
}

export interface SiteKnowledge {
  site: SiteMeta;
  auth: SiteAuth;
  workflow: {
    steps: WorkflowStep[];
  };
  known_quirks?: string[];
  last_validated?: string;
}

// Submission tracker types

export type SubmissionStatus =
  | 'success'
  | 'failed'
  | 'pending'
  | 'not_started'
  | 'needs_review';

export interface SubmissionEntry {
  site: string;
  status: SubmissionStatus;
  confirmation_url?: string;
  error?: string;
  reason?: string;
  submitted_at?: string;
  attempted_at?: string;
  retry_count?: number;
}

export interface SubmissionTracker {
  product: string;
  last_updated: string;
  entries: SubmissionEntry[];
  status_summary: {
    success: number;
    failed: number;
    pending: number;
    not_started: number;
  };
}

// Batch lock file

export interface BatchLock {
  product: string;
  site_queue: string[];
  current_site: string;
  started_at: string;
  timeout_minutes?: number;
}

// Category mappings

export interface CategoryMappings {
  global_tags: Record<string, Record<string, string>>;
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared TypeScript interfaces"
```

### Task 1.3: Product Store

**Files:**
- Create: `src/product-store.ts`
- Create: `tests/product-store.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/product-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadProduct, validateProduct } from '../src/product-store.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, '..', 'products', '__test__');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('loadProduct', () => {
  it('loads and parses a valid product.yaml', () => {
    const yaml = `
name: Test App
tagline: A test
description:
  short: Short desc
  full: Full desc
url: https://test.com
category_tags:
  - AI
contact_email: test@test.com
`;
    writeFileSync(join(TEST_DIR, 'product.yaml'), yaml);

    const product = loadProduct('__test__');
    expect(product.name).toBe('Test App');
    expect(product.description.short).toBe('Short desc');
    expect(product.category_tags).toEqual(['AI']);
  });

  it('throws on missing required fields', () => {
    const yaml = `name: Incomplete`;
    writeFileSync(join(TEST_DIR, 'product.yaml'), yaml);

    expect(() => validateProduct({ name: 'Incomplete' } as any)).toThrow();
  });
});

describe('validateProduct', () => {
  it('passes for a complete product', () => {
    const product = {
      name: 'Valid',
      tagline: 'x',
      description: { short: 's' },
      url: 'https://x.com',
      category_tags: ['AI'],
      contact_email: 'x@x.com',
    };
    expect(() => validateProduct(product)).not.toThrow();
  });

  it('fails when name is missing', () => {
    expect(() => validateProduct({} as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run tests/product-store.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement product-store.ts**

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { ProductData } from './types.js';

const PRODUCTS_DIR = resolve(process.cwd(), 'products');

export function loadProduct(productId: string): ProductData {
  const filePath = resolve(PRODUCTS_DIR, productId, 'product.yaml');
  const raw = readFileSync(filePath, 'utf-8');
  const data = yaml.load(raw) as ProductData;
  validateProduct(data);
  return data;
}

export function validateProduct(data: ProductData): void {
  const required = ['name', 'tagline', 'description', 'url', 'category_tags', 'contact_email'];
  for (const field of required) {
    if (!(field in data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  if (!data.description.short && !data.description.full) {
    throw new Error('description must have at least "short" or "full"');
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/product-store.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/product-store.ts tests/product-store.test.ts
git commit -m "feat: add product store - load and validate product.yaml"
```

---

## Chunk 2: Knowledge Base + Category Mapper

### Task 2.1: Knowledge Base CRUD

**Files:**
- Create: `src/knowledge-base.ts`
- Create: `tests/knowledge-base.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/knowledge-base.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadKnowledge,
  saveKnowledge,
  saveDraft,
  loadDraft,
  promoteDraft,
  listSites,
  deleteDraft,
} from '../src/knowledge-base.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { SiteKnowledge } from '../src/types.js';

const TEST_KNOWLEDGE_DIR = join(__dirname, '..', 'knowledge', 'sites', '__test__');
const TEST_DRAFT_DIR = join(__dirname, '..', 'knowledge', 'sites', '.drafts', '__test__');

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
  // clean up test data
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
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/knowledge-base.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement knowledge-base.ts**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { resolve, dirname } from 'path';
import * as yaml from 'js-yaml';
import { SiteKnowledge } from './types.js';

const SITES_DIR = resolve(process.cwd(), 'knowledge', 'sites');
const DRAFTS_DIR = resolve(SITES_DIR, '.drafts');

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
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
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/knowledge-base.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/knowledge-base.ts tests/knowledge-base.test.ts
git commit -m "feat: add knowledge base CRUD with draft support"
```

### Task 2.2: Knowledge Validator

**Files:**
- Modify: `src/knowledge-base.ts` (add validateKnowledge function)
- Modify: `tests/knowledge-base.test.ts` (add validate tests)

- [ ] **Step 1: Write test for validation logic**

In `tests/knowledge-base.test.ts`, add:

```typescript
import { validateKnowledgeStructure } from '../src/knowledge-base.js';

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

  it('checks fill step has source', () => {
    const k = makeKnowledge();
    k.workflow.steps = [{ action: 'fill', field: 'name' } as any];
    const result = validateKnowledgeStructure(k);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Add validateKnowledgeStructure to knowledge-base.ts**

```typescript
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
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/knowledge-base.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/knowledge-base.ts tests/knowledge-base.test.ts
git commit -m "feat: add knowledge structure validation"
```

### Task 2.3: Category Mapper

**Files:**
- Create: `src/category-mapper.ts`
- Create: `tests/category-mapper.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/category-mapper.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadMappings,
  getMapping,
  setMapping,
  saveMappings,
  getMappedCategories,
  setMappingsPath,
} from '../src/category-mapper.js';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const TEST_MAPPINGS_PATH = join(__dirname, '..', 'knowledge', '__test_category-mappings.yaml');

beforeEach(() => {
  mkdirSync(join(__dirname, '..', 'knowledge'), { recursive: true });
  writeFileSync(TEST_MAPPINGS_PATH, yaml.dump({ global_tags: {} }));
  // Point category mapper to test file
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
```

Note: test uses a test-specific file path. Need to make `category-mapper.ts` accept an optional path override for testing.

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/category-mapper.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement category-mapper.ts**

```typescript
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

export function getMappedCategories(
  tags: string[],
  siteId: string
): Record<string, string> {
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
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/category-mapper.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/category-mapper.ts tests/category-mapper.test.ts
git commit -m "feat: add category mapper with load/save/get/set"
```

---

## Chunk 3: bb-browser Wrapper + Ref Utilities

### Task 3.1: bb-browser CLI Wrapper

**Files:**
- Create: `src/bb-browser.ts`

- [ ] **Step 1: Implement wrapper**

```typescript
import { execSync } from 'child_process';

export interface BbBrowserResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const BIN = 'bb-browser';

function run(args: string[], timeoutMs = 30000): BbBrowserResult {
  const cmd = [BIN, ...args].join(' ');
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (e: any) {
    return {
      ok: false,
      stdout: e.stdout?.trim() || '',
      stderr: e.stderr?.trim() || e.message || '',
    };
  }
}

// Navigation
export function bbOpen(url: string, tab?: string): BbBrowserResult {
  const args = ['open', url];
  if (tab) args.push('--tab', tab);
  return run(args);
}

export function bbClose(): BbBrowserResult {
  return run(['close']);
}

// Snapshot
export function bbSnapshot(options?: { interactive?: boolean; compact?: boolean }): BbBrowserResult {
  const args = ['snapshot'];
  if (options?.interactive !== false) args.push('-i');
  if (options?.compact) args.push('-c');
  return run(args);
}

// Element interaction
export function bbClick(ref: string): BbBrowserResult {
  return run(['click', ref]);
}

export function bbFill(ref: string, text: string): BbBrowserResult {
  return run(['fill', ref, text]);
}

export function bbUpload(ref: string, filePath: string): BbBrowserResult {
  return run(['upload', ref, filePath]);
}

export function bbSelect(ref: string, option: string): BbBrowserResult {
  return run(['select', ref, option]);
}

export function bbCheck(ref: string): BbBrowserResult {
  return run(['check', ref]);
}

export function bbUncheck(ref: string): BbBrowserResult {
  return run(['uncheck', ref]);
}

export function bbPress(key: string): BbBrowserResult {
  return run(['press', key]);
}

// Info
export function bbGet(info: string, ref?: string): BbBrowserResult {
  const args = ['get', info];
  if (ref) args.push(ref);
  return run(args);
}

export function bbEval(js: string): BbBrowserResult {
  return run(['eval', js]);
}

export function bbScreenshot(path?: string): BbBrowserResult {
  const args = ['screenshot'];
  if (path) args.push(path);
  return run(args);
}

// Utility
export function bbWait(target: string | number): BbBrowserResult {
  return run(['wait', String(target)]);
}

export function bbDaemonStart(): BbBrowserResult {
  return run(['daemon', 'start']);
}

export function bbDaemonStatus(): BbBrowserResult {
  return run(['daemon', 'status']);
}

export function bbDaemonStop(): BbBrowserResult {
  return run(['daemon', 'stop']);
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/bb-browser.ts
git commit -m "feat: add bb-browser CLI wrapper functions"
```

### Task 3.2: Ref Utilities

**Files:**
- Create: `src/ref-utils.ts`
- Create: `tests/ref-utils.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/ref-utils.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseRef,
  matchRef,
  generateSemanticSelector,
  extractElementMeta,
} from '../src/ref-utils.js';

describe('parseRef', () => {
  it('parses a ref pattern', () => {
    const result = parseRef("@1 [input type='text'] placeholder='Name'");
    expect(result?.index).toBe(1);
    expect(result?.tag).toBe('input');
    expect(result?.attrs).toContain("type='text'");
  });

  it('returns null for invalid ref', () => {
    expect(parseRef('not a ref')).toBeNull();
  });
});

describe('matchRef', () => {
  it('matches when ref index and element type align', () => {
    // Snapshot output from bb-browser: "@1 [input] placeholder='Name'"
    const recorded = "@2 [input] placeholder='Name'";
    const currentSnapshot = [
      "@1 [button] 'Submit'",
      "@2 [input] placeholder='Name'",
      "@3 [textarea]",
    ].join('\n');

    const result = matchRef(recorded, currentSnapshot);
    expect(result).not.toBeNull();
    expect(result!.ref).toBe('@2');
  });

  it('falls back to semantic selector when index mismatches', () => {
    const recorded = "@2 [input] placeholder='Name'";
    const semantic = "[input][placeholder*='Name' i]";
    // Simulate DOM change: new banner element shifts indices
    const currentSnapshot = [
      "@1 [button] 'New Banner'",
      "@2 [button] 'Another'",
      "@3 [input] placeholder='Name'",
    ].join('\n');

    const result = matchRef(recorded, currentSnapshot, semantic);
    expect(result).not.toBeNull();
    expect(result!.ref).toBe('@3');
    expect(result!.method).toBe('semantic');
  });

  it('returns null when nothing matches', () => {
    const recorded = "@2 [input] placeholder='Name'";
    const currentSnapshot = "@1 [button] 'Submit'";
    expect(matchRef(recorded, currentSnapshot)).toBeNull();
  });
});

describe('generateSemanticSelector', () => {
  it('generates CSS selector from element meta', () => {
    const meta = { tag: 'input', type: 'text', placeholder: 'Startup name', ariaLabel: null };
    const selector = generateSemanticSelector(meta);
    expect(selector).toContain('input');
    expect(selector).toContain('placeholder');
  });

  it('prioritizes aria-label when available', () => {
    const meta = { tag: 'textarea', type: null, placeholder: 'Desc', ariaLabel: 'Description field' };
    const selector = generateSemanticSelector(meta);
    expect(selector).toContain('aria-label');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/ref-utils.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement ref-utils.ts**

```typescript
export interface RefInfo {
  index: number;
  tag: string;
  attrs: string[];
  text: string;
}

export function parseRef(ref: string): RefInfo | null {
  // Match: @N [tag] attr1='v1' attr2='v2'
  const match = ref.match(/^@(\d+)\s+\[(\w+)\]\s*(.*)$/);
  if (!match) return null;

  const index = parseInt(match[1], 10);
  const tag = match[2];
  const rest = match[3];

  const attrs: string[] = [];
  const attrRegex = /(\w+(?:-\w+)*)=('[^']*'|"[^"]*")/g;
  let am;
  while ((am = attrRegex.exec(rest)) !== null) {
    attrs.push(`${am[1]}=${am[2]}`);
  }

  return { index, tag, attrs, text: rest };
}

export interface MatchResult {
  ref: string;
  method: 'direct' | 'semantic';
}

export function matchRef(
  recordedRef: string,
  currentSnapshot: string,
  semantic?: string
): MatchResult | null {
  const recorded = parseRef(recordedRef);
  if (!recorded) return null;

  const lines = currentSnapshot.split('\n');

  // Strategy 1: direct index match
  for (const line of lines) {
    const parsed = parseRef(line.trim());
    if (parsed && parsed.index === recorded.index && parsed.tag === recorded.tag) {
      // Check at least one key attr matches
      const hasMatchingAttr = recorded.attrs.some(a => parsed.attrs.includes(a));
      if (hasMatchingAttr) {
        return { ref: `@${parsed.index}`, method: 'direct' };
      }
      // Exact index + tag match with no attrs to check
      if (recorded.attrs.length === 0) {
        return { ref: `@${parsed.index}`, method: 'direct' };
      }
    }
  }

  // Strategy 2: semantic CSS selector fallback
  if (semantic) {
    for (const line of lines) {
      const parsed = parseRef(line.trim());
      if (!parsed) continue;
      // Build a simple text representation of the line and check if semantic matches
      const lineText = line.trim();
      if (semanticMatch(semantic, lineText, parsed)) {
        return { ref: `@${parsed.index}`, method: 'semantic' };
      }
    }
  }

  return null;
}

function semanticMatch(selector: string, line: string, parsed: RefInfo): boolean {
  // Simple CSS selector matching for snapshot lines
  // Handles: [tag], [tag][attr*=value], [tag][attr=value], :has-text()
  const parts = selector.split(/,\s*/);
  for (const part of parts) {
    if (matchSingleSelector(part.trim(), parsed)) return true;
  }
  return false;
}

function matchSingleSelector(selector: string, parsed: RefInfo): boolean {
  // [input]
  const tagMatch = selector.match(/^\[(\w+)\]/);
  if (tagMatch && tagMatch[1] !== parsed.tag) return false;

  // [attr*='value' i]
  const attrContainsRegex = /\[(\w+(?:-\w+)*)\*='([^']+)'\s*i\]/g;
  let m;
  while ((m = attrContainsRegex.exec(selector)) !== null) {
    const attrName = m[1];
    const attrValue = m[2].toLowerCase();
    const matchingAttr = parsed.attrs.find(a => {
      const [aName, aValue] = a.split('=');
      return aName.toLowerCase() === attrName.toLowerCase() &&
             aValue.replace(/['"]/g, '').toLowerCase().includes(attrValue);
    });
    if (!matchingAttr) return false;
  }

  // :has-text('X')
  const hasTextMatch = selector.match(/:has-text\('([^']+)'\)/);
  if (hasTextMatch) {
    const text = hasTextMatch[1].toLowerCase();
    if (!parsed.text.toLowerCase().includes(text)) return false;
  }

  return true;
}

export interface ElementMeta {
  tag: string;
  type: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  name: string | null;
  id: string | null;
  classList: string | null;
}

export function generateSemanticSelector(meta: ElementMeta): string {
  const selectors: string[] = [];

  // Prefer aria-label (most stable)
  if (meta.ariaLabel) {
    selectors.push(`[${meta.tag}][aria-label*='${meta.ariaLabel}' i]`);
  }

  // placeholder-based
  if (meta.placeholder) {
    selectors.push(`[${meta.tag}][placeholder*='${meta.placeholder.substring(0, 30)}' i]`);
  }

  // name attribute
  if (meta.name) {
    selectors.push(`[${meta.tag}][name*='${meta.name}' i]`);
  }

  // id
  if (meta.id) {
    selectors.push(`[${meta.tag}]#${meta.id}`);
  }

  return selectors.join(', ');
}

export function extractElementMeta(ref: string, snapshotLine: string): ElementMeta | null {
  const parsed = parseRef(ref);
  if (!parsed) return null;

  return {
    tag: parsed.tag,
    type: getAttr(parsed.attrs, 'type'),
    placeholder: getAttr(parsed.attrs, 'placeholder'),
    ariaLabel: getAttr(parsed.attrs, 'aria-label'),
    name: getAttr(parsed.attrs, 'name'),
    id: getAttr(parsed.attrs, 'id'),
    classList: getAttr(parsed.attrs, 'class'),
  };
}

function getAttr(attrs: string[], name: string): string | null {
  const found = attrs.find(a => a.startsWith(`${name}=`));
  if (!found) return null;
  const val = found.split('=').slice(1).join('=');
  return val.replace(/^['"]|['"]$/g, '');
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/ref-utils.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ref-utils.ts tests/ref-utils.test.ts
git commit -m "feat: add ref matching and semantic selector utilities"
```

---

## Chunk 4: Executor (Replay Mode)

### Task 4.1: Workflow Step Executor

**Files:**
- Create: `src/executor.ts`
- Create: `tests/executor.test.ts`

- [ ] **Step 1: Write test for executor**

```typescript
// tests/executor.test.ts
import { describe, it, expect, vi } from 'vitest';
import { executeStep, executeWorkflow } from '../src/executor.js';
import { WorkflowStep } from '../src/types.js';

// Mock bb-browser module
vi.mock('../src/bb-browser.js', () => ({
  bbOpen: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbClose: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbSnapshot: vi.fn(() => ({ ok: true, stdout: '@1 [input] placeholder="Name"', stderr: '' })),
  bbClick: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbFill: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbUpload: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbSelect: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbCheck: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbUncheck: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbPress: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbWait: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbEval: vi.fn(() => ({ ok: true, stdout: '{}', stderr: '' })),
  bbGet: vi.fn(() => ({ ok: true, stdout: 'https://test.com', stderr: '' })),
  bbDaemonStart: vi.fn(() => ({ ok: true, stdout: '', stderr: '' })),
  bbDaemonStatus: vi.fn(() => ({ ok: true, stdout: 'running', stderr: '' })),
}));

describe('executeStep', () => {
  it('executes open step', async () => {
    const step: WorkflowStep = {
      action: 'open',
      target: 'https://test.com/submit',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
  });

  it('executes fill step with product source resolution', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: '@1',
      source: 'product.name',
    };
    const product = { name: 'My App' };
    const result = await executeStep(step, product);
    expect(result.ok).toBe(true);
  });

  it('executes fill with literal value', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: '@1',
      value: 'literal text',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
  });

  it('resolves nested product source like product.description.short', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: '@1',
      source: 'product.description.short',
    };
    const product = { description: { short: 'Short desc' } };
    const result = await executeStep(step, product);
    expect(result.ok).toBe(true);
  });
});

describe('executeWorkflow', () => {
  it('executes all steps in sequence', async () => {
    const steps: WorkflowStep[] = [
      { action: 'open', target: 'https://test.com' },
      { action: 'fill', ref: '@1', source: 'product.name' },
      { action: 'click', ref: '@2' },
    ];
    const product = { name: 'My App' };
    const results = await executeWorkflow(steps, product);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.ok)).toBe(true);
  });

  it('stops on human_intervention step', async () => {
    const steps: WorkflowStep[] = [
      { action: 'open', target: 'https://test.com' },
      { action: 'click', ref: '@1', human_intervention: 'google_login' },
      { action: 'fill', ref: '@2', source: 'product.name' },
    ];
    const product = { name: 'My App' };
    const results = await executeWorkflow(steps, product);
    expect(results).toHaveLength(2); // Stopped at intervention
    expect(results[1].needsIntervention).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/executor.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement executor.ts**

```typescript
import {
  bbOpen, bbClose, bbSnapshot, bbClick, bbFill, bbUpload,
  bbSelect, bbCheck, bbUncheck, bbPress, bbWait, bbEval, bbGet,
} from './bb-browser.js';
import { WorkflowStep } from './types.js';

export interface StepResult {
  ok: boolean;
  step: WorkflowStep;
  needsIntervention?: boolean;
  interventionReason?: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface ExecutorContext {
  product?: Record<string, unknown>;
  onIntervention?: (reason: string, step: WorkflowStep) => Promise<'done' | 'skip' | 'retry'>;
}

function resolveValue(step: WorkflowStep, context: ExecutorContext): string {
  // Use literal value if provided
  if (step.value !== undefined) return step.value;
  // Resolve product.field.path from source
  if (step.source && step.source.startsWith('product.')) {
    const path = step.source.replace('product.', '').split('.');
    let val: any = context.product;
    for (const key of path) {
      if (val === undefined || val === null) return '';
      val = val[key];
    }
    return val !== undefined && val !== null ? String(val) : '';
  }
  return step.source || '';
}

export async function executeStep(
  step: WorkflowStep,
  context: ExecutorContext
): Promise<StepResult> {
  try {
    // Check for human intervention before executing
    if (step.human_intervention && context.onIntervention) {
      const decision = await context.onIntervention(step.human_intervention, step);
      if (decision === 'skip') {
        return { ok: true, step, needsIntervention: true, interventionReason: step.human_intervention };
      }
      if (decision === 'retry') {
        return executeStep(step, context);
      }
    }

    switch (step.action) {
      case 'open': {
        const result = bbOpen(step.target!);
        if (step.wait) await sleep(step.wait);
        if (step.wait_for) bbWait(step.wait_for); // Wait for specific element
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'click': {
        const result = bbClick(step.ref!);
        if (step.wait) await sleep(step.wait);
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'fill': {
        const value = resolveValue(step, context);
        const result = bbFill(step.ref!, value);
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'upload': {
        const path = resolveValue(step, context);
        const result = bbUpload(step.ref!, path);
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'select':
      case 'select_category': {
        const value = step.value || resolveValue(step, context);
        const result = bbSelect(step.ref!, value);
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'check': {
        const result = bbCheck(step.ref!);
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'uncheck': {
        const result = bbUncheck(step.ref!);
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'press': {
        const result = bbPress(step.value || 'Enter');
        return { ok: result.ok, step, error: result.stderr || undefined };
      }

      case 'wait': {
        if (step.value) {
          await sleep(parseInt(step.value, 10));
        } else if (step.ref) {
          bbWait(step.ref);
        }
        return { ok: true, step };
      }

      case 'verify': {
        // For verify, we check if the ref text appears in snapshot
        const snap = bbSnapshot({ interactive: false });
        if (step.ref && snap.stdout.includes(step.ref)) {
          return { ok: true, step };
        }
        return { ok: false, step, error: `Verify failed: expected "${step.ref}"` };
      }

      case 'eval': {
        const result = bbEval(step.value || '');
        return {
          ok: result.ok,
          step,
          error: result.stderr || undefined,
          data: { result: result.stdout },
        };
      }

      case 'record_result': {
        const urlResult = bbGet('url');
        return {
          ok: true,
          step,
          data: { confirmation_url: urlResult.stdout },
        };
      }

      default:
        return { ok: false, step, error: `Unknown action: ${step.action}` };
    }
  } catch (e: any) {
    return { ok: false, step, error: e.message };
  }
}

export async function executeWorkflow(
  steps: WorkflowStep[],
  product?: Record<string, unknown>,
  onIntervention?: (reason: string, step: WorkflowStep) => Promise<'done' | 'skip' | 'retry'>
): Promise<StepResult[]> {
  const context: ExecutorContext = { product, onIntervention };
  const results: StepResult[] = [];

  for (const step of steps) {
    const result = await executeStep(step, context);
    results.push(result);

    // Stop on intervention
    if (result.needsIntervention) break;
    // Stop on error (unless it's a non-fatal step)
    if (!result.ok && step.action !== 'verify') break;
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Integrate ref-utils for dual-match element resolution**

Before each element interaction (click/fill/upload/select), take a fresh snapshot and resolve the ref:

```typescript
import { matchRef } from './ref-utils.js';
import { bbSnapshot } from './bb-browser.js';

// Add to ExecutorContext:
interface ExecutorContext {
  // ... existing fields
  snapshotCache?: string;
}

async function resolveRef(step: WorkflowStep, context: ExecutorContext): Promise<string | null> {
  const snapshot = bbSnapshot({ interactive: false }).stdout;
  context.snapshotCache = snapshot;
  const result = matchRef(step.ref || '', snapshot, step.semantic);
  return result?.ref || null;
}
```

Update each interaction step (click/fill/upload/select) to call `resolveRef()` before acting. The integration point is right before the switch's element interaction cases:

```typescript
// Before click/fill/upload/select cases:
if (['click', 'fill', 'upload', 'select', 'select_category', 'check', 'uncheck'].includes(step.action)) {
  const resolvedRef = await resolveRef(step, context);
  if (!resolvedRef) {
    return { ok: false, step, needsIntervention: true, interventionReason: 'DOM change: element not found', error: 'ref resolution failed' };
  }
  step = { ...step, ref: resolvedRef }; // Use resolved ref
}
```

Similarly, update the `upload` case to use `resolveProductPath()` instead of the generic `resolveValue()`:

```typescript
case 'upload': {
  const path = resolveProductPath(step.source || '', context.productId || '');
  const result = bbUpload(step.ref!, path);
  return { ok: result.ok, step, error: result.stderr || undefined };
}
```

If `resolveRef` returns null, fall back to Agent (emit needsIntervention for DOM change).

- [ ] **Step 5: Fix upload file path resolution**

Add a dedicated function to resolve product file paths:

```typescript
import { resolve } from 'path';

function resolveProductPath(source: string, productId: string): string {
  if (source.startsWith('product.')) {
    const relPath = source.replace('product.', '').replace(/\./g, '/');
    // For file uploads: product.logo-256x256.png → products/<id>/logo-256x256.png
    // For data fields: product.name → resolved via product data object
    const filePath = resolve(process.cwd(), 'products', productId, relPath);
    if (existsSync(filePath)) return filePath;
    // If not a file, return the dotted path for data resolution
    return source;
  }
  return source;
}
```

- [ ] **Step 6: Add retry logic for network errors**

```typescript
async function executeStepWithRetry(
  step: WorkflowStep,
  context: ExecutorContext,
  maxRetries = 3
): Promise<StepResult> {
  const delays = [5000, 10000, 30000]; // 5s, 10s, 30s
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeStep(step, context);
    if (result.ok) return result;
    const category = classifyError(result);
    if (!isRetriableError(category) || attempt === maxRetries) return result;
    await new Promise(r => setTimeout(r, delays[attempt] || 30000));
  }
  return { ok: false, step, error: 'Max retries exceeded' };
}
```

- [ ] **Step 7: Add argument verification to executor tests**

Update executor tests to verify mock function calls:

```typescript
it('executes fill step with correct value from product source', async () => {
  const { bbFill } = await import('../src/bb-browser.js');
  const step: WorkflowStep = { action: 'fill', ref: '@1', source: 'product.name' };
  const result = await executeStep(step, { product: { name: 'My App' } });
  expect(result.ok).toBe(true);
  expect(bbFill).toHaveBeenCalledWith('@1', 'My App');
});
```

- [ ] **Step 8: Run tests**

```bash
npx vitest run tests/executor.test.ts
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/executor.ts tests/executor.test.ts
git commit -m "feat: add deterministic workflow step executor with ref matching and retry"
```

---

## Chunk 5: HITL Handler + Tracker

### Task 5.1: Human-in-the-Loop Handler

**Files:**
- Create: `src/hitl.ts`

No tests (IO-bound, interacts with user via CLI)

- [ ] **Step 1: Implement hitl.ts**

```typescript
import { WorkflowStep, StepResult } from './types.js';

export interface InterventionRequest {
  site: string;
  reason: string;
  step: WorkflowStep;
  timeoutMinutes?: number;
}

export function formatIntervention(req: InterventionRequest): string {
  const timeoutMsg = req.timeoutMinutes
    ? ` (超时: ${req.timeoutMinutes}分钟)`
    : '';

  return [
    `[intervention] ${req.site}: ${req.reason}${timeoutMsg}`,
    `操作: 在浏览器中完成操作后输入 'done' 继续`,
    `或输入 'skip' 跳过此站, 'retry' 重试当前步骤`,
  ].join('\n');
}

// For testing: a callback-based intervention handler
export async function handleIntervention(
  req: InterventionRequest,
  getUserInput: (prompt: string) => Promise<string>
): Promise<'done' | 'skip' | 'retry'> {
  const prompt = formatIntervention(req);
  const response = await getUserInput(prompt);
  const normalized = response.trim().toLowerCase();

  if (normalized === 'done' || normalized === 'd') return 'done';
  if (normalized === 'skip' || normalized === 's') return 'skip';
  if (normalized === 'retry' || normalized === 'r') return 'retry';

  // Default: treat as done
  return 'done';
}

export function classifyError(result: StepResult): 'network' | 'dom_change' | 'captcha' | 'oauth' | 'form_validation' | 'server_reject' | 'unknown' {
  if (!result.ok) {
    const err = (result.error || '').toLowerCase();
    if (err.includes('timeout') || err.includes('econnrefused') || err.includes('enotfound')) {
      return 'network';
    }
    if (err.includes('verif') && err.includes('failed')) {
      return 'dom_change';
    }
    if (err.includes('403') || err.includes('429') || err.includes('500')) {
      return 'server_reject';
    }
    // Form validation: server returned field-level error messages
    if (err.includes('validation') || err.includes('required') || err.includes('invalid')) {
      return 'form_validation';
    }
  }
  if (result.needsIntervention) {
    const reason = (result.interventionReason || '').toLowerCase();
    if (reason.includes('captcha') || reason.includes('验证码')) return 'captcha';
    if (reason.includes('oauth') || reason.includes('login') || reason.includes('登录')) return 'oauth';
  }
  return 'unknown';
}

export function isInteractiveError(category: string): boolean {
  return ['dom_change', 'captcha', 'oauth', 'form_validation'].includes(category);
}

export function isRetriableError(category: string): boolean {
  return ['network'].includes(category);
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hitl.ts
git commit -m "feat: add human-in-the-loop intervention handler"
```

### Task 5.2: Submission Tracker

**Files:**
- Create: `src/tracker.ts`
- Create: `tests/tracker.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/tracker.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadTracker,
  updateEntry,
  getStatus,
  getSummary,
  getPendingSites,
} from '../src/tracker.js';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { SubmissionTracker } from '../src/types.js';

const TEST_PRODUCT = '__test_product__';

function makeTracker(): SubmissionTracker {
  return {
    product: TEST_PRODUCT,
    last_updated: new Date().toISOString(),
    entries: [],
    status_summary: { success: 0, failed: 0, pending: 0, not_started: 0 },
  };
}

beforeEach(() => {
  // Use a test-specific tracker file
  const dir = join(__dirname, '..', 'submissions', '__test__');
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(join(__dirname, '..', 'submissions', '__test__'), { recursive: true, force: true });
});

describe('SubmissionTracker', () => {
  it('initializes an empty tracker', () => {
    const t = makeTracker();
    expect(t.entries).toHaveLength(0);
  });

  it('updates an entry', () => {
    const t = makeTracker();
    updateEntry(t, 'site1', 'success', { confirmation_url: 'https://x.com' });
    expect(t.entries[0].site).toBe('site1');
    expect(t.entries[0].status).toBe('success');
    expect(t.status_summary.success).toBe(1);
  });

  it('merges updates to existing entries', () => {
    const t = makeTracker();
    updateEntry(t, 'site1', 'failed', { error: 'first error' });
    updateEntry(t, 'site1', 'success', {});
    expect(t.entries[0].status).toBe('success');
    expect(t.entries[0].retry_count).toBe(2); // retry_count should be tracked
  });

  it('getStatus returns correct status', () => {
    const t = makeTracker();
    updateEntry(t, 'site1', 'success', {});
    expect(getStatus(t, 'site1')).toBe('success');
    expect(getStatus(t, 'unknown')).toBe('not_started');
  });

  it('getPendingSites returns sites needing submission', () => {
    const t = makeTracker();
    updateEntry(t, 'site1', 'success', {});
    updateEntry(t, 'site2', 'failed', {});
    updateEntry(t, 'site3', 'pending', {});

    const allSites = ['site1', 'site2', 'site3', 'site4'];
    const pending = getPendingSites(t, allSites);
    expect(pending).toEqual(['site2', 'site3', 'site4']);
    expect(pending).not.toContain('site1'); // success should be skipped
  });
});
```

Note: tracker functions operate in memory. File I/O is separate (loadTracker/saveTracker).

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/tracker.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement tracker.ts**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { SubmissionTracker, SubmissionEntry, SubmissionStatus } from './types.js';

const SUBMISSIONS_DIR = resolve(process.cwd(), 'submissions');

function trackerPath(productId: string): string {
  return resolve(SUBMISSIONS_DIR, `${productId}.yaml`);
}

export function loadTracker(productId: string): SubmissionTracker {
  const p = trackerPath(productId);
  if (!existsSync(p)) {
    return createEmpty(productId);
  }
  const raw = readFileSync(p, 'utf-8');
  return yaml.load(raw) as SubmissionTracker;
}

export function saveTracker(tracker: SubmissionTracker): void {
  if (!existsSync(SUBMISSIONS_DIR)) mkdirSync(SUBMISSIONS_DIR, { recursive: true });
  tracker.last_updated = new Date().toISOString();
  const path = trackerPath(tracker.product);
  writeFileSync(path, yaml.dump(tracker, { lineWidth: 120 }), 'utf-8');
}

export function createEmpty(productId: string): SubmissionTracker {
  return {
    product: productId,
    last_updated: new Date().toISOString(),
    entries: [],
    status_summary: { success: 0, failed: 0, pending: 0, not_started: 0 },
  };
}

export function updateEntry(
  tracker: SubmissionTracker,
  siteId: string,
  status: SubmissionStatus,
  extra: Partial<Pick<SubmissionEntry, 'confirmation_url' | 'error' | 'reason'>>
): void {
  const existing = tracker.entries.find(e => e.site === siteId);
  if (existing) {
    existing.status = status;
    existing.attempted_at = new Date().toISOString();
    existing.retry_count = (existing.retry_count || 0) + 1;
    if (extra.confirmation_url) existing.confirmation_url = extra.confirmation_url;
    if (extra.error) existing.error = extra.error;
    if (extra.reason) existing.reason = extra.reason;
    if (status === 'success') existing.submitted_at = new Date().toISOString();
  } else {
    tracker.entries.push({
      site: siteId,
      status,
      confirmation_url: extra.confirmation_url,
      error: extra.error,
      reason: extra.reason,
      attempted_at: status !== 'not_started' ? new Date().toISOString() : undefined,
      submitted_at: status === 'success' ? new Date().toISOString() : undefined,
      retry_count: status !== 'not_started' ? 1 : 0,
    });
  }
  recomputeSummary(tracker);
}

function recomputeSummary(tracker: SubmissionTracker): void {
  const summary = { success: 0, failed: 0, pending: 0, not_started: 0 };
  for (const e of tracker.entries) {
    switch (e.status) {
      case 'success': summary.success++; break;
      case 'failed': summary.failed++; break;
      case 'pending': summary.pending++; break;
      case 'not_started': summary.not_started++; break;
    }
  }
  tracker.status_summary = summary;
}

export function getStatus(tracker: SubmissionTracker, siteId: string): SubmissionStatus {
  const entry = tracker.entries.find(e => e.site === siteId);
  return entry?.status || 'not_started';
}

export function getSummary(tracker: SubmissionTracker): SubmissionTracker['status_summary'] {
  return tracker.status_summary;
}

export function getPendingSites(tracker: SubmissionTracker, allSites: string[]): string[] {
  return allSites.filter(site => {
    const status = getStatus(tracker, site);
    // Skip already-successful and needs_review (requires human decision)
    return status !== 'success' && status !== 'needs_review';
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/tracker.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tracker.ts tests/tracker.test.ts
git commit -m "feat: add submission tracker with load/save/update/query"
```

---

## Chunk 6: Batcher (Batch Mode + Resume)

### Task 6.1: Batch Mode Orchestrator

**Files:**
- Create: `src/batcher.ts`
- Create: `tests/batcher.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// tests/batcher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createBatchLock, loadBatchLock, updateBatchProgress, deleteBatchLock, buildSiteQueue } from '../src/batcher.js';
import { writeFileSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BatchLock } from '../src/types.js';

const TEST_LOCK_FILE = join(__dirname, '..', 'submissions', '.batch-running');

beforeEach(() => {
  mkdirSync(join(__dirname, '..', 'submissions'), { recursive: true });
  if (existsSync(TEST_LOCK_FILE)) rmSync(TEST_LOCK_FILE);
});

afterEach(() => {
  if (existsSync(TEST_LOCK_FILE)) rmSync(TEST_LOCK_FILE);
});

describe('BatchLock', () => {
  it('creates and loads a batch lock', () => {
    createBatchLock('myapp', ['site1', 'site2', 'site3']);
    const lock = loadBatchLock();
    expect(lock).not.toBeNull();
    expect(lock!.product).toBe('myapp');
    expect(lock!.site_queue).toEqual(['site1', 'site2', 'site3']);  // Fixed
    expect(lock!.current_site).toBe('site1');
  });

  it('updateBatchProgress advances current_site', () => {
    createBatchLock('myapp', ['site1', 'site2']);
    updateBatchProgress('site1');
    const lock = loadBatchLock();
    expect(lock!.current_site).toBe('site2');
  });

  it('deleteBatchLock removes lock file', () => {
    createBatchLock('myapp', ['site1']);
    deleteBatchLock();
    expect(existsSync(TEST_LOCK_FILE)).toBe(false);
  });

  it('loadBatchLock returns null when no lock file', () => {
    expect(loadBatchLock()).toBeNull();
  });

  it('loadBatchLock returns null for corrupted lock file', () => {
    writeFileSync(TEST_LOCK_FILE, 'not valid yaml {{{');
    expect(loadBatchLock()).toBeNull();
  });
});

describe('buildSiteQueue', () => {
  it('filters out already-successful sites', () => {
    const allSites = ['site1', 'site2', 'site3'];
    const successSites = ['site1'];
    const queue = buildSiteQueue(allSites, successSites);
    expect(queue).toEqual(['site2', 'site3']);
  });

  it('returns empty when all sites succeeded', () => {
    expect(buildSiteQueue(['site1'], ['site1'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npx vitest run tests/batcher.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement batcher.ts**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { BatchLock } from './types.js';

const BATCH_LOCK_PATH = resolve(process.cwd(), 'submissions', '.batch-running');

export function createBatchLock(product: string, siteQueue: string[]): BatchLock {
  const lock: BatchLock = {
    product,
    site_queue: siteQueue,
    current_site: siteQueue[0] || '',
    started_at: new Date().toISOString(),
  };
  saveBatchLock(lock);
  return lock;
}

export function loadBatchLock(): BatchLock | null {
  if (!existsSync(BATCH_LOCK_PATH)) return null;
  try {
    const raw = readFileSync(BATCH_LOCK_PATH, 'utf-8');
    const data = yaml.load(raw) as any;
    // Structure validation
    if (!data?.product || !Array.isArray(data?.site_queue)) return null;
    return data as BatchLock;
  } catch {
    // Corrupted lock file
    return null;
  }
}

export function saveBatchLock(lock: BatchLock): void {
  if (!existsSync(resolve(BATCH_LOCK_PATH, '..'))) {
    mkdirSync(resolve(BATCH_LOCK_PATH, '..'), { recursive: true });
  }
  writeFileSync(BATCH_LOCK_PATH, yaml.dump(lock, { lineWidth: 120 }), 'utf-8');
}

export function updateBatchProgress(completedSite: string): void {
  const lock = loadBatchLock();
  if (!lock) return;
  const idx = lock.site_queue.indexOf(completedSite);
  if (idx >= 0 && idx + 1 < lock.site_queue.length) {
    lock.current_site = lock.site_queue[idx + 1];
  } else {
    lock.current_site = ''; // All done
  }
  saveBatchLock(lock);
}

export function deleteBatchLock(): void {
  if (existsSync(BATCH_LOCK_PATH)) unlinkSync(BATCH_LOCK_PATH);
}

export function buildSiteQueue(allSites: string[], alreadySuccess: string[]): string[] {
  const successSet = new Set(alreadySuccess);
  return allSites.filter(s => !successSet.has(s));
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/batcher.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/batcher.ts tests/batcher.test.ts
git commit -m "feat: add batch mode orchestrator with resume support"
```

---

## Chunk 7: CLI Wiring

### Task 7.1: CLI Entry Point

**Files:**
- Create: `src/cli.ts`
- Modify: `package.json` (add bin + scripts)

- [ ] **Step 1: Implement CLI with Commander.js**

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { loadProduct } from './product-store.js';
import { loadKnowledge, listSites, saveKnowledge, saveDraft, promoteDraft, loadDraft, validateKnowledgeStructure } from './knowledge-base.js';
import { loadMappings } from './category-mapper.js';
import { loadTracker, saveTracker, updateEntry, getStatus, getSummary, getPendingSites } from './tracker.js';
import { executeWorkflow } from './executor.js';
import { createBatchLock, loadBatchLock, updateBatchProgress, deleteBatchLock, buildSiteQueue } from './batcher.js';
import { formatIntervention, handleIntervention, classifyError, isInteractiveError, isRetriableError } from './hitl.js';
import { WorkflowStep } from './types.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const program = new Command();

program
  .name('bb-submitter')
  .description('Automate submitting web products to navigation sites')
  .version('0.1.0');

// teach command
program
  .command('teach <site>')
  .description('Teach agent a new navigation site')
  .option('-p, --product <name>', 'Product ID to use')
  .action(async (site, options) => {
    const product = loadProduct(options.product);
    console.log(`\nTeaching mode: ${site} for product "${product.name}"`);

    // Check for existing draft
    const draft = loadDraft(site);
    if (draft) {
      console.log('Detected unfinished teaching draft. Continue? (continue / restart)');
      // In teaching mode, agent handles the rest interactively
      console.log('Draft loaded. Agent will continue from last checkpoint.');
    }

    console.log(`Product loaded: ${product.name}`);
    console.log(`Site: ${site}`);
    console.log('\nReady to teach. Agent will now analyze the submission form.');
    console.log('Run: bb-browser open <submit-url> to get started.');
  });

// submit command
program
  .command('submit <site>')
  .description('Submit a product to a known site')
  .option('-p, --product <name>', 'Product ID to submit')
  .action(async (site, options) => {
    const knowledge = loadKnowledge(site);
    const product = loadProduct(options.product);
    const tracker = loadTracker(options.product);

    console.log(`\nSubmitting "${product.name}" to ${knowledge.site.name}...`);

    const results = await executeWorkflow(
      knowledge.workflow.steps,
      product as unknown as Record<string, unknown>,
      async (reason, step) => {
        console.log(formatIntervention({ site, reason, step }));
        // In CLI mode, read from stdin
        return new Promise(resolve => {
          process.stdin.once('data', (data) => {
            const input = data.toString().trim().toLowerCase();
            if (input === 'done' || input === 'd') resolve('done');
            else if (input === 'skip' || input === 's') resolve('skip');
            else if (input === 'retry' || input === 'r') resolve('retry');
            else resolve('done');
          });
        });
      }
    );

    const lastResult = results[results.length - 1];
    if (lastResult.ok) {
      const confirmUrl = lastResult.data?.confirmation_url as string || '';
      updateEntry(tracker, site, 'success', { confirmation_url: confirmUrl });
      console.log(`✅ Submitted successfully: ${confirmUrl}`);
    } else {
      const category = classifyError(lastResult);
      if (isInteractiveError(category)) {
        updateEntry(tracker, site, 'pending', { reason: lastResult.error });
        console.log(`⏸️ Paused: ${lastResult.error}`);
      } else {
        updateEntry(tracker, site, 'failed', { error: lastResult.error });
        console.log(`❌ Failed: ${lastResult.error}`);
      }
    }

    saveTracker(tracker);
  });

// batch command
program
  .command('batch')
  .description('Batch submit to all known sites')
  .option('-p, --product <name>', 'Product ID to submit')
  .option('--sites <list>', 'Comma-separated site list')
  .option('--timeout <minutes>', 'Intervention timeout in minutes', '0')
  .action(async (options) => {
    const product = loadProduct(options.product);
    const tracker = loadTracker(options.product);

    // Determine site queue
    let siteQueue: string[];
    if (options.sites) {
      siteQueue = options.sites.split(',').map((s: string) => s.trim());
    } else {
      siteQueue = listSites();
    }

    // Check for resume
    const existingLock = loadBatchLock();
    if (existingLock) {
      console.log(`Resuming batch from ${existingLock.current_site}...`);
      const resumeIdx = existingLock.site_queue.indexOf(existingLock.current_site);
      if (resumeIdx >= 0) {
        siteQueue = existingLock.site_queue.slice(resumeIdx);
      }
    }

    // Filter already-successful sites
    const successSites = tracker.entries
      .filter(e => e.status === 'success')
      .map(e => e.site);
    siteQueue = buildSiteQueue(siteQueue, successSites);

    if (siteQueue.length === 0) {
      console.log('All sites already submitted successfully.');
      deleteBatchLock();
      return;
    }

    // Create lock
    createBatchLock(options.product, siteQueue);

    // Run batch
    let consecutiveFailures = 0;
    for (const site of siteQueue) {
      console.log(`\n[${siteQueue.indexOf(site) + 1}/${siteQueue.length}] ${site}...`);

      try {
        const knowledge = loadKnowledge(site);
        const results = await executeWorkflow(
          knowledge.workflow.steps,
          product as unknown as Record<string, unknown>,
          async (reason, step) => {
            console.log(formatIntervention({ site, reason, step, timeoutMinutes: parseInt(options.timeout) || undefined }));
            // In CLI mode, read from stdin
            return new Promise(resolve => {
              const timer = parseInt(options.timeout) > 0
                ? setTimeout(() => {
                    console.log(`Timeout. Skipping ${site}.`);
                    resolve('skip');
                  }, parseInt(options.timeout) * 60 * 1000)
                : null;

              process.stdin.once('data', (data) => {
                if (timer) clearTimeout(timer);
                const input = data.toString().trim().toLowerCase();
                if (input === 'done' || input === 'd') resolve('done');
                else if (input === 'skip' || input === 's') resolve('skip');
                else if (input === 'retry' || input === 'r') resolve('retry');
                else resolve('done');
              });
            });
          }
        );

        const lastResult = results[results.length - 1];
        if (lastResult.ok) {
          updateEntry(tracker, site, 'success', {
            confirmation_url: lastResult.data?.confirmation_url as string,
          });
          consecutiveFailures = 0;
        } else {
          updateEntry(tracker, site, 'failed', { error: lastResult.error });
          consecutiveFailures++;
        }
      } catch (e: any) {
        updateEntry(tracker, site, 'failed', { error: e.message });
        consecutiveFailures++;
      }

      saveTracker(tracker);
      updateBatchProgress(site);

      // Check for systemic failure
      if (consecutiveFailures >= 5) {
        console.log('\n⚠️ 5 consecutive failures. Stopping batch. Check your environment.');
        break;
      }

      // Rate limit: 5-10s between sites
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 5000));
    }

    deleteBatchLock();
    const summary = getSummary(tracker);
    console.log(`\nBatch complete: ${summary.success} success, ${summary.failed} failed, ${summary.pending} pending`);
  });

// knowledge commands
const knowledgeCmd = program.command('knowledge').description('Manage site knowledge');

knowledgeCmd
  .command('list')
  .description('List all known sites')
  .action(() => {
    const sites = listSites();
    console.log(`Known sites (${sites.length}):`);
    sites.forEach(s => console.log(`  - ${s}`));
  });

knowledgeCmd
  .command('show <site>')
  .description('Show site knowledge')
  .action((site) => {
    const k = loadKnowledge(site);
    console.log(JSON.stringify(k, null, 2));
  });

knowledgeCmd
  .command('edit <site>')
  .description('Edit site knowledge with $EDITOR')
  .action(async (site) => {
    const editor = process.env.EDITOR || 'vim';
    const { spawnSync } = await import('child_process');
    const filePath = resolve(process.cwd(), 'knowledge', 'sites', `${site}.yaml`);
    spawnSync(editor, [filePath], { stdio: 'inherit' });
    console.log('Validating...');
    const k = loadKnowledge(site);
    const result = validateKnowledgeStructure(k);
    if (!result.valid) {
      console.log('⚠️ Validation errors:');
      result.errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('✅ Knowledge structure valid.');
    }
  });

knowledgeCmd
  .command('validate <site>')
  .description('Check if site knowledge is still valid by opening the page')
  .action(async (site) => {
    const { bbOpen, bbSnapshot, bbClose } = await import('./bb-browser.js');
    const { matchRef } = await import('./ref-utils.js');
    const knowledge = loadKnowledge(site);

    console.log(`Validating ${site} (${knowledge.site.name})...`);

    // 1. Open submit URL
    bbOpen(knowledge.site.url);
    // 2. Snapshot
    const snap = bbSnapshot({ interactive: false });
    if (!snap.ok) {
      console.log('❌ broken: Failed to load page');
      return;
    }

    // 3. Check each step's element via semantic selector
    let allValid = true;
    let partial = false;

    for (const step of knowledge.workflow.steps) {
      if (!step.ref && !step.semantic) continue;
      const match = matchRef(step.ref || '', snap.stdout, step.semantic);

      if (!match) {
        console.log(`  ❌ Step "${step.action}${step.field ? ' ' + step.field : ''}": element not found`);
        allValid = false;
      } else if (match.method === 'semantic') {
        console.log(`  ⚠️ Step "${step.action}${step.field ? ' ' + step.field : ''}": found via semantic (DOM shifted)`);
        partial = true;
      } else {
        console.log(`  ✅ Step "${step.action}${step.field ? ' ' + step.field : ''}": valid`);
      }

      // For select_category, also check mapping options
      if (step.action === 'select_category' && step.mapping) {
        // Use eval to get select options
        const optionsResult = bbEval(
          `Array.from(document.querySelector('${step.semantic?.split(',')[0] || 'select'}').options).map(o => o.value)`
        );
        if (optionsResult.ok) {
          try {
            const options: string[] = JSON.parse(optionsResult.stdout);
            const mappedValues = Object.values(step.mapping);
            const missing = mappedValues.filter(v => !options.includes(v));
            if (missing.length > 0) {
              console.log(`  ⚠️ Category options changed: missing values: ${missing.join(', ')}`);
              partial = true;
            }
          } catch {}
        }
      }
    }

    // 4. Report result
    if (!allValid) {
      console.log('\n❌ broken: Some elements could not be found. Consider re-teaching this site.');
    } else if (partial) {
      console.log('\n⚠️ partial: All elements found, but some DOM changes detected. Still usable.');
    } else {
      console.log('\n✅ valid: All elements match. Site knowledge is current.');
    }

    // 5. Update last_validated
    knowledge.last_validated = new Date().toISOString().split('T')[0];
    saveKnowledge(site, knowledge);

    bbClose();
  });

// status command
program
  .command('status')
  .description('Show submission progress')
  .option('-p, --product <name>', 'Product ID')
  .action((options) => {
    const tracker = loadTracker(options.product);
    const summary = getSummary(tracker);
    console.log(`\nProduct: ${tracker.product}`);
    console.log(`Last updated: ${tracker.last_updated}`);
    console.log(`\nStatus:`);
    console.log(`  ✅ Success: ${summary.success}`);
    console.log(`  ❌ Failed: ${summary.failed}`);
    console.log(`  ⏸️ Pending: ${summary.pending}`);
    console.log(`  ⬜ Not started: ${summary.not_started}`);

    if (tracker.entries.length > 0) {
      console.log('\nDetails:');
      tracker.entries.forEach(e => {
        const icon = e.status === 'success' ? '✅' : e.status === 'failed' ? '❌' : e.status === 'needs_review' ? '🔍' : '⏸️';
        console.log(`  ${icon} ${e.site}: ${e.status}${e.error ? ` (${e.error})` : ''}`);
      });
    }
  });

program.parse();
```

- [ ] **Step 2: Update package.json — add bin and scripts fields (MERGE into existing, do NOT replace)**

Add these fields to the existing package.json:

```json
"bin": {
  "bb-submitter": "./dist/cli.js"
},
"scripts": {
  "build": "tsc",
  "start": "node dist/cli.js",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Note: Add `"bin"` and `"scripts"` to the existing package.json object. Do NOT overwrite the entire file — keep `name`, `version`, `dependencies`, `devDependencies`, etc.

- [ ] **Step 3: Build and verify**

```bash
npx tsc
node dist/cli.js --help
```
Expected: shows help text with all commands

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat: add CLI with all commands (teach/submit/batch/knowledge/status)"
```

---

## Chunk 8: Integration - Teaching Mode & Agent Prompts

This chunk defines the Claude Code agent prompts and workflows. No TypeScript code — Teaching Mode is driven by Claude's reasoning in the session.

### Task 8.1: Create Claude Code skills for teach/submit/batch

**Files:**
- Create: `.claude/skills/bb-submitter-teach.md`
- Create: `.claude/skills/bb-submitter-submit.md`
- Create: `.claude/skills/bb-submitter-batch.md`

- [ ] **Step 1: Create teach skill**

`.claude/skills/bb-submitter-teach.md`:

```markdown
# bb-submitter Teach

Teaching mode: learn a new navigation site's submission form.

## Workflow

1. Load product data: use `loadProduct(productId)` from product-store.ts
2. Open submit URL: `bb-browser open <url>`. Check for auth requirement:
   - No login needed → proceed to form analysis
   - Login required → identify method (Google OAuth/GitHub/Email), pause for user to complete
3. Snapshot the page: `bb-browser snapshot -i`
4. **Analyze the form** and propose field mappings:
   - For each input/textarea/select/upload element in the snapshot:
     - Identify the field semantic from label, placeholder, name, aria-label
     - Match to a product.yaml field
     - Present suggestion to user with reasoning
   - For select elements: use `bb-browser eval` to get all options, ask user to map product.category_tags to site categories
5. **User confirms/adjusts**: iterate until all fields are mapped
   → After confirmation, save draft: `saveDraft(siteId, knowledge)` from knowledge-base.ts
6. **Detect and handle auth**: if page requires login (Google OAuth etc.), pause: "[intervention] <site>: needs Google login. Complete in browser, then type 'done'"
7. **Execute each step**: use bb-browser fill/upload/click/select commands. After each fill, update draft.
   - Page load failure → retry 2x (increasing delays) → abort on failure
   - Snapshot empty/loading → wait 3s, re-snapshot → warn user if still broken
   - Submit failure → Agent analyzes error, fixes if possible, retries once
8. **Generate semantic selectors**: for each element, use `bb-browser eval`:
   ```
   el = document.querySelector('[placeholder="Startup name"]')
   JSON.stringify({tag: el.tagName, type: el.type, placeholder: el.placeholder, ariaLabel: el.ariaLabel, name: el.name, id: el.id})
   ```
   Then use `generateSemanticSelector()` from ref-utils.ts
9. **Generate site knowledge YAML**: with all steps, refs, semantic selectors, category mappings. Include `known_quirks` and `last_validated`.
10. **User confirms** → `promoteDraft(siteId)` to save + `saveMappings()` for category-mappings.yaml changes
11. If user cancels (Ctrl+C / "cancel"): save draft, inform "Draft saved. Resume with `teach <site> --product <name>`"

## Agent I/O Contract

- **Input**: snapshot text, product.yaml fields, current step context
- **Output**: validated field mappings (JSON), generated semantic selectors, site knowledge YAML
```

- [ ] **Step 2: Create submit skill**

`.claude/skills/bb-submitter-submit.md`:

```markdown
# bb-submitter Submit

Replay mode: submit a product using learned site knowledge.

## Workflow

1. Load site knowledge: `loadKnowledge(siteId)` from knowledge-base.ts
2. Load product data: `loadProduct(productId)` from product-store.ts
3. Load submission tracker: `loadTracker(productId)` from tracker.ts
4. Execute workflow steps using `executeWorkflow()` from executor.ts:
   - Each step: snapshot → `matchRef(recordedRef, snapshot, semantic)` → resolve element
   - Ref fails → semantic fallback → DOM change intervention
   - Network errors: auto-retry 3x (5s/10s/30s delays)
   - Form validation errors: Agent analyzes, retries 1x with fix
5. Handle interventions via hitl.ts `formatIntervention()`:
   - Captcha/OAuth: "[intervention] <site>: <reason>. Complete in browser, type done/skip/retry"
   - DOM change: "[intervention] <site>: page structure changed. Type 're-teach' to redo, 'skip' to skip"
   - Form rejection: "[intervention] <site>: submission rejected: <error>. Type 'fix' to try correction, 'skip' to skip"
6. Retry logic:
   - Network (timeout/refused): retry 3x automatically, no user involvement
   - DOM change: pause for human, Agent re-analyzes or user re-teaches
   - Captcha/OAuth: always pause for human
   - Server reject (403/429/500): 429 waits Retry-After, others record and skip
7. Record result: `updateEntry(tracker, site, status, {...})` + `saveTracker(tracker)`
```

- [ ] **Step 3: Create batch skill**

`.claude/skills/bb-submitter-batch.md`:

```markdown
# bb-submitter Batch

Batch mode: submit to all known sites with resume support.

## Workflow

1. Check for existing batch lock: `loadBatchLock()` from batcher.ts
   - Exists → resume from `current_site` in queue
   - Not exists → new: `createBatchLock(product, siteQueue)`
2. Build site queue: `buildSiteQueue(allSites, successSites)` — skips success and needs_review
3. For each site in queue:
   - Run submit workflow (see bb-submitter-submit skill)
   - After completion: `updateBatchProgress(site)` to advance lock file
   - Rate limit: 5-10s random delay between sites
4. Handle interventions with timeout (`--timeout N` minutes):
   - Show: "[intervention] <site>: <reason> (timeout: N min)"
   - Timeout reached → mark as pending, skip, continue
5. Daemon crash recovery:
   - Detect daemon not running → auto `bb-browser daemon start` (max 3 retries)
   - If restart fails → record failure, skip site
6. Lock file corruption:
   - `loadBatchLock()` returns null on corrupt file → rescan tracker to rebuild queue
7. Consecutive failure threshold:
   - 5 consecutive failures → systemic failure → stop batch, notify user
8. On completion: `deleteBatchLock()`, print summary (success/failed/pending counts)
```

- [ ] **Step 4: Create knowledge-validate skill**

`.claude/skills/bb-submitter-knowledge-validate.md`:

```markdown
# bb-submitter Knowledge Validate

Check if site knowledge is still valid by opening the submit page and verifying each step's element exists.

## Workflow

1. Load site knowledge: `loadKnowledge(siteId)`
2. `bb-browser open <site.url>`
3. `bb-browser snapshot -i`
4. For each workflow step with a semantic selector:
   - Try to match element using `matchRef()`
   - For select_category steps: also check that mapped values still exist in select options
5. Report: valid (all match direct), partial (some semantic fallback), broken (elements missing)
6. Update `last_validated` timestamp in knowledge YAML
```

- [ ] **Step 5: Commit**

```bash
git add .claude/
git commit -m "feat: add Claude Code skills for teach/submit/batch/knowledge-validate workflows"
```

---

## Chunk 9: End-to-End Integration & Final Polish

### Task 9.1: Create sample product data

**Files:**
- Create: `products/example/product.yaml`
- Create: `knowledge/sites/.gitkeep`
- Create: `submissions/.gitkeep`
- Create: `.gitignore`

- [ ] **Step 1: Create example product.yaml**

```yaml
name: "Example App"
tagline: "An example product for testing"
description:
  short: "Short description under 200 chars"
  full: "A full description with features and benefits."
  zh: "示例产品描述"
url: "https://example.com"
category_tags:
  - AI
  - Productivity
tech_stack:
  - React
  - Node.js
social:
  twitter: "@example"
  github: "example/app"
launch_date: 2026-01-15
pricing:
  model: freemium
  starting_price: "$9/mo"
contact_email: "hello@example.com"
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
dist/
products/__test__/
knowledge/sites/__test__/
knowledge/sites/.drafts/
knowledge/__test_*
submissions/.batch-running
*.log
```

- [ ] **Step 3: Add gitkeep files**

```bash
touch knowledge/sites/.gitkeep
touch submissions/.gitkeep
```

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS

- [ ] **Step 5: Final commit**

```bash
git add products/example/product.yaml knowledge/sites/.gitkeep submissions/.gitkeep .gitignore
git commit -m "feat: add sample product data, .gitignore, finalize project structure"
```

---

## Summary of Deliverables

| Module | Files | Purpose |
|--------|-------|---------|
| Types | `src/types.ts` | All shared interfaces |
| Product Store | `src/product-store.ts` | Load/validate product.yaml |
| Knowledge Base | `src/knowledge-base.ts` | CRUD + validation for site knowledge |
| Category Mapper | `src/category-mapper.ts` | Global category tag → site category |
| bb-browser Wrapper | `src/bb-browser.ts` | TypeScript wrappers for bb-browser CLI |
| Ref Utils | `src/ref-utils.ts` | Ref matching, semantic selectors |
| Executor | `src/executor.ts` | Deterministic workflow step execution |
| HITL | `src/hitl.ts` | Intervention pause protocol + error classifier |
| Tracker | `src/tracker.ts` | Submission progress tracking |
| Batcher | `src/batcher.ts` | Batch mode + resume + lock file |
| CLI | `src/cli.ts` | Command-line interface (Commander.js) |
| Skills | `.claude/skills/` | Claude Code agent prompts for teach/submit/batch |

## Implementation Order

1. Chunk 1: Scaffold + Types + Product Store
2. Chunk 2: Knowledge Base + Category Mapper
3. Chunk 3: bb-browser Wrapper + Ref Utils
4. Chunk 4: Executor
5. Chunk 5: HITL + Tracker
6. Chunk 6: Batcher
7. Chunk 7: CLI
8. Chunk 8: Agent Skills
9. Chunk 9: Integration & Polish
