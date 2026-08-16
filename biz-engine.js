/* ============================================================
   AISAR playbook engine — generate on the run, self-improving.
   Bukan senarai profil hardcode: PLAYBOOKS (pola industri) +
   inference (free-text user → kategori) + generate dashboard.
   Tambah industri baru = tambah SATU entri PLAYBOOKS.
   ============================================================ */

/* ---- Safe storage wrapper (private mode tak crash) ---- */
var KV_STORE = (function(){
  function get(k, d){ try { var v = localStorage.getItem(k); return v === null ? d : v; } catch(e){ return d; } }
  function set(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  return { get: get, set: set };
})();

/* ============================================================
   COUNTRY LAYER — AISAR is built Malaysia-first but country-aware.
   Tambah negara baru = tambah SATU entri KV_COUNTRIES (cities,
   language default, currency, TLD, channel stack).
   Aktifkan: kvSetCountry('ID') — KV simpan di 'aisar-country'.
   ============================================================ */
var KV_COUNTRIES = {
  MY: {
    code: 'MY', name: 'Malaysia', lang: 'bm', currency: 'RM', tld: '.my',
    defaultCh: ['WhatsApp', 'Instagram'],
    cities: {
      'kuala lumpur': 'Kuala Lumpur, MY', 'kl': 'Kuala Lumpur, MY',
      'shah alam': 'Shah Alam, MY', 'petaling jaya': 'Petaling Jaya, MY', 'pj': 'Petaling Jaya, MY',
      'subang': 'Subang Jaya, MY', 'cyberjaya': 'Cyberjaya, MY', 'putrajaya': 'Putrajaya, MY',
      'penang': 'George Town, Penang, MY', 'george town': 'George Town, Penang, MY',
      'johor': 'Johor Bahru, MY', 'johor bahru': 'Johor Bahru, MY', 'jb': 'Johor Bahru, MY',
      'melaka': 'Melaka, MY', 'ipoh': 'Ipoh, MY', 'seremban': 'Seremban, MY',
      'kota kinabalu': 'Kota Kinabalu, MY', 'kuching': 'Kuching, MY',
      'singapore': 'Singapore, SG'
    }
  },
  ID: {
    code: 'ID', name: 'Indonesia', lang: 'id', currency: 'Rp', tld: '.co.id',
    defaultCh: ['WhatsApp', 'Instagram', 'Shopee'],
    cities: {
      'jakarta': 'Jakarta, ID', 'bandung': 'Bandung, ID', 'surabaya': 'Surabaya, ID',
      'medan': 'Medan, ID', 'bali': 'Denpasar, ID', 'denpasar': 'Denpasar, ID',
      'yogyakarta': 'Yogyakarta, ID', 'semarang': 'Semarang, ID', 'makassar': 'Makassar, ID',
      'bekasi': 'Bekasi, ID', 'depok': 'Depok, ID', 'tangerang': 'Tangerang, ID'
    }
  },
  SG: {
    code: 'SG', name: 'Singapore', lang: 'en', currency: 'S$', tld: '.sg',
    defaultCh: ['WhatsApp', 'Instagram'],
    cities: { 'singapore': 'Singapore, SG', 'jurong': 'Jurong, SG', 'woodlands': 'Woodlands, SG', 'tampines': 'Tampines, SG' }
  },
  TH: {
    code: 'TH', name: 'Thailand', lang: 'th', currency: '฿', tld: '.co.th',
    defaultCh: ['Line', 'Facebook'],
    cities: {
      'bangkok': 'Bangkok, TH', 'krung thep': 'Bangkok, TH', 'chiang mai': 'Chiang Mai, TH',
      'phuket': 'Phuket, TH', 'pattaya': 'Pattaya, TH', 'hat yai': 'Hat Yai, TH',
      'nakhon ratchasima': 'Nakhon Ratchasima, TH', 'khon kaen': 'Khon Kaen, TH'
    }
  },
  VN: {
    code: 'VN', name: 'Vietnam', lang: 'vi', currency: '₫', tld: '.vn',
    defaultCh: ['Zalo', 'Facebook'],
    cities: {
      'ho chi minh': 'Ho Chi Minh City, VN', 'saigon': 'Ho Chi Minh City, VN',
      'hanoi': 'Hanoi, VN', 'da nang': 'Da Nang, VN', 'can tho': 'Can Tho, VN',
      'hai phong': 'Hai Phong, VN', 'nha trang': 'Nha Trang, VN'
    }
  },
  PH: {
    code: 'PH', name: 'Philippines', lang: 'fil', currency: '₱', tld: '.ph',
    defaultCh: ['Facebook Messenger', 'Viber', 'WhatsApp'],
    cities: {
      'manila': 'Manila, PH', 'quezon city': 'Quezon City, PH', 'cebu': 'Cebu City, PH',
      'davao': 'Davao City, PH', 'makati': 'Makati, PH', 'tagaytay': 'Tagaytay, PH'
    }
  }
};
var KV_COUNTRY = (function(){
  var c = KV_STORE.get('aisar-country', 'MY');
  return KV_COUNTRIES[c] ? c : 'MY';
})();
function kvCountry(){ return KV_COUNTRIES[KV_COUNTRY] || KV_COUNTRIES.MY; }
function kvSetCountry(code){
  if (!KV_COUNTRIES[code]) return;
  KV_COUNTRY = code;
  KV_STORE.set('aisar-country', code);
  /* BIZ cache ikut negara — reset supaya loc/detect/site/ch segar */
  try { if (typeof BIZ !== 'undefined') { for (var k in BIZ) delete BIZ[k]; } } catch(e){}
}
function kvCityList(){
  var out = {};
  for (var k in KV_COUNTRIES.MY.cities) out[k] = KV_COUNTRIES.MY.cities[k];
  var cc = kvCountry().cities || {};
  for (var j in cc) out[j] = cc[j];
  return out;
}
function kvSite(p){
  var c = kvCountry();
  var s = String(p.site || '');
  if (c.code === 'MY') return s;
  /* Tukar only placeholder .my domain ke TLD negara; kekal .com/.co dsb */
  return s.replace(/\.my$/i, c.tld || '.my');
}
function kvDetect(p){
  var c = kvCountry();
  if (c.code === 'MY' || !p.detect) return p.detect;
  var cities = Object.keys(c.cities || {});
  var first = cities.length ? c.cities[cities[0]] : c.name;
  var city = first.split(',')[0].trim();
  return String(p.detect).replace(/·\s*[^·]+$/, '· ' + city);
}
function kvKeywords(p){
  var out = (p && p.keywords) ? p.keywords.slice() : [];
  var extra = p && p.kw && p.kw[kvCountry().code];
  if (extra && extra.length) out = out.concat(extra);
  return out;
}
function kvChans(b){
  var c = kvCountry();
  if (c.code === 'MY' || !b || !b.ch) return (b && b.ch) || [];
  var out = (c.defaultCh || []).slice();
  b.ch.forEach(function(x){ if (out.indexOf(x) < 0) out.push(x); });
  return out;
}

/* ============================================================
   CONNECTOR REGISTRY — senarai semua platform yang AISAR boleh
   connect. Setiap connector: kaedah integrate (oauth|link|file|bss),
   auth flow, scope (apa yang boleh buat), negara sokongan.

   Prinsip: customer TAK PERNAH nampak API key/webhook — connect =
   login + approve (T1 oauth), link je (T2), file/email (T3),
   atau key dipegang kami (T4/bss). Details: AISAR-INTEGRATION-STRATEGY.md
   ============================================================ */
var KV_CONNECTORS = {
  whatsapp: {
    n: 'WhatsApp', e: '💬', tier: 'T1', method: 'oauth',
    flow: 'Meta Embedded Signup — login FB/Meta, setup WhatsApp Cloud API automatik (takde API key)',
    scope: ['reply pelanggan', 'hantar reminder', 'hantar receipt', 'auto-follow-up'],
    countries: ['MY','ID','SG','TH','PH'], meta: true
  },
  instagram: {
    n: 'Instagram', e: '📸', tier: 'T1', method: 'oauth',
    flow: 'Meta Business Login — 1 klik connect, perlu FB Page + IG Business',
    scope: ['jawab DM', 'baca komen', 'hantar promo'],
    countries: ['MY','ID','SG','TH','VN','PH'], meta: true
  },
  telegram: {
    n: 'Telegram', e: '✈️', tier: 'T2', method: 'bss',
    flow: 'Guided Telegram bot authorization — AISAR handles the token, webhook, and setup securely',
    scope: ['reply to customers', 'send updates', 'handle enquiries', 'escalate to owner'],
    countries: ['MY','ID','SG','TH','VN','PH']
  },
  google: {
    n: 'Google (Sheets & Calendar)', e: '📊', tier: 'T1', method: 'oauth',
    flow: 'Google OAuth — popup login, sync ke Sheets/Calendar',
    scope: ['baca stock/order', 'auto-import booking', 'hantar jadual'],
    countries: ['MY','ID','SG','TH','VN','PH']
  },
  billplz: {
    n: 'Billplz', e: '🧾', tier: 'T2', method: 'link',
    flow: 'Payment link — jana link/QR, tiada integrasi rumit; webhook kita pegang',
    scope: ['jana payment link', 'auto-receipt', 'reminder bayaran'],
    countries: ['MY'], fpga: true
  },
  senangpay: {
    n: 'senangPay (DOKU)', e: '💳', tier: 'T2', method: 'link',
    flow: 'Payment link + QR — bayar via FPX, e-wallet, kad',
    scope: ['payment link', 'auto-receipt'],
    countries: ['MY'], fpga: true
  },
  shopee: {
    n: 'Shopee', e: '🛒', tier: 'T1', method: 'oauth',
    flow: 'Shopee Open Platform — seller authorize, kita daftar app sekali',
    scope: ['sync order', 'update tracking', 'jawab chat'],
    countries: ['MY','ID','SG','TH','PH'], marketplace: true
  },
  lazada: {
    n: 'Lazada', e: '🛍️', tier: 'T1', method: 'oauth',
    flow: 'Lazada Open Platform — seller authorize',
    scope: ['sync order', 'update status'],
    countries: ['MY','ID','SG','TH','PH'], marketplace: true
  },
  tiktokshop: {
    n: 'TikTok Shop', e: '🎵', tier: 'T1', method: 'oauth',
    flow: 'TikTok Shop Seller API — authorize, kita daftar app',
    scope: ['sync order', 'auto-reply chat'],
    countries: ['MY','ID','SG','TH','VN','PH'], marketplace: true
  },
  grab: {
    n: 'GrabFood', e: '🛵', tier: 'T3', method: 'file',
    flow: 'Email-to-parse atau CSV export mingguan',
    scope: ['sync order', 'track revenue'],
    countries: ['MY','ID','SG','TH','PH','VN'], delivery: true
  },
  foodpanda: {
    n: 'foodpanda', e: '🍱', tier: 'T3', method: 'file',
    flow: 'Email-to-parse atau CSV export mingguan',
    scope: ['sync order', 'track revenue'],
    countries: ['MY','ID','SG','TH'], delivery: true
  },
  qashier: {
    n: 'Qashier POS', e: '🧾', tier: 'T3', method: 'file',
    flow: 'CSV export atau Google Sheets sync (POS takde API terbuka)',
    scope: ['sync sales', 'inventory', 'P&L report'],
    countries: ['MY','SG'], pos: true
  },
  storehub: {
    n: 'StoreHub POS', e: '🏪', tier: 'T3', method: 'file',
    flow: 'CSV export / Sheets sync — 20k+ kedai MY guna',
    scope: ['sync sales', 'inventory', 'customer list'],
    countries: ['MY','SG'], pos: true
  },
  lalamove: {
    n: 'Lalamove', e: '🚚', tier: 'T2', method: 'link',
    flow: 'Link-based — jana pickup request dari order, takde API key',
    scope: ['auto-booking delivery', 'track status'],
    countries: ['MY','ID','SG','TH','PH','VN'], delivery: true
  },
  gdex: {
    n: 'GDEX', e: '📦', tier: 'T2', method: 'link',
    flow: 'Courier link + webhook — dropoff request dari order',
    scope: ['auto-shipping label', 'track status'],
    countries: ['MY'], courier: true, 'e-invoice': false
  },
  duitnow: {
    n: 'DuitNow QR', e: '🔗', tier: 'T2', method: 'link',
    flow: 'QR jana terus — bayaran masuk, kita webhook',
    scope: ['QR payment', 'auto-receipt'],
    countries: ['MY']
  },
  lhdn: {
    n: 'LHDN e-Invoice', e: '🧾', tier: 'T4', method: 'bss',
    flow: 'Kita pegang credential/dig prepaid — customer tak nampak; compliance auto',
    scope: ['auto-e-invoice', 'compliance'],
    countries: ['MY'], regulated: true
  }
};
function kvConnectors(cat){
  var c = kvCountry().code;
  return Object.keys(KV_CONNECTORS)
    .map(function(k){ return KV_CONNECTORS[k]; })
    .filter(function(x){
      if (cat && x[cat] !== true) return false;
      if (x.countries && x.countries.indexOf(c) < 0) return false;
      return true;
    });
}
function kvConnector(name){
  for (var k in KV_CONNECTORS){
    if (KV_CONNECTORS[k].n === name) return KV_CONNECTORS[k];
  }
  return null;
}

/* ============================================================
   TOOL CONTRACT — Agent Interface (spec v1)
   Satu pattern untuk semua connector. Detail: AISAR-INTEGRATION-STRATEGY.md §8
   ============================================================ */
var KV_TOOL_RISK = { send:'high', pay:'high', cancel:'high', refund:'high',
                     update:'medium', book:'medium', read:'low', list:'low', export:'low' };

function kvTool(req){
  /* req = { conn, op, args, dryRun } — dryRun default true kalau risk high/medium */
  var out = { ok:true, t:Date.now(), req:req };
  var cx = req.conn ? kvConnector(req.conn) : null;
  if (!cx) return { ok:false, err:'unknown connector: ' + req.conn };
  var risk = KV_TOOL_RISK[req.op] || 'medium';
  var dry = (req.dryRun !== undefined) ? !!req.dryRun : (risk !== 'low');
  var connected = kvConnOn(cx.n);
  if (!connected){
    return { ok:false, need:'connect', conn:cx.n, msg:'Connect ' + cx.n + ' dulu dalam Connections.' };
  }
  if (dry){
    out.dryRun = true;
    out.would = cx.n + ' → ' + req.op + ' ' + JSON.stringify(req.args || {});
    out.risk = risk;
    kvApprovalQueue(cx.n, req.op, req.args || {}, risk);
    return out;
  }
  /* Mock real execution — backend nanti ganti dengan Workers + OAuth, contract sama */
  out.mock = true;
  out.msg = cx.n + ' → ' + req.op + ' OK (mock — belum ada executor backend).';
  return out;
}

/* Approval queue — manusia kekal dalam loop untuk external action */
function kvApprovalQueue(conn, op, args, risk){
  var key = 'aisar-approvals';
  var q = [];
  try { q = JSON.parse(KV_STORE.get(key, '[]')); } catch(e){}
  q.push({ id: Date.now(), conn:conn, op:op, args:args, risk:risk, ts:new Date().toISOString(), status:'pending' });
  KV_STORE.set(key, JSON.stringify(q));
}
function kvApprovals(){
  try { return JSON.parse(KV_STORE.get('aisar-approvals', '[]')); } catch(e){ return []; }
}
function kvApprovalDecide(id, ok){
  var q = kvApprovals();
  for (var i=0;i<q.length;i++){ if (q[i].id === id){ q[i].status = ok ? 'approved' : 'rejected'; q[i].decided = new Date().toISOString(); } }
  KV_STORE.set('aisar-approvals', JSON.stringify(q));
}

/* Approval queue UI — manusia kekal dalam loop */
function kvApprovalsRender(){
  var el = document.getElementById('kv-approvals');
  if (!el) return;
  var q = kvApprovals().filter(function(a){ return a.status === 'pending'; });
  var b = kvPlaybook(kvBizType());
  var pendingWork = (b.work || []).map(function(w, i){ return { item:w, index:i }; }).filter(function(x){ return x.item.tag === 'needs you' && !kvWorkDone(x.index); });
  if (!q.length && !pendingWork.length){
    el.innerHTML = '<div class="as-card flex flex-col items-center gap-2 p-6 text-center"><span class="text-2xl">🛡️</span><p class="text-[13px] text-text-secondary">' + kvT('appr.empty') + '</p></div>';
  } else {
    var workHtml = pendingWork.map(function(x){
      var w = x.item;
      return '<div class="as-card flex flex-col gap-3 p-4">' +
        '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + w.e + '</span><div class="flex flex-col"><span class="text-sm">' + kvEsc(w.n) + '</span><span class="text-[11px] text-text-muted">' + kvEsc(w.t) + '</span></div></div><span class="as-tag amber">' + kvT('work.need') + '</span></div>' +
        '<p class="text-[13px] text-text-secondary">' + kvEsc(w.d) + '</p>' +
        '<div class="as-row gap-2"><button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvApproveWork(' + x.index + ')">' + kvT('work.approve') + '</button><button class="btn btn-outline px-4 py-1.5 text-xs" onclick="kvEditWork(' + x.index + ')">' + kvT('work.edit') + '</button></div>' +
        '</div>';
    }).join('');
    var toolHtml = q.map(function(a){
      var riskCls = a.risk === 'high' ? 'red' : (a.risk === 'medium' ? 'amber' : 'green');
      var opLabel = kvT('appr.op.' + a.op);
      if (opLabel === 'appr.op.' + a.op) opLabel = a.op;
      var args = Object.keys(a.args || {}).map(function(k){ return k + ': ' + a.args[k]; }).join(' · ');
      var when = '';
      try { when = new Date(a.ts).toLocaleString(); } catch(e){ when = a.ts; }
      return '<div class="as-card flex flex-col gap-3 p-4">' +
        '<div class="as-row justify-between"><div class="as-row gap-2">' +
        '<span class="as-avatar">🛡️</span>' +
        '<div class="flex flex-col"><span class="text-sm">' + kvEsc(opLabel) + ' · ' + kvEsc(a.conn) + '</span>' +
        '<span class="text-[11px] text-text-muted">' + kvEsc(when) + '</span></div></div>' +
        '<span class="as-tag ' + riskCls + '">' + kvT('appr.risk.' + a.risk) + '</span></div>' +
        (args ? '<p class="text-[12px] text-text-secondary">' + kvEsc(args) + '</p>' : '') +
        '<div class="as-row justify-end gap-2">' +
        '<button class="btn btn-outline px-4 py-1.5 text-xs" onclick="kvApprovalDecide(' + a.id + ',false);kvRenderAll();kvToast(kvT(\'appr.rejected\'))">' + kvT('appr.reject') + '</button>' +
        '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvApprovalDecide(' + a.id + ',true);kvRenderAll();kvToast(kvT(\'appr.approved\'))">' + kvT('appr.approve') + '</button>' +
        '</div></div>';
    }).join('');
    el.innerHTML = workHtml + toolHtml;
  }
  kvApprovalBadge();
}
function kvApprovalBadge(){
  var n = kvApprovals().filter(function(a){ return a.status === 'pending'; }).length;
  var b = kvPlaybook(kvBizType());
  var workNeeds = (b.work || []).filter(function(w, i){ return w.tag === 'needs you' && !kvWorkDone(i); }).length;
  var total = n + workNeeds;
  ['kv-side-approvals-badge','kv-drawer-approvals-badge'].forEach(function(id){
    var b = document.getElementById(id);
    if (b){ b.textContent = total; b.style.display = total ? 'inline-flex' : 'none'; }
  });
  var mobile = document.getElementById('kv-bottom-work-badge');
  if (mobile){ mobile.textContent = total; mobile.style.display = total ? 'inline-flex' : 'none'; }
}


/* ============================================================
   I18N — EN/BM language toggle (English-first, BM support).
   ============================================================ */
var KV_I18N = {
  en: {
    'nav.home':'Home','nav.chat':'Ask AISAR','nav.team':'Team Chat','nav.business':'My Business','nav.business.short':'Business','nav.aiteam':'AI Team','nav.work':'Activity','nav.connections':'Connections',
    'nav.approvals':'Approvals','view.approvals':'Approvals','view.approvals.desc':'Actions your AI team wants to take — nothing goes out until you approve.','appr.approve':'Approve','appr.reject':'Reject','appr.approved':'Approved ✓','appr.rejected':'Rejected','appr.empty':'Nothing pending. AISAR will ask when a sensitive action needs you.','appr.risk.high':'High risk','appr.risk.medium':'Medium','appr.risk.low':'Low','appr.op.send':'Send a message','appr.op.pay':'Make a payment','appr.op.cancel':'Cancel an item','appr.op.refund':'Issue a refund','appr.op.update':'Update information','appr.op.book':'Confirm a booking','appr.op.export':'Export information',
    'nav.landing':'← Landing','nav.getstarted':'Get started','nav.openchat':'Open activity →','nav.logout':'Log out','status.working':'AISAR working','status.setup':'Setup needed','status.connect':'Connection needed',
    'cx.oauth':'one-click login','cx.link':'secure link — no setup','cx.file':'simple file or account sync','cx.bss':'we handle the credentials — you approve','conn.guide.oauth':'Sign in and approve. AISAR handles the setup.','conn.guide.link':'Follow a secure link. AISAR handles the rest.','conn.guide.file':'Choose a file or connect an account. No technical setup required.','conn.guide.bss':'Approve access. AISAR handles the credentials securely.',
    'view.home.greet':'Good morning 👋','view.home.desc':"Here's what happened while you were away.",
    'view.chat':'Ask AISAR','view.chat.desc':'Ask for an update or tell AISAR what to handle next.','ask.tab':'Ask AISAR','ask.tab.conversations':'Customer inbox','ask.ready':'Ready to handle your business','ask.empty.title':'What can I take off your plate?','ask.welcome':'Ask what happened, give me a job, or tell me what you want to improve. I’ll work from what I know about your business.','ask.placeholder':'Ask AISAR anything about your business…','ask.hint':'Enter to send · Shift + Enter for a new line','ask.prompt.status':'Give me today’s update','ask.prompt.approvals':'What needs my approval?','ask.prompt.next':'What should you handle next?','ask.send':'Ask AISAR','ask.conversations':'Customer conversations','ask.conversations.desc':'See what AISAR said and take over whenever you want.','ask.inbox.live':'AISAR is replying','ask.you':'You','ask.now':'Now','ask.status':'I handled {handled} items today. {needs} still need your attention.','ask.needone':'1 item needs your review. Open Activity to approve, edit, or reject it.','ask.needs':'{n} items need your review. Open Activity to approve, edit, or reject them.','ask.clear':'Nothing needs your attention right now.','ask.next':'I recommend “{title}” next. {detail}','ask.default':'I can help with that. I’ll use your business profile and connected tools, and I’ll ask before any sensitive action.',
    'view.team':'Team Chat','view.team.desc':'One space for you + all AI agents — tag @agent, they answer.',
    'view.business':'My Business','view.business.desc':'Everything AISAR knows, handles, and can access. Correct or disconnect anything here.',
    'view.aiteam':'AI Team','view.aiteam.desc':'Your team, organised by job — not by agents, models or workflows.',
    'view.work':'Activity','view.work.desc':'What AISAR completed, what is in progress, and the decisions that need you.',
    'view.connections':'Connections','view.connections.desc':"The tools your AI team works with. Every connection is explained — you always know why it's there.",
    'side.business':'My Business','side.complete':'✓ Setup complete','side.industry':'Your industry','side.demo':'Demo preview','side.finish':'Finish setup →','side.potential':'AISAR can handle','side.routine':'of routine work','side.review':'Review opportunities →',
    'drawer.menu':'Menu','drawer.platform':'AISAR platform',
    'biz.profile':'Business profile','biz.website':'Website','biz.contact':'Contact','biz.booking':'Booking','biz.systems':'Systems','biz.handles':'What AISAR handles','biz.handles.desc':'The jobs AISAR is doing now and the next useful responsibilities it can take on.','biz.connections':'Connected tools & permissions','biz.connections.desc':'See what AISAR can access, why it needs each connection, and disconnect it at any time.','func.covered':'handled','func.live':'working','func.opportunity':'ready next',
    'conn.focus':'AISAR focuses on where your customers actually are.','conn.ready':'Ready to connect','conn.telegram':'Lets AISAR answer enquiries and send updates through Telegram.','conn.connect':'Connect','conn.disconnect':'Disconnect','conn.connected':'connected','conn.off':'off',
    'conn.enable':'Connect & enable','conn.first':'Connect first','home.open':'Open',
    'sub.step1':'AISAR has learned your business. Finish the final details so it can start working.',
    'sub.step2':'AISAR is ready. Connect one customer channel to put it to work.',
    'sub.step3':"Here's what happened while you were away.",
    'cmd.step1.title':'Ready to finish','cmd.step1.head':'Complete your business details','cmd.step1.body':'AISAR has learned the basics. Confirm the final details before it starts working.','cmd.step1.cta':'Finish setup →',
    'cmd.step2.title':'Ready to work','cmd.step2.head':'Let AISAR answer customers','cmd.step2.body':'Connect WhatsApp or another customer channel. AISAR handles the technical setup.','cmd.step2.tag':'1 connection','cmd.step2.cta':'Connect a channel →',
    'cmd.step3.title':'Today at a glance','cmd.step3.head':'AISAR handled {n} tasks today','cmd.step3.clear':'Everything is handled. Nothing needs your attention.','cmd.step3.need':'1 item needs your approval.','cmd.step3.needs':'{n} items need your approval.','cmd.step3.review':'Review now',
    'work.need':'Needs you','work.auto':'Approved','work.activity':'Handled','work.approve':'Approve & send','work.edit':'Edit','work.empty':'Nothing in this category. Everything is handled. 🎉','activity.approvals':'Needs your approval','activity.approvals.desc':'Sensitive actions wait here until you approve or reject them.','activity.history':'Work history',
    'work.f.need':'⚠️ Needs you','work.f.auto':'✓ Handled','work.f.done':'🛡️ Approved','work.f.all':'📋 All','work.respond':'Review',
    'team.ph.pasukan':'Message for the team — tag @agent…','team.ph.escalation':'Update / instructions — tag @agent…','team.ph.random':'Casual chat — tag @agent…','team.channels':'channels',
    'chat.search':'Search conversations…','chat.reply':'Type a reply…','chat.takeover':'Take over to reply yourself…','chat.send':'Send',
    'toast.approved':'✓ Approved & sent.',
    'rec.title':'AISAR found','rec.head':'More work AISAR can handle','rec.desc':'These responsibilities could save your business the most time next.','rec.rec':'ready','rec.cta':'Put AISAR to work','rec.added':'✓ {n} is being prepared. Review the required connections below.',
    'pot.txt':'AISAR found {n} more ways it can help.',
    'uc.suggested':'Ready next','uc.automate':'Put AISAR to work','uc.notnow':'Not now','uc.opportunity':'ready to set up','uc.see':'Review in Activity','uc.more':'More work AISAR is ready to handle','uc.started':'AISAR is preparing this. Review the required access when you are ready.','uc.savedlater':'Saved for later. AISAR will keep it available.','uc.reviewaccess':'Review required access','uc.preparing':'preparing','home.recent':'Recent activity','home.openactivity':'Open activity →','home.empty':'No activity yet. AISAR will show completed work here.','team.waiting':'Waiting for access — connect the required tool below.'
  },
  bm: {
    'nav.home':'Home','nav.chat':'Tanya AISAR','nav.team':'Chat Pasukan','nav.business':'Bisnes Saya','nav.business.short':'Bisnes','nav.aiteam':'Pasukan AI','nav.work':'Aktiviti','nav.connections':'Sambungan',
    'nav.approvals':'Kelulusan','view.approvals':'Kelulusan','view.approvals.desc':'Tindakan yang pasukan AI mahu ambil — tiada apa keluar sebelum anda luluskan.','appr.approve':'Lulus','appr.reject':'Tolak','appr.approved':'Diluluskan ✓','appr.rejected':'Ditolak','appr.empty':'Tiada yang menunggu. AISAR akan bertanya apabila tindakan sensitif memerlukan anda.','appr.risk.high':'Risiko tinggi','appr.risk.medium':'Sederhana','appr.risk.low':'Rendah','appr.op.send':'Hantar mesej','appr.op.pay':'Buat bayaran','appr.op.cancel':'Batalkan item','appr.op.refund':'Buat bayaran balik','appr.op.update':'Kemas kini maklumat','appr.op.book':'Sahkan tempahan','appr.op.export':'Eksport maklumat',
    'nav.landing':'← Laman','nav.getstarted':'Mula sekarang','nav.openchat':'Buka aktiviti →','nav.logout':'Keluar','status.working':'AISAR sedang bekerja','status.setup':'Setup diperlukan','status.connect':'Sambungan diperlukan',
    'cx.oauth':'log masuk satu klik','cx.link':'pautan selamat — tiada setup','cx.file':'sync fail atau akaun ringkas','cx.bss':'kami urus kelayakan — anda luluskan','conn.guide.oauth':'Log masuk dan luluskan. AISAR menguruskan setup.','conn.guide.link':'Ikuti pautan selamat. AISAR menguruskan selebihnya.','conn.guide.file':'Pilih fail atau sambungkan akaun. Tiada setup teknikal diperlukan.','conn.guide.bss':'Luluskan akses. AISAR menguruskan kelayakan dengan selamat.',
    'view.home.greet':'Selamat pagi 👋','view.home.desc':'Apa yang berlaku semasa kau pergi.',
    'view.chat':'Tanya AISAR','view.chat.desc':'Minta kemas kini atau beritahu AISAR apa yang perlu diurus seterusnya.','ask.tab':'Tanya AISAR','ask.tab.conversations':'Peti masuk pelanggan','ask.ready':'Sedia mengurus bisnes anda','ask.empty.title':'Apa yang boleh saya urus untuk anda?','ask.welcome':'Tanya apa yang berlaku, beri saya kerja, atau beritahu apa yang anda mahu tingkatkan. Saya akan gunakan apa yang saya tahu tentang bisnes anda.','ask.placeholder':'Tanya AISAR apa sahaja tentang bisnes anda…','ask.hint':'Enter untuk hantar · Shift + Enter untuk baris baharu','ask.prompt.status':'Beri kemas kini hari ini','ask.prompt.approvals':'Apa yang perlukan kelulusan saya?','ask.prompt.next':'Apa yang patut anda urus seterusnya?','ask.send':'Tanya AISAR','ask.conversations':'Perbualan pelanggan','ask.conversations.desc':'Lihat apa yang AISAR katakan dan ambil alih pada bila-bila masa.','ask.inbox.live':'AISAR sedang membalas','ask.you':'Anda','ask.now':'Sekarang','ask.status':'Saya mengurus {handled} perkara hari ini. {needs} masih perlukan perhatian anda.','ask.needone':'1 perkara perlukan semakan anda. Buka Aktiviti untuk luluskan, edit, atau tolak.','ask.needs':'{n} perkara perlukan semakan anda. Buka Aktiviti untuk luluskan, edit, atau tolak.','ask.clear':'Tiada apa yang perlukan perhatian anda sekarang.','ask.next':'Saya cadangkan “{title}” seterusnya. {detail}','ask.default':'Saya boleh bantu. Saya akan gunakan profil bisnes dan alat tersambung, serta meminta kelulusan sebelum tindakan sensitif.',
    'view.team':'Chat Pasukan','view.team.desc':'Satu ruang untuk kau + semua AI agent — tag @agent, dia jawab.',
    'view.business':'Bisnes Saya','view.business.desc':'Semua yang AISAR tahu, urus, dan boleh akses. Betulkan atau putuskan sambungan di sini.',
    'view.aiteam':'Pasukan AI','view.aiteam.desc':'Pasukan kau, diatur ikut kerja — bukan ikut agents, models atau workflows.',
    'view.work':'Aktiviti','view.work.desc':'Apa yang AISAR telah siapkan, sedang lakukan, dan keputusan yang perlukan anda.',
    'view.connections':'Sambungan','view.connections.desc':'Alat yang pasukan AI kau guna. Setiap sambungan diterangkan — kau sentiasa tahu kenapa ia ada.',
    'side.business':'Bisnes Saya','side.complete':'✓ Setup selesai','side.industry':'Industri anda','side.demo':'Pratonton demo','side.finish':'Sambung setup →','side.potential':'AISAR boleh urus','side.routine':'kerja rutin','side.review':'Semak peluang →',
    'drawer.menu':'Menu','drawer.platform':'Platform AISAR',
    'biz.profile':'Profil bisnes','biz.website':'Laman web','biz.contact':'Hubungan','biz.booking':'Tempahan','biz.systems':'Sistem','biz.handles':'Apa yang AISAR urus','biz.handles.desc':'Kerja yang AISAR sedang lakukan dan tanggungjawab berguna seterusnya yang boleh diambil alih.','biz.connections':'Alat & kebenaran tersambung','biz.connections.desc':'Lihat apa yang AISAR boleh akses, sebab ia diperlukan, dan putuskan sambungan bila-bila masa.','func.covered':'diurus','func.live':'sedang bekerja','func.opportunity':'sedia seterusnya',
    'conn.focus':'AISAR fokus di mana pelanggan anda sebenarnya berada.','conn.ready':'Sedia disambung','conn.telegram':'Membolehkan AISAR menjawab pertanyaan dan menghantar kemas kini melalui Telegram.','conn.connect':'Sambung','conn.disconnect':'Putuskan','conn.connected':'tersambung','conn.off':'tidak aktif',
    'conn.enable':'Sambung & aktifkan','conn.first':'Sambung dulu','home.open':'Buka',
    'sub.step1':'AISAR sudah belajar bisnes anda. Lengkapkan butiran akhir supaya ia boleh mula bekerja.',
    'sub.step2':'AISAR sudah sedia. Sambungkan satu saluran pelanggan untuk mula bekerja.',
    'sub.step3':'Apa yang berlaku semasa kau pergi.',
    'cmd.step1.title':'Sedia untuk dilengkapkan','cmd.step1.head':'Lengkapkan butiran bisnes','cmd.step1.body':'AISAR sudah belajar asasnya. Sahkan butiran akhir sebelum ia mula bekerja.','cmd.step1.cta':'Siapkan setup →',
    'cmd.step2.title':'Sedia untuk bekerja','cmd.step2.head':'Biar AISAR jawab pelanggan','cmd.step2.body':'Sambungkan WhatsApp atau saluran pelanggan lain. AISAR urus setup teknikal.','cmd.step2.tag':'1 sambungan','cmd.step2.cta':'Sambung saluran →',
    'cmd.step3.title':'Ringkasan hari ini','cmd.step3.head':'AISAR mengurus {n} tugasan hari ini','cmd.step3.clear':'Semuanya selesai. Tiada apa yang perlukan perhatian anda.','cmd.step3.need':'1 perkara perlukan kelulusan anda.','cmd.step3.needs':'{n} perkara perlukan kelulusan anda.','cmd.step3.review':'Semak sekarang',
    'work.need':'Perlu anda','work.auto':'Diluluskan','work.activity':'Diurus','work.approve':'Lulus & hantar','work.edit':'Edit','work.empty':'Tiada apa dalam kategori ini. Semuanya selesai. 🎉','activity.approvals':'Perlukan kelulusan anda','activity.approvals.desc':'Tindakan sensitif menunggu di sini sehingga anda luluskan atau tolak.','activity.history':'Sejarah kerja',
    'work.f.need':'⚠️ Perlu anda','work.f.auto':'✓ Diurus','work.f.done':'🛡️ Diluluskan','work.f.all':'📋 Semua','work.respond':'Semak',
    'team.ph.pasukan':'Mesej untuk pasukan — tag @agent…','team.ph.escalation':'Update / arahan — tag @agent…','team.ph.random':'Sembang santai — tag @agent…','team.channels':'saluran',
    'chat.search':'Cari perbualan…','chat.reply':'Type balasan…','chat.takeover':'Ambil alih untuk reply sendiri…','chat.send':'Send',
    'toast.approved':'✓ Diluluskan & dihantar.',
    'rec.title':'AISAR menjumpai','rec.head':'Lebih banyak kerja yang AISAR boleh urus','rec.desc':'Tanggungjawab ini boleh menjimatkan paling banyak masa bisnes anda seterusnya.','rec.rec':'sedia','rec.cta':'Mulakan AISAR','rec.added':'✓ {n} sedang disediakan. Semak sambungan yang diperlukan di bawah.',
    'pot.txt':'AISAR menjumpai {n} lagi cara untuk membantu.',
    'uc.suggested':'Sedia seterusnya','uc.automate':'Mulakan AISAR','uc.notnow':'Nanti dulu','uc.opportunity':'sedia untuk disediakan','uc.see':'Semak dalam Aktiviti','uc.more':'Lebih banyak kerja yang AISAR sedia urus','uc.started':'AISAR sedang menyediakannya. Semak akses yang diperlukan apabila anda sedia.','uc.savedlater':'Disimpan untuk kemudian. AISAR akan mengekalkannya di sini.','uc.reviewaccess':'Semak akses diperlukan','uc.preparing':'sedang disediakan','home.recent':'Aktiviti terkini','home.openactivity':'Buka aktiviti →','home.empty':'Belum ada aktiviti. AISAR akan tunjukkan kerja yang siap di sini.','team.waiting':'Menunggu akses — sambungkan alat yang diperlukan di bawah.'
  }
};
var KV_LANG = (function(){
  var l = KV_STORE.get('aisar-lang','');
  if (l === 'en' || l === 'bm') return l;
  var c = kvCountry();
  if (c && c.lang && KV_I18N && KV_I18N[c.lang]) return c.lang;
  return 'en';   /* English-first: fallback selamat sampai terjemahan negara siap */
})();
function kvT(k){
  var d = KV_I18N[KV_LANG] || KV_I18N.en;
  if (d && d[k]) return d[k];
  return (KV_I18N.en && KV_I18N.en[k]) ? KV_I18N.en[k] : k;
}
function kvToggleLang(){
  KV_LANG = (KV_LANG === 'en') ? 'bm' : 'en';
  KV_STORE.set('aisar-lang', KV_LANG);
  kvApplyLang();
  try { kvRenderAll(); } catch(e){ if (window.console) console.error(e); }
}
function kvLogout(){
  /* Logout = kembali ke landing page. State demo kekal. */
  try { window.location.href = '/'; } catch(e){}
}
function kvApplyLang(){
  document.querySelectorAll('[data-t]').forEach(function(el){
    var v = kvT(el.getAttribute('data-t'));
    if (v) el.textContent = v;
  });
  document.querySelectorAll('.kv-lang-btn').forEach(function(el){
    el.textContent = (KV_LANG === 'en') ? 'BM' : 'EN';
  });
  document.querySelectorAll('[data-t-placeholder]').forEach(function(el){
    el.setAttribute('placeholder', kvT(el.getAttribute('data-t-placeholder')));
  });
  document.title = (KV_LANG === 'en') ? 'AISAR — Your business, without the busywork' : 'AISAR — Bisnes anda, tanpa kerja yang membebankan';
}

/* ============================================================
   PLAYBOOKS — pola per industri. Setiap entri = template
   dashboard lengkap. Fields:
   icon, keywords (untuk inference), name, type, sub, site,
   booking, systems, potential, opportunities, ch (default
   channels), detect (hasil scan), confirm (soalan step 3),
   funcs, stats, sug, team, work, conns.
   ============================================================ */
var PLAYBOOKS = {

  restaurant: {
    icon: '🍜', keywords: ['restaurant','cafe','café','kedai makan','kopi','kopitiam','food','bistro','warung','mamak','grill','sushi','pizza','burger','dapur','kafe'], kw: { ID: ['nasi padang','warteg','rumah makan'] },
    name: 'Your Restaurant', type: 'Restaurant / Café', sub: 'Restaurant / Café', site: 'yourbusiness.com', booking: 'Phone + Instagram DM', systems: 'Google Sheets · POS',
    potential: 62, opportunities: 4, ch: ['WhatsApp','Instagram'],
    detect: 'restaurant · premium · Kuala Lumpur',
    loc: 'Kuala Lumpur, MY',
    confirm: 'I found that you operate a restaurant/café in Kuala Lumpur. Is that correct?',
    funcs: [['Customer service','','covered'],['Reservations','green','live'],['Follow-up','green','live'],['Inventory & ordering','amber','opportunity'],['Weekly reports','amber','opportunity']],
    stats: [
      { d:'Today', v:'12', u:'', l:'conversations handled', s:'4 needed you' },
      { d:'Reservations', v:'7', u:'', l:'new bookings this week', s:'3 via WhatsApp' },
      { d:'Hours saved', v:'18', u:' hrs', l:'saved this week by your AI team', p:64 } ],
    sug: { t:'Automate your Friday export', d:'You manually export reservations to Sheets every Friday. AISAR can do this automatically.', tag:'est. 1 hr/month', cta:'Automation queued — I\u0027ll take care of the Friday export.' },
    team: [
      { e:'💬', n:'Customer Assistant', ch:'WhatsApp · Instagram', d:'Answers FAQs, menu questions, opening hours and policies — 24/7, in your voice. Escalates complaints.', m:'Today · 12 chats · 4 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Calendar · Confirmations', d:'Checks availability, creates bookings, sends confirmations and reminders automatically.', m:'This week · 7 bookings' },
      { e:'🔁', n:'Follow-up', ch:'Past customers', d:'Follows up past customers, special occasions, and abandoned enquiries — turning one-time buyers into regulars.', m:'This month · 23 follow-ups' },
      { e:'📊', n:'Ops Assistant', ch:'Inventory · Reports', d:'Watches your spreadsheets, automates supplier ordering, and prepares your weekly business report every Monday.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "Do you have halal certification?" with menu + certification link.' },
      { e:'📅', n:'Booking Agent', t:'Instagram · 1h ago · auto', tag:'confirmed', tc:'green', d:'Created booking for 2 pax, Sat 8pm — sent confirmation + reminder.' },
      { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Sent birthday promo to 6 past customers (personalised, in brand voice).' },
      { e:'⚠️', n:'Customer Assistant', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Customer complained about wrong order delivery — AISAR apologised and offered 10% off. Review before sending?', cta:'Approved — 10% discount voucher sent.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant & Follow-up use this to talk to customers.', on:true },
      { e:'📸', n:'Instagram', s:'DM · linked', d:'Booking Agent receives reservation DMs here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent checks availability and creates events.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads reservations & inventory here.', on:true },
      { e:'🧾', n:'Accounting / POS', s:'not connected', d:'Unlocks ordering automation + weekly P&L reports.', on:false, cta:'Accounting connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  retail: {
    icon: '🛍️', keywords: ['retail','e-commerce','ecommerce','shop','store','kedai runcit','fashion','baju','pakaian','online store','marketplace','shopee','lazada','tiktok shop','homeware','kosmetik','product','distributor'],
    name: 'Your Store', type: 'Retail / E-commerce', sub: 'Retail / E-commerce', site: 'yourstore.my', booking: 'Shopee / Website checkout', systems: 'Shopify · Google Sheets',
    potential: 58, opportunities: 5, ch: ['WhatsApp','Instagram'],
    detect: 'e-commerce · home & living · Shah Alam',
    loc: 'Shah Alam, MY',
    confirm: 'I found that you run a home & living e-commerce business in Shah Alam. Is that correct?',
    funcs: [['Customer service','','covered'],['Order status','green','live'],['Abandoned carts','green','live'],['Returns','amber','opportunity'],['Weekly reports','amber','opportunity']],
    stats: [
      { d:'Today', v:'34', u:'', l:'orders processed', s:'6 support tickets' },
      { d:'Orders this week', v:'211', u:'', l:'across your channels', s:'9 refunds handled' },
      { d:'Hours saved', v:'22', u:' hrs', l:'saved this week by your AI team', p:71 } ],
    sug: { t:'Automate abandoned cart recovery', d:'Shoppers leave carts every day. AISAR follows up automatically with a personalised message + offer.', tag:'est. 3 hrs/month', cta:'Automation queued — I\u0027ll take care of cart recovery.' },
    team: [
      { e:'💬', n:'Customer Assistant', ch:'WhatsApp · Instagram', d:'Answers product questions, stock, shipping and policy FAQs — 24/7.', m:'Today · 34 chats · 6 escalated' },
      { e:'📦', n:'Order Tracker', ch:'Store · Email', d:'Tracks orders and sends status updates automatically as items ship.', m:'This week · 41 updates' },
      { e:'🔁', n:'Follow-up', ch:'Abandoned carts · Past customers', d:'Recovers abandoned carts and nudges repeat-purchase in your brand voice.', m:'This month · 17 campaigns' },
      { e:'📊', n:'Ops Assistant', ch:'Inventory · Reports', d:'Watches stock levels, reorders best-sellers, and prepares your weekly sales report.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "Is this available in size L?" with stock + product link.' },
      { e:'📦', n:'Order Tracker', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Sent tracking update for order #1024 — out for delivery.' },
      { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Sent cart recovery to 5 shoppers who abandoned checkout yesterday.' },
      { e:'⚠️', n:'Customer Assistant', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Customer complained about late delivery — AISAR apologised and offered free shipping. Review before sending?', cta:'Approved — free shipping voucher sent.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant & Follow-up use this to talk to customers.', on:true },
      { e:'📸', n:'Instagram', s:'Shop · linked', d:'Customer Assistant answers product DMs here.', on:true },
      { e:'🛒', n:'Store platform', s:'linked', d:'Order Tracker reads orders & fulfilment here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads inventory here.', on:true },
      { e:'💳', n:'Payment gateway', s:'not connected', d:'Unlocks automatic refunds & failed-payment follow-ups.', on:false, cta:'Payment connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  smallretail: {
    icon: '🛒', keywords: ['butik','boutique','kasut','shoe','sneaker','aksesori','accessory','handbag','beg','tudung','hijab','reseller','preloved','apparel','clothing','vintage','kedai baju','kedai kasut','kedai aksesori','kedai hadiah','gift shop','baju kurung','baju melayu'], kw: { ID: ['toko baju','toko tas','toko aksesoris','konveksi'] },
    name: 'Your Boutique', type: 'Small Retail / Kedai', sub: 'Small Retail / Kedai', site: 'yourboutique.my', booking: 'WhatsApp / Walk-in', systems: 'WhatsApp · Instagram · Google Sheets',
    potential: 62, opportunities: 4, ch: ['WhatsApp','Instagram'],
    detect: 'small retail · fashion & lifestyle · Shah Alam',
    loc: 'Shah Alam, MY',
    confirm: 'I found that you run a small retail shop — boutique or kedai — taking orders via WhatsApp and walk-ins. Is that correct?',
    funcs: [['Customer service','','covered'],['WhatsApp orders','green','live'],['Inventory & ordering','amber','opportunity'],['Loyalty & rebooking','amber','opportunity'],['Weekly reports','amber','opportunity']],
    stats: [
      { d:'Today', v:'26', u:'', l:'enquiries answered', s:'3 needed you' },
      { d:'Orders this week', v:'47', u:'', l:'via WhatsApp & walk-in', s:'2 pending payment' },
      { d:'Hours saved', v:'15', u:' hrs', l:'saved this week by your AI team', p:58 } ],
    sug: { t:'Automate WhatsApp order intake', d:'Customers order via WhatsApp all day — even when your shop is closed. AISAR captures orders, confirms sizes and prices, and sends receipts automatically.', tag:'est. 6 hrs/month', cta:'Automation queued — I\u0027ll take your orders on WhatsApp.' },
    team: [
      { e:'💬', n:'Customer Assistant', ch:'WhatsApp · Instagram', d:'Answers product, size, stock and shop-hours questions — 24/7.', m:'Today · 28 chats · 4 escalated' },
      { e:'🛒', n:'Order Taker', ch:'WhatsApp · Walk-in', d:'Captures orders, confirms details and sends receipts — no pen needed.', m:'This week · 19 orders' },
      { e:'🔁', n:'Follow-up', ch:'WhatsApp · Past customers', d:'Nudges repeat purchases and reminds customers about reserved items.', m:'This month · 12 campaigns' },
      { e:'📊', n:'Ops Assistant', ch:'Stock · Reports', d:'Watches stock levels, flags low items, and prepares your weekly sales report.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "Kedai buka sampai pukul berapa?" with store hours + location.' },
      { e:'🛒', n:'Order Taker', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Captured order #241: 2x baju kurung (S, M) — payment pending.' },
      { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Sent reorder nudge to 6 past customers whose size restock just arrived.' },
      { e:'⚠️', n:'Customer Assistant', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Customer asked about a bulk order (50 pcs) — AISAR checked with you before promising a price. Review?', cta:'Approved — offer sent with 8% bulk discount.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant & Order Taker use this to talk to customers.', on:true },
      { e:'📸', n:'Instagram', s:'Shop · linked', d:'Customer Assistant answers product DMs here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads stock & orders here.', on:true },
      { e:'💳', n:'Payment gateway', s:'not connected', d:'Unlocks automatic receipts & payment reminders.', on:false, cta:'Payment connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  catering: {
    icon: '🎪', keywords: ['catering','katering','buffet','bento','bento box','tiffin','hi-tea','high tea','caterer'],
    name: 'Your Catering', type: 'Catering / Event', sub: 'Catering / Event', site: 'yourcatering.my', booking: 'WhatsApp / Phone', systems: 'WhatsApp · Google Sheets',
    potential: 64, opportunities: 4, ch: ['WhatsApp','Instagram'],
    detect: 'catering & events · Kuala Lumpur',
    loc: 'Kuala Lumpur, MY',
    confirm: 'I found that you run a catering / event food business. Is that correct?',
    funcs: [['Customer service','','covered'],['Event quotes','green','live'],['Order intake','green','live'],['Scheduling','amber','opportunity'],['Weekly reports','amber','opportunity']],
    stats: [
      { d:'Today', v:'14', u:'', l:'enquiries answered', s:'5 quote requests' },
      { d:'Events this month', v:'9', u:'', l:'confirmed from quotes', s:'3 pending deposit' },
      { d:'Hours saved', v:'12', u:' hrs', l:'saved this week by your AI team', p:55 } ],
    sug: { t:'Automate event quote requests', d:'Clients ask for buffet quotes at all hours. AISAR collects event details (date, pax, menu) and sends a quote — no back-and-forth.', tag:'est. 5 hrs/month', cta:'Automation queued — I\u0027ll handle quote requests.' },
    team: [
      { e:'💬', n:'Customer Assistant', ch:'WhatsApp · Instagram', d:'Answers menu, pricing and availability questions — 24/7.', m:'Today · 16 chats · 3 escalated' },
      { e:'📝', n:'Quote Agent', ch:'WhatsApp · Form', d:'Collects event details (date, pax, menu) and drafts quotes instantly.', m:'This week · 6 quotes' },
      { e:'📅', n:'Event Coordinator', ch:'Calendar · WhatsApp', d:'Tracks confirmed events and reminds you about deposits and prep.', m:'This month · 9 events' },
      { e:'📊', n:'Ops Assistant', ch:'Sheets · Reports', d:'Watches ingredient stock and prepares post-event summaries.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "Ada menu untuk 50 pax?" with package options + price range.' },
      { e:'📝', n:'Quote Agent', t:'1h ago · auto', tag:'sent', tc:'green', d:'Sent buffet quote for 19 Aug (80 pax, RM 28/pax) — awaiting deposit.' },
      { e:'📅', n:'Event Coordinator', t:'3h ago · auto', tag:'confirmed', tc:'green', d:'Booking confirmed for Saturday wedding — reminder set for prep day.' },
      { e:'⚠️', n:'Customer Assistant', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Client asked for halal certification documents — AISAR needs your copy to send. Review?', cta:'Approved — cert sent.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant & Quote Agent use this to talk to clients.', on:true },
      { e:'📸', n:'Instagram', s:'Shop · linked', d:'Customer Assistant answers menu DMs here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads quotes & bookings here.', on:true },
      { e:'💳', n:'Payment gateway', s:'not connected', d:'Unlocks automatic deposits & payment reminders.', on:false, cta:'Payment connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  photography: {
    icon: '📸', keywords: ['photography','photographer','foto','gambar','shoot','video shoot','videography','videographer','studio foto','wedding shoot','prewedding','seni foto','portfolio shoot'],
    name: 'Your Studio', type: 'Photography / Video', sub: 'Photography / Video', site: 'yourstudio.my', booking: 'Calendly · WhatsApp', systems: 'Google Calendar · Portfolio',
    potential: 60, opportunities: 4, ch: ['Instagram','WhatsApp'],
    detect: 'photography & videography · Kuala Lumpur',
    loc: 'Kuala Lumpur, MY',
    confirm: 'I found that you run a photography / videography studio. Is that correct?',
    funcs: [['Enquiry response','','covered'],['Booking slots','green','live'],['Gallery delivery','green','live'],['Scheduling','amber','opportunity'],['Invoicing','amber','opportunity']],
    stats: [
      { d:'Today', v:'18', u:'', l:'enquiries answered', s:'4 booking requests' },
      { d:'Shoots this month', v:'11', u:'', l:'booked & scheduled', s:'2 rescheduled' },
      { d:'Hours saved', v:'14', u:' hrs', l:'saved this week by your AI team', p:57 } ],
    sug: { t:'Automate booking & reminder flow', d:'Clients ask "ada slot weekend ni?" every day. AISAR checks your calendar, books slots and sends reminders — no double-booking.', tag:'est. 4 hrs/month', cta:'Automation queued — I\u0027ll handle bookings.' },
    team: [
      { e:'💬', n:'Lead Responder', ch:'Instagram · WhatsApp', d:'Answers package, price and availability questions — in seconds.', m:'Today · 20 chats · 5 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Calendar · WhatsApp', d:'Checks studio availability and books shoots without the back-and-forth.', m:'This week · 7 bookings' },
      { e:'🖼️', n:'Client Assistant', ch:'Email · Link', d:'Delivers galleries, sends previews and reminds clients about prints.', m:'This month · 12 deliveries' },
      { e:'📊', n:'Ops Assistant', ch:'Sheets · Invoicing', d:'Tracks shoot invoices and chases late payments politely.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Lead Responder', t:'Instagram · 2m ago · auto', tag:'done', tc:'', d:'Answered "Berapa untuk prewedding outdoor?" with package + sample link.' },
      { e:'📅', n:'Booking Agent', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Booked family shoot — Sat 10am, studio A. Reminder sent to client.' },
      { e:'🖼️', n:'Client Assistant', t:'3h ago · auto', tag:'sent', tc:'green', d:'Delivered wedding gallery — 230 edited photos, 24h download link.' },
      { e:'⚠️', n:'Lead Responder', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Client wants a rush quote for corporate event coverage (3 days notice). AISAR asked if you can accept. Review?', cta:'Approved — rush fee quoted.' } ],
    conns: [
      { e:'📸', n:'Instagram', s:'Shop · linked', d:'Lead Responder answers DMs & comments here.', on:true },
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Booking Agent confirms sessions here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent reads availability from your studio calendar.', on:true },
      { e:'🧾', n:'Invoicing', s:'not connected', d:'Unlocks automatic invoices & payment follow-ups after each shoot.', on:false, cta:'Invoicing wizard will open — we\u0027ll guide you through it.' } ]
  },

  bakery: {
    icon: '🍰', keywords: ['bakery','bakeri','kek','cake','cupcake','donut','brownie','tart','patisserie','kedai kek','biskut','cookies','artisan bread','rotibakar'],
    name: 'Your Bakery', type: 'Bakery / Patisserie', sub: 'Bakery / Patisserie', site: 'yourbakery.my', booking: 'WhatsApp / Walk-in', systems: 'WhatsApp · Instagram · Google Sheets',
    potential: 63, opportunities: 5, ch: ['WhatsApp','Instagram'],
    detect: 'bakery & patisserie · Shah Alam',
    loc: 'Shah Alam, MY',
    confirm: 'I found that you run a bakery / patisserie with custom pre-orders. Is that correct?',
    funcs: [['Customer service','','covered'],['Custom pre-orders','green','live'],['Order reminders','green','live'],['Inventory & ordering','amber','opportunity'],['Loyalty & rebooking','amber','opportunity']],
    stats: [
      { d:'Today', v:'22', u:'', l:'orders & questions handled', s:'3 needed you' },
      { d:'Cakes this week', v:'31', u:'', l:'custom pre-orders', s:'2 cancellations' },
      { d:'Hours saved', v:'16', u:' hrs', l:'saved this week by your AI team', p:61 } ],
    sug: { t:'Automate custom cake orders', d:'Customers describe cakes on WhatsApp at midnight. AISAR captures flavour, size and pickup date — then reminds them to confirm.', tag:'est. 6 hrs/month', cta:'Automation queued — I\u0027ll take cake orders.' },
    team: [
      { e:'💬', n:'Customer Assistant', ch:'WhatsApp · Instagram', d:'Answers flavour, price and order-cutoff questions — 24/7.', m:'Today · 24 chats · 3 escalated' },
      { e:'🎂', n:'Order Taker', ch:'WhatsApp', d:'Captures custom cake orders — flavour, size, pickup date, deposit.', m:'This week · 18 orders' },
      { e:'🔁', n:'Follow-up', ch:'WhatsApp', d:'Reminds customers to confirm & pay, and nudges repeat orders.', m:'This month · 21 reminders' },
      { e:'📊', n:'Ops Assistant', ch:'Stock · Reports', d:'Watches ingredient stock and flags what to bake more of.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "Boleh order kek untuk esok?" with cutoff + pickup info.' },
      { e:'🎂', n:'Order Taker', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Captured order: chocolate 1kg, pickup Sat 3pm — deposit pending.' },
      { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Reminded 4 customers about pickup tomorrow + payment confirmation.' },
      { e:'⚠️', n:'Customer Assistant', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Customer wants a 3-tier wedding cake with custom design — needs your quote. Review?', cta:'Approved — quote sent.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant & Order Taker use this to talk to customers.', on:true },
      { e:'📸', n:'Instagram', s:'Shop · linked', d:'Customer Assistant answers DM orders here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads pre-orders & stock here.', on:true },
      { e:'💳', n:'Payment gateway', s:'not connected', d:'Unlocks automatic deposit collection & receipts.', on:false, cta:'Payment connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  wedding: {
    icon: '💍', keywords: ['wedding','perkahwinan','nikah','kenduri','pelamin','bridal','hantaran','event planner','wedding planner','decor','dekorasi','tent','khemah','gubahan'],
    name: 'Your Studio', type: 'Wedding / Events', sub: 'Wedding / Events', site: 'yourwedding.my', booking: 'WhatsApp / Site visit', systems: 'WhatsApp · Google Sheets',
    potential: 62, opportunities: 5, ch: ['WhatsApp','Instagram'],
    detect: 'wedding & events · Shah Alam',
    loc: 'Shah Alam, MY',
    confirm: 'I found that you run a wedding / event planning business. Is that correct?',
    funcs: [['Enquiry response','','covered'],['Package quotes','green','live'],['Follow-up','green','live'],['Scheduling','amber','opportunity'],['Invoicing','amber','opportunity']],
    stats: [
      { d:'Today', v:'9', u:'', l:'enquiries answered', s:'3 wedding leads' },
      { d:'Events this month', v:'5', u:'', l:'confirmed packages', s:'2 deposits pending' },
      { d:'Hours saved', v:'11', u:' hrs', l:'saved this week by your AI team', p:54 } ],
    sug: { t:'Automate wedding lead follow-up', d:'Couples enquire with 3 planners at once — the fastest reply wins. AISAR answers instantly and books site visits for the best-fit dates.', tag:'est. 5 hrs/month', cta:'Automation queued — I\u0027ll chase wedding leads.' },
    team: [
      { e:'💬', n:'Lead Responder', ch:'Instagram · WhatsApp', d:'Answers package, date and budget questions — in seconds, day or night.', m:'Today · 12 chats · 6 escalated' },
      { e:'📝', n:'Quote Agent', ch:'WhatsApp · Form', d:'Collects wedding details (date, pax, theme) and drafts package quotes.', m:'This week · 4 quotes' },
      { e:'📅', n:'Event Coordinator', ch:'Calendar · WhatsApp', d:'Books site visits, tracks deposits and reminds you about prep milestones.', m:'This month · 5 events' },
      { e:'📊', n:'Ops Assistant', ch:'Sheets · Invoicing', d:'Tracks vendor payments and invoice status per event.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Lead Responder', t:'Instagram · 2m ago · auto', tag:'done', tc:'', d:'Answered "Harga package pelamin + hantaran?" with package link.' },
      { e:'📝', n:'Quote Agent', t:'1h ago · auto', tag:'sent', tc:'green', d:'Sent package quote for Dec wedding (200 pax, theme garden).' },
      { e:'📅', n:'Event Coordinator', t:'3h ago · auto', tag:'confirmed', tc:'green', d:'Site visit booked — Sunday 11am. Reminder set for both parties.' },
      { e:'⚠️', n:'Lead Responder', t:'WhatsApp · 5h ago · escalated', tag:'needs you', tc:'red', d:'Couple wants custom theme + outside vendor — AISAR flagged before promising. Review?', cta:'Approved — custom quote sent.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Lead Responder & Quote Agent use this to talk to couples.', on:true },
      { e:'📸', n:'Instagram', s:'Shop · linked', d:'Lead Responder answers DMs & comments here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads quotes & event status here.', on:true },
      { e:'🧾', n:'Invoicing', s:'not connected', d:'Unlocks automatic deposits & milestone invoice reminders.', on:false, cta:'Invoicing wizard will open — we\u0027ll guide you through it.' } ]
  },

  services: {
    icon: '💼', keywords: ['agency','service','services','studio','konsult','consult','design','branding','marketing','digital','freelance','architect','law','accounting','audit'],
    name: 'Your Studio', type: 'Services / Agency', sub: 'Services / Agency', site: 'yourstudio.my', booking: 'Email / Calendly', systems: 'Notion · Google Calendar',
    potential: 66, opportunities: 4, ch: ['Instagram','Email'],
    detect: 'agency · design & branding · Petaling Jaya',
    loc: 'Petaling Jaya, MY',
    confirm: 'I found that you run a design & branding agency in Petaling Jaya. Is that correct?',
    funcs: [['Enquiry response','','covered'],['Lead intake','green','live'],['Proposal follow-up','green','live'],['Scheduling','amber','opportunity'],['Invoicing','amber','opportunity']],
    stats: [
      { d:'Today', v:'8', u:'', l:'new leads', s:'2 booked discovery calls' },
      { d:'Quotes', v:'3', u:'', l:'sent this week', s:'1 awaiting reply' },
      { d:'Hours saved', v:'14', u:' hrs', l:'saved this week by your AI team', p:55 } ],
    sug: { t:'Automate proposal follow-up', d:'You draft quotes and chase replies manually. AISAR follows up on sent quotes automatically.', tag:'est. 4 hrs/month', cta:'Automation queued — I\u0027ll chase those quotes.' },
    team: [
      { e:'🧲', n:'Lead Responder', ch:'Instagram · Email', d:'Answers scope, pricing and availability questions — and books discovery calls.', m:'Today · 8 leads · 2 booked' },
      { e:'📅', n:'Booking Agent', ch:'Calendar · Scheduling', d:'Checks your calendar and schedules discovery calls without back-and-forth.', m:'This week · 10 calls booked' },
      { e:'🔁', n:'Follow-up', ch:'Sent quotes', d:'Tracks sent proposals and nudges prospects at the right moment.', m:'This month · 9 follow-ups' },
      { e:'📑', n:'Quote Assistant', ch:'Notion · Pricing', d:'Drafts first-pass quotes from your rate card and past projects.', m:'', setup:true } ],
    work: [
      { e:'🧲', n:'Lead Responder', t:'Instagram · 1m ago · auto', tag:'done', tc:'', d:'Answered "Do you do branding for F&B brands?" with portfolio + case study.' },
      { e:'📅', n:'Booking Agent', t:'30m ago · auto', tag:'confirmed', tc:'green', d:'Booked discovery call with new lead for Tue 3pm + sent invite.' },
      { e:'🔁', n:'Follow-up', t:'2h ago · auto', tag:'sent', tc:'green', d:'Followed up quote #Q22 with a short personalised nudge.' },
      { e:'⚠️', n:'Lead Responder', t:'4h ago · escalated', tag:'needs you', tc:'red', d:'Prospect asked for a discount on retainers — AISAR offered a 3-month option. Review before sending?', cta:'Approved — 3-month retainer offer sent.' } ],
    conns: [
      { e:'📸', n:'Instagram', s:'DM · linked', d:'Lead Responder answers enquiries here.', on:true },
      { e:'✉️', n:'Email', s:'Gmail · linked', d:'Proposals and follow-up go through here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent checks availability and creates events.', on:true },
      { e:'📝', n:'Notion', s:'linked', d:'Quote Assistant reads your rate card here.', on:true },
      { e:'💬', n:'WhatsApp', s:'not connected', d:'Unlocks instant client chats for status updates.', on:false, cta:'WhatsApp connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  clinic: {
    icon: '🏥', keywords: ['klinik','clinic','doctor','doktor','gigi','dental','farmasi','pharmacy','physio','terap','therapy','hospital','optometri'],
    name: 'Your Clinic', type: 'Clinic / Health', sub: 'Clinic / Health', site: 'yourclinic.my', booking: 'Phone / WhatsApp', systems: 'Clinic system · Google Sheets',
    potential: 71, opportunities: 6, ch: ['WhatsApp','Phone'],
    detect: 'clinic · GP & family · Johor Bahru',
    loc: 'Johor Bahru, MY',
    confirm: 'I found that you run a GP & family clinic in Johor Bahru. Is that correct?',
    funcs: [['Front desk','','covered'],['Appointments','green','live'],['Intake forms','green','live'],['Reminders','green','live'],['Billing','amber','opportunity']],
    stats: [
      { d:'Today', v:'41', u:'', l:'appointments scheduled', s:'12 intake forms' },
      { d:'This week', v:'86', u:'', l:'patients seen', s:'3 no-shows prevented' },
      { d:'Hours saved', v:'25', u:' hrs', l:'saved this week by your AI team', p:68 } ],
    sug: { t:'Automate appointment reminders', d:'No-shows cost you hours every month. AISAR sends reminders + reschedule links automatically.', tag:'est. 6 hrs/month', cta:'Automation queued — I\u0027ll set up reminders.' },
    team: [
      { e:'🩺', n:'Front Desk Assistant', ch:'WhatsApp · Phone', d:'Answers clinic hours, doctor schedules, and insurance FAQs — 24/7.', m:'Today · 41 chats · 8 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Calendar · Appointments', d:'Books and confirms appointments, and manages the waitlist automatically.', m:'This week · 86 appointments' },
      { e:'🔁', n:'Follow-up', ch:'Patients', d:'Sends reminders, post-visit check-ins, and recall messages for follow-ups.', m:'This month · 210 reminders' },
      { e:'📊', n:'Ops Assistant', ch:'Reports · Billing', d:'Prepares daily patient stats and flags billing anomalies.', m:'', setup:true } ],
    work: [
      { e:'🩺', n:'Front Desk Assistant', t:'WhatsApp · 3m ago · auto', tag:'done', tc:'', d:'Answered "Do you open on Sundays?" with this week\u0027s hours.' },
      { e:'📅', n:'Booking Agent', t:'40m ago · auto', tag:'confirmed', tc:'green', d:'Booked appointment for Azman (check-up) Thu 10am + reminder set.' },
      { e:'🔁', n:'Follow-up', t:'2h ago · auto', tag:'sent', tc:'green', d:'Sent post-visit check-in to 23 patients from yesterday.' },
      { e:'⚠️', n:'Front Desk Assistant', t:'6h ago · escalated', tag:'needs you', tc:'red', d:'Patient asked about pricing for a procedure — AISAR offered a call-back. Review before sending?', cta:'Approved — call-back scheduled.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Front Desk Assistant & Follow-up talk to patients here.', on:true },
      { e:'📞', n:'Phone', s:'linked', d:'Front Desk Assistant can make call-backs here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent manages appointments here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads appointment stats here.', on:true },
      { e:'🏥', n:'Clinic system', s:'not connected', d:'Unlocks automatic patient records sync.', on:false, cta:'Clinic system connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  salon: {
    icon: '💇', keywords: ['salon','salun','dandan','rambut','hair','beauty','spa','kuku','nails','lash','makeup','mekap'],
    name: 'Your Salon', type: 'Salon / Beauty', sub: 'Salon / Beauty', site: 'yoursalon.my', booking: 'Phone / WhatsApp', systems: 'Google Calendar · POS',
    potential: 60, opportunities: 4, ch: ['WhatsApp','Instagram'],
    detect: 'salon & beauty · Shah Alam',
    loc: 'Shah Alam, MY',
    confirm: 'I found that you run a salon/beauty business in Shah Alam. Is that correct?',
    funcs: [['Customer service','','covered'],['Bookings','green','live'],['Reminders','green','live'],['Product retail','amber','opportunity'],['Loyalty & rebooking','amber','opportunity']],
    stats: [
      { d:'Today', v:'9', u:'', l:'appointments', s:'2 walk-in slots left' },
      { d:'New clients', v:'14', u:'', l:'this week', s:'5 via Instagram' },
      { d:'Hours saved', v:'16', u:' hrs', l:'saved this week by your AI team', p:57 } ],
    sug: { t:'Automate booking reminders', d:'No-shows and last-minute cancellations eat your schedule. AISAR sends reminders + fill-from-waitlist automatically.', tag:'est. 3 hrs/month', cta:'Automation queued — I\u0027ll handle reminders + waitlist.' },
    team: [
      { e:'💬', n:'Reception Assistant', ch:'WhatsApp · Instagram', d:'Answers service prices, availability, and stylist questions — 24/7.', m:'Today · 9 chats · 2 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Calendar · Appointments', d:'Books services, manages waitlist, and sends confirmations.', m:'This week · 22 bookings' },
      { e:'🔁', n:'Follow-up', ch:'Past clients', d:'Sends rebooking nudges and after-care messages to keep clients coming back.', m:'This month · 31 rebookings' },
      { e:'📊', n:'Ops Assistant', ch:'Inventory · Reports', d:'Tracks product stock and prepares your weekly client report.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Reception Assistant', t:'WhatsApp · 5m ago · auto', tag:'done', tc:'', d:'Answered "Berapa untuk rebond panjang?" with price list + stylist availability.' },
      { e:'📅', n:'Booking Agent', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Booked colour + treatment for Aina, Sat 11am + reminder set.' },
      { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Sent rebooking nudge to 8 clients whose last visit was 6+ weeks ago.' },
      { e:'⚠️', n:'Reception Assistant', t:'5h ago · escalated', tag:'needs you', tc:'red', d:'Client asked about bridal package pricing — AISAR offered a consultation call. Review before sending?', cta:'Approved — consultation call scheduled.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Reception Assistant & Follow-up talk to clients here.', on:true },
      { e:'📸', n:'Instagram', s:'DM · linked', d:'Booking Agent receives booking DMs here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent manages appointments here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads client & stock data here.', on:true },
      { e:'🧾', n:'POS / Accounting', s:'not connected', d:'Unlocks product retail automation + daily sales reports.', on:false, cta:'POS connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  gym: {
    icon: '🏋️', keywords: ['gym','fitness','futsal','badminton','yoga','pilates','crossfit','workout','sport','sukan','swim','swimming','bootcamp'],
    name: 'Your Gym', type: 'Gym / Fitness', sub: 'Gym / Fitness', site: 'yourgym.my', booking: 'App / WhatsApp', systems: 'Google Sheets · App',
    potential: 63, opportunities: 5, ch: ['WhatsApp','Instagram'],
    detect: 'gym & fitness · Petaling Jaya',
    loc: 'Petaling Jaya, MY',
    confirm: 'I found that you run a gym/fitness studio in Petaling Jaya. Is that correct?',
    funcs: [['Front desk','','covered'],['Class bookings','green','live'],['Member enquiries','green','live'],['Renewals','amber','opportunity'],['Trial sign-ups','amber','opportunity']],
    stats: [
      { d:'Today', v:'23', u:'', l:'check-ins', s:'3 class waitlists active' },
      { d:'New leads', v:'11', u:'', l:'this week', s:'4 trial passes booked' },
      { d:'Hours saved', v:'15', u:' hrs', l:'saved this week by your AI team', p:60 } ],
    sug: { t:'Automate class schedule answers', d:'Members ask "is there a slot tonight?" every day. AISAR answers with live availability + waitlist signup.', tag:'est. 5 hrs/month', cta:'Automation queued — I\u0027ll handle class schedule answers.' },
    team: [
      { e:'💬', n:'Front Desk Assistant', ch:'WhatsApp · Instagram', d:'Answers membership, class schedule, and pricing questions — 24/7.', m:'Today · 23 chats · 5 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Classes · Waitlist', d:'Books classes, manages waitlists, and sends class reminders.', m:'This week · 48 class bookings' },
      { e:'🔁', n:'Follow-up', ch:'Members', d:'Sends renewal reminders and re-engages lapsed members.', m:'This month · 14 renewals saved' },
      { e:'📊', n:'Ops Assistant', ch:'Reports', d:'Prepares daily attendance and flags under-booked classes.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Front Desk Assistant', t:'WhatsApp · 4m ago · auto', tag:'done', tc:'', d:'Answered "Ada slot kelas malam ni?" with live availability + waitlist link.' },
      { e:'📅', n:'Booking Agent', t:'50m ago · auto', tag:'confirmed', tc:'green', d:'Booked HIT class for Amir, 7pm + reminder set.' },
      { e:'🔁', n:'Follow-up', t:'2h ago · auto', tag:'sent', tc:'green', d:'Sent renewal reminder to 6 members expiring this week.' },
      { e:'⚠️', n:'Front Desk Assistant', t:'4h ago · escalated', tag:'needs you', tc:'red', d:'Prospect asked about corporate memberships — AISAR offered a call-back. Review before sending?', cta:'Approved — call-back scheduled.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Front Desk Assistant & Follow-up talk to members here.', on:true },
      { e:'📸', n:'Instagram', s:'DM · linked', d:'Trial sign-ups come in here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent manages class schedules here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads attendance here.', on:true },
      { e:'💳', n:'Member app / Payment', s:'not connected', d:'Unlocks automatic renewals & payment reminders.', on:false, cta:'Payment connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  tuition: {
    icon: '📚', keywords: ['tuition','tutor','tuto','pusat tuisyen','academy','akademi','kelas','belajar','music school','coding class','mengaji','tahfiz','daycare','taska','kindergarten','tadika'],
    name: 'Your Tuition Centre', type: 'Tuition / Education', sub: 'Tuition / Education', site: 'yourtution.my', booking: 'Phone / WhatsApp', systems: 'Google Sheets · Excel',
    potential: 59, opportunities: 5, ch: ['WhatsApp','Phone'],
    detect: 'tuition & education · Kuala Lumpur',
    loc: 'Kuala Lumpur, MY',
    confirm: 'I found that you run a tuition/education centre in Kuala Lumpur. Is that correct?',
    funcs: [['Parent enquiries','','covered'],['Class schedules','green','live'],['Fee reminders','green','live'],['Attendance','amber','opportunity'],['Progress reports','amber','opportunity']],
    stats: [
      { d:'Today', v:'18', u:'', l:'messages from parents', s:'5 new enquiries' },
      { d:'New students', v:'5', u:'', l:'enquiries this week', s:'2 trials booked' },
      { d:'Hours saved', v:'12', u:' hrs', l:'saved this week by your AI team', p:52 } ],
    sug: { t:'Automate fee reminders', d:'You chase fees every month. AISAR sends polite reminders + receipts automatically.', tag:'est. 3 hrs/month', cta:'Automation queued — I\u0027ll handle fee reminders.' },
    team: [
      { e:'💬', n:'Parent Assistant', ch:'WhatsApp · Phone', d:'Answers class schedules, fees, and location questions — 24/7.', m:'Today · 18 chats · 3 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Classes · Trials', d:'Books trial classes and manages student slots.', m:'This week · 9 trials booked' },
      { e:'🔁', n:'Follow-up', ch:'Parents', d:'Sends fee reminders, homework updates, and progress nudges.', m:'This month · 42 reminders sent' },
      { e:'📊', n:'Ops Assistant', ch:'Attendance · Reports', d:'Tracks attendance and prepares monthly class reports.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Parent Assistant', t:'WhatsApp · 3m ago · auto', tag:'done', tc:'', d:'Answered "Berapa yuran untuk darjah 4?" with fee list + class times.' },
      { e:'📅', n:'Booking Agent', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Booked trial class for Aiman, Sat 10am Mathematics.' },
      { e:'🔁', n:'Follow-up', t:'2h ago · auto', tag:'sent', tc:'green', d:'Sent fee reminder to 12 parents (polite, with receipt attached).' },
      { e:'⚠️', n:'Parent Assistant', t:'5h ago · escalated', tag:'needs you', tc:'red', d:'Parent asked about discount for 2 siblings — AISAR offered 10%. Review before sending?', cta:'Approved — 10% sibling discount offered.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Parent Assistant & Follow-up talk to parents here.', on:true },
      { e:'📞', n:'Phone', s:'linked', d:'Enquiries by call route here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent manages class schedules here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads attendance & fees here.', on:true },
      { e:'🧾', n:'Accounting', s:'not connected', d:'Unlocks automatic receipts & monthly statements.', on:false, cta:'Accounting connection wizard will open — we\u0027ll guide you through it.' } ]
  },

  laundry: {
    "icon": "🧺",
    "keywords": [
      "dobi",
      "laundry",
      "basuh",
      "dry clean",
      "dry cleaning",
      "iron",
      "seterika"
    ],
    "name": "Your Laundry",
    "type": "Laundry / Dobi",
    "sub": "Laundry / Dobi",
    "site": "yourlaundry.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Kuala Lumpur, MY",
    "potential": 57,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "laundry & dobi · Kuala Lumpur",
    "confirm": "I found that you run a laundry/dobi service in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Order intake",
        "green",
        "live"
      ],
      [
        "Status updates",
        "green",
        "live"
      ],
      [
        "Pickup & delivery",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & repeat",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "26",
        "u": "",
        "l": "orders collected",
        "s": "5 pickup requests"
      },
      {
        "d": "This week",
        "v": "154",
        "u": " kg",
        "l": "laundry processed",
        "s": "12 new customers"
      },
      {
        "d": "Hours saved",
        "v": "14",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 53
      }
    ],
    "sug": {
      "t": "Automate order status updates",
      "d": "Customers ask \"dah siap?\" every day. AISAR sends status updates + pickup reminders automatically.",
      "tag": "est. 2 hrs/month",
      "cta": "Automation queued — I'll set up status updates."
    },
    "team": [
      {
        "e": "💬",
        "n": "Order Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers pricing, services, and pickup questions — 24/7.",
        "m": "Today · 26 chats · 4 escalated"
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "ch": "Pickup · Drop-off",
        "d": "Arranges pickup & delivery slots and sends driver updates.",
        "m": "This week · 18 pickups"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past customers",
        "d": "Sends rebooking nudges and loyalty offers to regulars.",
        "m": "This month · 21 rebookings"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports",
        "d": "Tracks daily volume and prepares your weekly report.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Order Assistant",
        "t": "WhatsApp · 3m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa harga basuh baju?\" with price list + today pickup slot."
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Confirmed pickup for 2 bags, 6pm — driver notified."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent \"your laundry is ready for pickup\" to 9 customers."
      },
      {
        "e": "⚠️",
        "n": "Order Assistant",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer complained about a missing item — AISAR apologised and offered 20% off next order.",
        "cta": "Approved — 20% voucher sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Order Assistant & Follow-up talk to customers here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Pickup requests come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Delivery Coordinator schedules pickups here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads orders here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks daily revenue reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  auto: {
    "icon": "🔧",
    "keywords": [
      "bengkel",
      "kereta",
      "mekanik",
      "tayar",
      "workshop",
      "servis kereta",
      "sparepart",
      "minyak hitam",
      "pomen"
    ],
    "name": "Your Workshop",
    "type": "Auto Workshop / Bengkel",
    "sub": "Auto Workshop / Bengkel",
    "site": "yourworkshop.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Shah Alam, MY",
    "potential": 64,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "auto workshop & bengkel · Shah Alam",
    "confirm": "I found that you run a car workshop/bengkel in Shah Alam. Is that correct?",
    "funcs": [
      [
        "Customer enquiries",
        "",
        "covered"
      ],
      [
        "Service bookings",
        "green",
        "live"
      ],
      [
        "Service reminders",
        "green",
        "live"
      ],
      [
        "Parts & inventory",
        "amber",
        "opportunity"
      ],
      [
        "Invoices",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "8",
        "u": "",
        "l": "cars in workshop",
        "s": "2 ready for pickup"
      },
      {
        "d": "This week",
        "v": "31",
        "u": "",
        "l": "vehicles serviced",
        "s": "4 new regulars"
      },
      {
        "d": "Hours saved",
        "v": "13",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 59
      }
    ],
    "sug": {
      "t": "Automate service reminders",
      "d": "Customers forget servicing. AISAR reminds them when their car is due + books the slot automatically.",
      "tag": "est. 4 hrs/month",
      "cta": "Automation queued — I'll set up service reminders."
    },
    "team": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers service pricing, tyre sizes, and booking questions — 24/7.",
        "m": "Today · 8 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Appointments",
        "d": "Books service slots and manages the workshop schedule.",
        "m": "This week · 22 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Service due",
        "d": "Tracks service intervals and reminds customers when their car is due.",
        "m": "This month · 31 reminders"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Parts · Reports",
        "d": "Watches parts inventory and prepares daily workshop reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa servis minyak hitam?\" with package prices + available slots."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "40m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked full service for Proton Saga, Thu 10am + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 6 customers that their car is due for service this month."
      },
      {
        "e": "⚠️",
        "n": "Service Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer asked about brake pad replacement pricing — AISAR offered a call-back quote.",
        "cta": "Approved — quote call-back scheduled."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Service Assistant & Follow-up talk to customers here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Service bookings by call route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages slots here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads parts & jobs here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks automatic invoices & GST-ready reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  petcare: {
    "icon": "🐾",
    "keywords": [
      "pet",
      "petshop",
      "pet shop",
      "groom",
      "grooming",
      "anjing",
      "kucing",
      "haiwan",
      "vet",
      "klinik haiwan",
      "boarding"
    ],
    "name": "Your Pet Shop",
    "type": "Pet Care / Grooming",
    "sub": "Pet Care / Grooming",
    "site": "yourpetshop.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Petaling Jaya, MY",
    "potential": 61,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "pet care & grooming · Petaling Jaya",
    "confirm": "I found that you run a pet care/grooming business in Petaling Jaya. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Grooming bookings",
        "green",
        "live"
      ],
      [
        "Reminders",
        "green",
        "live"
      ],
      [
        "Product retail",
        "amber",
        "opportunity"
      ],
      [
        "Loyalty & rebooking",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "6",
        "u": "",
        "l": "grooming appointments",
        "s": "2 boarding check-ins"
      },
      {
        "d": "New pets",
        "v": "9",
        "u": "",
        "l": "this week",
        "s": "4 via Instagram"
      },
      {
        "d": "Hours saved",
        "v": "11",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 55
      }
    ],
    "sug": {
      "t": "Automate grooming reminders",
      "d": "Owners forget appointments — and no-shows cost you. AISAR sends reminders + rebooking nudges automatically.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll handle grooming reminders."
    },
    "team": [
      {
        "e": "💬",
        "n": "Pet Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers grooming prices, breed questions, and boarding availability — 24/7.",
        "m": "Today · 9 chats · 2 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Appointments",
        "d": "Books grooming slots and manages boarding reservations.",
        "m": "This week · 18 bookings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Past clients",
        "d": "Sends rebooking nudges and after-care messages for pets.",
        "m": "This month · 26 rebookings"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Tracks pet food stock and prepares weekly client reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Pet Assistant",
        "t": "WhatsApp · 4m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa harga groom kucing?\" with price list + groomer availability."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked full groom for Miko (shih tzu), Sat 10am + reminder set."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Sent rebooking nudge to 7 pet owners due for their next groom."
      },
      {
        "e": "⚠️",
        "n": "Pet Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Owner asked about boarding during Raya — AISAR offered a hold-slot.",
        "cta": "Approved — boarding slot held."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Pet Assistant & Follow-up talk to owners here.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Grooming bookings come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages appointments here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads client & stock data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks product retail automation + sales reports.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  florist: {
    "icon": "💐",
    "keywords": [
      "bunga",
      "florist",
      "floral",
      "bouquet",
      "taman bunga"
    ],
    "name": "Your Florist",
    "type": "Florist / Gifting",
    "sub": "Florist / Gifting",
    "site": "yourflorist.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · POS",
    "loc": "Kuala Lumpur, MY",
    "potential": 56,
    "opportunities": 4,
    "ch": [
      "WhatsApp",
      "Instagram"
    ],
    "detect": "florist & gifting · Kuala Lumpur",
    "confirm": "I found that you run a florist/gifting business in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Customer service",
        "",
        "covered"
      ],
      [
        "Order intake",
        "green",
        "live"
      ],
      [
        "Delivery coordination",
        "green",
        "live"
      ],
      [
        "Seasonal campaigns",
        "amber",
        "opportunity"
      ],
      [
        "Same-day specials",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "14",
        "u": "",
        "l": "orders taken",
        "s": "6 out for delivery"
      },
      {
        "d": "This week",
        "v": "89",
        "u": "",
        "l": "bouquets delivered",
        "s": "12 repeat gifters"
      },
      {
        "d": "Hours saved",
        "v": "10",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 50
      }
    ],
    "sug": {
      "t": "Automate delivery updates",
      "d": "Customers always ask \"sampai dah?\". AISAR sends delivery confirmations + photos automatically.",
      "tag": "est. 2 hrs/month",
      "cta": "Automation queued — I'll set up delivery updates."
    },
    "team": [
      {
        "e": "💬",
        "n": "Florist Assistant",
        "ch": "WhatsApp · Instagram",
        "d": "Answers bouquet prices, delivery areas, and same-day orders — 24/7.",
        "m": "Today · 14 chats · 3 escalated"
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "ch": "Orders · Routes",
        "d": "Schedules deliveries and sends live status to customers.",
        "m": "This week · 89 deliveries"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Anniversaries · Birthdays",
        "d": "Remembers occasions and suggests gifting moments to past customers.",
        "m": "This month · 18 occasions"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Inventory · Reports",
        "d": "Tracks flower stock and seasonal demand.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Florist Assistant",
        "t": "Instagram · 1m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Ada bouquet bawah RM100?\" with today's options + delivery time."
      },
      {
        "e": "📦",
        "n": "Delivery Coordinator",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Delivered anniversary bouquet — sent photo + confirmation to customer."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "3h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 5 past customers that their mum's birthday is next week."
      },
      {
        "e": "⚠️",
        "n": "Florist Assistant",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Customer needs urgent same-day delivery — driver unavailable. AISAR suggested express option.",
        "cta": "Approved — express delivery arranged."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Florist Assistant & Follow-up talk to customers here.",
        "on": true
      },
      {
        "e": "📸",
        "n": "Instagram",
        "s": "DM · linked",
        "d": "Orders come in here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Delivery Coordinator plans routes here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads orders & stock here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "POS / Accounting",
        "s": "not connected",
        "d": "Unlocks daily sales + refund handling.",
        "on": false,
        "cta": "POS connection wizard will open — we'll guide you through it."
      }
    ]
  },
  property: {
    "icon": "🏠",
    "keywords": [
      "hartanah",
      "property",
      "real estate",
      "ejen",
      "landlord",
      "tuan tanah",
      "lelong",
      "listing"
    ],
    "name": "Your Agency",
    "type": "Real Estate / Property",
    "sub": "Real Estate / Property",
    "site": "youragency.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets · CRM",
    "loc": "Kuala Lumpur, MY",
    "potential": 65,
    "opportunities": 6,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "real estate agency · Kuala Lumpur",
    "confirm": "I found that you run a real estate/property agency in Kuala Lumpur. Is that correct?",
    "funcs": [
      [
        "Lead response",
        "",
        "covered"
      ],
      [
        "Viewing scheduling",
        "green",
        "live"
      ],
      [
        "Listing updates",
        "green",
        "live"
      ],
      [
        "Buyer qualification",
        "amber",
        "opportunity"
      ],
      [
        "Follow-up cadence",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "12",
        "u": "",
        "l": "new leads",
        "s": "3 viewings booked"
      },
      {
        "d": "This week",
        "v": "27",
        "u": "",
        "l": "enquiries",
        "s": "9 active listings"
      },
      {
        "d": "Hours saved",
        "v": "16",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 61
      }
    ],
    "sug": {
      "t": "Automate first-reply speed",
      "d": "The first agent to reply wins the deal. AISAR answers enquiries instantly + books viewings.",
      "tag": "est. 5 hrs/month",
      "cta": "Automation queued — I'll handle lead response."
    },
    "team": [
      {
        "e": "🧲",
        "n": "Lead Responder",
        "ch": "WhatsApp · Phone",
        "d": "Answers property questions, pricing, and viewing availability — 24/7.",
        "m": "Today · 12 leads · 3 booked"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Viewings",
        "d": "Books viewing slots and sends confirmations + location pins.",
        "m": "This week · 9 viewings"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Buyers · Sellers",
        "d": "Nudges interested buyers and checks in with sellers.",
        "m": "This month · 24 follow-ups"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "CRM · Reports",
        "d": "Tracks lead pipeline and prepares weekly reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "🧲",
        "n": "Lead Responder",
        "t": "WhatsApp · 1m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Ada unit bawah 500k dekat LRT?\" with 3 matching listings + viewing link."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "30m ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked viewing for unit B-12, Sat 11am + sent location pin."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Followed up 4 buyers from yesterday's open house."
      },
      {
        "e": "⚠️",
        "n": "Lead Responder",
        "t": "4h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Buyer asked about negotiation on asking price — AISAR drafted a polite response.",
        "cta": "Approved — response sent."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Lead Responder & Follow-up talk to clients here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Call enquiries route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent manages viewings here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads listings & pipeline here.",
        "on": true
      },
      {
        "e": "🗂️",
        "n": "CRM system",
        "s": "not connected",
        "d": "Unlocks full pipeline tracking + auto reports.",
        "on": false,
        "cta": "CRM connection wizard will open — we'll guide you through it."
      }
    ]
  },
  cleaning: {
    "icon": "🧽",
    "keywords": [
      "cleaning",
      "cuci",
      "pembersihan",
      "maid",
      "domestik",
      "disinfect"
    ],
    "name": "Your Cleaning Co",
    "type": "Cleaning Services",
    "sub": "Cleaning Services",
    "site": "yourcleaning.my",
    "booking": "Phone / WhatsApp",
    "systems": "Google Sheets",
    "loc": "Selangor, MY",
    "potential": 58,
    "opportunities": 5,
    "ch": [
      "WhatsApp",
      "Phone"
    ],
    "detect": "cleaning services · Selangor",
    "confirm": "I found that you run a cleaning services business in Selangor. Is that correct?",
    "funcs": [
      [
        "Customer enquiries",
        "",
        "covered"
      ],
      [
        "Quote requests",
        "green",
        "live"
      ],
      [
        "Scheduling",
        "green",
        "live"
      ],
      [
        "Recurring bookings",
        "amber",
        "opportunity"
      ],
      [
        "Team dispatch",
        "amber",
        "opportunity"
      ]
    ],
    "stats": [
      {
        "d": "Today",
        "v": "7",
        "u": "",
        "l": "jobs scheduled",
        "s": "3 quotes sent"
      },
      {
        "d": "This week",
        "v": "19",
        "u": "",
        "l": "bookings",
        "s": "5 recurring clients"
      },
      {
        "d": "Hours saved",
        "v": "12",
        "u": " hrs",
        "l": "saved this week by your AI team",
        "p": 54
      }
    ],
    "sug": {
      "t": "Automate quote requests",
      "d": "AISAR collects details (type, size, frequency) and sends pricing quotes instantly — no back-and-forth.",
      "tag": "est. 3 hrs/month",
      "cta": "Automation queued — I'll set up instant quotes."
    },
    "team": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "ch": "WhatsApp · Phone",
        "d": "Answers service areas, pricing, and availability — 24/7.",
        "m": "Today · 7 chats · 1 escalated"
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "ch": "Calendar · Jobs",
        "d": "Schedules jobs and assigns the right crew.",
        "m": "This week · 19 jobs"
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "ch": "Recurring clients",
        "d": "Reminds recurring clients and nudges for monthly bookings.",
        "m": "This month · 12 renewals"
      },
      {
        "e": "📊",
        "n": "Ops Assistant",
        "ch": "Reports · Dispatch",
        "d": "Prepares crew schedules and daily job reports.",
        "m": "",
        "setup": true
      }
    ],
    "work": [
      {
        "e": "💬",
        "n": "Service Assistant",
        "t": "WhatsApp · 2m ago · auto",
        "tag": "done",
        "tc": "",
        "d": "Answered \"Berapa untuk cuci rumah 3 bilik?\" with instant quote + slots."
      },
      {
        "e": "📅",
        "n": "Booking Agent",
        "t": "1h ago · auto",
        "tag": "confirmed",
        "tc": "green",
        "d": "Booked deep-clean for 3-room condo, Thu 9am + crew assigned."
      },
      {
        "e": "🔁",
        "n": "Follow-up",
        "t": "2h ago · auto",
        "tag": "sent",
        "tc": "green",
        "d": "Reminded 5 recurring clients their monthly clean is due."
      },
      {
        "e": "⚠️",
        "n": "Service Assistant",
        "t": "5h ago · escalated",
        "tag": "needs you",
        "tc": "red",
        "d": "Client asked about monthly discount packages — AISAR offered a 3-month plan.",
        "cta": "Approved — 3-month plan offered."
      }
    ],
    "conns": [
      {
        "e": "💬",
        "n": "WhatsApp",
        "s": "Business API · linked",
        "d": "Service Assistant & Follow-up talk to clients here.",
        "on": true
      },
      {
        "e": "📞",
        "n": "Phone",
        "s": "linked",
        "d": "Job enquiries route here.",
        "on": true
      },
      {
        "e": "📅",
        "n": "Google Calendar",
        "s": "linked",
        "d": "Booking Agent schedules jobs here.",
        "on": true
      },
      {
        "e": "📊",
        "n": "Google Sheets",
        "s": "linked",
        "d": "Ops Assistant reads job data here.",
        "on": true
      },
      {
        "e": "🧾",
        "n": "Invoicing",
        "s": "not connected",
        "d": "Unlocks automatic invoices & monthly billing.",
        "on": false,
        "cta": "Invoicing connection wizard will open — we'll guide you through it."
      }
    ]
  },

  minimart: {
      "key": "minimart",
      "name": "Your Minimart",
      "type": "Minimart / Grocery",
      "icon": "🏪",
      "loc": "Kuala Lumpur, MY",
      "potential": 58,
      "opportunities": 5,
      "ch": [
        "WhatsApp",
        "Phone"
      ],
      "detect": "minimart & grocery · Kuala Lumpur",
      "confirm": "I found that you run a minimart/grocery shop in Kuala Lumpur. Is that correct?",
      "keywords": [
        "minimart",
        "kedai runcit",
        "runcit",
        "grocery",
        "serbaneka",
        "stor runcit"
      ],
      "sub": "Minimart / Grocery",
      "site": "yourbusiness.my",
      "booking": "Phone / WhatsApp",
      "systems": "Google Sheets",
      "funcs": [
        [
          "Customer enquiries",
          "",
          "covered"
        ],
        [
          "Follow-up",
          "green",
          "live"
        ],
        [
          "Scheduling",
          "green",
          "live"
        ],
        [
          "Reports",
          "amber",
          "opportunity"
        ],
        [
          "Invoicing",
          "amber",
          "opportunity"
        ]
      ],
      "stats": [
        {
          "d": "Today",
          "v": "9",
          "u": "",
          "l": "customer conversations",
          "s": "2 need you"
        },
        {
          "d": "New enquiries",
          "v": "14",
          "u": "",
          "l": "this week",
          "s": "via WhatsApp + Phone"
        },
        {
          "d": "Hours saved",
          "v": "11",
          "u": " hrs",
          "l": "saved this week by your AI team",
          "p": 48
        }
      ],
      "sug": {
        "t": "Automate your common questions",
        "d": "Your customers ask the same things every day. AISAR answers them instantly — in your voice.",
        "tag": "est. 2 hrs/month",
        "cta": "Automation queued — I'll set up the Customer Assistant."
      },
      "team": [
        {
          "e": "💬",
          "n": "Customer Assistant",
          "ch": "WhatsApp · Phone",
          "d": "Answers your FAQs instantly — hours, pricing, availability — 24/7.",
          "m": "Today · 9 chats · 2 escalated"
        },
        {
          "e": "📅",
          "n": "Booking Agent",
          "ch": "Calendar",
          "d": "Schedules appointments and sends confirmations automatically.",
          "m": "This week · 6 bookings"
        },
        {
          "e": "🔁",
          "n": "Follow-up",
          "ch": "Past customers",
          "d": "Follows up enquiries and past customers automatically.",
          "m": "This month · 18 follow-ups"
        },
        {
          "e": "📊",
          "n": "Ops Assistant",
          "ch": "Reports",
          "d": "Prepares a simple weekly summary of everything that happened.",
          "m": "",
          "setup": true
        }
      ],
      "work": [
        {
          "e": "💬",
          "n": "Customer Assistant",
          "t": "WhatsApp · 2m ago · auto",
          "tag": "done",
          "tc": "",
          "d": "Answered \"What are your opening hours?\" instantly."
        },
        {
          "e": "📅",
          "n": "Booking Agent",
          "t": "1h ago · auto",
          "tag": "confirmed",
          "tc": "green",
          "d": "Booked an appointment + sent confirmation."
        },
        {
          "e": "🔁",
          "n": "Follow-up",
          "t": "3h ago · auto",
          "tag": "sent",
          "tc": "green",
          "d": "Followed up 2 enquiries from yesterday."
        },
        {
          "e": "⚠️",
          "n": "Customer Assistant",
          "t": "5h ago · escalated",
          "tag": "needs you",
          "tc": "red",
          "d": "Customer asked about special pricing — AISAR drafted a reply.",
          "cta": "Approved — reply sent."
        }
      ],
      "conns": [
        {
          "e": "💬",
          "n": "WhatsApp",
          "s": "Business API · linked",
          "d": "Customer Assistant talks to customers here.",
          "on": true
        },
        {
          "e": "📞",
          "n": "Phone",
          "s": "linked",
          "d": "Enquiries by call route here.",
          "on": true
        },
        {
          "e": "📅",
          "n": "Google Calendar",
          "s": "linked",
          "d": "Booking Agent checks availability here.",
          "on": true
        },
        {
          "e": "📊",
          "n": "Google Sheets",
          "s": "linked",
          "d": "Ops Assistant reads your data here.",
          "on": true
        },
        {
          "e": "🧾",
          "n": "Accounting",
          "s": "not connected",
          "d": "Unlocks invoicing automation.",
          "on": false,
          "cta": "Accounting connection wizard will open — we'll guide you through it."
        }
      ]
  },  generic: {
    icon: '🏪', keywords: [],
    name: 'Your Business', type: 'Small Business', sub: 'Small Business', site: 'yourbusiness.com', booking: 'Phone / WhatsApp', systems: 'Google Sheets',
    potential: 55, opportunities: 3, ch: ['WhatsApp','Email'],
    detect: 'small business · services',
    loc: 'Malaysia',
    confirm: 'I found what your business is about. Is this correct?',
    funcs: [['Customer enquiries','','covered'],['Follow-up','green','live'],['Scheduling','amber','opportunity'],['Reports','amber','opportunity']],
    stats: [
      { d:'Today', v:'9', u:'', l:'customer conversations', s:'2 need you' },
      { d:'New enquiries', v:'14', u:'', l:'this week', s:'via WhatsApp + Email' },
      { d:'Hours saved', v:'11', u:' hrs', l:'saved this week by your AI team', p:48 } ],
    sug: { t:'Automate your common questions', d:'Your customers ask the same things every day. AISAR answers them instantly — in your voice.', tag:'est. 2 hrs/month', cta:'Automation queued — I\u0027ll set up the Customer Assistant.' },
    team: [
      { e:'💬', n:'Customer Assistant', ch:'WhatsApp · Email', d:'Answers your FAQs instantly — hours, pricing, availability — 24/7.', m:'Today · 9 chats · 2 escalated' },
      { e:'📅', n:'Booking Agent', ch:'Calendar', d:'Schedules appointments and sends confirmations automatically.', m:'This week · 6 bookings' },
      { e:'🔁', n:'Follow-up', ch:'Past customers', d:'Follows up enquiries and past customers automatically.', m:'This month · 18 follow-ups' },
      { e:'📊', n:'Ops Assistant', ch:'Reports', d:'Prepares a simple weekly summary of everything that happened.', m:'', setup:true } ],
    work: [
      { e:'💬', n:'Customer Assistant', t:'WhatsApp · 2m ago · auto', tag:'done', tc:'', d:'Answered "What are your opening hours?" instantly.' },
      { e:'📅', n:'Booking Agent', t:'1h ago · auto', tag:'confirmed', tc:'green', d:'Booked an appointment + sent confirmation.' },
      { e:'🔁', n:'Follow-up', t:'3h ago · auto', tag:'sent', tc:'green', d:'Followed up 2 enquiries from yesterday.' },
      { e:'⚠️', n:'Customer Assistant', t:'5h ago · escalated', tag:'needs you', tc:'red', d:'Customer asked about special pricing — AISAR drafted a reply. Review before sending?', cta:'Approved — reply sent.' } ],
    conns: [
      { e:'💬', n:'WhatsApp', s:'Business API · linked', d:'Customer Assistant talks to customers here.', on:true },
      { e:'✉️', n:'Email', s:'Gmail · linked', d:'Follow-ups and documents go through here.', on:true },
      { e:'📅', n:'Google Calendar', s:'linked', d:'Booking Agent checks availability here.', on:true },
      { e:'📊', n:'Google Sheets', s:'linked', d:'Ops Assistant reads your data here.', on:true },
      { e:'🧾', n:'Accounting', s:'not connected', d:'Unlocks invoicing automation.', on:false, cta:'Accounting connection wizard will open — we\u0027ll guide you through it.' } ]
  }
};

/* ============================================================
   CACHE — playbook dijadikan "business object" + override nama.
   ============================================================ */
var BIZ = {};

function kvPlaybook(key){
  key = PLAYBOOKS[key] ? key : 'generic';
  if (BIZ[key]) return BIZ[key];
  var p = PLAYBOOKS[key];
  var b = {
    icon: p.icon, name: p.name, type: p.type, sub: p.sub, site: kvSite(p),
    loc: (kvCountry().code !== 'MY' && p.loc) ? kvCountry().name : (p.loc || kvCountry().name),
    booking: p.booking, systems: p.systems, potential: p.potential,
    opportunities: p.opportunities, ch: p.ch.slice(), detect: kvDetect(p),
    confirm: p.confirm, funcs: p.funcs, stats: p.stats, sug: p.sug,
    team: p.team, work: p.work, conns: p.conns
  };
  var n = KV_STORE.get('aisar-biz-name', ''); if (n) b.name = n;
  var l = KV_STORE.get('aisar-biz-loc', '');  if (l) b.loc = l;
  BIZ[key] = b;
  return b;
}

/* ============================================================
   INFERENCE — free-text user → playbook + lokasi + nama.
   ============================================================ */
function kvInfer(text){
  text = (text || '').toLowerCase();
  var best = 'generic', bestN = 0;
  var tokens = text.split(/[^a-z0-9&]+/).filter(Boolean);
  Object.keys(PLAYBOOKS).forEach(function(k){
    if (k === 'generic') return;
    var n = 0;
    kvKeywords(PLAYBOOKS[k]).forEach(function(w){
      w = String(w).toLowerCase();
      if (w.indexOf(' ') >= 0){
        // multi-word: cari frasa penuh, weight lebih (lebih spesifik)
        if (text.indexOf(w) >= 0) n += 1 + (w.split(' ').length - 1) * 1.5;
      } else if (w.length <= 3){
        // perkataan pendek ('pet'): kena padan penuh supaya tak match "petaling"
        if (tokens.indexOf(w) >= 0) n += 1;
      } else {
        // token penuh atau prefix pendek ('hair' → 'haircut')
        var m = tokens.some(function(t){
          return t === w || (t.indexOf(w) === 0 && t.length - w.length <= 3);
        });
        if (m) n += 1;
      }
    });
    if (n > bestN){ bestN = n; best = k; }
  });
  return { key: best, score: bestN };
}

var KV_CITIES = {
  'kuala lumpur': 'Kuala Lumpur, MY', 'kl': 'Kuala Lumpur, MY',
  'shah alam': 'Shah Alam, MY', 'petaling jaya': 'Petaling Jaya, MY', 'pj': 'Petaling Jaya, MY',
  'subang': 'Subang Jaya, MY', 'cyberjaya': 'Cyberjaya, MY', 'putrajaya': 'Putrajaya, MY',
  'penang': 'George Town, Penang, MY', 'george town': 'George Town, Penang, MY',
  'johor': 'Johor Bahru, MY', 'johor bahru': 'Johor Bahru, MY', 'jb': 'Johor Bahru, MY',
  'melaka': 'Melaka, MY', 'ipoh': 'Ipoh, MY', 'seremban': 'Seremban, MY',
  'kota kinabalu': 'Kota Kinabalu, MY', 'kuching': 'Kuching, MY', 'singapore': 'Singapore, SG'
};

function kvExtractLoc(text){
  text = (text || '').toLowerCase();
  var cities = kvCityList();
  /* Padan ikut sempadan perkataan, alias terpanjang dahulu.
     Ujian indexOf dulu buatkan alias dua huruf tercetus dalam
     perkataan biasa: 'kl' ialah alias Kuala Lumpur, jadi
     'Klinik gigi di Ipoh' mengandunginya — setiap klinik dipindah
     ke KL tak kira bandar mana yang ditulis. 'jb' dan 'pj' sama.
     Susun terpanjang dahulu supaya 'kuala lumpur' dan 'johor bahru'
     tak kalah kepada singkatan mereka sendiri. */
  var aliases = Object.keys(cities).sort(function(a, b){ return b.length - a.length; });
  for (var i = 0; i < aliases.length; i++){
    var alias = aliases[i];
    var re = new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (re.test(text)) return cities[alias];
  }
  var m = text.match(/(?:di|in|at)\s+([a-z .,'-]{2,40})/);
  if (m && m[1]){
    var parts = m[1].trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length){
      var cap = parts.map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
      return cap + ', ' + kvCountry().code;
    }
  }
  return '';
}

function kvExtractName(text, fallback){
  var t = (text || '').replace(/(?:di|in|at)\s+[a-z .,'-]{2,40}$/i, '')
                   .replace(/[^a-zA-Z0-9 &'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 3) return fallback;
  var words = t.split(' ').map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); });
  return words.slice(0, 5).join(' ');
}

/* ============================================================
   SELF-IMPROVING — belajar dari pilihan user (demo local).
   ============================================================ */
function kvLearn(key, pick){
  var k = 'aisar-learn:' + key;
  var obj = {};
  try { obj = JSON.parse(KV_STORE.get(k, '{}')); } catch(e){}
  obj[pick] = (obj[pick] || 0) + 1;
  KV_STORE.set(k, JSON.stringify(obj));
}
function kvPopular(key){
  var obj = {};
  try { obj = JSON.parse(KV_STORE.get('aisar-learn:' + key, '{}')); } catch(e){}
  var best = null, bestN = 0;
  for (var p in obj){ if (obj[p] > bestN){ bestN = obj[p]; best = p; } }
  return bestN > 0 ? { pick: best, n: bestN } : null;
}

/* ============================================================
   API
   ============================================================ */
function kvBizType(){
  var t = KV_STORE.get('aisar-biz-type', '');
  return PLAYBOOKS[t] ? t : 'generic';
}
function kvSetBiz(t){
  if (!PLAYBOOKS[t]) return;
  KV_STORE.set('aisar-biz-type', t);
  delete BIZ[t];
  kvRenderAll();
  var pills = document.querySelectorAll('[data-switch]');
  if (pills) pills.forEach(function(p){ p.classList.toggle('green', p.dataset.switch === t); });
}
/* Free-text → infer → simpan → render. Jantung "generate on the run". */
function kvRegisterBiz(text){
  var inf = kvInfer(text);
  var key = inf.key;
  KV_STORE.set('aisar-biz-type', key);
  delete BIZ[key];
  var fallback = PLAYBOOKS[key].name;
  var name = kvExtractName(text, fallback);
  KV_STORE.set('aisar-biz-name', name);
  var loc = kvExtractLoc(text);
  if (loc) KV_STORE.set('aisar-biz-loc', loc);
  kvLearn(key, 'inferred:' + key);
  var b = kvPlaybook(key);
  return { key: key, score: inf.score, playbook: b };
}

function kvSetupDone(){ return KV_STORE.get('aisar-setup-done-v1', '') === '1'; }
function kvLiveChans(){
  try { var a = JSON.parse(KV_STORE.get('aisar-channels', '[]')); return (a && a.length) ? a : null; } catch(e){ return null; }
}
function kvBump(v){ return kvSetupDone() ? Math.min(96, v + 20) : v; }

/* ============================================================
   STATE — sambungan sebenar + kerja selesai (localStorage).
   ============================================================ */
function kvConnKeys(){
  try { var v = JSON.parse(KV_STORE.get('aisar-conns', 'null')); return Array.isArray(v) ? v : []; } catch(e){ return []; }
}
function kvSeedConns(){
  if (KV_STORE.get('aisar-conns', null) !== null) return;
  var b = kvPlaybook(kvBizType());
  KV_STORE.set('aisar-conns', JSON.stringify(b.conns.filter(function(c){ return c.on; }).map(function(c){ return c.n; })));
}
function kvConnOn(n){ return kvConnKeys().indexOf(n) >= 0; }
function kvToggleConn(n){
  var a = kvConnKeys();
  var i = a.indexOf(n);
  if (i >= 0) a.splice(i, 1); else a.push(n);
  KV_STORE.set('aisar-conns', JSON.stringify(a));
  kvToast(i >= 0 ? n + ' disconnected.' : n + ' connected ✓');
  kvRenderAll();
}
function kvAgentReady(t){
  if (t.setup) return kvConnOn('Accounting');
  var ch = String(t.ch || '').toLowerCase();
  var keys = kvConnKeys();
  var match = keys.some(function(cn){ return ch.indexOf(cn.split(' ')[0].toLowerCase()) >= 0; });
  return match || keys.length > 0;
}

/* ---- AI Team: AI recommendations (opportunity functions -> agents) ---- */
var KV_REC_MAP = {
  'Inventory & ordering': { e:'📦', n:'Inventory Agent', d:'Watches your stock levels in Sheets or POS and auto-orders before you run out.', tag:'est. 4 hrs/month' },
  'Weekly reports': { e:'📊', n:'Reporting Agent', d:'Builds your Monday business report automatically — sales, bookings, issues.', tag:'est. 2 hrs/month' },
  'Returns': { e:'🔄', n:'Returns Agent', d:'Guides customers through returns and refunds 24/7, escalating only unusual cases.', tag:'est. 3 hrs/month' },
  'Scheduling': { e:'📅', n:'Scheduling Agent', d:'Proposes follow-up times and books meetings without the back-and-forth.', tag:'est. 3 hrs/month' },
  'Invoicing': { e:'🧾', n:'Invoicing Agent', d:'Drafts invoices after each job and chases late payments politely.', tag:'est. 4 hrs/month' },
  'Billing': { e:'💳', n:'Billing Agent', d:'Sends payment reminders and receipts automatically after each visit.', tag:'est. 3 hrs/month' },
  'Product retail': { e:'🛍️', n:'Retail Assistant', d:'Recommends products, checks stock and closes sales on WhatsApp and Instagram.', tag:'est. 5 hrs/month' },
  'Loyalty & rebooking': { e:'🎁', n:'Loyalty Agent', d:'Turns one-time customers into regulars with rebooking offers and perks.', tag:'est. 4 hrs/month' },
  'Renewals': { e:'🔁', n:'Renewals Agent', d:'Tracks memberships ending soon and sends renewal offers automatically.', tag:'est. 3 hrs/month' },
  'Trial sign-ups': { e:'🎟️', n:'Trial Agent', d:'Books trial sessions and follows up to convert them into members.', tag:'est. 4 hrs/month' },
  'Attendance': { e:'📋', n:'Attendance Agent', d:'Tracks attendance and flags patterns — fewer missed classes, fewer gaps.', tag:'est. 2 hrs/month' },
  'Progress reports': { e:'📈', n:'Progress Agent', d:'Sends parents monthly progress updates without you writing them.', tag:'est. 3 hrs/month' },
  'Reports': { e:'📊', n:'Reporting Agent', d:'Turns your daily data into a weekly summary you can read in 2 minutes.', tag:'est. 2 hrs/month' }
};
var KV_RECS_LAST = [];
function kvTeamRecs(b){
  var out = [];
  (b.funcs || []).forEach(function(f){
    if (f[2] !== 'opportunity') return;
    var m = KV_REC_MAP[f[0]];
    if (m) out.push({ icon:m.e, name:m.n, desc:m.d, tag:m.tag });
  });
  return out;
}
function kvAddRec(i){
  var r = KV_RECS_LAST[i];
  kvToast(kvT('rec.added').replace('{n}', r ? r.name : 'Agent'));
  kvOpenBusinessConnections();
}
function kvOpenBusinessConnections(){
  kvNav('business');
  setTimeout(function(){
    var el = document.getElementById('business-connections');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 50);
}
function kvStartSuggestion(){
  KV_STORE.set('aisar-suggestion-started:' + kvBizType(), '1');
  kvToast(kvT('uc.started'));
  kvRenderAll();
}
function kvDismissSuggestion(){
  kvToast(kvT('uc.savedlater'));
}
function kvAskTab(tab){
  var active = tab === 'conversations' ? 'conversations' : 'assistant';
  document.querySelectorAll('[data-ask-tab]').forEach(function(button){
    var on = button.getAttribute('data-ask-tab') === active;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  ['assistant','conversations'].forEach(function(name){
    var panel = document.getElementById('kv-ask-panel-' + name);
    if (!panel) return;
    var on = name === active;
    panel.classList.toggle('active', on);
    panel.hidden = !on;
  });
  if (active === 'assistant') {
    var input = document.getElementById('kv-ask-input');
    if (input) input.focus();
  } else {
    kvChatRender();
  }
}
function kvAskResize(input){
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}
function kvAskPrompt(key){
  var input = document.getElementById('kv-ask-input');
  if (!input) return;
  input.value = kvT('ask.prompt.' + key);
  kvAskResize(input);
  kvAskAisar();
}
function kvAskAisar(prompt){
  var input = document.getElementById('kv-ask-input');
  var thread = document.getElementById('kv-ask-thread');
  if (!input || !thread) return;
  var question = String(prompt || input.value || '').trim();
  if (!question) return;
  var q = question.toLowerCase();
  var b = kvPlaybook(kvBizType());
  var work = b.work || [];
  var handled = work.filter(function(w, i){ return w.tag !== 'needs you' || kvWorkDone(i); }).length;
  var needs = work.filter(function(w, i){ return w.tag === 'needs you' && !kvWorkDone(i); }).length + kvApprovals().filter(function(a){ return a.status === 'pending'; }).length;
  var reply;
  if (/today|status|happen|hari|status|berlaku/.test(q)) {
    reply = kvT('ask.status').replace('{handled}', handled).replace('{needs}', needs);
  } else if (/need|approval|approve|perlu|lulus/.test(q)) {
    reply = needs ? (needs === 1 ? kvT('ask.needone') : kvT('ask.needs').replace('{n}', needs)) : kvT('ask.clear');
  } else if (/next|help|handle|seterus|bantu|urus/.test(q)) {
    reply = kvT('ask.next').replace('{title}', b.sug.t).replace('{detail}', b.sug.d);
  } else {
    reply = kvT('ask.default');
  }
  var welcome = document.getElementById('kv-ask-welcome');
  if (welcome) welcome.remove();
  thread.insertAdjacentHTML('beforeend',
    '<div class="kv-ask-message user"><span class="kv-ask-message-avatar">' + kvEsc(kvT('ask.you').charAt(0).toUpperCase()) + '</span><div class="kv-ask-bubble">' + kvEsc(question) + '<div class="kv-ask-meta">' + kvT('ask.you') + ' · ' + kvT('ask.now') + '</div></div></div>' +
    '<div class="kv-ask-message ai"><span class="kv-ask-message-avatar">AI</span><div class="kv-ask-bubble">' + kvEsc(reply) + '<div class="kv-ask-meta">AISAR · ' + kvT('ask.now') + '</div></div></div>');
  input.value = '';
  input.style.height = 'auto';
  thread.scrollTop = thread.scrollHeight;
  input.focus();
}
function kvWorkDone(i){
  var k = 'aisar-work-done:' + kvBizType();
  try { return JSON.parse(KV_STORE.get(k, '[]')).indexOf(String(i)) >= 0; } catch(e){ return false; }
}
function kvApproveWork(i){
  var k = 'aisar-work-done:' + kvBizType();
  var a = [];
  try { a = JSON.parse(KV_STORE.get(k, '[]')); } catch(e){}
  if (a.indexOf(String(i)) < 0) a.push(String(i));
  KV_STORE.set(k, JSON.stringify(a));
  kvToast(kvT('toast.approved'));
  kvRenderAll();
}
function kvEditWork(i){
  var b = kvPlaybook(kvBizType());
  var w = b.work[i]; if (!w) return;
  var card = document.getElementById('work-' + i); if (!card) return;
  card.innerHTML = '<div class="as-card flex flex-col gap-3 p-4">' +
    '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + w.e + '</span><div class="flex flex-col"><span class="text-sm">' + w.n + '</span><span class="text-[11px] text-text-muted">' + w.t + '</span></div></div><span class="as-tag amber">draft</span></div>' +
    '<textarea id="work-edit-' + i + '" class="as-input w-full rounded-lg p-2 text-[13px]" style="min-height:48px" rows="2">' + kvEsc(w.d) + '</textarea>' +
    '<div class="as-row gap-2">' +
      '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvSaveWork(' + i + ')">Save</button>' +
      '<button class="btn btn-outline px-4 py-1.5 text-xs" onclick="kvRenderAll()">Cancel</button>' +
    '</div></div>';
}
function kvSaveWork(i){
  var b = kvPlaybook(kvBizType());
  var v = document.getElementById('work-edit-' + i);
  if (v && b.work[i]) b.work[i].d = v.value;
  kvToast('Saved ✓');
  kvRenderAll();
}

/* ============================================================
   CHAT APP — perbualan per agent, kawalan macam WhatsApp/Telegram.
   ============================================================ */
var kvChatState = { sel: null, who: {}, custom: {}, seeded: false, q: '' };

var KV_TPL = {
  'Customer Assistant': ['Hantar menu terkini 📄', 'Maklumkan waktu operasi 🕐', 'Promo minggu ini 🎉'],
  'Booking Agent': ['Confirm booking 📅', 'Tanya tarikh alternatif 🔁', 'Hantar reminder ⏰'],
  'Follow-up': ['Hantar promo peribadi 🎁', 'Tanya maklum balas 💬', 'Ucap terima kasih 🙏'],
  'Ops Assistant': ['Minta weekly report 📊', 'Auto-order stok 📦', 'Update supplier 🔄']
};

function kvChatTmpl(n, tx){
  var inp = document.getElementById('kv-inp');
  if (inp){
    inp.value = tx;
    inp.focus();
  } else {
    kvChatState.custom[n].push({ f:'you', d:tx, tm:'sekarang' });
    kvChatRender();
  }
}

function kvChatSearch(v){
  kvChatState.q = v;
  kvChatRender();
}

function kvChatSeed(b){
  if (kvChatState.seeded) return;
  kvChatState.seeded = true;
  (b.team || []).forEach(function(t){
    kvChatState.who[t.n] = 'ai';
    kvChatState.custom[t.n] = [];
  });
}

function kvChatConv(name, b){
  var t = null;
  (b.team || []).forEach(function(x){ if (x.n === name) t = x; });
  if (!t) return [];
  var seed = [];
  if (t.n === 'Customer Assistant'){
    seed = [
      { f:'cust', n:'Aisyah', d:'Assalamualaikum, ada menu vegetarian tak? 😊', tm:'9:02 AM' },
      { f:'agent', d:'Waalaikumsalam! Ada — Nasi Lemak Sayur, Pasta Aglio Olio, Salad Bowl. Nak saya hantar menu penuh?', tm:'9:02 AM' },
      { f:'cust', n:'Aisyah', d:'Ya tolong 🙏', tm:'9:03 AM' },
      { f:'agent', d:'Dah hantar 📩 Ada apa-apa lagi, boleh tanya saya. (jawab soalan harga + halal cert juga tadi)', tm:'9:04 AM' }
    ];
  } else if (t.n === 'Booking Agent'){
    seed = [
      { f:'cust', n:'Farid', d:'Nak booking Sabtu ni pukul 8 malam, 2 orang boleh?', tm:'1:02 PM' },
      { f:'agent', d:'Boleh! Sabtu 8pm untuk 2 pax — saya check availability dulu ya.', tm:'1:02 PM' },
      { f:'cust', n:'Farid', d:'Ok 👍', tm:'1:03 PM' },
      { f:'agent', d:'Confirmed ✅ Booking 2 pax, Sabtu 8pm. Confirmation + reminder dah hantar ke WhatsApp.', tm:'1:04 PM' }
    ];
  } else if (t.n === 'Follow-up'){
    seed = [
      { f:'agent', d:'Hantar birthday promo ke 6 pelanggan lama (personalised, brand voice) 🎂', tm:'11:00 AM' },
      { f:'cust', n:'Siti', d:'Ohh ada promo birthday ke? Bagus!', tm:'11:05 AM' },
      { f:'agent', d:'Alhamdulillah dapat sambutan — 2 dah reply nak redeem.', tm:'11:20 AM' }
    ];
  } else if (t.n === 'Ops Assistant'){
    seed = [
      { f:'agent', d:'Weekly report siap 📊 — sales minggu ni naik 12% vs minggu lepas.', tm:'8:00 AM' },
      { f:'agent', d:'Inventory alert: stok kopi tinggal 3 hari. Nak aku auto-order dari supplier?', tm:'8:15 AM' }
    ];
  }
  /* work items agent ni → bubble agent */
  (b.work || []).forEach(function(w){
    if (w.n === t.n){
      seed.push({ f:'agent', d:w.d, tm:'sekarang', tag:w.tag });
    }
  });
  return seed.concat(kvChatState.custom[t.n] || []);
}

function kvChatPreview(name, b){
  var m = kvChatConv(name, b);
  return m.length ? m[m.length - 1].d : '';
}

function kvChatOpen(name){
  kvChatState.sel = name;
  kvChatRender();
}

function kvChatBack(){
  kvChatState.sel = null;
  kvChatRender();
}

function kvChatTake(name){
  kvChatState.who[name] = 'you';
  kvChatState.custom[name].push({ f:'you', d:'Aku ambil alih dari sini.', tm:'sekarang' });
  kvChatRender();
}

function kvChatHandback(name){
  kvChatState.who[name] = 'ai';
  kvChatState.custom[name].push({ f:'agent', d:'Ok, AI ambil alih balik ✓ — saya sambung urus pelanggan.', tm:'sekarang' });
  kvChatRender();
}

function kvChatSend(name){
  var inp = document.getElementById('kv-inp');
  if (!inp || !inp.value.trim()) return;
  kvChatState.custom[name].push({ f:'you', d:inp.value.trim(), tm:'sekarang' });
  inp.value = '';
  kvChatRender();
  /* typing indicator + balas balik */
  var th = document.getElementById('kv-msgs');
  if (th) th.insertAdjacentHTML('beforeend',
    '<div class="kv-msg-row in"><div class="kv-bubble in kv-typing"><span></span><span></span><span></span></div></div>');
  th.scrollTop = th.scrollHeight;
  setTimeout(function(){
    kvChatState.custom[name].push({ f:'agent', d:'Siap ✓ dah hantar ke pelanggan. Ada apa-apa lagi?', tm:'sekarang' });
    kvChatRender();
  }, 1400);
}

function kvChatRender(){
  var el = document.getElementById('kv-chat-app');
  if (!el) return;
  var b = kvPlaybook(kvBizType());
  kvChatSeed(b);
  var team = b.team || [];
  var sel = kvChatState.sel;

  /* Senarai perbualan — dengan search */
  var q = (kvChatState.q || '').trim().toLowerCase();
  var listTeam = team.filter(function(t){
    if (!q) return true;
    return t.n.toLowerCase().indexOf(q) >= 0 || (t.ch || '').toLowerCase().indexOf(q) >= 0 || kvChatPreview(t.n, b).toLowerCase().indexOf(q) >= 0;
  });
  var list = '<div class="kv-chat-search">' +
      '<input id="kv-search" placeholder="🔍 ' + kvT('chat.search') + '" value="' + kvEsc(kvChatState.q || '') + '" oninput="kvChatSearch(this.value)"/>' +
    '</div>' +
    (listTeam.length
      ? listTeam.map(function(t){
          var prev = kvEsc(kvChatPreview(t.n, b));
          var unread = (t.n === 'Customer Assistant' || t.n === 'Booking Agent') ? 2 : 1;
          var badge = '<span class="kv-unread">' + unread + '</span>';
          return '<div class="kv-conv' + (sel === t.n ? ' active' : '') + '" onclick="kvChatOpen(\'' + t.n + '\')">' +
            '<span class="as-avatar" style="width:34px;height:34px;font-size:15px;flex-shrink:0">' + t.e + '</span>' +
            '<div class="flex flex-col min-w-0 gap-0.5" style="flex:1">' +
              '<div class="as-row justify-between gap-2">' +
                '<span class="kv-conv-name">' + t.n + '</span>' +
                '<span class="kv-conv-time">' + (t.ch || '') + '</span>' +
              '</div>' +
              '<div class="as-row justify-between gap-2">' +
                '<span class="kv-conv-prev">' + prev + '</span>' + badge +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="kv-empty">Tiada perbualan dijumpai untuk "' + kvEsc(kvChatState.q || '') + '"</div>');

  /* Thread */
  var thread = '';
  if (!sel){
    thread = '<div class="flex flex-col items-center justify-center gap-3" style="flex:1;padding:40px">' +
      '<span style="font-size:40px">💬</span>' +
      '<p class="text-[13px] text-text-secondary text-center">Pilih perbualan untuk tengok progress agent —<br/>macam buka chat WhatsApp dengan staff kau.</p>' +
    '</div>';
  } else {
    var t = null;
    team.forEach(function(x){ if (x.n === sel) t = x; });
    var who = kvChatState.who[sel] || 'ai';
    var msgs = kvChatConv(sel, b);
    var bubble = msgs.map(function(m){
      var out = m.f === 'you';
      var name = m.n ? '<div class="kv-msg-name">' + kvEsc(m.n) + '</div>' : '';
      return '<div class="kv-msg-row ' + (out ? 'out' : 'in') + '">' +
        '<div class="kv-bubble ' + (out ? 'out' : 'in') + '">' +
          (out ? '' : name) +
          kvEsc(m.d) +
          '<div class="kv-msg-meta">' + (m.tm || '') + (m.tag ? ' · ' + kvEsc(m.tag) : '') + (out ? ' ✓' : '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    var banner = who === 'you'
      ? '<div class="kv-banner you"><span>🙋 <b>Kau sedang control</b> <span class="kv-hint">— balasan dihantar sebagai bisnes kau. AI tengah stand-by.</span></span><button class="kv-take-btn" onclick="kvChatHandback(\'' + sel + '\')">Serah balik ke AI →</button></div>'
      : '<div class="kv-banner ai"><span>🤖 <b>' + sel + '</b> sedang handle <span class="kv-hint">— balas pelanggan 24/7 dalam suara kau.</span></span><button class="kv-take-btn" onclick="kvChatTake(\'' + sel + '\')">Ambil alih →</button></div>';
    var tpls = (KV_TPL[sel] || []).map(function(tx){
      return '<button class="kv-tpl" onclick="kvChatTmpl(\'' + sel + '\',\'' + tx.replace(/'/g, "\\'") + '\')">' + kvEsc(tx) + '</button>';
    }).join('');
    var input = who === 'you'
      ? '<div class="kv-tpls">' + tpls + '</div>' +
        '<div class="kv-chat-input"><input id="kv-inp" placeholder="' + kvT('chat.reply') + '" onkeydown="if(event.key===\'Enter\')kvChatSend(\'' + sel + '\')"/><button onclick="kvChatSend(\'' + sel + '\')">' + kvT('chat.send') + '</button></div>'
      : '<div class="kv-chat-input"><input id="kv-inp" placeholder="💡 ' + kvT('chat.takeover') + '" disabled/><button disabled>' + kvT('chat.send') + '</button></div>';
    thread =
      '<div class="kv-chat-header">' +
        '<button class="kv-back" onclick="kvChatBack()">←</button>' +
        '<span class="as-avatar" style="width:30px;height:30px;font-size:14px">' + t.e + '</span>' +
        '<div class="flex flex-col"><span class="text-sm" style="font-weight:600">' + t.n + '</span><span class="text-[10px] text-text-muted">' + (t.ch || '') + '</span></div>' +
      '</div>' +
      banner +
      '<div class="kv-chat-msgs" id="kv-msgs">' + bubble + '</div>' +
      input;
  }

  el.innerHTML =
    '<div class="kv-chat-wrap">' +
      '<div class="kv-chat-list">' + list + '</div>' +
      '<div class="kv-chat-thread' + (sel ? ' open' : '') + '" id="kv-thread">' + thread + '</div>' +
    '</div>';
  var th = document.getElementById('kv-msgs');
  if (th) th.scrollTop = th.scrollHeight;
}

/* ============================================================
   COMMAND CENTER — Home jadi state-driven: setup → connect → operasi.
   Satu CTA jelas setiap stage, bukan 5 view bebas.
   ============================================================ */
function kvEsc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

function kvCommandCenter(b){
  var el = document.getElementById('h-command');
  if (!el) return;
  var html = '';
  var setupDone = kvSetupDone();
  var chans = kvLiveChans();
  var sub = document.getElementById('kv-home-sub');

  if (!setupDone){
    /* Stage 1 — setup belum siap: fokus setup je */
    if (sub) sub.textContent = kvT('sub.step1');
    html =
      '<div class="as-card flex flex-col gap-4 p-5">' +
        '<div class="as-row justify-between">' +
          '<div class="flex flex-col gap-1">' +
            '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('cmd.step1.title') + '</span>' +
            '<h3 class="font-pixel text-lg tracking-tight">' + kvT('cmd.step1.head') + '</h3>' +
            '<p class="text-[13px] text-text-secondary">' + kvT('cmd.step1.body') + '</p>' +
          '</div>' +
          '<span class="as-tag amber">setup</span>' +
        '</div>' +
        '<div class="as-row gap-3">' +
          '<a class="btn btn-primary px-5 py-2 text-sm" href="/setup">' + kvT('cmd.step1.cta') + '</a>' +
        '</div>' +
      '</div>';
  } else if (!chans || !chans.length){
    /* Stage 2 — setup siap, belum connect: fokus connect */
    if (sub) sub.textContent = kvT('sub.step2');
    html =
      '<div class="as-card flex flex-col gap-4 p-5">' +
        '<div class="as-row justify-between">' +
          '<div class="flex flex-col gap-1">' +
            '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('cmd.step2.title') + '</span>' +
            '<h3 class="font-pixel text-lg tracking-tight">' + kvT('cmd.step2.head') + '</h3>' +
            '<p class="text-[13px] text-text-secondary">' + kvT('cmd.step2.body') + '</p>' +
          '</div>' +
          '<span class="as-tag amber">' + kvT('cmd.step2.tag') + '</span>' +
        '</div>' +
        '<div class="as-row gap-3">' +
          '<a class="btn btn-primary px-5 py-2 text-sm" href="/setup">' + kvT('cmd.step2.cta') + '</a>' +
        '</div>' +
      '</div>';
  } else {
    /* Stage 3 — operasi harian: narrative + eskalasi */
    if (sub) sub.textContent = kvT('sub.step3');
    var work = b.work || [];
    var doneCount = work.filter(function(w){ return w.tag === 'done' || w.tag === 'confirmed' || w.tag === 'sent'; }).length;
    var needCount = 0;
    var needHtml = '';
    work.forEach(function(w, i){
      if (w.tag !== 'needs you' || kvWorkDone(i)) return;
      needCount++;
      needHtml += '<div class="as-row justify-between gap-3 border-t border-white/10 pt-3 mt-3">' +
        '<div class="flex flex-col gap-1">' +
          '<span class="text-[13px]">' + w.e + ' ' + kvEsc(w.n) + '</span>' +
          '<span class="text-[12px] text-text-secondary">' + kvEsc(w.d) + '</span>' +
        '</div>' +
        '<button class="btn btn-primary px-4 py-1 text-xs" onclick="kvNav(\'work\')">' + kvT('cmd.step3.review') + '</button>' +
      '</div>';
    });
    html =
      '<div class="as-card flex flex-col gap-4 p-5">' +
        '<div class="as-row justify-between">' +
          '<div class="flex flex-col gap-1">' +
            '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('cmd.step3.title') + '</span>' +
            '<h3 class="font-pixel text-lg tracking-tight">' + kvT('cmd.step3.head').replace('{n}', doneCount) + '</h3>' +
            '<p class="text-[13px] text-text-secondary">' + (needCount ? (needCount === 1 ? kvT('cmd.step3.need') : kvT('cmd.step3.needs').replace('{n}', needCount)) : kvT('cmd.step3.clear')) + '</p>' +
          '</div>' +
          '<span class="as-tag green">' + kvT('status.working') + '</span>' +
        '</div>' +
        needHtml +
      '</div>';
  }
  el.innerHTML = html;
}

/* ============================================================
   RENDER — satu set views, content ikut playbook.
   ============================================================ */
var kvWorkFilter = 'auto';

function kvWorkSetFilter(f){
  kvWorkFilter = f;
  kvRenderAll();
}

function kvRenderAll(){
  var b = kvPlaybook(kvBizType());
  kvSeedConns();
  var chans = kvLiveChans() || kvConnKeys();

  kvCommandCenter(b);

  /* Home recent activity — outcomes, click → Activity */
  var hc = document.getElementById('h-chat');
  if (hc) {
    var work = b.work || [];
    var msgs = work.slice(0, 2).map(function (w) {
      return '<div class="as-row items-start gap-2">' +
        '<span class="as-avatar" style="width:28px;height:28px;font-size:13px;flex-shrink:0">' + w.e + '</span>' +
        '<div class="flex flex-col min-w-0 gap-0.5">' +
          '<span class="text-[12px]" style="font-weight:600">' + w.n + '</span>' +
          '<span class="text-[12px] text-text-secondary leading-snug">' + w.d + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    hc.innerHTML =
      '<div class="as-card flex flex-col gap-3 p-4">' +
        '<div class="as-row justify-between">' +
          '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">⚡ ' + kvT('home.recent') + '</span>' +
          '<a class="text-[11px] as-link" onclick="kvNav(\'work\');return false">' + kvT('home.openactivity') + '</a>' +
        '</div>' +
        (msgs || '<p class="text-[12px] text-text-muted">' + kvT('home.empty') + '</p>') +
      '</div>';
  }

  /* Sidebar */
  var el;
  if ((el = document.getElementById('kv-biz-name'))) el.textContent = b.name;
  if ((el = document.getElementById('kv-biz-sub'))) el.textContent = b.sub;
  if ((el = document.getElementById('kv-biz-loc'))) el.textContent = b.loc;

  /* Your industry panel — peribadi utk user, auto dari playbook */
  if ((el = document.getElementById('kv-industry-icon'))) el.textContent = b.icon;
  if ((el = document.getElementById('kv-industry-type'))) el.textContent = b.type;
  if ((el = document.getElementById('kv-industry-status'))) {
    if (kvSetupDone()){
      el.textContent = kvT('side.complete');
      el.href = '#';
      el.style.pointerEvents = 'none';
      el.style.cursor = 'default';
    } else {
      el.textContent = kvT('side.finish');
      el.href = '/setup';
      el.style.pointerEvents = '';
      el.style.cursor = 'pointer';
    }
  }
  if ((el = document.getElementById('kv-header-status'))) {
    var setupDone = kvSetupDone();
    var liveChans = kvLiveChans();
    var working = !!(setupDone && liveChans && liveChans.length);
    el.textContent = !setupDone ? kvT('status.setup') : (!liveChans || !liveChans.length ? kvT('status.connect') : kvT('status.working'));
    el.classList.toggle('green', working);
    el.classList.toggle('amber', !working);
  }
  if ((el = document.getElementById('kv-potential'))) el.textContent = kvBump(b.potential) + '%';
  if ((el = document.getElementById('kv-potential-fill'))) el.style.width = kvBump(b.potential) + '%';
  if ((el = document.getElementById('kv-potential-txt'))) el.textContent = kvT('pot.txt').replace('{n}', b.opportunities);

  /* Home stats */
  if ((el = document.getElementById('h-stats'))) {
    el.innerHTML = b.stats.map(function (s) {
      return '<div class="as-card flex flex-col gap-3 p-5">' +
        '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + s.d + '</span>' +
        '<span class="font-pixel text-3xl">' + s.v + (s.u ? '<span class="text-lg text-text-muted">' + s.u + '</span>' : '') + '</span>' +
        '<span class="text-[13px] text-text-secondary">' + s.l + '</span>' +
        (s.s ? '<div class="as-row justify-between"><span class="text-[11px] text-text-muted">' + s.s + '</span></div>' : '') +
        (s.p ? '<div class="as-progress"><div class="as-progress-fill" style="width:' + s.p + '%"></div></div>' : '') +
        '</div>';
    }).join('');
  }

  /* Home suggestion + self-improving signal */
  if ((el = document.getElementById('h-suggest'))) {
    var pop = kvPopular(kvBizType());
    var signal = '';
    if (pop && pop.pick && pop.pick.indexOf('inferred:') !== 0){
      signal = '<div class="mt-2 text-[11px] text-text-muted">🔥 ' + pop.n + ' other ' + b.sub.toLowerCase() + ' businesses started with this.</div>';
    }
    /* Use cases to automate: suggestion utama + opportunity funcs */
    var ops = (b.funcs || []).filter(function(f){ return f[2] === 'opportunity'; });
    var opCards = ops.map(function(f){
      return '<div class="flex items-center justify-between gap-3 rounded-lg border border-(--rail) px-4 py-3">' +
        '<div class="flex flex-col gap-0.5">' +
          '<span class="text-[13px] text-text">' + f[0] + '</span>' +
          '<span class="text-[11px] text-text-muted">' + kvT('uc.opportunity') + '</span>' +
        '</div>' +
        '<button class="btn btn-outline px-3 py-1 text-[11px] whitespace-nowrap" onclick="kvNav(\'work\');return false">' + kvT('uc.see') + '</button>' +
      '</div>';
    }).join('');
    var suggestionStarted = KV_STORE.get('aisar-suggestion-started:' + kvBizType(), '') === '1';
    var suggestionAction = suggestionStarted
      ? '<div class="as-row gap-3"><button class="btn btn-primary px-5 py-2 text-sm" onclick="kvOpenBusinessConnections()">' + kvT('uc.reviewaccess') + '</button><span class="as-tag amber">' + kvT('uc.preparing') + '</span></div>'
      : '<div class="as-row gap-3"><button class="btn btn-primary px-5 py-2 text-sm" onclick="kvStartSuggestion()">' + kvT('uc.automate') + '</button><button class="btn btn-outline px-5 py-2 text-sm" onclick="kvDismissSuggestion()">' + kvT('uc.notnow') + '</button></div>';
    el.innerHTML =
      '<div class="flex flex-col gap-4">' +
      '<div class="as-card flex flex-col gap-4 p-5">' +
      '<div class="as-row justify-between">' +
        '<div class="flex flex-col gap-1">' +
          '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('uc.suggested') + '</span>' +
          '<h3 class="font-pixel text-lg tracking-tight">' + b.sug.t + '</h3>' +
          '<p class="text-[13px] text-text-secondary">' + b.sug.d + '</p>' +
        '</div>' +
        '<span class="as-tag green">' + b.sug.tag + '</span>' +
      '</div>' +
      suggestionAction + signal +
      '</div>' +
      (opCards ? '<div class="flex flex-col gap-2">' +
        '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('uc.more') + '</span>' +
        opCards +
      '</div>' : '') +
      '</div>';
  }

  /* Business profile rows */
  if ((el = document.getElementById('kv-biz-site'))) el.textContent = kvSite(b);
  if ((el = document.getElementById('kv-biz-contact'))) el.textContent = chans.join(' · ') || kvChans(b).join(' · ');
  if ((el = document.getElementById('kv-biz-booking'))) el.textContent = b.booking;
  if ((el = document.getElementById('kv-biz-systems'))) el.textContent = b.systems;

  /* Channels chips */
  if ((el = document.getElementById('kv-chips'))) {
    el.innerHTML = ['WhatsApp', 'Telegram', 'Instagram', 'Email', 'Phone'].map(function (c) {
      var act = chans.indexOf(c) >= 0;
      return '<span class="as-chip' + (act ? ' green' : ' dim') + '">' + c + '</span>';
    }).join('');
  }

  /* Business functions */
  if ((el = document.getElementById('kv-funcs'))) {
    el.innerHTML = b.funcs.map(function (f) {
      return '<div class="as-row justify-between"><span class="text-[13px]">' + f[0] + '</span><span class="as-tag' + (f[1] ? ' ' + f[1] : '') + '">' + kvT('func.' + f[2]) + '</span></div>';
    }).join('');
  }

  /* AI Team */
  if ((el = document.getElementById('kv-team'))) {
    el.innerHTML = b.team.map(function (t) {
      var ready = kvAgentReady(t);
      var action;
      if (t.setup){
        action = ready
          ? '<span class="as-tag green">live</span>'
          : '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvOpenBusinessConnections()">' + kvT('conn.enable') + '</button>';
      } else {
        action = ready
          ? '<a class="btn btn-outline px-4 py-1.5 text-xs" href="#work" onclick="kvNav(\'work\');return false">' + kvT('home.open') + '</a>'
          : '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvOpenBusinessConnections()">' + kvT('conn.first') + '</button>';
      }
      var meta = ready ? (t.m || '') : kvT('team.waiting');
      return '<div class="as-card flex flex-col gap-4 p-5">' +
        '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + t.e + '</span><div class="flex flex-col"><span class="text-sm">' + t.n + '</span><span class="text-[11px] text-text-muted">' + t.ch + '</span></div></div>' + action + '</div>' +
        '<p class="text-[13px] text-text-secondary">' + t.d + '</p>' +
        (meta ? '<div class="as-row justify-between"><span class="text-[11px] text-text-muted">' + meta + '</span></div>' : '') +
        '</div>';
    }).join('');
  }

  /* AI Team — AI recommends: opportunity funcs -> suggested agents */
  if ((el = document.getElementById('kv-recs'))) {
    var recs = kvTeamRecs(b);
    if (!recs.length){
      el.style.display = 'none';
      el.innerHTML = '';
    } else {
      KV_RECS_LAST = recs;
      el.style.display = '';
      el.innerHTML =
        '<div class="flex flex-col gap-1">' +
          '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('rec.title') + '</span>' +
          '<h3 class="font-pixel text-lg tracking-tight">' + kvT('rec.head') + '</h3>' +
          '<p class="text-[13px] text-text-secondary">' + kvT('rec.desc') + '</p>' +
        '</div>' +
        '<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">' +
        recs.map(function(r, i){
          return '<div class="as-card flex flex-col gap-3 p-5" style="border-color:rgb(0 210 148/.35)">' +
            '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + r.icon + '</span><div class="flex flex-col"><span class="text-sm">' + r.name + '</span><span class="text-[11px] text-text-muted">' + r.tag + '</span></div></div><span class="text-[10px] font-mono uppercase tracking-[0.18em]" style="color:#ffb43c;background:rgb(255 180 60/.12);border:1px solid rgb(255 180 60/.3);padding:3px 8px;border-radius:999px">' + kvT('rec.rec') + '</span></div>' +
            '<p class="text-[13px] text-text-secondary">' + r.desc + '</p>' +
            '<button class="btn btn-primary px-4 py-1.5 text-xs self-start" onclick="kvAddRec(' + i + ')">' + kvT('rec.cta') + '</button>' +
          '</div>';
        }).join('') +
        '</div>';
    }
  }

  /* Work — decision inbox: ringkasan + filter + senarai */
  if ((el = document.getElementById('kv-work'))) {
    var work = b.work || [];
    var needCount = 0, doneCount = 0, autoCount = 0;
    work.forEach(function(w, i){
      if (kvWorkDone(i)) doneCount++;
      else if (w.tag === 'needs you') needCount++;
      else autoCount++;
    });
    /* Bottom nav badge (mobile) */
    var bn = document.getElementById('kv-bottom-work-badge');
    if (bn){
      bn.textContent = needCount;
      bn.style.display = needCount ? 'inline-flex' : 'none';
    }
    /* Ringkasan */
    var sum = document.getElementById('kv-work-sum');
    if (sum){
      sum.innerHTML =
        '<div class="as-card flex flex-col gap-1 p-4"><span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('work.need') + '</span><span class="font-pixel text-2xl ' + (needCount ? 'text-[rgb(255 180 60)]' : '') + '">' + needCount + '</span></div>' +
        '<div class="as-card flex flex-col gap-1 p-4"><span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('work.auto') + '</span><span class="font-pixel text-2xl">' + doneCount + '</span></div>' +
        '<div class="as-card flex flex-col gap-1 p-4"><span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">' + kvT('work.activity') + '</span><span class="font-pixel text-2xl">' + (autoCount + doneCount) + '</span></div>';
    }
    /* Filter tabs */
    var f = document.getElementById('kv-work-filters');
    if (f){
      var tabs = [
        ['auto', kvT('work.f.auto'), autoCount],
        ['done', kvT('work.f.done'), doneCount],
        ['all', kvT('work.f.all'), work.length]
      ];
      f.innerHTML = tabs.map(function(t){
        return '<button class="btn btn-outline px-4 py-1.5 text-xs' + (kvWorkFilter === t[0] ? ' btn-primary' : '') + '" onclick="kvWorkSetFilter(\'' + t[0] + '\')">' + t[1] + ' · ' + t[2] + '</button>';
      }).join('');
    }
    /* Senarai ikut filter */
    var shown = work.filter(function(w, i){
      if (kvWorkFilter === 'all') return true;
      if (kvWorkFilter === 'needs you') return !kvWorkDone(i) && w.tag === 'needs you';
      if (kvWorkFilter === 'done') return kvWorkDone(i);
      if (kvWorkFilter === 'auto') return !kvWorkDone(i) && w.tag !== 'needs you';
      return true;
    });
    el.innerHTML = shown.length
      ? shown.map(function (w, j) {
          var idx = work.indexOf(w);
          var approved = kvWorkDone(idx);
          var status = approved ? 'approved' : w.tag;
          var cta = approved
            ? (w.tc === 'red' ? '<span class="as-tag green">approved ✓</span>' : '')
            : (w.tag === 'needs you'
              ? '<div class="as-row gap-2">' +
                  '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvApproveWork(' + idx + ')">' + kvT('work.approve') + '</button>' +
                  '<button class="btn btn-outline px-4 py-1.5 text-xs" onclick="kvEditWork(' + idx + ')">' + kvT('work.edit') + '</button>' +
                '</div>'
              : '');
          return '<div id="work-' + idx + '" class="as-card flex flex-col gap-3 p-4">' +
            '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + w.e + '</span><div class="flex flex-col"><span class="text-sm">' + w.n + '</span><span class="text-[11px] text-text-muted">' + w.t + '</span></div></div><span class="as-tag' + (approved ? ' green' : (w.tc ? ' ' + w.tc : '')) + '">' + status + '</span></div>' +
            '<p class="text-[13px] text-text-secondary">' + w.d + '</p>' + cta +
            '</div>';
        }).join('')
      : '<div class="as-card p-6 text-center text-[13px] text-text-muted">' + kvT('work.empty') + '</div>';
  }

  /* Connections */
  if ((el = document.getElementById('kv-conns'))) {
    var connectionCards = (b.conns || []).slice();
    if (chans.indexOf('Telegram') >= 0 && !connectionCards.some(function(c){ return c.n === 'Telegram'; })) {
      connectionCards.unshift({ e:'✈️', n:'Telegram', s:kvT('conn.ready'), d:kvT('conn.telegram') });
    }
    el.innerHTML = connectionCards.map(function (c) {
      var on = kvConnOn(c.n);
      var cx = kvConnector(c.n);
      var method = cx ? (cx.method || 'oauth') : '';
      var meta = cx ? '<span class="as-tag amber">' + kvT('cx.' + method) + '</span>' : '';
      var action = on
        ? '<button class="btn btn-outline px-4 py-1.5 text-xs" onclick="kvToggleConn(\'' + c.n + '\')">' + kvT('conn.disconnect') + '</button>'
        : '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvToggleConn(\'' + c.n + '\')">' + kvT('conn.connect') + '</button>';
      return '<div class="as-card flex flex-col gap-3 p-4">' +
        '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + c.e + '</span><div class="flex flex-col"><span class="text-sm">' + c.n + '</span><span class="text-[11px] text-text-muted">' + c.s + '</span></div></div><div class="as-row gap-1">' + meta + (on ? '<span class="as-tag green">' + kvT('conn.connected') + '</span>' : '<span class="as-tag dim">' + kvT('conn.off') + '</span>') + '</div></div>' +
        '<p class="text-[13px] text-text-secondary">' + c.d + '</p>' +
        '<p class="text-[11px] text-text-muted">' + (cx ? kvT('conn.guide.' + method) : '') + '</p>' +
        '<div class="as-row justify-end">' + action + '</div>' +
        '</div>';
    }).join('');
  }

  kvApprovalsRender();

  /* Chat — app penuh: senarai perbualan + thread + ambil alih */
  kvChatRender();

  /* Team — kolaborasi ala-Slack */
  kvTeamRender();
}

var kvTeamState = { sel:'#pasukan', typing:false, chans:{} };

var KV_TEAM_CHANS = {
  '#pasukan': {
    label: 'pasukan', desc: 'ruang kolaborasi semua agent',
    tpl: [
      'Apa status order hari ni? 📊',
      '@Follow-up: hantar reminder promo minggu ni 🎁',
      '@Ops Assistant: siapkan weekly report 📈',
      'Ada apa-apa escalation yang perlu aku semak? ⚠️'
    ]
  },
  '#escalations': {
    label: 'escalations', desc: 'auto-log dari ⚡ Work — yang perlu kau approve',
    tpl: [
      'Senaraikan semua escalation hari ni ⚠️',
      '@Follow-up: apa status escalation ni?',
      'Yang dah approve, tutup & archive ✅'
    ]
  },
  '#random': {
    label: 'random', desc: 'sembang santai pasukan',
    tpl: [
      'Cadang promo hujung minggu 💡',
      '@Customer Assistant: cerita customer paling lawak 😄',
      'Teh tarik sesiapa? ☕'
    ]
  }
};

var KV_TEAM_REPLIES = {
  'Customer Assistant': [
    'On it! Saya dah semak — 2 pelanggan tanya waktu operasi, dah balas. Menu terkini hantar ke 3 chat. ✅',
    'Dah settle. 1 pelanggan minta diskaun — aku dah escalate ke ⚡ Work untuk approval kau. ⚠️',
    'Siap! Semua enquiry pagi ni dah dijawab. Tiada yang tertinggal. 👍'
  ],
  'Booking Agent': [
    'Dah semak — 4 booking baru hari ni, semua confirmed. Satu minta tarikh alternatif, dah tawarkan Jumaat. ✅',
    'Booking malam ni: 2 meja 4 orang, 1 meja 2 orang. Semua confirmed, reminder dihantar. 📅',
    'Ada 1 no-show risk — reminder automatik dah hantar. Kalau tak jawab, aku escalate. ⚠️'
  ],
  'Follow-up': [
    'Promo minggu ni dah jadual — 23 pelanggan terima mesej esok 10 pagi. 🎁',
    'Reminder loyaliti dah hantar ke 15 regular. 5 dah reply, 3 booking baru! 🔁',
    'Maklum balas minggu lepas: 8 positif, 2 cadangan. Dah ringkas dalam weekly report. 📊'
  ],
  'Ops Assistant': [
    'Weekly report siap! Jualan naik 12% minggu ni, top item: wagyu set & udon. 📈',
    'Stok wagyu tinggal 3 hari — aku cadang auto-order esok. Nak aku proceed? 📦',
    'Dah track semua — 87 transaksi hari ini, peak hour 7-9pm. Operasi normal. ✅'
  ]
};

var KV_TEAM_GENERAL = [
  'Aku dengar! Semua agent sihat dan bekerja. Nak semak apa-apa, terus tag agent yang berkaitan. 😊',
  'Noted! Semua sistem berjalan normal. Contoh: tag @Customer Assistant untuk enquiry, @Ops Assistant untuk report. 👍',
  'Ok! Kalau nak status bahagian tertentu, tag agent dia — aku tolong sampaikan jugak. ✅'
];

function kvTeamSeed(){
  var b = kvPlaybook(kvBizType());
  var team = b.team || [];
  var first = team.length ? team[0].n : 'Customer Assistant';
  var last = team.length > 1 ? team[team.length-1].n : first;

  kvTeamState.chans['#pasukan'] = kvTeamState.chans['#pasukan'] || { seeded:false, msgs:[] };
  if (!kvTeamState.chans['#pasukan'].seeded){
    kvTeamState.chans['#pasukan'].seeded = true;
    kvTeamState.chans['#pasukan'].msgs = [
      { f:'agent', n: first, d:'Morning! Semua channel aktif. 2 escalation menunggu approval kau kat ⚡ Work.', tm:'8:02 AM' },
      { f:'you', n:'Kau', d:'Ok nanti aku semak. @' + last + ', boleh siapkan laporan sebelum Jumaat?', tm:'8:15 AM' },
      { f:'agent', n: last, d:'Boleh. Laporan siap esok 9 pagi — aku tag kau bila dah sedia. ✅', tm:'8:16 AM' },
      { f:'agent', n: first, d:'Update: 1 pelanggan minta diskaun 15% — aku dah draft balasan, tengok kat ⚡ Work. ⚠️', tm:'10:42 AM' }
    ];
  }

  kvTeamState.chans['#escalations'] = kvTeamState.chans['#escalations'] || { seeded:false, msgs:[] };
  kvTeamState.chans['#random'] = kvTeamState.chans['#random'] || { seeded:false, msgs:[] };
  if (!kvTeamState.chans['#random'].seeded){
    kvTeamState.chans['#random'].seeded = true;
    kvTeamState.chans['#random'].msgs = [
      { f:'agent', n: first, d:'Channel ni untuk benda santai — share apa-apa je! 🎉', tm:'11:00 AM' },
      { f:'you', n:'Kau', d:'Nice. Sesiapa boleh cadangkan promo hujung minggu? 💡', tm:'11:02 AM' },
      { f:'agent', n: last, d:'Aku cadang bundle set + free dessert untuk regular. 😋', tm:'11:05 AM' }
    ];
  }
  kvTeamSyncEscalations();
}

/* Auto-log escalation dari Work ke #escalations — dedupe ikut srcIdx */
function kvTeamSyncEscalations(){
  var b = kvPlaybook(kvBizType());
  var work = b.work || [];
  var chan = kvTeamState.chans['#escalations'];
  if (!chan) return;
  chan.msgs = chan.msgs || [];
  var open = {}, done = {};
  chan.msgs.forEach(function(m){
    if (m.srcIdx !== undefined){
      if (m.done) done[m.srcIdx] = true; else open[m.srcIdx] = true;
    }
  });
  work.forEach(function(w, i){
    var approved = kvWorkDone(i);
    if (approved){
      if (!done[i]){
        chan.msgs.push({ f:'agent', n:(w.n||'AISAR'), srcIdx:i, done:true, tm:'sekarang',
          d:'✅ Escalation ditutup — approved & dihantar. (dari ' + (w.n||'AISAR') + ')' });
      }
    } else if (w.tag === 'needs you' && !open[i]){
      chan.msgs.push({ f:'agent', n:(w.n||'AISAR'), srcIdx:i, tm:'sekarang',
        d:'⚠️ Escalation: ' + w.d + ' — approve kat ⚡ Work.' });
    }
  });
}

function kvTeamChanUnread(ch){
  if (ch !== '#escalations') return 0;
  var b = kvPlaybook(kvBizType());
  var work = b.work || [];
  var n = 0;
  work.forEach(function(w,i){ if(!kvWorkDone(i) && w.tag==='needs you') n++; });
  return n;
}

function kvTeamMention(tx, team){
  var lower = (tx || '').toLowerCase();
  for (var i=0;i<team.length;i++){
    if (lower.indexOf('@' + team[i].n.toLowerCase()) >= 0) return team[i];
  }
  return null;
}

function kvTeamOpen(chan){
  kvTeamState.sel = chan;
  kvTeamRender();
}

function kvTeamSend(){
  var inp = document.getElementById('kv-team-inp');
  if (!inp) return;
  var tx = (inp.value || '').trim();
  if (!tx) return;
  inp.value = '';
  var chan = kvTeamState.chans[kvTeamState.sel];
  if (!chan) return;
  chan.msgs.push({ f:'you', n:'Kau', d:tx, tm:'sekarang' });
  var b = kvPlaybook(kvBizType());
  var team = b.team || [];
  var target = kvTeamMention(tx, team);
  kvTeamRender();
  var t = document.getElementById('kv-team-typing');
  if (t) t.style.display = 'flex';
  var box = document.getElementById('kv-team-msgs');
  if (box) box.scrollTop = box.scrollHeight;
  var pool = target ? (KV_TEAM_REPLIES[target.n] || KV_TEAM_GENERAL) : KV_TEAM_GENERAL;
  setTimeout(function(){
    var t2 = document.getElementById('kv-team-typing');
    if (t2) t2.style.display = 'none';
    var d = pool[Math.floor(Math.random()*pool.length)];
    kvTeamState.chans[kvTeamState.sel].msgs.push({ f:'agent', n: target ? target.n : (team.length ? team[0].n : 'Customer Assistant'), d:d, tm:'sekarang' });
    kvTeamRender();
  }, 1000 + Math.floor(Math.random()*700));
}

function kvTeamTpl(tx){
  var inp = document.getElementById('kv-team-inp');
  if (inp){ inp.value = tx; inp.focus(); }
}

function kvTeamRender(){
  kvTeamSeed();
  var b = kvPlaybook(kvBizType());
  var team = b.team || [];
  var el = document.getElementById('kv-team-app');
  if (!el) return;
  var sel = kvTeamState.sel;
  var chan = kvTeamState.chans[sel] || { msgs: [] };
  var meta = KV_TEAM_CHANS[sel] || KV_TEAM_CHANS['#pasukan'];

  /* Channel list */
  var chans = Object.keys(KV_TEAM_CHANS).map(function(key){
    var c = KV_TEAM_CHANS[key];
    var unread = kvTeamChanUnread(key);
    var badge = unread ? '<span class="kv-badge">' + unread + '</span>' : '';
    return '<button class="kv-chan' + (sel === key ? ' active' : '') + '" onclick="kvTeamOpen(\'' + key + '\')"><span># ' + c.label + '</span>' + badge + '</button>';
  }).join('');

  /* Members */
  var members = '<div class="kv-team-members"><span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Team</span>';
  members += '<div class="as-row gap-2"><span class="kv-dot you"></span><span class="text-[12px]">Kau (boss)</span></div>';
  team.forEach(function(t){
    members += '<div class="as-row gap-2"><span class="kv-dot"></span><span class="text-[12px]">' + kvEsc(t.n) + '</span></div>';
  });
  members += '</div>';

  /* Templates ikut channel */
  var tpls = meta.tpl.map(function(t){
    return '<button class="kv-tpl" onclick="kvTeamTpl(\'' + t.replace(/'/g,"\\'") + '\')">' + kvEsc(t) + '</button>';
  }).join('');

  /* Messages */
  var iconFor = function(nm){
    for (var i=0;i<team.length;i++) if (team[i].n === nm) return team[i].e;
    return '🤖';
  };
  var msgs = chan.msgs.map(function(msg){
    var cls = 'kv-tm' + (msg.f === 'you' ? ' kv-tm-you' : '') + (msg.done ? ' kv-tm-done' : '');
    var av = msg.f === 'you' ? '🙋' : iconFor(msg.n);
    return '<div class="' + cls + '">' +
      '<span class="as-avatar">' + av + '</span>' +
      '<div class="flex flex-col gap-1"><div class="as-row gap-2"><span class="text-[12px] font-semibold">' + kvEsc(msg.n) + '</span><span class="text-[10px] text-text-muted">' + kvEsc(msg.tm) + '</span></div>' +
      '<div class="kv-tm-bubble">' + kvEsc(msg.d) + '</div></div></div>';
  }).join('');

  var typing = '<div class="kv-tm" id="kv-team-typing" style="display:none"><span class="as-avatar">🤖</span><div class="kv-typing"><i></i><i></i><i></i></div></div>';

  var ph = sel === '#pasukan'
    ? kvT('team.ph.pasukan')
    : sel === '#escalations'
      ? kvT('team.ph.escalation')
      : kvT('team.ph.random');

  var input = '<div class="kv-team-inp-row">' +
    '<input id="kv-team-inp" placeholder="' + ph + '" onkeydown="if(event.key===&quot;Enter&quot;)kvTeamSend()">' +
    '<button class="kv-team-send" onclick="kvTeamSend()">➤</button></div>';

  el.innerHTML =
    '<div class="kv-team-chans"><span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Channels</span>' + chans + '</div>' +
    '<div class="kv-team-main">' +
      '<div class="kv-team-head"><span>💬 <b>#' + meta.label + '</b> — ' + kvEsc(meta.desc) + '</span><span class="text-text-muted">' + Object.keys(KV_TEAM_CHANS).length + ' ' + kvT('team.channels') + '</span></div>' +
      '<div class="kv-team-tpls">' + tpls + '</div>' +
      '<div class="kv-team-msgs" id="kv-team-msgs">' + msgs + typing + '</div>' +
      input +
    '</div>' + members;

  var box = document.getElementById('kv-team-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

/* ============================================================
   AUTO-RENDER — panggil bila DOM sedia.
   ============================================================ */
if (typeof document !== 'undefined') {
  function kvBoot(){
    try {
      var q = (window.location.search || '').match(/[?&]country=([a-z]{2})/i);
      if (q && q[1]) kvSetCountry(q[1].toUpperCase());
      kvApplyLang(); kvSeedConns(); kvRenderAll();
    }
    catch(e){ if (window.console) console.error('AISAR render error:', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kvBoot);
  } else {
    kvBoot();
  }
}
