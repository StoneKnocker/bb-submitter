export interface RefInfo {
  index: number;
  tag: string;
  attrs: string[];
  text: string;
}

export function parseRef(ref: string): RefInfo | null {
  const match = ref.match(/^@(\d+)\s+\[([^\]]+)\]\s*(.*)$/);
  if (!match) return null;

  const index = parseInt(match[1], 10);
  const insideBracket = match[2];
  const text = match[3];

  const parts = insideBracket.match(/^([\w-]+)(?:\s+(.*))?$/);
  if (!parts) return null;

  const tag = parts[1];
  const attrString = parts[2] || '';

  // Extract key=value pairs from both inside brackets and trailing text
  const attrs: string[] = [];
  const attrRegex = /(\w+(?:-\w+)*)=('[^']*'|"[^"]*")/g;
  let am;
  while ((am = attrRegex.exec(attrString)) !== null) {
    attrs.push(`${am[1]}=${am[2]}`);
  }
  attrRegex.lastIndex = 0;
  while ((am = attrRegex.exec(text)) !== null) {
    attrs.push(`${am[1]}=${am[2]}`);
  }

  return { index, tag, attrs, text };
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
      const hasMatchingAttr = recorded.attrs.some(a => parsed.attrs.includes(a));
      if (hasMatchingAttr || recorded.attrs.length === 0) {
        return { ref: `@${parsed.index}`, method: 'direct' };
      }
    }
  }

  // Strategy 2: semantic CSS selector fallback
  if (semantic) {
    for (const line of lines) {
      const parsed = parseRef(line.trim());
      if (!parsed) continue;
      if (semanticMatch(semantic, parsed)) {
        return { ref: `@${parsed.index}`, method: 'semantic' };
      }
    }
  }

  return null;
}

function semanticMatch(selector: string, parsed: RefInfo): boolean {
  const parts = selector.split(/,\s*/);
  for (const part of parts) {
    if (matchSingleSelector(part.trim(), parsed)) return true;
  }
  return false;
}

function matchSingleSelector(selector: string, parsed: RefInfo): boolean {
  const tagMatch = selector.match(/^\[([\w-]+)\]/);
  if (tagMatch && tagMatch[1] !== parsed.tag) return false;

  const attrContainsRegex = /\[(\w+(?:-\w+)*)\*=(('[^']+'|"[^"]+"))\s*i\]/g;
  let m;
  while ((m = attrContainsRegex.exec(selector)) !== null) {
    const attrName = m[1];
    const attrValue = m[2].replace(/^['"]|['"]$/g, '').toLowerCase();
    const matchingAttr = parsed.attrs.find(a => {
      const [aName, aValue] = a.split('=');
      return aName.toLowerCase() === attrName.toLowerCase() &&
             aValue.replace(/['"]/g, '').toLowerCase().includes(attrValue);
    });
    if (!matchingAttr) return false;
  }

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

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function generateSemanticSelector(meta: ElementMeta): string {
  const selectors: string[] = [];
  if (meta.ariaLabel) {
    selectors.push(`[${meta.tag}][aria-label*='${esc(meta.ariaLabel)}' i]`);
  }
  if (meta.placeholder) {
    selectors.push(`[${meta.tag}][placeholder*='${esc(meta.placeholder.substring(0, 30))}' i]`);
  }
  if (meta.name) {
    selectors.push(`[${meta.tag}][name*='${esc(meta.name)}' i]`);
  }
  if (meta.id) {
    selectors.push(`[${meta.tag}]#${esc(meta.id)}`);
  }
  return selectors.join(', ');
}

export function extractElementMeta(ref: string): ElementMeta | null {
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
