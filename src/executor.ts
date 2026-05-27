import { resolve } from 'path';
import { existsSync } from 'fs';
import type { WorkflowStep, StepAction } from './types.js';
import {
  bbOpen,
  bbSnapshot,
  bbClick,
  bbFill,
  bbUpload,
  bbSelect,
  bbCheck,
  bbUncheck,
  bbPress,
  bbWait,
  bbEval,
  bbGet,
} from './bb-browser.js';
import { matchRef } from './ref-utils.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

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
  productId?: string;
  onIntervention?: (reason: string, step: WorkflowStep) => Promise<'done' | 'skip' | 'retry'>;
  snapshotCache?: string;
}

type ErrorCategory =
  | 'network'
  | 'dom_change'
  | 'captcha'
  | 'oauth'
  | 'form_validation'
  | 'server_reject'
  | 'file_upload_reject'
  | 'unknown';

// Actions that require a DOM ref to be resolved before execution.
const REF_ACTIONS: StepAction[] = [
  'click',
  'fill',
  'upload',
  'select',
  'select_category',
  'check',
  'uncheck',
];

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Value / path resolution helpers
// ---------------------------------------------------------------------------

/**
 * Walk a dotted path inside an object.  Returns `undefined` for missing keys.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  const start = parts[0] === 'product' ? 1 : 0;
  let current: unknown = obj;
  for (let i = start; i < parts.length; i++) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  return current;
}

/**
 * Resolve the literal string value for a fill / select step.
 *
 * Priority:
 * 1. `step.value` (literal) if present
 * 2. `step.source` prefixed with `product.` → resolve dotted path from
 *    `context.product`
 * 3. `step.source` as a raw string
 * 4. empty string fallback
 */
export function resolveValue(
  step: WorkflowStep,
  context: ExecutorContext,
): string {
  if (step.value !== undefined) return step.value;

  if (step.source) {
    if (step.source.startsWith('product.') && context.product) {
      const resolved = getByPath(context.product, step.source);
      if (resolved !== undefined && resolved !== null) return String(resolved);
    }
    return step.source;
  }

  return '';
}

/**
 * Convert a `product.<filename>` source into an absolute file-system path.
 *
 * Pattern: `product.logo-256x256.png` → `products/<productId>/logo-256x256.png`
 *
 * The resolved path is checked with `existsSync`; if the file does not exist
 * the original source is returned unchanged.
 */
