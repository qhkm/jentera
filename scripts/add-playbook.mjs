#!/usr/bin/env node
/* ============================================================
   AISAR playbook generator — tambah playbook baru, auto-validate.
   "Dari description je terus generate" — spec minimal pun jadi.

   Usage (run dari folder aisar-site):
     node scripts/add-playbook.mjs --file spec.json [--deploy]
     node scripts/add-playbook.mjs '{ "key":"minimart", "name":"...", ... }' [--deploy]
     node scripts/add-playbook.mjs --key minimart --name "Your Minimart" \
         --type "Minimart / Grocery" --icon "🏪" --loc "Kuala Lumpur, MY" \
         --keywords "kedai runcit,minimart,grocery" --detect "minimart & grocery · Kuala Lumpur" \
         [--deploy]

   Spec fields (semua optional kecuali key + keywords):
     key, icon, name, type, site, booking, systems, loc, potential,
     opportunities, ch[], detect, confirm, keywords[],
     funcs[][], stats[], sug{}, team[], work[], conns[]
   Field yang takde → auto-generate dari template generic.
   ============================================================ */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/* ---------- helpers ---------- */
function die(msg){ console.error('✗ ' + msg); process.exit(1); }
function ok(msg){ console.log('✓ ' + msg); }

function parseArgs(argv){
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++){
    const x = argv[i];
    if (x === '--deploy') a.deploy = true;
    else if (x === '--file') a.file = argv[++i];
    else if (x === '--key') a.key = argv[++i];
    else if (x === '--name') a.name = argv[++i];
    else if (x === '--type') a.type = argv[++i];
    else if (x === '--icon') a.icon = argv[++i];
    else if (x === '--loc') a.loc = argv[++i];
    else if (x === '--detect') a.detect = argv[++i];
    else if (x === '--potential') a.potential = parseInt(argv[++i], 10);
    else if (x === '--opportunities') a.opportunities = parseInt(argv[++i], 10);
    else if (x === '--keywords') a.keywords = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (x === '--ch') a.ch = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (x === '--confirm') a.confirm = argv[++i];
    else if (x.startsWith('--')) die('Argumen tidak dikenali: ' + x);
    else a._.push(x);
  }
  return a;
}

