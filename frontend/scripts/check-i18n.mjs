/**
 * Translation check: every text key the screens use must exist in both
 * Arabic and English, and the two files must hold the same keys — otherwise
 * a raw key like "payroll.runs.title" shows on screen.
 *
 *   node scripts/check-i18n.mjs        (exit code 1 when something is missing)
 *
 * Keys built at run time (t(`status.${x}`)) cannot be read statically; their
 * fixed prefix is checked to exist instead.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const load = (name) => JSON.parse(readFileSync(join(root, 'src/i18n/locales', name), 'utf8').replace(/^﻿/, ''));

/** { a: { b: 'x' } } → Map('a.b' → 'x') */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(vue|ts)$/.test(name) ? [path] : [];
  });
}

const en = flatten(load('en.json'));
const ar = flatten(load('ar.json'));
const problems = [];

for (const key of en.keys()) if (!ar.has(key)) problems.push(`missing in ar.json: ${key}`);
for (const key of ar.keys()) if (!en.has(key)) problems.push(`missing in en.json: ${key}`);
for (const [key, value] of [...en, ...ar]) if (typeof value === 'string' && !value.trim()) problems.push(`empty text: ${key}`);

// t('a.b'), $t("a.b"), te('a.b'), i18n.global.t('a.b'), keypath="a.b"
const literal = /\b(?:\$?t|te|tc)\(\s*(['"])([A-Za-z0-9_.-]+)\1/g;
const keypath = /keypath="([A-Za-z0-9_.-]+)"/g;
const template = /\b(?:\$?t|te|tc)\(\s*`([A-Za-z0-9_.-]*)\$\{/g;
const prefixes = (map) => new Set([...map.keys()].flatMap((k) => k.split('.').map((_, i, parts) => `${parts.slice(0, i + 1).join('.')}.`)));
const enPrefixes = prefixes(en);
let used = 0;

for (const file of files(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  const where = relative(root, file).replaceAll('\\', '/');
  const keys = [...text.matchAll(literal)].map((m) => m[2]).concat([...text.matchAll(keypath)].map((m) => m[1]));
  for (const key of keys) {
    if (!key.includes('.')) continue; // t('x') with a local variable named like a key — not a message key
    used += 1;
    if (!en.has(key) && !ar.has(key)) problems.push(`unknown key ${key} — ${where}`);
  }
  for (const m of text.matchAll(template)) {
    const prefix = m[1];
    if (prefix && prefix.endsWith('.') && !enPrefixes.has(prefix)) problems.push(`no keys under ${prefix}* — ${where}`);
  }
}

const unique = [...new Set(problems)];
console.log(`${en.size} English keys, ${ar.size} Arabic keys, ${used} uses checked.`);
if (unique.length) {
  console.log(unique.join('\n'));
  process.exitCode = 1;
} else {
  console.log('All keys present in both languages.');
}
