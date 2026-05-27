import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkflowStep } from '../src/types.js';
import type { ExecutorContext } from '../src/executor.js';

// ---------------------------------------------------------------------------
// Mock helpers — use vi.hoisted so the factory runs before vi.mock.
// We keep a separate DEFAULT_RETURN_VALUES map so the test harness can
// fully reset each mock (including mockReturnValueOnce leftovers) in
// beforeEach.
// ---------------------------------------------------------------------------
type MockMap = Record<string, ReturnType<typeof vi.fn>>;

const mocks = vi.hoisted(() => {
  const defaultValues: Record<string, { ok: boolean; stdout: string; stderr: string }> = {
    bbOpen: { ok: true, stdout: '', stderr: '' },
    bbSnapshot: {
      ok: true,
      stdout: '@1 [input] placeholder=\'Name\'',
      stderr: '',
    },
    bbClick: { ok: true, stdout: '', stderr: '' },
    bbFill: { ok: true, stdout: '', stderr: '' },
    bbUpload: { ok: true, stdout: '', stderr: '' },
    bbSelect: { ok: true, stdout: '', stderr: '' },
    bbCheck: { ok: true, stdout: '', stderr: '' },
    bbUncheck: { ok: true, stdout: '', stderr: '' },
    bbPress: { ok: true, stdout: '', stderr: '' },
    bbWait: { ok: true, stdout: '', stderr: '' },
    bbEval: { ok: true, stdout: '', stderr: '' },
    bbGet: { ok: true, stdout: '', stderr: '' },
  };

  // Store the values for use in resetAllMocks later (exported on the return
  // object so the describe block can reference them).
  const fns: MockMap = {};
  for (const [name, val] of Object.entries(defaultValues)) {
    fns[name] = vi.fn(() => ({ ...val }));
  }
  return { ...fns, _defaultValues: defaultValues } as MockMap & {
    _defaultValues: typeof defaultValues;
  };
});

vi.mock('../src/bb-browser.js', () => {
  const { _defaultValues: _, ...rest } = mocks;
  return rest;
});

// ---------------------------------------------------------------------------
// Module under test — imported AFTER mock
// ---------------------------------------------------------------------------
import {
  executeStep,
  executeWorkflow,
  executeStepWithRetry,
  resolveValue,
  resolveProductPath,
  classifyError,
  isRetriableError,
} from '../src/executor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const NAME_INPUT_REF = '@1 [input] placeholder=\'Name\'';

/**
 * Fully reset every mock: clear call history, wipe mockReturnValueOnce
 * leftovers, and restore the default implementation.
 */
