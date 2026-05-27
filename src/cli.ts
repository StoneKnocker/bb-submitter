#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dump, load } from 'js-yaml';
import { loadProduct } from './product-store.js';
import {
  loadKnowledge,
  listSites,
  saveKnowledge,
  loadDraft,
  validateKnowledgeStructure,
} from './knowledge-base.js';
import {
  loadTracker,
  saveTracker,
  updateEntry,
  getSummary,
} from './tracker.js';
import { executeWorkflow } from './executor.js';
import {
  createBatchLock,
  loadBatchLock,
  updateBatchProgress,
  deleteBatchLock,
  buildSiteQueue,
} from './batcher.js';
import {
  handleIntervention,
  classifyError,
  isInteractiveError,
} from './hitl.js';
import type { WorkflowStep, SiteKnowledge } from './types.js';
import type { StepResult } from './executor.js';
import type { InterventionRequest } from './hitl.js';

// ---------------------------------------------------------------------------
// Stdio helpers
// ---------------------------------------------------------------------------

function readUserInput(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.once('data', (data: Buffer | string) => {
      resolve(data.toString().trim());
    });
  });
}

function readUserInputWithTimeout(timeoutMinutes: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      resolve('done');
    }, timeoutMs);

    process.stdin.once('data', (data: Buffer | string) => {
      clearTimeout(timer);
      resolve(data.toString().trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Product file helpers
// ---------------------------------------------------------------------------

function resolveProductData(
  productId: string,
): Record<string, unknown> {
  const product = loadProduct(productId);
  return product as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Intervention callback factories
// ---------------------------------------------------------------------------

function makeInteractiveIntervention(
  site: string,
): (reason: string, step: WorkflowStep) => Promise<'done' | 'skip' | 'retry'> {
  return (reason: string, step: WorkflowStep) => {
    const req: InterventionRequest = { site, reason, step };
    return handleIntervention(req, async (prompt: string) => {
      console.log(prompt);
      return readUserInput();
    });
  };
}

function makeTimedIntervention(
  site: string,
  timeoutMinutes: number,
): (reason: string, step: WorkflowStep) => Promise<'done' | 'skip' | 'retry'> {
  return (reason: string, step: WorkflowStep) => {
    const req: InterventionRequest = { site, reason, step, timeoutMinutes };
    return handleIntervention(req, async (prompt: string) => {
      console.log(prompt);
      return readUserInputWithTimeout(timeoutMinutes);
    });
  };
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function extractConfirmationUrl(results: StepResult[]): string | undefined {
  const recordResult = results.find(
    (r) => r.step.action === 'record_result' && r.ok,
  );
  return recordResult?.data?.confirmation_url as string | undefined;
}

function resultsAllOk(results: StepResult[]): boolean {
  return results.length > 0 && results.every((r) => r.ok);
}

function updateTrackerAfterSubmission(
  tracker: ReturnType<typeof loadTracker>,
  site: string,
  results: StepResult[],
): void {
  const lastResult = results[results.length - 1];

  if (resultsAllOk(results)) {
    const confirmationUrl = extractConfirmationUrl(results);
    updateEntry(tracker, site, 'success', {
      confirmation_url: confirmationUrl,
      submitted_at: new Date().toISOString(),
    });
    console.log(
      `[submit] ${site}: success${confirmationUrl ? ` (${confirmationUrl})` : ''}`,
    );
  } else {
    const error = lastResult?.error || 'Unknown error';
    const category = classifyError(lastResult);
    if (isInteractiveError(category)) {
      updateEntry(tracker, site, 'pending', {
        error,
        reason: lastResult?.interventionReason,
      });
      console.log(`[submit] ${site}: needs review — ${error}`);
    } else {
      updateEntry(tracker, site, 'failed', { error });
      console.log(`[submit] ${site}: failed — ${error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// teach command
// ---------------------------------------------------------------------------

async function teachCmd(site: string, opts: { product?: string }): Promise<void> {
  if (!opts.product) {
    console.error('error: --product / -p is required');
    process.exit(1);
  }

  const product = loadProduct(opts.product);
  const draft = loadDraft(site);

  console.log('=== Teaching Mode ===');
  console.log(`Site:   ${site}`);
  console.log(`Product: ${product.name}`);
  if (draft) {
    console.log(`Draft exists for "${site}" — will resume from draft`);
  }
  console.log();
  console.log('Open bb-browser and record a workflow, then save the draft.');
  console.log('This CLI is a scaffold — the actual recording is driven');
  console.log('by the Agent interactively.');
}

// ---------------------------------------------------------------------------
// submit command
// ---------------------------------------------------------------------------

async function submitCmd(site: string, opts: { product?: string }): Promise<void> {
  if (!opts.product) {
    console.error('error: --product / -p is required');
    process.exit(1);
  }

  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const product = resolveProductData(opts.product);
  const knowledge = loadKnowledge(site);
  const tracker = loadTracker(opts.product);

  const onIntervention = makeInteractiveIntervention(site);

  console.log(`[submit] Submitting ${site} for product "${opts.product}"...`);

  const results = await executeWorkflow(
    knowledge.workflow.steps,
    product,
    onIntervention,
    opts.product,
  );

  updateTrackerAfterSubmission(tracker, site, results);
  saveTracker(tracker);
  process.stdin.pause();
}

// ---------------------------------------------------------------------------
// batch command
// ---------------------------------------------------------------------------

async function batchCmd(
  opts: { product?: string; sites?: string; timeout?: string },
): Promise<void> {
  if (!opts.product) {
    console.error('error: --product / -p is required');
    process.exit(1);
  }

  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const timeoutMinutes = opts.timeout ? parseInt(opts.timeout, 10) : 10;
  if (isNaN(timeoutMinutes) || timeoutMinutes < 1) {
    console.error('error: --timeout must be a positive number (minutes)');
    process.exit(1);
  }

  const product = resolveProductData(opts.product);
  const allSites: string[] = opts.sites
    ? opts.sites.split(',').map((s: string) => s.trim()).filter(Boolean)
    : listSites();

  if (allSites.length === 0) {
    console.log('[batch] No sites to process.');
    return;
  }

  const tracker = loadTracker(opts.product);
  const alreadySuccess = tracker.entries
    .filter((e) => e.status === 'success')
    .map((e) => e.site);

  let siteQueue: string[];
  let resumeMode = false;
  const existingLock = loadBatchLock();
  if (existingLock) {
    resumeMode = true;
    const currentIdx = existingLock.site_queue.indexOf(existingLock.current_site);
    const remaining = currentIdx >= 0
      ? existingLock.site_queue.slice(currentIdx)
      : existingLock.site_queue;
    // Filter out already-successful even in resume
    siteQueue = buildSiteQueue(remaining, alreadySuccess);
    console.log(
      `[batch] Resuming from "${existingLock.current_site}" (${siteQueue.length} sites remaining)`,
    );
  } else {
    siteQueue = buildSiteQueue(allSites, alreadySuccess);
  }

  if (siteQueue.length === 0) {
    console.log('[batch] All sites already submitted. Nothing to do.');
    deleteBatchLock();
    return;
  }

  console.log(`[batch] Starting batch for "${opts.product}" — ${siteQueue.length} site(s)`);

  if (!resumeMode) {
    createBatchLock(opts.product, siteQueue);
  }

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  for (let i = 0; i < siteQueue.length; i++) {
    const site = siteQueue[i];

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(
        `[batch] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping`,
      );
      break;
    }

    console.log(`\n[batch] [${i + 1}/${siteQueue.length}] Processing "${site}"...`);

    // Load knowledge — if missing, skip
    let knowledge: SiteKnowledge;
    try {
      knowledge = loadKnowledge(site);
    } catch {
      console.error(`[batch] ${site}: knowledge not found, skipping`);
      updateEntry(tracker, site, 'failed', { error: 'Knowledge file not found' });
      continue;
    }

    const onIntervention = makeTimedIntervention(site, timeoutMinutes);

    const results = await executeWorkflow(
      knowledge.workflow.steps,
      product,
      onIntervention,
      opts.product,
    );

    updateTrackerAfterSubmission(tracker, site, results);
    saveTracker(tracker);
    updateBatchProgress(site);

    const lastResult = results[results.length - 1];
    if (!lastResult?.ok) {
      consecutiveFailures++;
    } else {
      consecutiveFailures = 0;
    }

    // Rate limit: 5-10s random delay between sites
    if (i < siteQueue.length - 1) {
      const delay = 5000 + Math.random() * 5000;
      console.log(`[batch] Waiting ${Math.round(delay / 1000)}s before next site...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Reset stdin in case of timeout-driven completion
  process.stdin.resume();

  deleteBatchLock();
  printBatchSummary(tracker, siteQueue);
  process.stdin.pause();
}

function printBatchSummary(
  tracker: ReturnType<typeof loadTracker>,
  siteQueue: string[],
): void {
  const summary = getSummary(tracker);
  console.log('\n=== Batch Summary ===');
  console.log(`  Success:     ${summary.success}`);
  console.log(`  Failed:      ${summary.failed}`);
  console.log(`  Pending:     ${summary.pending}`);
  console.log(`  Not started: ${summary.not_started}`);

  // Detail rows for the sites in this batch
  console.log('\nDetails:');
  for (const site of siteQueue) {
    const entry = tracker.entries.find((e) => e.site === site);
    const status = entry?.status ?? 'not_started';
    const extra = entry?.confirmation_url
      ? entry.confirmation_url
      : entry?.error ?? '';
    console.log(`  ${site.padEnd(25)} ${status.padEnd(14)} ${extra}`);
  }
}

// ---------------------------------------------------------------------------
// knowledge subcommands
// ---------------------------------------------------------------------------

async function knowledgeListCmd(): Promise<void> {
  const sites = listSites();
  if (sites.length === 0) {
    console.log('No sites in knowledge base.');
    return;
  }
  console.log('Known sites:');
  for (const site of sites) {
    console.log(`  ${site}`);
  }
}

async function knowledgeShowCmd(site: string): Promise<void> {
  let knowledge: SiteKnowledge;
  try {
    knowledge = loadKnowledge(site);
  } catch {
    console.error(`error: knowledge for "${site}" not found`);
    process.exit(1);
    return;
  }
  console.log(JSON.stringify(knowledge, null, 2));
}

async function knowledgeEditCmd(site: string): Promise<void> {
  let knowledge: SiteKnowledge;
  try {
    knowledge = loadKnowledge(site);
  } catch {
    console.error(`error: knowledge for "${site}" not found`);
    process.exit(1);
    return;
  }

  const tmpFile = `/tmp/bb-knowledge-${Date.now()}-${site}.yaml`;
  writeFileSync(tmpFile, dump(knowledge, { lineWidth: 120 }), 'utf-8');

  const { spawnSync } = await import('child_process');
  const editor = process.env.EDITOR || 'vi';
  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`Editor exited with status ${result.status}`);
    unlinkSync(tmpFile);
    process.exit(1);
    return;
  }

  const editedRaw = readFileSync(tmpFile, 'utf-8');
  let edited: unknown;
  try {
    edited = load(editedRaw);
  } catch (err) {
    console.error('Invalid YAML after edit:', String(err));
    unlinkSync(tmpFile);
    process.exit(1);
    return;
  }

  const validation = validateKnowledgeStructure(edited);
  if (!validation.valid) {
    console.error('Validation errors after edit:');
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    console.error('Fix the errors and try again.');
    unlinkSync(tmpFile);
    process.exit(1);
    return;
  }

  saveKnowledge(site, edited as SiteKnowledge);
  unlinkSync(tmpFile);
  console.log(`Knowledge for "${site}" updated.`);
}

async function knowledgeValidateCmd(site: string): Promise<void> {
  let knowledge: SiteKnowledge;
  try {
    knowledge = loadKnowledge(site);
  } catch {
    console.error(`error: knowledge for "${site}" not found`);
    process.exit(1);
    return;
  }

  // 1. Structural validation
  console.log(`Validating knowledge for "${site}"...`);
  const structResult = validateKnowledgeStructure(knowledge as unknown as Record<string, unknown>);
  if (!structResult.valid) {
    console.error('Structural validation failed:');
    for (const err of structResult.errors) {
      console.error(`  - ${err}`);
    }
    console.log('Result: BROKEN');
    return;
  }
  console.log(' Structural validation: PASS');

  // 2. Runtime (DOM) validation via bb-browser
  const { bbOpen, bbSnapshot, bbClose } = await import('./bb-browser.js');
  const { matchRef } = await import('./ref-utils.js');

  console.log(` Opening "${knowledge.site.url}"...`);
  const openResult = bbOpen(knowledge.site.url);
  if (!openResult.ok) {
    console.error(` Failed to open URL: ${openResult.stderr || openResult.stdout}`);
    console.log('Result: BROKEN');
    return;
  }

  const snapshotResult = bbSnapshot({ interactive: false });
  if (!snapshotResult.ok) {
    console.error(` Failed to take snapshot: ${snapshotResult.stderr}`);
    bbClose();
    console.log('Result: BROKEN');
    return;
  }
  const snapshot = snapshotResult.stdout;

  const refSteps = knowledge.workflow.steps.filter((s) => s.ref);
  let matched = 0;
  let failed = 0;

  for (const step of refSteps) {
    const match = matchRef(step.ref!, snapshot, step.semantic);
    if (match) {
      matched++;
      console.log(`  [OK]  Step ${knowledge.workflow.steps.indexOf(step)}: ref=${step.ref} → @${match.ref} (${match.method})`);
    } else {
      failed++;
      console.log(`  [--]  Step ${knowledge.workflow.steps.indexOf(step)}: ref=${step.ref} → NOT FOUND`);
    }
  }

  bbClose();

  const totalRefSteps = refSteps.length;
  let result: string;
  if (totalRefSteps === 0) {
    console.log(' (no ref-based steps to validate)');
    result = 'VALID (no refs)';
  } else if (failed === 0) {
    result = 'VALID';
  } else if (matched > 0) {
    result = 'PARTIAL';
  } else {
    result = 'BROKEN';
  }

  console.log(`\n Matched: ${matched}/${totalRefSteps}`);
  console.log(`Result: ${result}`);

  // Update last_validated
  knowledge.last_validated = new Date().toISOString();
  saveKnowledge(site, knowledge);
}

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

async function statusCmd(opts: { product?: string }): Promise<void> {
  if (!opts.product) {
    console.error('error: --product / -p is required');
    process.exit(1);
  }

  const tracker = loadTracker(opts.product);
  const summary = getSummary(tracker);

  console.log(`Status for product "${opts.product}":`);
  console.log(`  Success:     ${summary.success}`);
  console.log(`  Failed:      ${summary.failed}`);
  console.log(`  Pending:     ${summary.pending}`);
  console.log(`  Not started: ${summary.not_started}`);

  if (tracker.entries.length === 0) {
    console.log('\nNo submissions yet.');
    return;
  }

  console.log('\nDetails:');
  console.log(`  ${'Site'.padEnd(25)} ${'Status'.padEnd(14)} Details`);
  console.log(`  ${''.padEnd(25, '-')} ${''.padEnd(14, '-')} ${''.padEnd(30, '-')}`);
  for (const entry of tracker.entries) {
    const detail =
      entry.confirmation_url ??
      entry.error ??
      entry.reason ??
      '';
    console.log(`  ${entry.site.padEnd(25)} ${entry.status.padEnd(14)} ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('bb-submitter')
  .description('Automated web product submission tool')
  .version('1.0.0');

// ---- teach ---------------------------------------------------------------

program
  .command('teach <site>')
  .description('Interactive teaching mode to record a workflow for a site')
  .option('-p, --product <name>', 'Product name')
  .action(async (site: string, opts: { product?: string }) => {
    await teachCmd(site, opts);
  });

// ---- submit --------------------------------------------------------------

program
  .command('submit <site>')
  .description('Submit a product to a single site')
  .option('-p, --product <name>', 'Product name')
  .action(async (site: string, opts: { product?: string }) => {
    await submitCmd(site, opts);
  });

// ---- batch ---------------------------------------------------------------

program
  .command('batch')
  .description('Submit product to all (or selected) sites in batch')
  .option('-p, --product <name>', 'Product name')
  .option('--sites <list>', 'Comma-separated list of sites (default: all)')
  .option('--timeout <minutes>', 'Intervention timeout per site in minutes (default: 10)', '10')
  .action(async (opts: { product?: string; sites?: string; timeout?: string }) => {
    await batchCmd(opts);
  });

// ---- knowledge -----------------------------------------------------------

const knowledgeCmd = program
  .command('knowledge')
  .description('Manage site knowledge');

knowledgeCmd
  .command('list')
  .description('List all known sites')
  .action(async () => {
    await knowledgeListCmd();
  });

knowledgeCmd
  .command('show <site>')
  .description('Show knowledge for a site as JSON')
  .action(async (site: string) => {
    await knowledgeShowCmd(site);
  });

knowledgeCmd
  .command('edit <site>')
  .description('Open site knowledge in $EDITOR')
  .action(async (site: string) => {
    await knowledgeEditCmd(site);
  });

knowledgeCmd
  .command('validate <site>')
  .description('Validate site knowledge (structural + runtime DOM check)')
  .action(async (site: string) => {
    await knowledgeValidateCmd(site);
  });

// ---- status --------------------------------------------------------------

program
  .command('status')
  .description('Show submission status for a product')
  .option('-p, --product <name>', 'Product name')
  .action(async (opts: { product?: string }) => {
    await statusCmd(opts);
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse(process.argv);
