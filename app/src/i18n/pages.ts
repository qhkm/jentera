/* ============================================================
   Page copy introduced by the React app.

   Kept separate from lib/data/i18n.ts, which is a verbatim port of
   the engine's table and should stay regenerable. These merge over
   it at runtime — same `t(key)` call site, no special casing.

   Malaysia's country locale is 'bm', so the default language is BM,
   not English. Any string rendered in a page must live here or the
   UI mixes languages.
   ============================================================ */

import type { Lang } from '@/lib/types';

export const PAGE_MESSAGES: Record<Lang, Record<string, string>> = {
  en: {
    /* Landing */
    'lp.eyebrow': 'Malaysia-first · AI operations',
    'lp.headline': 'Your business, increasingly run by AI',
    'lp.lede':
      'Tell AISAR what you do. It works out your industry, builds an AI team around it, and starts handling the routine work — customer questions, bookings, follow-ups, reports.',
    'lp.cta.primary': 'Tell us about your business',
    'lp.cta.secondary': 'See the dashboard',
    'lp.industries': '{n} industries, no setup forms',
    'lp.potential': '{n}% potential',

    /* Onboarding */
    'ob.step': 'Step {n} of 2',
    'ob.ask.head': 'What do you do?',
    'ob.ask.body':
      'One sentence is enough. AISAR works out the rest — no forms, no category picker.',
    'ob.ask.placeholder': 'e.g. I run a grocery shop in Kuala Lumpur',
    'ob.ask.cta': 'Scan my business →',
    'ob.ask.examples': 'Or try one of these',
    'ob.confirm.head': 'Did I get that right?',
    'ob.confirm.matched': 'matched · {n}',
    'ob.confirm.guess': 'best guess',
    'ob.confirm.opportunities': '{n} automation opportunities found',
    'ob.confirm.yes': 'Yes — activate AISAR →',
    'ob.confirm.no': 'Not quite, let me rephrase',

    /* Setup */
    'su.eyebrow': 'Setting up',
    'su.head': 'Getting your AI team ready',
    'su.body': 'Three of these run themselves. Two need one tap from you.',
    'su.done': 'Everything is connected. Your AI team is live and will start working for you.',
    'su.count': '{done} of {total}',
    'su.needyou': '{done} of {total} · {n} need you',
    'su.complete': 'complete ✓',
    'su.connect': 'Connect',
    'su.open': 'Open my dashboard →',
    'su.skip': 'Skip for now →',
    'su.state.done': 'done',
    'su.state.queued': 'queued',
    'su.state.linking': 'linking…',
    'su.state.waiting': 'waiting for you',
    'su.step1': 'Building your Business Profile',
    'su.step1.done': 'profile built',
    'su.step2': 'Configuring your AI team',
    'su.step2.done': 'team configured',
    'su.step3': 'Training on your business',
    'su.step3.done': 'training complete',
    'su.step4': 'Connect WhatsApp',
    'su.step5': 'Connect Calendar',
    'su.step45.done': 'connected',

    /* Dashboard */
    'db.handled': '{n} handled automatically',
    'db.disconnect': 'Disconnect',
    'db.theme.toLight': 'Switch to light theme',
    'db.theme.toDark': 'Switch to dark theme',
    'db.light': 'Light',
    'db.dark': 'Dark',
  },

  bm: {
    /* Landing */
    'lp.eyebrow': 'Malaysia dahulu · Operasi AI',
    'lp.headline': 'Perniagaan anda, semakin dikendalikan AI',
    'lp.lede':
      'Beritahu AISAR apa yang anda buat. Ia kenal pasti industri anda, bina pasukan AI untuknya, dan mula uruskan kerja rutin — soalan pelanggan, tempahan, susulan, laporan.',
    'lp.cta.primary': 'Ceritakan tentang perniagaan anda',
    'lp.cta.secondary': 'Lihat dashboard',
    'lp.industries': '{n} industri, tiada borang setup',
    'lp.potential': 'potensi {n}%',

    /* Onboarding */
    'ob.step': 'Langkah {n} daripada 2',
    'ob.ask.head': 'Apa perniagaan anda?',
    'ob.ask.body':
      'Satu ayat sudah memadai. AISAR uruskan selebihnya — tiada borang, tiada senarai kategori.',
    'ob.ask.placeholder': 'cth. Saya ada kedai runcit di Kuala Lumpur',
    'ob.ask.cta': 'Imbas perniagaan saya →',
    'ob.ask.examples': 'Atau cuba salah satu ini',
    'ob.confirm.head': 'Betul ke maklumat ini?',
    'ob.confirm.matched': 'padan · {n}',
    'ob.confirm.guess': 'anggaran terbaik',
    'ob.confirm.opportunities': '{n} peluang automasi dijumpai',
    'ob.confirm.yes': 'Ya — aktifkan AISAR →',
    'ob.confirm.no': 'Tak tepat, biar saya tulis semula',

    /* Setup */
    'su.eyebrow': 'Sedang disediakan',
    'su.head': 'Menyiapkan pasukan AI anda',
    'su.body': 'Tiga langkah ini berjalan sendiri. Dua perlukan satu ketikan daripada anda.',
    'su.done': 'Semua telah disambung. Pasukan AI anda aktif dan akan mula bekerja untuk anda.',
    'su.count': '{done} daripada {total}',
    'su.needyou': '{done} daripada {total} · {n} perlukan anda',
    'su.complete': 'selesai ✓',
    'su.connect': 'Sambung',
    'su.open': 'Buka dashboard saya →',
    'su.skip': 'Nanti dulu →',
    'su.state.done': 'selesai',
    'su.state.queued': 'menunggu giliran',
    'su.state.linking': 'menyambung…',
    'su.state.waiting': 'menunggu anda',
    'su.step1': 'Membina Profil Perniagaan anda',
    'su.step1.done': 'profil siap',
    'su.step2': 'Menyusun pasukan AI anda',
    'su.step2.done': 'pasukan siap',
    'su.step3': 'Melatih pada perniagaan anda',
    'su.step3.done': 'latihan selesai',
    'su.step4': 'Sambung WhatsApp',
    'su.step5': 'Sambung Kalendar',
    'su.step45.done': 'disambung',

    /* Dashboard */
    'db.handled': '{n} diselesaikan automatik',
    'db.disconnect': 'Putuskan',
    'db.theme.toLight': 'Tukar ke tema cerah',
    'db.theme.toDark': 'Tukar ke tema gelap',
    'db.light': 'Cerah',
    'db.dark': 'Gelap',
  },
};