function resetAllMocks(): void {
  for (const [name, val] of Object.entries(mocks._defaultValues)) {
    const fn = (mocks as MockMap)[name];
    if (fn && typeof fn.mockReset === 'function') {
      fn.mockReset();
      fn.mockReturnValue({ ...val });
    }
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
beforeEach(() => {
  resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// resolveValue
// ---------------------------------------------------------------------------

describe('resolveValue', () => {
  it('returns step.value when present', () => {
    const step = { value: 'hello' } as WorkflowStep;
    expect(resolveValue(step, {})).toBe('hello');
  });

  it('resolves product.source from context.product', () => {
    const step = { source: 'product.name' } as WorkflowStep;
    const ctx: ExecutorContext = { product: { name: 'MyApp' } };
    expect(resolveValue(step, ctx)).toBe('MyApp');
  });

  it('resolves nested product path', () => {
    const step = { source: 'product.description.short' } as WorkflowStep;
    const ctx: ExecutorContext = {
      product: { description: { short: 'Nested value' } },
    };
    expect(resolveValue(step, ctx)).toBe('Nested value');
  });

  it('falls back to source string when not a product path', () => {
    const step = { source: 'some-literal-text' } as WorkflowStep;
    expect(resolveValue(step, {})).toBe('some-literal-text');
  });

  it('returns empty string when nothing is set', () => {
    expect(resolveValue({} as WorkflowStep, {})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// executeStep
// ---------------------------------------------------------------------------

describe('executeStep', () => {
  it('open: calls bbOpen with target', async () => {
    const step: WorkflowStep = { action: 'open', target: 'https://example.com' };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbOpen).toHaveBeenCalledWith('https://example.com');
  });

  it('fill: resolves product source and calls bbFill', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: NAME_INPUT_REF,
      source: 'product.name',
    };
    const ctx: ExecutorContext = { product: { name: 'TestCo' } };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(true);
    expect(mocks.bbSnapshot).toHaveBeenCalledWith({ interactive: false });
    expect(mocks.bbFill).toHaveBeenCalledWith('@1', 'TestCo');
  });

  it('fill: uses literal value when provided', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: NAME_INPUT_REF,
      value: 'My Startup',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbFill).toHaveBeenCalledWith('@1', 'My Startup');
  });

  it('fill: resolves nested product source', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: NAME_INPUT_REF,
      source: 'product.description.short',
    };
    const ctx: ExecutorContext = {
      product: { description: { short: 'AI-powered tool' } },
    };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(true);
    expect(mocks.bbFill).toHaveBeenCalledWith('@1', 'AI-powered tool');
  });

  it('fill: verifies bbFill is called with correct ref and value', async () => {
    const step: WorkflowStep = {
      action: 'fill',
      ref: NAME_INPUT_REF,
      value: 'ExactMatch',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbFill).toHaveBeenCalledTimes(1);
    expect(mocks.bbFill).toHaveBeenCalledWith('@1', 'ExactMatch');
  });

  it('click: calls bbClick after ref resolution', async () => {
    const step: WorkflowStep = {
      action: 'click',
      ref: NAME_INPUT_REF,
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbClick).toHaveBeenCalledWith('@1');
  });

  it('select: resolves value and calls bbSelect', async () => {
    const step: WorkflowStep = {
      action: 'select',
      ref: NAME_INPUT_REF,
      value: 'Option 1',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbSelect).toHaveBeenCalledWith('@1', 'Option 1');
  });

  it('select_category: calls bbSelect with resolved value', async () => {
    const step: WorkflowStep = {
      action: 'select_category',
      ref: NAME_INPUT_REF,
      source: 'product.name',
    };
    const ctx: ExecutorContext = { product: { name: 'Software' } };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(true);
    expect(mocks.bbSelect).toHaveBeenCalledWith('@1', 'Software');
  });

  it('check: calls bbCheck with resolved ref', async () => {
    const step: WorkflowStep = {
      action: 'check',
      ref: '@1 [input]',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbCheck).toHaveBeenCalledWith('@1');
  });

  it('uncheck: calls bbUncheck with resolved ref', async () => {
    const step: WorkflowStep = {
      action: 'uncheck',
      ref: '@1 [input]',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbUncheck).toHaveBeenCalledWith('@1');
  });

  it('press: calls bbPress with value or default Enter', async () => {
    const step: WorkflowStep = { action: 'press', value: 'Escape' };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbPress).toHaveBeenCalledWith('Escape');
  });

  it('press: defaults to Enter', async () => {
    const step: WorkflowStep = { action: 'press' };
    await executeStep(step, {});
    expect(mocks.bbPress).toHaveBeenCalledWith('Enter');
  });

  it('wait: sleeps for value milliseconds', async () => {
    vi.useFakeTimers();
    const step: WorkflowStep = { action: 'wait', value: '100' };
    const promise = executeStep(step, {});
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ waited: 100 });
  });

  it('wait: calls bbWait with ref', async () => {
    const step: WorkflowStep = { action: 'wait', ref: '#submit-button' };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(mocks.bbWait).toHaveBeenCalledWith('#submit-button');
  });

  it('verify: checks if ref text appears in snapshot', async () => {
    const step: WorkflowStep = {
      action: 'verify',
      ref: 'placeholder',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(result.data?.found).toBe(true);
  });

  it('verify: returns ok false when text not found', async () => {
    mocks.bbSnapshot.mockImplementation(() => ({
      ok: true,
      stdout: '@1 [button] Submit',
      stderr: '',
    }));
    const step: WorkflowStep = {
      action: 'verify',
      ref: 'NonExistentText',
    };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(false);
    expect(result.data?.found).toBe(false);
  });

  it('eval: returns result in data', async () => {
    mocks.bbEval.mockImplementation(() => ({
      ok: true,
      stdout: '42',
      stderr: '',
    }));
    const step: WorkflowStep = { action: 'eval', value: '1 + 1' };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(result.data?.result).toBe('42');
  });

  it('record_result: returns confirmation_url from bbGet', async () => {
    mocks.bbGet.mockImplementation(() => ({
      ok: true,
      stdout: 'https://example.com/confirmed/123',
      stderr: '',
    }));
    const step: WorkflowStep = { action: 'record_result' };
    const result = await executeStep(step, {});
    expect(result.ok).toBe(true);
    expect(result.data?.confirmation_url).toBe(
      'https://example.com/confirmed/123',
    );
  });

  it('returns needsIntervention when ref resolution fails', async () => {
    mocks.bbSnapshot.mockImplementation(() => ({
      ok: true,
      stdout: '@5 [div] nothing-here',
      stderr: '',
    }));
    const step: WorkflowStep = {
      action: 'fill',
      ref: NAME_INPUT_REF,
      source: 'product.name',
    };
    const ctx: ExecutorContext = { product: { name: 'X' } };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(false);
    expect(result.needsIntervention).toBe(true);
    expect(result.interventionReason).toBe('DOM change: element not found');
  });

  it('calls onIntervention and skips when it returns skip', async () => {
    const onIntervention = vi.fn().mockResolvedValue('skip' as const);
    const step: WorkflowStep = {
      action: 'click',
      ref: NAME_INPUT_REF,
      human_intervention: 'Please login',
    };
    const ctx: ExecutorContext = { onIntervention };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(false);
    expect(result.needsIntervention).toBe(true);
    expect(onIntervention).toHaveBeenCalledWith('Please login', step);
    expect(mocks.bbClick).not.toHaveBeenCalled();
  });

  it('recurses when onIntervention returns retry', async () => {
    let callCount = 0;
    const onIntervention = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount >= 2 ? ('done' as const) : ('retry' as const);
    });
    const step: WorkflowStep = {
      action: 'click',
      ref: NAME_INPUT_REF,
      human_intervention: 'Retry me',
    };
    const ctx: ExecutorContext = { onIntervention };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(true);
    expect(onIntervention).toHaveBeenCalledTimes(2);
    expect(mocks.bbClick).toHaveBeenCalledTimes(1);
  });

  it('upload: calls bbUpload with resolved path', async () => {
    mocks.bbSnapshot.mockImplementation(() => ({
      ok: true,
      stdout: '@5 [input type=\'file\'] accept=\'image/*\'',
      stderr: '',
    }));
    const step: WorkflowStep = {
      action: 'upload',
      ref: '@5 [input type=\'file\']',
      source: 'product.logo.png',
    };
    const ctx: ExecutorContext = { productId: 'myapp' };
    const result = await executeStep(step, ctx);
    expect(result.ok).toBe(true);
    expect(mocks.bbUpload).toHaveBeenCalledTimes(1);
  });

  it('open: sleeps when step.wait is set', async () => {
    vi.useFakeTimers();
    const step: WorkflowStep = {
      action: 'open',
      target: 'https://example.com',
      wait: 200,
    };
    const promise = executeStep(step, {});
    await vi.runAllTimersAsync();
    await promise;
    expect(mocks.bbOpen).toHaveBeenCalledWith('https://example.com');
  });

  it('open: calls bbWait when step.wait_for is set', async () => {
    const step: WorkflowStep = {
      action: 'open',
      target: 'https://example.com',
      wait_for: '#app-loaded',
    };
    await executeStep(step, {});
    expect(mocks.bbWait).toHaveBeenCalledWith('#app-loaded');
  });
});

