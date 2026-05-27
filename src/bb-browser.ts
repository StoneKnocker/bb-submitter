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

export function bbOpen(url: string, tab?: string): BbBrowserResult {
  const args = ['open', url];
  if (tab) args.push('--tab', tab);
  return run(args);
}

export function bbClose(): BbBrowserResult { return run(['close']); }

export function bbSnapshot(options?: { interactive?: boolean; compact?: boolean }): BbBrowserResult {
  const args = ['snapshot'];
  if (options?.interactive !== false) args.push('-i');
  if (options?.compact) args.push('-c');
  return run(args);
}

export function bbClick(ref: string): BbBrowserResult { return run(['click', ref]); }
export function bbFill(ref: string, text: string): BbBrowserResult { return run(['fill', ref, text]); }
export function bbUpload(ref: string, filePath: string): BbBrowserResult { return run(['upload', ref, filePath]); }
export function bbSelect(ref: string, option: string): BbBrowserResult { return run(['select', ref, option]); }
export function bbCheck(ref: string): BbBrowserResult { return run(['check', ref]); }
export function bbUncheck(ref: string): BbBrowserResult { return run(['uncheck', ref]); }
export function bbPress(key: string): BbBrowserResult { return run(['press', key]); }
export function bbGet(info: string, ref?: string): BbBrowserResult {
  const args = ['get', info];
  if (ref) args.push(ref);
  return run(args);
}
export function bbEval(js: string): BbBrowserResult { return run(['eval', js]); }
export function bbScreenshot(path?: string): BbBrowserResult {
  const args = ['screenshot'];
  if (path) args.push(path);
  return run(args);
}
export function bbWait(target: string | number): BbBrowserResult { return run(['wait', String(target)]); }
export function bbDaemonStart(): BbBrowserResult { return run(['daemon', 'start']); }
export function bbDaemonStatus(): BbBrowserResult { return run(['daemon', 'status']); }
export function bbDaemonStop(): BbBrowserResult { return run(['daemon', 'stop']); }