/* ---------- defaults (template generic, auto-fill) ---------- */
function defaults(spec){
  const s = { ...spec };
  const name = s.name || 'Your Business';
  const type = s.type || 'Small Business';
  const loc  = s.loc  || 'Malaysia';
  const ch   = s.ch   || ['WhatsApp','Phone'];
  const key  = s.key;

  s.icon  = s.icon  || '🏪';
  s.type  = type;
  s.sub   = type;
  s.site  = s.site  || 'yourbusiness.my';
  s.booking = s.booking || 'Phone / WhatsApp';
  s.systems = s.systems || 'Google Sheets';
  s.potential  = s.potential  || 57;
  s.opportunities = s.opportunities || 4;
  s.detect = s.detect || (key + ' · ' + (loc.split(',')[0] || loc));
  s.confirm = s.confirm || ('I found that you run a ' + type + ' in ' + loc + '. Is that correct?');
  s.keywords = s.keywords || [];

  if (!s.funcs) s.funcs = [
    ['Customer enquiries','','covered'],
    ['Follow-up','green','live'],
    ['Scheduling','green','live'],
    ['Reports','amber','opportunity'],
    ['Invoicing','amber','opportunity']
  ];
  if (!s.stats) s.stats = [
    { d:'Today', v:'9', u:'', l:'customer conversations', s:'2 need you' },
    { d:'New enquiries', v:'14', u:'', l:'this week', s:'via ' + ch.join(' + ') },
    { d:'Hours saved', v:'11', u:' hrs', l:'saved this week by your AI team', p:48 }
  ];
  if (!s.sug) s.sug = {
    t:'Automate your common questions',
    d:'Your customers ask the same things every day. AISAR answers them instantly — in your voice.',
    tag:'est. 2 hrs/month',
    cta:"Automation queued — I'll set up the Customer Assistant."
  };
  if (!s.team) s.team = [
    { e:'💬', n:'Customer Assistant', ch:ch.join(' · '), d:'Answers your FAQs instantly — hours, pricing, availability — 24/7.', m:'Today · 9 chats · 2 escalated' },
    { e:'📅', n:'Booking Agent', ch:'Calendar', d:'Schedules appointments and sends confirmations automatically.', m:'This week · 6 bookings' },
    { e:'🔁', n:'Follow-up', ch:'Past customers', d:'Follows up enquiries and past customers automatically.', m:'This month · 18 follow-ups' },
    { e:'📊', n:'Ops Assistant', ch:'Reports', d:'Prepares a simple weekly summary of everything that happened.', m:'', setup:true }
  ];
  if (!s.work) s.work = [
    { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "What are your opening hours?" instantly.' },
    { e:'📅', n:'Booking Agent', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Booked an appointment + sent confirmation.' },
    { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Followed up 2 enquiries from yesterday.' },
    { e:'⚠️', n:'Customer Assistant', t:'5h ago · escalated', tag:'needs you', tc:'red', d:'Customer asked about special pricing — AISAR drafted a reply.', cta:'Approved — reply sent.' }
  ];
  if (!s.conns) s.conns = [
    { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant talks to customers here.', on:true },
    { e:'📞', n:'Phone', s:'linked', d:'Enquiries by call route here.', on:true },
    { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent checks availability here.', on:true },
    { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads your data here.', on:true },
    { e:'🧾', n:'Accounting', s:'not connected', d:'Unlocks invoicing automation.', on:false, cta:"Accounting connection wizard will open — we'll guide you through it." }
  ];
  return s;
}

/* ---------- format blok JSON (playbooks.ts) ---------- */
function formatBlock(key, obj){
  const json = JSON.stringify(obj, null, 2);           // 2-space
  const lines = json.split('\n');
  const out = [];
  out.push('  "' + key + '": ' + lines[0]);           // '  "key": {'
  for (let i = 1; i < lines.length - 1; i++) out.push('  ' + lines[i]);
  out.push('  },');
  return out.join('\n');
}

/* ---------- inject ke playbooks.ts sebelum generic ---------- */
function inject(enginePath, key, block){
  let ts = fs.readFileSync(enginePath, 'utf8');
  if (new RegExp('^\\s*"' + key + '":\\s*\\{', 'm').test(ts))
    die('Playbook "' + key + '" sudah wujud dalam playbooks.ts');
  const marker = '\n  "generic": {';
  const idx = ts.indexOf(marker);
  if (idx < 0) die('Marker `"generic": {` tak jumpa — struktur playbooks.ts dah berubah?');
  ts = ts.slice(0, idx + 1) + block + '\n' + ts.slice(idx + 1);
  fs.writeFileSync(enginePath, ts);
}

/* ---------- validate TypeScript (app/) ---------- */
function tsCheck(repo){
  const r = spawnSync('pnpm', ['typecheck'], { cwd: path.join(repo, 'app'), encoding: 'utf8' });
  return r.status === 0 ? null : ((r.stdout || '') + (r.stderr || '') || 'unknown error');
}

/* ---------- inference sanity test — guna inferPlaybook app sendiri, bukan salinan logik ---------- */
function verifyKeywords(repo, key, keywords){
  const appDir = path.join(repo, 'app');
  const testRel = path.join('src', 'lib', '__verify-playbook__.test.ts');
  const testPath = path.join(appDir, testRel);
  const testSrc = `import { describe, expect, it } from 'vitest';
import { inferPlaybook } from '@/lib/infer';
import { LocalRepository } from '@/lib/repo/local';

/* Generated sementara oleh scripts/add-playbook.mjs — dipadam lepas run. */
describe('generated playbook keyword verification', () => {
  it('setiap keyword untuk "${key}" infer balik ke key tu', async () => {
    const snap = await new LocalRepository().load();
    const keywords = ${JSON.stringify(keywords)};
    const bad = keywords.filter((k) => inferPlaybook(snap, k).key !== ${JSON.stringify(key)});
    expect(bad, 'keywords tak infer balik ke "${key}": ' + bad.join(', ')).toEqual([]);
  });
});
`;
  fs.writeFileSync(testPath, testSrc);
  try {
    const r = spawnSync('pnpm', ['vitest', 'run', testRel], { cwd: appDir, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  } finally {
    fs.unlinkSync(testPath);
  }
}

/* ---------- main ---------- */
const args = parseArgs(process.argv.slice(2));
const repo = process.cwd();
const enginePath = path.join(repo, 'app', 'src', 'lib', 'data', 'playbooks.ts');
if (!fs.existsSync(enginePath)) die('app/src/lib/data/playbooks.ts tak jumpa — run script dari folder aisar-site');

let spec = {};
if (args.file){
  spec = JSON.parse(fs.readFileSync(path.resolve(repo, args.file), 'utf8'));
} else if (args._.length){
  spec = JSON.parse(args._[0]);
} else {
  ['key','name','type','icon','loc','detect','confirm'].forEach(f => { if (args[f]) spec[f] = args[f]; });
  ['potential','opportunities'].forEach(f => { if (args[f] !== undefined) spec[f] = args[f]; });
  ['keywords','ch'].forEach(f => { if (args[f]) spec[f] = args[f]; });
}
if (!spec.key) die('Spec perlukan "key" (cth: minimart).');
if (!/^[a-z][a-z0-9_]*$/.test(spec.key)) die('Key mesti lowercase + underscore sahaja (cth: minimart, food_truck).');
if (spec.key === 'generic') die('Key "generic" adalah reserved — pilih nama lain.');
if (!spec.keywords || !spec.keywords.length) die('Spec perlukan "keywords" (3-8 istilah user akan taip: BM + EN).');

spec = defaults(spec);
const { key: _omitKey, ...entry } = spec; // "key" hidup dalam spec sahaja — bukan medan Playbook
const block = formatBlock(spec.key, entry);
inject(enginePath, spec.key, block);
ok('Playbook "' + spec.key + '" ditambah ke app/src/lib/data/playbooks.ts');

const tsErr = tsCheck(repo);
if (tsErr) die('Semakan TypeScript gagal:\n' + tsErr);
ok('Semakan TypeScript lulus');

const inf = verifyKeywords(repo, spec.key, spec.keywords);
if (!inf.ok) die('Inference test gagal:\n' + inf.out + '\n' + inf.err);
ok('Inference test lulus (' + spec.keywords.length + ' keywords → ' + spec.key + ')');

console.log('\n=== Selesai: ' + spec.key + ' ===');
console.log(JSON.stringify({ key: spec.key, name: spec.type, detect: spec.detect, loc: spec.loc }, null, 2));

if (args.deploy){
  console.log('\n🌎 Deploying…');
  const c = spawnSync('bash', ['-c',
    'git add -A && git -c user.email="dev@kitakod.com" -c user.name="kitakod" commit -qm "feat: playbook ' +
    spec.key + ' (via add-playbook.mjs)" 2>/dev/null; wrangler pages publish . --project-name aisar 2>&1 | tail -3'],
    { cwd: repo, stdio: 'inherit', shell: false });
  if (c.status !== 0) die('Deploy gagal.');
  ok('Deployed.');
}