// ---------------------------------------------------------------------------
// resolveProductPath
// ---------------------------------------------------------------------------

describe('resolveProductPath', () => {
  it('returns source as-is when productId is missing', () => {
    expect(resolveProductPath('product.logo.png')).toBe('product.logo.png');
  });

  it('returns source as-is when source has no product. prefix', () => {
    expect(resolveProductPath('/absolute/path.png', 'myapp')).toBe('/absolute/path.png');
  });

  it('returns source as-is when file does not exist', () => {
    expect(resolveProductPath('product.logo.png', 'nonexistent')).toBe('product.logo.png');
  });
});

// ---------------------------------------------------------------------------
// executeWorkflow
// ---------------------------------------------------------------------------

describe('executeWorkflow', () => {
  it('executes all steps in sequence', async () => {
    const steps: WorkflowStep[] = [
      { action: 'open', target: 'https://example.com' },
      { action: 'fill', ref: NAME_INPUT_REF, value: 'Test' },
      { action: 'press' },
    ];
    const results = await executeWorkflow(steps);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(mocks.bbOpen).toHaveBeenCalledTimes(1);
    expect(mocks.bbFill).toHaveBeenCalledTimes(1);
    expect(mocks.bbPress).toHaveBeenCalledTimes(1);
  });

  it('stops on human_intervention step', async () => {
    const onIntervention = vi.fn().mockResolvedValue('skip' as const);
    const steps: WorkflowStep[] = [
      { action: 'open', target: 'https://example.com' },
      {
        action: 'click',
        ref: '@1 [button]',
        human_intervention: 'Please verify',
      },
      { action: 'click', ref: '@2 [button]' },
    ];
    const results = await executeWorkflow(steps, undefined, onIntervention);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].needsIntervention).toBe(true);
    expect(onIntervention).toHaveBeenCalledWith('Please verify', steps[1]);
  });

  it('continues past verify failures', async () => {
    mocks.bbSnapshot.mockImplementation(() => ({
      ok: true,
      stdout: '@1 [div] no-match',
      stderr: '',
    }));
    const steps: WorkflowStep[] = [
      { action: 'verify', ref: 'missing-text' },
      { action: 'open', target: 'https://example.com' },
    ];
    const results = await executeWorkflow(steps);
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(false); // verify failed
    expect(results[1].ok).toBe(true); // open still ran
  });

  it('stops on non-verify error', async () => {
    mocks.bbOpen.mockImplementation(() => ({
      ok: false,
      stdout: '',
      stderr: 'connection refused',
    }));
    const steps: WorkflowStep[] = [
      { action: 'open', target: 'https://example.com' },
      { action: 'fill', ref: NAME_INPUT_REF, value: 'Test' },
    ];
    const results = await executeWorkflow(steps);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyError / isRetriableError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  const base = { ok: false as const, step: {} as WorkflowStep };

  it('classifies timeout errors as network', () => {
    expect(classifyError({ ...base, error: 'timeout' })).toBe('network');
  });

  it('classifies econnrefused as network', () => {
    expect(classifyError({ ...base, error: 'ECONNREFUSED' })).toBe('network');
  });

  it('classifies verification failed as dom_change', () => {
    expect(classifyError({ ...base, error: 'verify failed' })).toBe(
      'dom_change',
    );
  });

  it('classifies 403 as server_reject', () => {
    expect(classifyError({ ...base, error: 'HTTP 403' })).toBe('server_reject');
  });

  it('classifies 429 as server_reject', () => {
    expect(classifyError({ ...base, error: 'status 429' })).toBe(
      'server_reject',
    );
  });

  it('classifies validation errors as form_validation', () => {
    expect(classifyError({ ...base, error: 'validation required' })).toBe(
      'form_validation',
    );
  });

  it('classifies captcha intervention as captcha', () => {
    expect(
      classifyError({
        ...base,
        needsIntervention: true,
        interventionReason: 'captcha detected',
      }),
    ).toBe('captcha');
  });

  it('classifies oauth intervention as oauth', () => {
    expect(
      classifyError({
        ...base,
        needsIntervention: true,
        interventionReason: 'oauth login required',
      }),
    ).toBe('oauth');
  });

  it('classifies file upload errors as file_upload_reject', () => {
    expect(classifyError({ ...base, error: 'file format not supported' })).toBe(
      'file_upload_reject',
    );
  });

  it('classifies unknown errors as unknown', () => {
    expect(classifyError({ ...base, error: 'something weird' })).toBe(
      'unknown',
    );
  });
});

