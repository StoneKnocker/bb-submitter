import { execFileSync } from 'child_process';

export interface BbBrowserResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const BIN = 'bb-browser';

let _currentTab = '';

export function setCurrentTab(tab: string): void {
  _currentTab = tab;
}

export function getCurrentTab(): string {
  return _currentTab;
}

function run(args: string[], timeoutMs = 30000): BbBrowserResult {
  try {
    const stdout = execFileSync(BIN, args, {
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
  const result = run(args);
  if (result.ok) {
    const m = result.stdout.match(/Tab ID:\s*(\S+)/);
    if (m) _currentTab = m[1];
  }
  return result;
}

export function bbClose(): BbBrowserResult {
  const args = _currentTab ? ['close', '--tab', _currentTab] : ['close'];
  return run(args);
}

// Snapshot
export function bbSnapshot(options?: { interactive?: boolean; compact?: boolean }): BbBrowserResult {
  const args = ['snap'];
  if (options?.interactive !== false) args.push('-i');
  if (options?.compact) args.push('-c');
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

// Element interaction
export function bbClick(ref: string): BbBrowserResult {
  const args = ['click', ref];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbFill(ref: string, text: string): BbBrowserResult {
  const args = ['fill', ref, text];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbUpload(ref: string, filePath: string): BbBrowserResult {
  const args = ['upload', ref, filePath];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbSelect(ref: string, option: string): BbBrowserResult {
  const args = ['select', ref, option];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbCheck(ref: string): BbBrowserResult {
  const args = ['check', ref];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbUncheck(ref: string): BbBrowserResult {
  const args = ['uncheck', ref];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbPress(key: string): BbBrowserResult {
  const args = ['press', key];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

// Info
export function bbGet(info: string, ref?: string): BbBrowserResult {
  const args = ['get', info];
  if (ref) args.push(ref);
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbEval(js: string): BbBrowserResult {
  const args = ['eval', js];
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

export function bbScreenshot(path?: string): BbBrowserResult {
  const args = ['screenshot'];
  if (path) args.push(path);
  if (_currentTab) args.push('--tab', _currentTab);
  return run(args);
}

// Daemon
export function bbDaemonStart(): BbBrowserResult { return run(['daemon', 'start']); }
export function bbDaemonStatus(): BbBrowserResult { return run(['daemon', 'status']); }
export function bbDaemonStop(): BbBrowserResult { return run(['daemon', 'stop']); }

// Wait for element (poll via eval, since CLI has no native wait command)
export function bbWaitForElement(selector: string, timeoutMs = 30000): BbBrowserResult {
  const start = Date.now();
  let lastResult: BbBrowserResult = { ok: false, stdout: '', stderr: '' };
  while (Date.now() - start < timeoutMs) {
    const checkJs = `document.querySelector(${JSON.stringify(selector)}) !== null`;
    const r = bbEval(checkJs);
    if (r.ok && r.stdout === 'true') return r;
    lastResult = r;
    // sleep 500ms before next poll
    const until = Date.now() + 500;
    while (Date.now() < until); // sync sleep - fine in execFileSync context
  }
  return { ok: false, stdout: '', stderr: `wait_for '${selector}' timed out after ${timeoutMs}ms` };
}
