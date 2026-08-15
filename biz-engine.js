/* ---- BIZ engine: satu dashboard engine, content ikut business type ---- */
var BIZ = {
  restaurant: {
    name: 'Wagyu Japanese Restaurant', sub: 'Premium Japanese Restaurant', loc: 'Kuala Lumpur · MY',
    site: 'wagyu.my', booking: 'Phone + Instagram DM', systems: 'Google Sheets · AutoCount',
    potential: 62, opportunities: 4,
    stats: [
      { d: 'Today', v: '12', u: '', l: 'conversations handled', s: '4 needed you' },
      { d: 'Reservations', v: '7', u: '', l: 'new bookings this week', s: '3 via WhatsApp' },
      { d: 'Hours saved', v: '18', u: ' hrs', l: 'saved this week by your AI team', p: 64 }
    ],
    sug: { t: 'Automate your Friday export', d: 'You manually export reservations to Sheets every Friday. AISAR can do this automatically.', tag: 'est. 1 hr/month', cta: 'Automation queued \u2014 I\u0027ll take care of the Friday export.' },
    ch: ['WhatsApp', 'Instagram'],
    funcs: [['Customer service', '', 'covered'], ['Reservations', 'green', 'live'], ['Follow-up', 'green', 'live'], ['Inventory & ordering', 'amber', 'opportunity'], ['Weekly reports', 'amber', 'opportunity']],
    team: [
      { e: '💬', n: 'Customer Assistant', ch: 'WhatsApp · Instagram', d: 'Answers FAQs, menu questions, opening hours and policies — 24/7, in your voice. Escalates complaints.', m: 'Today · 12 chats · 4 escalated' },
      { e: '📅', n: 'Booking Agent', ch: 'Calendar · Confirmations', d: 'Checks availability, creates bookings, sends confirmations and reminders automatically.', m: 'This week · 7 bookings' },
      { e: '🔁', n: 'Follow-up', ch: 'Past customers', d: 'Follows up past customers, special occasions, and abandoned enquiries — turning one-time buyers into regulars.', m: 'This month · 23 follow-ups' },
      { e: '📊', n: 'Ops Assistant', ch: 'Inventory · Reports', d: 'Watches your spreadsheets, automates supplier ordering, and prepares your weekly business report every Monday.', m: '', setup: true }
    ],
    work: [
      { e: '💬', n: 'Customer Assistant', t: 'WhatsApp · 2m ago · auto', tag: 'done', tc: '', d: 'Answered "Do you have halal certification?" with menu + certification link.' },
      { e: '📅', n: 'Booking Agent', t: 'Instagram · 1h ago · auto', tag: 'confirmed', tc: 'green', d: 'Created booking for 2 pax, Sat 8pm — sent confirmation + reminder.' },
      { e: '🔁', n: 'Follow-up', t: '3h ago · auto', tag: 'sent', tc: 'green', d: 'Sent birthday promo to 6 past customers (personalised, in brand voice).' },
      { e: '⚠️', n: 'Customer Assistant', t: 'WhatsApp · 5h ago · escalated', tag: 'needs you', tc: 'red', d: 'Customer complained about wrong order delivery — AISAR apologised and offered 10% off. Review before sending?', cta: 'Approved \u2014 10% discount voucher sent.' }
    ],
    conns: [
      { e: '💬', n: 'WhatsApp', s: 'Business API · linked', d: 'Customer Assistant & Follow-up use this to talk to customers.', on: true },
      { e: '📸', n: 'Instagram', s: 'DM · linked', d: 'Booking Agent receives reservation DMs here.', on: true },
      { e: '📅', n: 'Google Calendar', s: 'linked', d: 'Booking Agent checks availability and creates events.', on: true },
      { e: '📊', n: 'Google Sheets', s: 'linked', d: 'Ops Assistant reads reservations &amp; inventory here.', on: true },
      { e: '🧾', n: 'AutoCount', s: 'not connected', d: 'Unlocks ordering automation + weekly P&L reports.', on: false, cta: 'AutoCount connection wizard will open \u2014 we\u0027ll guide you through it.' }
    ]
  },
  retail: {
    name: 'Serai Homeware', sub: 'Home & Living E-commerce', loc: 'Shah Alam · MY',
    site: 'seraihomeware.my', booking: 'Shopee / Website checkout', systems: 'Shopify · Google Sheets',
    potential: 58, opportunities: 5,
    stats: [
      { d: 'Today', v: '34', u: '', l: 'orders processed', s: '6 support tickets' },
      { d: 'Orders this week', v: '211', u: '', l: 'across Shopify + Shopee', s: '9 refunds handled' },
      { d: 'Hours saved', v: '22', u: ' hrs', l: 'saved this week by your AI team', p: 71 }
    ],
    sug: { t: 'Automate abandoned cart recovery', d: 'Shoppers leave carts every day. AISAR follows up automatically with a personalised message + offer.', tag: 'est. 3 hrs/month', cta: 'Automation queued \u2014 I\u0027ll take care of cart recovery.' },
    ch: ['WhatsApp', 'Instagram'],
    funcs: [['Customer service', '', 'covered'], ['Order status', 'green', 'live'], ['Abandoned carts', 'green', 'live'], ['Returns', 'amber', 'opportunity'], ['Weekly reports', 'amber', 'opportunity']],
    team: [
      { e: '💬', n: 'Customer Assistant', ch: 'WhatsApp · Instagram', d: 'Answers product questions, stock, shipping and policy FAQs — 24/7.', m: 'Today · 34 chats · 6 escalated' },
      { e: '📦', n: 'Order Tracker', ch: 'Shopify · Email', d: 'Tracks orders and sends status updates automatically as items ship.', m: 'This week · 41 updates' },
      { e: '🔁', n: 'Follow-up', ch: 'Abandoned carts · Past customers', d: 'Recovers abandoned carts and nudges repeat-purchase in your brand voice.', m: 'This month · 17 campaigns' },
      { e: '📊', n: 'Ops Assistant', ch: 'Inventory · Reports', d: 'Watches stock levels, reorders best-sellers, and prepares your weekly sales report.', m: '', setup: true }
    ],
    work: [
      { e: '💬', n: 'Customer Assistant', t: 'WhatsApp · 2m ago · auto', tag: 'done', tc: '', d: 'Answered "Is this available in size L?" with stock + product link.' },
      { e: '📦', n: 'Order Tracker', t: '1h ago · auto', tag: 'confirmed', tc: 'green', d: 'Sent tracking update for order #1024 — out for delivery.' },
      { e: '🔁', n: 'Follow-up', t: '3h ago · auto', tag: 'sent', tc: 'green', d: 'Sent cart recovery to 5 shoppers who abandoned checkout yesterday.' },
      { e: '⚠️', n: 'Customer Assistant', t: 'WhatsApp · 5h ago · escalated', tag: 'needs you', tc: 'red', d: 'Customer complained about late delivery — AISAR apologised and offered free shipping. Review before sending?', cta: 'Approved \u2014 free shipping voucher sent.' }
    ],
    conns: [
      { e: '💬', n: 'WhatsApp', s: 'Business API · linked', d: 'Customer Assistant & Follow-up use this to talk to customers.', on: true },
      { e: '📸', n: 'Instagram', s: 'Shop · linked', d: 'Customer Assistant answers product DMs here.', on: true },
      { e: '🛒', n: 'Shopify', s: 'linked', d: 'Order Tracker reads orders &amp; fulfilment here.', on: true },
      { e: '📊', n: 'Google Sheets', s: 'linked', d: 'Ops Assistant reads inventory here.', on: true },
      { e: '💳', n: 'Payment gateway', s: 'not connected', d: 'Unlocks automatic refunds &amp; failed-payment follow-ups.', on: false, cta: 'Payment connection wizard will open \u2014 we\u0027ll guide you through it.' }
    ]
  },
  services: {
    name: 'Nadi Studio', sub: 'Design & Branding Agency', loc: 'Petaling Jaya · MY',
    site: 'nadi.studio', booking: 'Email / Calendly', systems: 'Notion · Google Calendar',
    potential: 66, opportunities: 4,
    stats: [
      { d: 'Today', v: '8', u: '', l: 'new leads', s: '2 booked discovery calls' },
      { d: 'Quotes', v: '3', u: '', l: 'sent this week', s: '1 awaiting reply' },
      { d: 'Hours saved', v: '14', u: ' hrs', l: 'saved this week by your AI team', p: 55 }
    ],
    sug: { t: 'Automate proposal follow-up', d: 'You draft quotes and chase replies manually. AISAR follows up on sent quotes automatically.', tag: 'est. 4 hrs/month', cta: 'Automation queued \u2014 I\u0027ll chase those quotes.' },
    ch: ['Instagram', 'Email'],
    funcs: [['Enquiry response', '', 'covered'], ['Lead intake', 'green', 'live'], ['Proposal follow-up', 'green', 'live'], ['Scheduling', 'amber', 'opportunity'], ['Invoicing', 'amber', 'opportunity']],
    team: [
      { e: '🧲', n: 'Lead Responder', ch: 'Instagram · Email', d: 'Answers scope, pricing and availability questions — and books discovery calls.', m: 'Today · 8 leads · 2 booked' },
      { e: '📅', n: 'Booking Agent', ch: 'Calendar · Scheduling', d: 'Checks your calendar and schedules discovery calls without back-and-forth.', m: 'This week · 10 calls booked' },
      { e: '🔁', n: 'Follow-up', ch: 'Sent quotes', d: 'Tracks sent proposals and nudges prospects at the right moment.', m: 'This month · 9 follow-ups' },
      { e: '📑', n: 'Quote Assistant', ch: 'Notion · Pricing', d: 'Drafts first-pass quotes from your rate card and past projects.', m: '', setup: true }
    ],
    work: [
      { e: '🧲', n: 'Lead Responder', t: 'Instagram · 1m ago · auto', tag: 'done', tc: '', d: 'Answered "Do you do branding for F&amp;B brands?" with portfolio + case study.' },
      { e: '📅', n: 'Booking Agent', t: '30m ago · auto', tag: 'confirmed', tc: 'green', d: 'Booked discovery call with new lead for Tue 3pm + sent invite.' },
      { e: '🔁', n: 'Follow-up', t: '2h ago · auto', tag: 'sent', tc: 'green', d: 'Followed up quote #Q22 with a short personalised nudge.' },
      { e: '⚠️', n: 'Lead Responder', t: '4h ago · escalated', tag: 'needs you', tc: 'red', d: 'Prospect asked for a discount on retainers — AISAR offered a 3-month option. Review before sending?', cta: 'Approved \u2014 3-month retainer offer sent.' }
    ],
    conns: [
      { e: '📸', n: 'Instagram', s: 'DM · linked', d: 'Lead Responder answers enquiries here.', on: true },
      { e: '✉️', n: 'Email', s: 'Gmail · linked', d: 'Proposals and follow-up go through here.', on: true },
      { e: '📅', n: 'Google Calendar', s: 'linked', d: 'Booking Agent checks availability and creates events.', on: true },
      { e: '📝', n: 'Notion', s: 'linked', d: 'Quote Assistant reads your rate card here.', on: true },
      { e: '💬', n: 'WhatsApp', s: 'not connected', d: 'Unlocks instant client chats for status updates.', on: false, cta: 'WhatsApp connection wizard will open \u2014 we\u0027ll guide you through it.' }
    ]
  },
  clinic: {
    name: 'Klinik Sejahtera', sub: 'GP & Family Clinic', loc: 'Johor Bahru · MY',
    site: 'kliniksejahtera.my', booking: 'Phone / WhatsApp', systems: 'Clinic system · Google Sheets',
    potential: 71, opportunities: 6,
    stats: [
      { d: 'Today', v: '41', u: '', l: 'appointments scheduled', s: '12 intake forms' },
      { d: 'This week', v: '86', u: '', l: 'patients seen', s: '3 no-shows prevented' },
      { d: 'Hours saved', v: '25', u: ' hrs', l: 'saved this week by your AI team', p: 68 }
    ],
    sug: { t: 'Automate appointment reminders', d: 'No-shows cost you hours every month. AISAR sends reminders + reschedule links automatically.', tag: 'est. 6 hrs/month', cta: 'Automation queued \u2014 I\u0027ll set up reminders.' },
    ch: ['WhatsApp', 'Phone'],
    funcs: [['Front desk', '', 'covered'], ['Appointments', 'green', 'live'], ['Intake forms', 'green', 'live'], ['Reminders', 'green', 'live'], ['Billing', 'amber', 'opportunity']],
    team: [
      { e: '🩺', n: 'Front Desk Assistant', ch: 'WhatsApp · Phone', d: 'Answers clinic hours, doctor schedules, and insurance FAQs — 24/7.', m: 'Today · 41 chats · 8 escalated' },
      { e: '📅', n: 'Booking Agent', ch: 'Calendar · Appointments', d: 'Books and confirms appointments, and manages the waitlist automatically.', m: 'This week · 86 appointments' },
      { e: '🔁', n: 'Follow-up', ch: 'Patients', d: 'Sends reminders, post-visit check-ins, and recall messages for follow-ups.', m: 'This month · 210 reminders' },
      { e: '📊', n: 'Ops Assistant', ch: 'Reports · Billing', d: 'Prepares daily patient stats and flags billing anomalies.', m: '', setup: true }
    ],
    work: [
      { e: '🩺', n: 'Front Desk Assistant', t: 'WhatsApp · 3m ago · auto', tag: 'done', tc: '', d: 'Answered "Do you open on Sundays?" with this week\u0027s hours.' },
      { e: '📅', n: 'Booking Agent', t: '40m ago · auto', tag: 'confirmed', tc: 'green', d: 'Booked appointment for Azman (check-up) Thu 10am + reminder set.' },
      { e: '🔁', n: 'Follow-up', t: '2h ago · auto', tag: 'sent', tc: 'green', d: 'Sent post-visit check-in to 23 patients from yesterday.' },
      { e: '⚠️', n: 'Front Desk Assistant', t: '6h ago · escalated', tag: 'needs you', tc: 'red', d: 'Patient asked about pricing for a procedure — AISAR offered a call-back. Review before sending?', cta: 'Approved \u2014 call-back scheduled.' }
    ],
    conns: [
      { e: '💬', n: 'WhatsApp', s: 'Business API · linked', d: 'Front Desk Assistant &amp; Follow-up talk to patients here.', on: true },
      { e: '📞', n: 'Phone', s: 'linked', d: 'Front Desk Assistant can make call-backs here.', on: true },
      { e: '📅', n: 'Google Calendar', s: 'linked', d: 'Booking Agent manages appointments here.', on: true },
      { e: '📊', n: 'Google Sheets', s: 'linked', d: 'Ops Assistant reads appointment stats here.', on: true },
      { e: '🏥', n: 'Clinic system', s: 'not connected', d: 'Unlocks automatic patient records sync.', on: false, cta: 'Clinic system connection wizard will open \u2014 we\u0027ll guide you through it.' }
    ]
  }
};

