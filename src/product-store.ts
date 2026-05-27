import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as yaml from 'js-yaml';
import { ProductData } from './types.js';

const PRODUCTS_DIR = resolve(process.cwd(), 'products');

export function loadProduct(productId: string): ProductData {
  const filePath = resolve(PRODUCTS_DIR, productId, 'product.yaml');
  const raw = readFileSync(filePath, 'utf-8');
  const data = yaml.load(raw) as ProductData;
  validateProduct(data);
  return data;
}

export function validateProduct(data: ProductData): void {
  const required = ['name', 'tagline', 'description', 'url', 'category_tags', 'contact_email'];
  for (const field of required) {
    if (!(field in data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  if (!data.description.short && !data.description.full) {
    throw new Error('description must have at least "short" or "full"');
  }
}
