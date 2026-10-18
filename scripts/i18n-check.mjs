/**
 * Locale key parity check (docs/ARCHITECTURE.md §8): every shipped locale must
 * expose exactly the same key set as the reference locale (`en`). Missing keys
 * silently fall back to English at runtime — this script makes that loud.
 *
 * Usage: node scripts/i18n-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'locales');
const REFERENCE = 'en';

function localeDirs() {
  return readdirSync(localesDir)
    .filter((entry) => statSync(join(localesDir, entry)).isDirectory())
    .sort();
}

function namespaceFiles(locale) {
  return readdirSync(join(localesDir, locale))
    .filter((file) => file.endsWith('.json'))
    .sort();
}

function flatten(value, prefix = '') {
  const keys = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      keys.push(...flatten(entry, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function readKeys(locale, file) {
  const path = join(localesDir, locale, file);
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${relative(root, path)} is not valid JSON: ${error.message}`, { cause: error });
  }
  return { path, keys: flatten(parsed), values: parsed };
}

function emptyValues(value, prefix = '') {
  const found = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      found.push(...emptyValues(entry, path));
    } else if (typeof entry === 'string' && entry.trim() === '') {
      found.push(path);
    }
  }
  return found;
}

const locales = localeDirs();
const referenceNamespaces = namespaceFiles(REFERENCE);
const problems = [];
let comparedKeys = 0;

for (const locale of locales) {
  if (locale === REFERENCE) continue;

  const namespaces = namespaceFiles(locale);
  for (const file of referenceNamespaces) {
    if (!namespaces.includes(file)) {
      problems.push(`${locale}: missing namespace file ${file}`);
    }
  }
  for (const file of namespaces) {
    if (!referenceNamespaces.includes(file)) {
      problems.push(`${locale}: unexpected namespace file ${file} (reference has none)`);
    }
  }
}

for (const file of referenceNamespaces) {
  const reference = readKeys(REFERENCE, file);
  comparedKeys += reference.keys.length;

  const empty = emptyValues(reference.values);
  if (empty.length > 0) {
    problems.push(`${REFERENCE}/${file}: empty values at ${empty.join(', ')}`);
  }

  for (const locale of locales) {
    if (locale === REFERENCE) continue;
    if (!namespaceFiles(locale).includes(file)) continue;

    const candidate = readKeys(locale, file);
    const candidateKeys = new Set(candidate.keys);
    const referenceKeys = new Set(reference.keys);

    const missing = reference.keys.filter((key) => !candidateKeys.has(key));
    const extra = candidate.keys.filter((key) => !referenceKeys.has(key));
    if (missing.length > 0) {
      problems.push(`${locale}/${file}: missing ${missing.length} key(s): ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      problems.push(`${locale}/${file}: ${extra.length} key(s) not in ${REFERENCE}: ${extra.join(', ')}`);
    }

    const emptyCandidates = emptyValues(candidate.values);
    if (emptyCandidates.length > 0) {
      problems.push(`${locale}/${file}: empty values at ${emptyCandidates.join(', ')}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`i18n check failed (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `i18n check passed: ${locales.length} locale(s) (${locales.join(', ')}), ` +
    `${referenceNamespaces.length} namespace(s), ${comparedKeys} reference key(s).`,
);