/* ---- Helpers ---- */
function kvBizType() { try { var t = localStorage.getItem('aisar-biz-type'); return BIZ[t] ? t : 'restaurant'; } catch (e) { return 'restaurant'; } }
function kvSetupDone() { try { return localStorage.getItem('aisar-setup-done-v1') === '1'; } catch (e) { return false; } }
function kvLiveChans() { try { var a = JSON.parse(localStorage.getItem('aisar-channels') || '[]'); return (a && a.length) ? a : null; } catch (e) { return null; } }
function kvBump(v) { return kvSetupDone() ? Math.min(96, v + 20) : v; }

function kvSetBiz(t) {
  if (!BIZ[t]) return;
  try { localStorage.setItem('aisar-biz-type', t); } catch (e) {}
  kvRenderAll();
  var pills = document.querySelectorAll('[data-switch]');
  if (pills) pills.forEach(function (p) { p.classList.toggle('green', p.dataset.switch === t); });
}

/* ---- Render all views ---- */
function kvRenderAll() {
  var b = BIZ[kvBizType()];
  var chans = kvLiveChans() || b.ch;

  /* Sidebar */
  var el;
  if ((el = document.getElementById('kv-biz-name'))) el.textContent = b.name;
  if ((el = document.getElementById('kv-biz-sub'))) el.textContent = b.sub;
  if ((el = document.getElementById('kv-biz-loc'))) el.textContent = b.loc;
  if ((el = document.getElementById('kv-potential'))) el.textContent = kvBump(b.potential) + '%';
  if ((el = document.getElementById('kv-potential-fill'))) el.style.width = kvBump(b.potential) + '%';
  if ((el = document.getElementById('kv-potential-txt'))) el.textContent = 'AISAR found ' + b.opportunities + ' more opportunities to automate.';

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

  /* Home suggestion */
  if ((el = document.getElementById('h-suggest'))) {
    el.innerHTML =
      '<div class="as-card flex flex-col gap-4 p-5">' +
      '<div class="as-row justify-between">' +
        '<div class="flex flex-col gap-1">' +
          '<span class="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Suggested next</span>' +
          '<h3 class="font-pixel text-lg tracking-tight">' + b.sug.t + '</h3>' +
          '<p class="text-[13px] text-text-secondary">' + b.sug.d + '</p>' +
        '</div>' +
        '<span class="as-tag green">' + b.sug.tag + '</span>' +
      '</div>' +
      '<div class="as-row gap-3">' +
        '<button class="btn btn-primary px-5 py-2 text-sm" data-msg="' + b.sug.cta + '" onclick="kvToast(this.dataset.msg)">Automate it</button>' +
        '<button class="btn btn-outline px-5 py-2 text-sm">Not now</button>' +
      '</div>' +
      '</div>';
  }

  /* Business profile rows */
  if ((el = document.getElementById('kv-biz-name'))) el.textContent = b.name;
  if ((el = document.getElementById('kv-biz-site'))) el.textContent = b.site;
  if ((el = document.getElementById('kv-biz-contact'))) el.textContent = chans.join(' · ') || b.ch.join(' · ');
  if ((el = document.getElementById('kv-biz-booking'))) el.textContent = b.booking;
  if ((el = document.getElementById('kv-biz-systems'))) el.textContent = b.systems;

  /* Channels chips */
  if ((el = document.getElementById('kv-chips'))) {
    el.innerHTML = ['WhatsApp', 'Instagram', 'Email', 'Phone'].map(function (c) {
      var act = chans.indexOf(c) >= 0;
      return '<span class="as-chip' + (act ? ' green' : ' dim') + '">' + c + '</span>';
    }).join('');
  }

  /* Business functions */
  if ((el = document.getElementById('kv-funcs'))) {
    el.innerHTML = b.funcs.map(function (f) {
      return '<div class="as-row justify-between"><span class="text-[13px]">' + f[0] + '</span><span class="as-tag' + (f[1] ? ' ' + f[1] : '') + '">' + f[2] + '</span></div>';
    }).join('');
  }

  /* AI Team */
  if ((el = document.getElementById('kv-team'))) {
    el.innerHTML = b.team.map(function (t) {
      var action = t.setup
        ? '<span class="as-tag amber">setup</span>'
        : '<a class="btn btn-outline px-4 py-1.5 text-xs" href="#work" onclick="kvNav(\'work\');return false">Open</a>';
      return '<div class="as-card flex flex-col gap-4 p-5">' +
        '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + t.e + '</span><div class="flex flex-col"><span class="text-sm">' + t.n + '</span><span class="text-[11px] text-text-muted">' + t.ch + '</span></div></div>' + action + '</div>' +
        '<p class="text-[13px] text-text-secondary">' + t.d + '</p>' +
        '<div class="as-row justify-between">' + (t.m ? '<span class="text-[11px] text-text-muted">' + t.m + '</span>' : '') + (t.setup ? '<button class="btn btn-primary px-4 py-1.5 text-xs" onclick="kvToast(\'This assistant gets enabled after you connect its systems.\')">Connect &amp; enable</button>' : '') + '</div>' +
        '</div>';
    }).join('');
  }

  /* Work */
  if ((el = document.getElementById('kv-work'))) {
    el.innerHTML = b.work.map(function (w) {
      var cta = w.cta
        ? '<div class="as-row gap-2"><button class="btn btn-primary px-4 py-1.5 text-xs" data-msg="' + w.cta + '" onclick="kvToast(this.dataset.msg)">Approve &amp; send</button><button class="btn btn-outline px-4 py-1.5 text-xs">Edit</button></div>'
        : '';
      return '<div class="as-card flex flex-col gap-3 p-4">' +
        '<div class="as-row justify-between"><div class="as-row"><span class="as-avatar">' + w.e + '</span><div class="flex flex-col"><span class="text-sm">' + w.n + '</span><span class="text-[11px] text-text-muted">' + w.t + '</span></div></div><span class="as-tag' + (w.tc ? ' ' + w.tc : '') + '">' + w.tag + '</span></div>' +
        '<p class="text-[13px] text-text-secondary">' + w.d + '</p>' + cta +
        '</div>';
    }).join('');
  }

  /* Connections */
  if ((el = document.getElementById('kv-conns'))) {
    el.innerHTML = b.conns.map(function (c) {
      return '<div class="as-card flex flex-col gap-3 p-4">' +
        '<div class="as-row justify-between">' +
          '<div class="as-row"><span class="as-avatar">' + c.e + '</span><div class="flex flex-col"><span class="text-sm">' + c.n + '</span><span class="text-[11px] text-text-muted">' + c.s + '</span></div></div>' +
          (c.on
            ? '<div class="as-toggle on" onclick="this.classList.toggle(\'on\')" role="switch" aria-label="' + c.n + ' toggle"></div>'
            : '<button class="btn btn-primary px-4 py-1.5 text-xs" data-msg="' + c.cta + '" onclick="kvToast(this.dataset.msg)">Connect</button>') +
        '</div>' +
        '<p class="text-[13px] text-text-secondary">' + c.d + '</p>' +
        '</div>';
    }).join('');
  }
}

/* Auto-render bila DOM siap */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', kvRenderAll);
} else {
  kvRenderAll();
}
