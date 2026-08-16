#!/usr/bin/env node
/* ============================================================
   Parity audit — the "nothing lost" gate for the React cutover.

   Enumerates what the static site actually does and checks the
   React app does it too. Mechanical checks only: this proves
   coverage of data, strings, routes and storage keys. It cannot
   prove the UI behaves the same, so it is a floor, not a ceiling.

   Usage: node scripts/parity-audit.mjs
   Exit code 1 if anything is missing.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app', 'src');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readApp = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

/** Every .ts/.tsx source in the React app, concatenated. */
function appSources() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) out.push(fs.readFileSync(full, 'utf8'));
    }
  })(APP);
  return out.join('\n');
}

/* ---- Load the static engine's globals by evaluating it ---- */
function loadEngine() {
  const src = read('biz-engine.js');
  const scope = {};
  const fn = new Function(
    'window',
    'document',
    'localStorage',
    src +
      '\nreturn { PLAYBOOKS, KV_COUNTRIES, KV_CONNECTORS, KV_I18N, KV_REC_MAP, KV_TOOL_RISK };',
  );
  return fn(undefined, undefined, undefined, scope);
}

const findings = [];
const pass = [];

function check(label, missing, note) {
  if (missing.length) {
    findings.push({ label, missing, note });
  } else {
    pass.push(label);
  }
}

const engine = loadEngine();
const src = appSources();

/* ---- 1. Data coverage ---- */
const appData = {
  PLAYBOOKS: Object.keys(JSON.parse(extractLiteral('data/playbooks.ts'))),
  CONNECTORS: Object.keys(JSON.parse(extractLiteral('data/connectors.ts'))),
  COUNTRIES: Object.keys(JSON.parse(extractLiteral('data/countries.ts'))),
  REC_MAP: Object.keys(JSON.parse(extractLiteral('data/recommendations.ts'))),
  RISK: Object.keys(JSON.parse(extractLiteral('data/risk.ts'))),
};

function extractLiteral(rel) {
  const s = readApp(path.join('lib', rel));
  return s.replace(/^[\s\S]*?=\s*/, '').replace(/;\s*$/, '');
}

check(
  'playbooks',
  Object.keys(engine.PLAYBOOKS).filter((k) => !appData.PLAYBOOKS.includes(k)),
);
check(
  'connectors',
  Object.keys(engine.KV_CONNECTORS).filter((k) => !appData.CONNECTORS.includes(k)),
);
check(
  'countries',
  Object.keys(engine.KV_COUNTRIES).filter((k) => !appData.COUNTRIES.includes(k)),
);
check(
  'agent recommendations',
  Object.keys(engine.KV_REC_MAP).filter((k) => !appData.REC_MAP.includes(k)),
);
check(
  'tool risk table',
  Object.keys(engine.KV_TOOL_RISK).filter((k) => !appData.RISK.includes(k)),
);

/* ---- 2. i18n coverage: every engine key present in both languages ---- */
const appI18n = JSON.parse(extractLiteral('data/i18n.ts'));
for (const lang of ['en', 'bm']) {
  check(
    `i18n.${lang} keys present`,
    Object.keys(engine.KV_I18N[lang]).filter((k) => !(k in appI18n[lang])),
  );
}

/* ---- 3. i18n keys the static UI actually renders are reachable in React ---- */
const staticHtml = ['index.html', 'app.html', 'onboard.html', 'setup.html']
  .map(read)
  .join('\n');
const usedKeys = new Set([
  ...[...staticHtml.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]),
  ...[...read('biz-engine.js').matchAll(/kvT\('([^']+)'\)/g)].map((m) => m[1]),
]);
check(
  'i18n keys used by the static UI exist in the React tables',
  [...usedKeys].filter((k) => !(k in appI18n.en) && !src.includes(`'${k}'`)),
);

/* ---- 4. localStorage keys ---- */
const engineKeys = new Set(
  [...read('biz-engine.js').matchAll(/'(aisar-[a-z0-9-]+)'/g)].map((m) => m[1]),
);
const appStorage = readApp('lib/storage.ts');
check(
  'localStorage keys',
  [...engineKeys].filter((k) => !appStorage.includes(k)),
);

/* ---- 5. Routes ---- */
const routes = ['/', '/onboard', '/setup', '/app'];
const appRoutes = readApp('App.tsx');
check(
  'routes',
  routes.filter((r) => !appRoutes.includes(`path="${r}"`) && r !== '/'),
);

/* ---- 6. Dashboard views the static site currently ships ---- */
const staticViews = [
  ...new Set([...read('app.html').matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1])),
];
const dashboard = readApp('routes/Dashboard.tsx');
check(
  'dashboard views present in React',
  staticViews.filter((v) => !new RegExp(`'${v}'`).test(dashboard)),
  'static site now ships a 4-area IA',
);

/* ---- 7. Nav labels: the four areas the static site ships ---- */
const staticNav = [
  ...new Set([...read('app.html').matchAll(/data-t="(nav\.[a-z]+)"/g)].map((m) => m[1])),
].filter((k) => k !== 'nav.logout');
check(
  'nav items match the static sidebar',
  staticNav.filter((k) => !dashboard.includes(k)),
);

/* ---- 8. React must not resurrect retired top-level views ---- */
const retired = ['nav.team', 'nav.aiteam', 'nav.connections', 'nav.approvals'];
check(
  'retired views are not top-level nav in React',
  retired.filter((k) => new RegExp(`labelKey: '${k}'`).test(dashboard)),
  'these belong inside Activity / My Business now',
);

/* ---- 9. work-done index format must match the engine (strings) ---- */
const engineStoresStrings = /indexOf\(String\(i\)\)/.test(read('biz-engine.js'));
const appTolerant = /String\(v\) === String\(i\)/.test(readApp('lib/business.ts'));
check(
  'work-done storage format is compatible with the engine',
  engineStoresStrings && !appTolerant ? ['engine writes string indices; app does not read them'] : [],
);

/* ---- Report ---- */
console.log('\n=== PARITY AUDIT ===\n');
for (const p of pass) console.log(`  PASS  ${p}`);
if (findings.length) {
  console.log('');
  for (const f of findings) {
    console.log(`  GAP   ${f.label}${f.note ? ` (${f.note})` : ''}`);
    for (const m of f.missing.slice(0, 25)) console.log(`          · ${m}`);
    if (f.missing.length > 25) console.log(`          … and ${f.missing.length - 25} more`);
  }
}
console.log(`\n${pass.length} passed, ${findings.length} gap${findings.length === 1 ? '' : 's'}\n`);
process.exit(findings.length ? 1 : 0);
