// Product types
export interface ProductData {
  name: string;
  tagline: string;
  description: Record<string, string>;
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
  [key: string]: unknown;
}

// Site knowledge types
export type AuthMethod = 'google_oauth' | 'github' | 'email_password' | 'none';
export type StepAction =
  | 'open' | 'click' | 'fill' | 'upload' | 'select' | 'select_category'
  | 'check' | 'uncheck' | 'press' | 'wait' | 'verify' | 'eval' | 'record_result';

export interface WorkflowStep {
  action: StepAction;
  ref?: string;
  semantic?: string;
  field?: string;
  source?: string;
  target?: string;
  value?: string;
  wait?: number;
  wait_for?: string;
  human_intervention?: string;
  verify?: string;
  mapping?: Record<string, string>;
  multi?: boolean;
  max?: number;
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
  workflow: { steps: WorkflowStep[] };
  known_quirks?: string[];
  last_validated?: string;
}

// Submission tracker types
export type SubmissionStatus = 'success' | 'failed' | 'pending' | 'not_started' | 'needs_review';

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
  status_summary: { success: number; failed: number; pending: number; not_started: number; };
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
