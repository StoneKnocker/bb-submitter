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
    expect(() => loadProduct('__test__')).toThrow();
  });
});

describe('validateProduct', () => {
  it('passes for a complete product', () => {
    const product = {
      name: 'Valid', tagline: 'x', description: { short: 's' },
      url: 'https://x.com', category_tags: ['AI'], contact_email: 'x@x.com',
    };
    expect(() => validateProduct(product)).not.toThrow();
  });

  it('fails when name is missing', () => {
    expect(() => validateProduct({} as any)).toThrow();
  });
});