export function resolveProductPath(
  source: string,
  productId?: string,
): string {
  if (source.startsWith('product.') && productId) {
    const filename = source.slice('product.'.length);
    const fullPath = resolve(process.cwd(), 'products', productId, filename);
    if (existsSync(fullPath)) return fullPath;
  }
  return source;
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

/**
 * Take a fresh snapshot and attempt to match `step.ref` against the live DOM.
 *
 * Caches the snapshot text in `context.snapshotCache` for later inspection.
 * Returns the resolved ref string (e.g. `@3`) or `null` if no match.
 */
export function resolveRef(
  step: WorkflowStep,
  context: ExecutorContext,
): string | null {
  const snapshot = bbSnapshot({ interactive: false });
  context.snapshotCache = snapshot.stdout;
  if (!step.ref) return null;
  const match = matchRef(step.ref, snapshot.stdout, step.semantic);
  return match ? match.ref : null;
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute a single workflow step.
 *
 * - Checks `human_intervention` before any action logic.
 * - Resolves the DOM ref for actions that need one.
 * - Dispatches to the correct bb-browser wrapper.
 * - Always returns a `StepResult` (does not throw).
 */
export async function executeStep(
  step: WorkflowStep,
  context: ExecutorContext = {},
): Promise<StepResult> {
  // ---- human intervention gate -------------------------------------------
  if (step.human_intervention && context.onIntervention) {
    try {
      const decision = await context.onIntervention(
        step.human_intervention,
        step,
      );
      if (decision === 'skip') {
        return {
          ok: false,
          step,
          needsIntervention: true,
          interventionReason: step.human_intervention,
        };
      }
      if (decision === 'retry') {
        return executeStep(step, context);
      }
      // 'done' → fall through and execute normally
    } catch {
      // If the callback throws, treat it as 'done' and continue.
    }
  }

  // ---- ref resolution ----------------------------------------------------
  let resolvedRef: string | null = null;
  if (REF_ACTIONS.includes(step.action)) {
    resolvedRef = resolveRef(step, context);
    if (!resolvedRef) {
      return {
        ok: false,
        step,
        needsIntervention: true,
        interventionReason: 'DOM change: element not found',
        error: 'ref resolution failed',
      };
    }
  }

  // ---- action dispatch ---------------------------------------------------
  switch (step.action) {
    case 'open': {
      const r = bbOpen(step.target!);
      if (step.wait) await sleep(step.wait);
      if (step.wait_for) bbWait(step.wait_for);
      return {
        ok: r.ok,
        step,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'click': {
      const r = bbClick(resolvedRef!);
      if (step.wait) await sleep(step.wait);
      return {
        ok: r.ok,
        step,
        data: r.ok ? { ref: resolvedRef } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'fill': {
      const value = resolveValue(step, context);
      const r = bbFill(resolvedRef!, value);
      return {
        ok: r.ok,
        step,
        data: r.ok ? { ref: resolvedRef, value } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'upload': {
      const filePath = resolveProductPath(
        step.source || step.value || '',
        context.productId,
      );
      const r = bbUpload(resolvedRef!, filePath);
      return {
        ok: r.ok,
        step,
        data: r.ok ? { ref: resolvedRef, path: filePath } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'select':
    case 'select_category': {
      const value = resolveValue(step, context);
      const r = bbSelect(resolvedRef!, value);
      return {
        ok: r.ok,
        step,
        data: r.ok ? { ref: resolvedRef, value } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'check': {
      const r = bbCheck(resolvedRef!);
      return {
        ok: r.ok,
        step,
        data: r.ok ? { ref: resolvedRef } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'uncheck': {
      const r = bbUncheck(resolvedRef!);
      return {
        ok: r.ok,
        step,
        data: r.ok ? { ref: resolvedRef } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'press': {
      const r = bbPress(step.value || 'Enter');
      return {
        ok: r.ok,
        step,
        data: r.ok ? { key: step.value || 'Enter' } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'wait': {
      if (step.value) {
        const ms = parseInt(step.value, 10);
        if (!isNaN(ms)) {
          await sleep(ms);
          return { ok: true, step, data: { waited: ms } };
        }
      }
      if (step.ref) {
        const r = bbWait(step.ref);
        return {
          ok: r.ok,
          step,
          data: r.ok ? { waitedFor: step.ref } : undefined,
          error: r.ok ? undefined : r.stderr || r.stdout || undefined,
        };
      }
      return { ok: true, step };
    }

    case 'verify': {
      const snapshot = bbSnapshot({ interactive: false });
      const found = step.ref ? snapshot.stdout.includes(step.ref) : false;
      return {
        ok: found,
        step,
        data: { found, snapshot: snapshot.stdout },
      };
    }

    case 'eval': {
      const r = bbEval(step.value || '');
      return {
        ok: r.ok,
        step,
        data: r.ok ? { result: r.stdout } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    case 'record_result': {
      const r = bbGet('url');
      return {
        ok: r.ok,
        step,
        data: r.ok ? { confirmation_url: r.stdout } : undefined,
        error: r.ok ? undefined : r.stderr || r.stdout || undefined,
      };
    }

    default:
      return {
        ok: false,
        step,
        error: `Unknown action: ${step.action}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Workflow runner
// ---------------------------------------------------------------------------

/**
 * Execute a sequence of workflow steps.
 *
 * Iterates every step in order.  Stops on the first step that returns
 * `needsIntervention` or an error (unless the action is `verify`, which
 * is allowed to fail without halting the pipeline).
 *
 * Returns the results for all executed steps (including the failing one).
 */
export async function executeWorkflow(
  steps: WorkflowStep[],
  product?: Record<string, unknown>,
  onIntervention?: (
    reason: string,
    step: WorkflowStep,
  ) => Promise<'done' | 'skip' | 'retry'>,
  productId?: string,
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const context: ExecutorContext = { product, onIntervention, productId };

  for (const step of steps) {
    const result = await executeStep(step, context);
    results.push(result);

    // Stop on intervention or non-verify errors.
    if (!result.ok) {
      if (result.needsIntervention) break;
      if (step.action !== 'verify') break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [5000, 10_000, 30_000];

/**
 * Classify an error from a `StepResult` into a category that drives retry
 * decisions.
 */
export function classifyError(result: StepResult): ErrorCategory {
  const err = (result.error || '').toLowerCase();

  if (/timeout|econnrefused|enotfound|econnreset|econnaborted/i.test(err)) {
    return 'network';
  }
  if (/verif.*failed|failed.*verif/i.test(err)) {
    return 'dom_change';
  }
  if (/\b(403|429|500)\b/.test(err)) {
    return 'server_reject';
  }
  if (/validation|required|invalid/i.test(err)) {
    return 'form_validation';
  }
  if (/file.*(?:format|size|type|reject)|invalid.*file|upload.*fail/i.test(err)) {
    return 'file_upload_reject';
  }

  const reason = (result.interventionReason || '').toLowerCase();
  if (/captcha|验证码/.test(reason)) {
    return 'captcha';
  }
  if (/oauth|login|登录/.test(reason)) {
    return 'oauth';
  }

  return 'unknown';
}

/**
 * Return `true` only for error categories that warrant an automatic retry.
 */
export function isRetriableError(category: ErrorCategory): boolean {
  return category === 'network';
}

/**
 * Execute a step with automatic retries for network errors.
 *
 * Delays between attempts: 5 s, 10 s, 30 s.
 * Non-network errors and exhausted retries return the last result immediately.
 */
export async function executeStepWithRetry(
  step: WorkflowStep,
  context: ExecutorContext,
  maxRetries = 3,
): Promise<StepResult> {
  let lastResult: StepResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
      await sleep(delay);
    }

    lastResult = await executeStep(step, context);
    if (lastResult.ok) return lastResult;

    const category = classifyError(lastResult);
    if (!isRetriableError(category)) return lastResult;
  }

  return lastResult!;
}
