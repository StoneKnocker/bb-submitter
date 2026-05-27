import { describe, it, expect } from 'vitest';
import {
  parseRef, matchRef, generateSemanticSelector, extractElementMeta,
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

describe('extractElementMeta', () => {
  it('extracts structured metadata from a ref string', () => {
    const meta = extractElementMeta("@2 [input type='text'] placeholder='Startup name' aria-label='Name field'");
    expect(meta).not.toBeNull();
    expect(meta!.tag).toBe('input');
    expect(meta!.type).toBe('text');
    expect(meta!.placeholder).toBe('Startup name');
    expect(meta!.ariaLabel).toBe('Name field');
  });

  it('returns null for invalid ref', () => {
    expect(extractElementMeta('not a ref')).toBeNull();
  });

  it('handles elements with minimal attributes', () => {
    const meta = extractElementMeta("@5 [button] 'Click me'");
    expect(meta).not.toBeNull();
    expect(meta!.tag).toBe('button');
    expect(meta!.type).toBeNull();
    expect(meta!.placeholder).toBeNull();
  });
});

describe('matchRef with :has-text()', () => {
  it('matches element by text content with :has-text() when index shifted', () => {
    const recorded = "@1 [button type='submit'] 'Submit'";
    const semantic = "[button]:has-text('Submit')";
    const currentSnapshot = [
      "@1 [button] 'New Banner'",
      "@2 [button] 'Cancel'",
      "@3 [button] 'Submit'",
    ].join('\n');

    const result = matchRef(recorded, currentSnapshot, semantic);
    expect(result).not.toBeNull();
    expect(result!.ref).toBe('@3');
    expect(result!.method).toBe('semantic');
  });
});

describe('generateSemanticSelector', () => {
  it('generates CSS selector from element meta', () => {
    const meta = { tag: 'input', type: 'text', placeholder: 'Startup name', ariaLabel: null, name: null, id: null, classList: null };
    const selector = generateSemanticSelector(meta);
    expect(selector).toContain('input');
    expect(selector).toContain('placeholder');
  });

  it('prioritizes aria-label when available', () => {
    const meta = { tag: 'textarea', type: null, placeholder: 'Desc', ariaLabel: 'Description field', name: null, id: null, classList: null };
    const selector = generateSemanticSelector(meta);
    expect(selector).toContain('aria-label');
  });
});
