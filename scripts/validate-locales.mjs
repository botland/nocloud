#!/usr/bin/env node
/**
 * Validate en/fr locale key parity and interpolation placeholder consistency.
 * Fails build if FR is missing keys or placeholder names differ from EN.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOCALES_DIR = join(ROOT, 'locales');

function loadJson(name) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, name), 'utf8'));
}

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function getAtPath(obj, path) {
  return path.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj);
}

function extractPlaceholders(str) {
  if (typeof str !== 'string') return [];
  const matches = str.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) || [];
  return [...new Set(matches)].sort();
}

const en = loadJson('en.json');
const fr = loadJson('fr.json');

const enKeys = collectKeys(en).sort();
const frKeys = new Set(collectKeys(fr));

const problems = [];

for (const key of enKeys) {
  if (!frKeys.has(key)) {
    problems.push(`Missing FR key: ${key}`);
    continue;
  }
  const enVal = getAtPath(en, key);
  const frVal = getAtPath(fr, key);
  if (typeof enVal === 'string' && typeof frVal === 'string') {
    const enPh = extractPlaceholders(enVal);
    const frPh = extractPlaceholders(frVal);
    if (enPh.join(',') !== frPh.join(',')) {
      problems.push(`Placeholder mismatch at ${key}: EN [${enPh.join(', ')}] vs FR [${frPh.join(', ')}]`);
    }
  }
}

if (problems.length > 0) {
  console.error('\n❌ Locale validation failed:\n');
  for (const p of problems) {
    console.error(`  • ${p}`);
  }
  console.error(`\n  ${problems.length} problem(s) found.\n`);
  process.exit(1);
}

console.log(`✓ Locales OK (${enKeys.length} EN keys, FR parity verified)`);