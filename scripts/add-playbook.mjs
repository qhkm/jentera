#!/usr/bin/env node
/* ============================================================
   JENTERA playbook generator — tambah playbook baru, auto-validate.
   "Dari description je terus generate" — spec minimal pun jadi.

   Usage (run dari folder ini):
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
    d:'Your customers ask the same things every day. JENTERA answers them instantly — in your voice.',
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
    { e:'⚠️', n:'Customer Assistant', t:'5h ago · escalated', tag:'needs you', tc:'red', d:'Customer asked about special pricing — JENTERA drafted a reply.', cta:'Approved — reply sent.' }
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

/* ---------- format blok JS ---------- */
function formatBlock(key, obj){
  const json = JSON.stringify(obj, null, 2);           // 2-space
  const lines = json.split('\n');
  const out = [];
  out.push('  ' + key + ': ' + lines[0]);             // "  key: {"
  for (let i = 1; i < lines.length - 1; i++) out.push('    ' + lines[i]);
  out.push('  },');
  return out.join('\n');
}

/* ---------- inject ke biz-engine.js sebelum generic ---------- */
function inject(enginePath, key, block){
  let js = fs.readFileSync(enginePath, 'utf8');
  if (new RegExp('^\\s+' + key + ': \\{', 'm').test(js))
    die('Playbook "' + key + '" sudah wujud dalam biz-engine.js');
  const marker = '\n  generic: {';
  const idx = js.indexOf(marker);
  if (idx < 0) die('Marker "generic: {" tak jumpa — struktur engine dah berubah?');
  js = js.slice(0, idx + 1) + '\n' + block + js.slice(idx + 1);
  fs.writeFileSync(enginePath, js);
}

/* ---------- validate JS ---------- */
function jsCheck(enginePath){
  const src = fs.readFileSync(enginePath, 'utf8');
  const r = spawnSync(process.execPath, ['-e',
    'new Function(process.argv[1]); console.log("JS OK")', src],
    { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || r.stdout || 'unknown error');
}

/* ---------- inference sanity test ---------- */
function inferTest(enginePath, spec){
  const src = fs.readFileSync(enginePath, 'utf8');
  const testSrc = `
    global.localStorage = { _d:{}, getItem(k){ return this._d[k]||null; }, setItem(k,v){ this._d[k]=String(v); } };
    eval(process.argv[1]);
    var key = ${JSON.stringify(spec.key)};
    var kws = ${JSON.stringify(spec.keywords)};
    var fail = 0;
    kws.forEach(function(w){
      var got = kvInfer('saya ada ' + w).key;
      if (got !== key){ fail++; console.log('FAIL: "' + w + '" -> ' + got); }
    });
    console.log(fail === 0 ? 'INFER OK' : 'INFER FAIL');
    process.exit(fail === 0 ? 0 : 1);
  `;
  const r = spawnSync(process.execPath, ['-e', testSrc, src], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/* ---------- inject UI: chip (app.html) + pill (onboard.html) ---------- */
function injectUi(repo, key, label, icon){
  // app.html — demo chip sebelum chip generic
  const appPath = path.join(repo, 'app.html');
  let app = fs.readFileSync(appPath, 'utf8');
  const chipAnchor = '<button class="as-chip" data-switch="generic"';
  if (!app.includes('data-switch="' + key + '"')){
    const idx = app.indexOf(chipAnchor);
    if (idx < 0) die('Anchor chip generic tak jumpa di app.html');
    const chip = '<button class="as-chip" data-switch="' + key + '" onclick="kvSetBiz(\'' + key + '\')">' + icon + ' ' + label + '</button>\n';
    app = app.slice(0, idx) + chip + app.slice(idx);
    fs.writeFileSync(appPath, app);
    ok('Chip ditambah ke app.html (' + key + ')');
  } else {
    ok('Chip ' + key + ' sudah wujud di app.html');
  }
  // onboard.html — type pill sebelum pill generic
  const onboardPath = path.join(repo, 'onboard.html');
  let ob = fs.readFileSync(onboardPath, 'utf8');
  const pillAnchor = '<div class="as-opt as-type" data-type="generic"';
  if (!ob.includes('data-type="' + key + '"')){
    const idx = ob.indexOf(pillAnchor);
    if (idx < 0) die('Anchor pill generic tak jumpa di onboard.html');
    const pill = '<div class="as-opt as-type" data-type="' + key + '"><div class="as-row"><span class="as-check">✓</span>' + icon + ' ' + label + '</div></div>\n';
    ob = ob.slice(0, idx) + pill + ob.slice(idx);
    fs.writeFileSync(onboardPath, ob);
    ok('Pill ditambah ke onboard.html (' + key + ')');
  } else {
    ok('Pill ' + key + ' sudah wujud di onboard.html');
  }
}

function jsCheckHtml(filePath){
  const h = fs.readFileSync(filePath, 'utf8');
  const scripts = h.match(/<script>([\s\S]*?)<\/script>/g) || [];
  for (const s of scripts){
    const r = spawnSync(process.execPath, ['-e', 'new Function(process.argv[1])', s.replace(/<\/?script>/g, '')], { encoding: 'utf8' });
    if (r.status !== 0) die('Inline script dalam ' + path.basename(filePath) + ' gagal: ' + (r.stderr || '').slice(0, 300));
  }
}

/* ---------- main ---------- */
const args = parseArgs(process.argv.slice(2));
const repo = process.cwd();
const enginePath = path.join(repo, 'biz-engine.js');
if (!fs.existsSync(enginePath)) die('biz-engine.js tak jumpa — run script dari folder ini');

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
const block = formatBlock(spec.key, spec);
inject(enginePath, spec.key, block);
ok('Playbook "' + spec.key + '" ditambah ke biz-engine.js');

const jsErr = jsCheck(enginePath);
if (jsErr) die('JS validation gagal:\n' + jsErr);
ok('JS validation lulus');

const inf = inferTest(enginePath, spec);
if (!inf.ok || inf.out.indexOf('INFER FAIL') >= 0) die('Inference test gagal:\n' + inf.out + '\n' + inf.err);
ok('Inference test lulus (' + spec.keywords.length + ' keywords → ' + spec.key + ')');

// UI: auto-add chip + pill supaya playbook baru terus nampak dalam demo
const label = (spec.type || spec.name || spec.key).split('/')[0].trim();
injectUi(repo, spec.key, label, spec.icon);
jsCheckHtml(path.join(repo, 'app.html'));
jsCheckHtml(path.join(repo, 'onboard.html'));
ok('UI injection lulus (app.html + onboard.html masih JS-valid)');

console.log('\n=== Selesai: ' + spec.key + ' ===');
console.log(JSON.stringify({ key: spec.key, name: spec.type, detect: spec.detect, loc: spec.loc }, null, 2));

if (args.deploy){
  console.log('\n🌎 Deploying…');
  const c = spawnSync('bash', ['-c',
    'git add -A && git -c user.email="dev@kitakod.com" -c user.name="kitakod" commit -qm "feat: playbook ' +
    spec.key + ' (via add-playbook.mjs)" 2>/dev/null; wrangler pages publish . --project-name jentera 2>&1 | tail -3'],
    { cwd: repo, stdio: 'inherit', shell: false });
  if (c.status !== 0) die('Deploy gagal.');
  ok('Deployed.');
}