describe('isRetriableError', () => {
  it('returns true for network', () => {
    expect(isRetriableError('network')).toBe(true);
  });

  it('returns false for dom_change', () => {
    expect(isRetriableError('dom_change')).toBe(false);
  });

  it('returns false for captcha', () => {
    expect(isRetriableError('captcha')).toBe(false);
  });

  it('returns false for oauth', () => {
    expect(isRetriableError('oauth')).toBe(false);
  });

  it('returns false for form_validation', () => {
    expect(isRetriableError('form_validation')).toBe(false);
  });

  it('returns false for file_upload_reject', () => {
    expect(isRetriableError('file_upload_reject')).toBe(false);
  });

  it('returns false for server_reject', () => {
    expect(isRetriableError('server_reject')).toBe(false);
  });

  it('returns false for unknown', () => {
    expect(isRetriableError('unknown')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeStepWithRetry
// ---------------------------------------------------------------------------

describe('executeStepWithRetry', () => {
  it('retries network errors up to 3 times', async () => {
    vi.useFakeTimers();

    mocks.bbOpen.mockImplementation(() => ({
      ok: false,
      stdout: '',
      stderr: 'Connection timeout',
    }));

    const step: WorkflowStep = { action: 'open', target: 'https://example.com' };
    const promise = executeStepWithRetry(step, {});

    // Advance clock through each retry delay:
    // attempt=1: sleep(5000), attempt=2: sleep(10000), attempt=3: sleep(30000)
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(30_000);

    const result = await promise;
    expect(result.ok).toBe(false);
    // 1 initial + 3 retries = 4 total attempts
    expect(mocks.bbOpen).toHaveBeenCalledTimes(4);
  });

  it('stops retrying when step succeeds', async () => {
    vi.useFakeTimers();

    // Fail twice, succeed on third attempt
    let callCount = 0;
    mocks.bbOpen.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false as const, stdout: '', stderr: 'timeout' };
      }
      return { ok: true as const, stdout: '', stderr: '' };
    });

    const step: WorkflowStep = { action: 'open', target: 'https://example.com' };
    const promise = executeStepWithRetry(step, {});

    // attempt=0: no sleep → bbOpen #1 (fail)
    // attempt=1: sleep(5000) → after advance → bbOpen #2 (fail)
    // attempt=2: sleep(10000) → after advance → bbOpen #3 (success)
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(mocks.bbOpen).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-network errors', async () => {
    // Replace default implementation inline (beforeEach already reset mocks)
    mocks.bbOpen.mockImplementation(() => ({
      ok: false,
      stdout: '',
      stderr: 'validation failed',
    }));

    const step: WorkflowStep = { action: 'open', target: 'https://example.com' };
    const result = await executeStepWithRetry(step, {});

    expect(result.ok).toBe(false);
    // Only the initial attempt — form_validation is not retriable
    expect(mocks.bbOpen).toHaveBeenCalledTimes(1);
  });

  it('does not retry dom_change errors', async () => {
    mocks.bbOpen.mockImplementation(() => ({
      ok: false,
      stdout: '',
      stderr: 'verify failed',
    }));

    const step: WorkflowStep = { action: 'open', target: 'https://example.com' };
    const result = await executeStepWithRetry(step, {});

    expect(result.ok).toBe(false);
    expect(mocks.bbOpen).toHaveBeenCalledTimes(1);
  });

  it('respects custom maxRetries', async () => {
    vi.useFakeTimers();

    mocks.bbOpen.mockImplementation(() => ({
      ok: false,
      stdout: '',
      stderr: 'timeout',
    }));

    const step: WorkflowStep = { action: 'open', target: 'https://example.com' };
    const promise = executeStepWithRetry(step, {}, 1); // only 1 retry

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.ok).toBe(false);
    // 1 initial + 1 retry = 2 total
    expect(mocks.bbOpen).toHaveBeenCalledTimes(2);
  });
});
