/**
 * Static token discipline check (docs/ARCHITECTURE.md §7):
 *
 *   1. `src/shared/theme/tokens.css` is the only place allowed to contain raw
 *      colours; components must consume semantic tokens (`var(--...)`).
 *   2. The window background used before the first paint must stay in sync with
 *      the theme's `--bg-surface` (anti-flash measure).
 *
 * Usage: node scripts/check-tokens.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokensFile = join(root, 'src', 'shared', 'theme', 'tokens.css');
const windowBackgroundFile = join(root, 'src', 'shared', 'theme', 'window-background.ts');

const SCAN_ROOTS = [join(root, 'src', 'renderer')];
const SCAN_EXTENSIONS = ['.css', '.ts', '.tsx'];
const HEX_COLOUR = /#[0-9a-fA-F]{3,8}\b/g;
const FUNCTIONAL_COLOUR = /\b(?:rgba?|hsla?|oklch|lab)\(/g;

const problems = [];

function walk(directory, visit) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, visit);
      continue;
    }
    if (SCAN_EXTENSIONS.some((extension) => path.endsWith(extension))) visit(path);
  }
}

walk(SCAN_ROOTS[0], (path) => {
  const source = readFileSync(path, 'utf8');
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    // Comments may quote colours while explaining a decision.
    const code = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
    for (const match of code.matchAll(HEX_COLOUR)) {
      // Ignore CSS id selectors such as `#root` (they never contain hex digits only).
      if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(match[0])) {
        continue;
      }
      problems.push(`${relative(root, path)}:${index + 1} raw colour ${match[0]} — use a token`);
    }
    if (FUNCTIONAL_COLOUR.test(code)) {
      problems.push(
        `${relative(root, path)}:${index + 1} raw colour function in component code — use a token`,
      );
    }
  });
});

// --- 2. window background vs --bg-surface --------------------------------
const tokens = readFileSync(tokensFile, 'utf8');
const windowBackground = readFileSync(windowBackgroundFile, 'utf8');

function bgSurface(theme, mode) {
  const block = new RegExp(
    `:root\\[data-theme='${theme}'\\]\\[data-mode='${mode}'\\]\\s*\\{([\\s\\S]*?)\\}`,
  ).exec(tokens);
  if (block === null) return null;
  const value = /--bg-surface:\s*([^;]+);/.exec(block[1]);
  return value === null ? null : value[1].trim().toLowerCase();
}

function declaredWindowBackground(mode) {
  const value = new RegExp(`${mode}:\\s*'([^']+)'`).exec(windowBackground);
  return value === null ? null : value[1].trim().toLowerCase();
}

for (const [theme, mode] of [
  ['minimal', 'light'],
  ['minimal', 'dark'],
]) {
  const fromTokens = bgSurface(theme, mode);
  const fromTs = declaredWindowBackground(mode);
  if (fromTokens === null || fromTs === null) {
    problems.push(`could not read the ${mode} surface colour from tokens.css / window-background.ts`);
    continue;
  }
  if (fromTokens !== fromTs) {
    problems.push(
      `window-background.ts ${mode} (${fromTs}) does not match --bg-surface of theme '${theme}' (${fromTokens})`,
    );
  }
}

if (problems.length > 0) {
  console.error(`token check failed (${problems.length} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('token check passed: no raw colours in components, window background matches the theme.');
