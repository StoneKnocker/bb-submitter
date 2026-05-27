import { classifyError, isRetriableError } from './executor.js';
import type { WorkflowStep } from './types.js';

export { classifyError, isRetriableError };

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface InterventionRequest {
  site: string;
  reason: string;
  step: WorkflowStep;
  timeoutMinutes?: number;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format an intervention request into a user-facing prompt string.
 *
 * Output format:
 * ```
 * [intervention] <site>: <reason> (timeout: <timeoutMinutes> min)
 * 操作: 在浏览器中完成操作后输入 'done' 继续
 * 或输入 'skip' 跳过此站, 'retry' 重试当前步骤
 * ```
 * The `(timeout: ...)` part is omitted when `timeoutMinutes` is not set.
 */
export function formatIntervention(req: InterventionRequest): string {
  let output = `[intervention] ${req.site}: ${req.reason}`;
  if (req.timeoutMinutes !== undefined) {
    output += ` (timeout: ${req.timeoutMinutes} min)`;
  }
  output += `\n操作: 在浏览器中完成操作后输入 'done' 继续`;
  output += `\n或输入 'skip' 跳过此站, 'retry' 重试当前步骤`;
  return output;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Display the intervention prompt to the user and parse their response.
 *
 * Accepted inputs:
 * - `'done'` / `'d'` → `'done'`
 * - `'skip'` / `'s'` → `'skip'`
 * - `'retry'` / `'r'` → `'retry'`
 * - Anything else defaults to `'done'`.
 */
export async function handleIntervention(
  req: InterventionRequest,
  getUserInput: (prompt: string) => Promise<string>,
): Promise<'done' | 'skip' | 'retry'> {
  const prompt = formatIntervention(req);
  const response = await getUserInput(prompt);
  const trimmed = response.trim().toLowerCase();

  switch (trimmed) {
    case 'done':
    case 'd':
      return 'done';
    case 'skip':
    case 's':
      return 'skip';
    case 'retry':
    case 'r':
      return 'retry';
    default:
      return 'done';
  }
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/**
 * Return `true` for error categories that indicate a user-interactive
 * intervention is needed (rather than a transient / auto-retriable issue).
 */
export function isInteractiveError(category: string): boolean {
  return ['dom_change', 'captcha', 'oauth', 'form_validation'].includes(category);
}
