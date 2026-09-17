/* ============================================================
   Salinan Bahasa Malaysia untuk /ms.

   Written as its own page, not a phrase-by-phrase translation of
   landing-content.ts. Every claim here must match a claim the English
   page makes: prices, limits and what is and is not available are the
   same product, and a translation that softens a limit is a different
   promise in a language the reviewer may not read.

   Numbers come from launch-offer.ts so the two pages cannot drift.
   ============================================================ */

import { launchOffer } from '@/lib/launch-offer';

export const HERO_MS = {
  eyebrow: 'Akses awal · Dibina di Malaysia',
  headline: {
    lead: 'Staf AI yang bekerja 24/7',
    preposition: 'untuk',
    flag: '🇲🇾',
    country: 'perniagaan',
    audience: 'Malaysia.',
  },
  detail:
    'Serahkan sahaja kerja kepada Jentera. Kajian pasaran, kerja pentadbiran, laporan dan draf susulan '
    + 'pelanggan — staf AI anda ada komputernya sendiri dan boleh terus bekerja semasa anda tiada.',
  ctaPrimary: 'Cuba staf AI saya — 10 chat percuma',
  ctaSecondary: 'Lihat cara ia membantu',
} as const;

export const EVERYDAY_WORK_MS = [
  {
    number: '01',
    kicker: 'Pertanyaan dan susulan',
    title: 'Pastikan setiap pertanyaan bergerak.',
    body:
      'Kongsi senarai pertanyaan dan butiran perniagaan anda. Jentera boleh menyusun prospek, menandakan '
      + 'siapa yang perlu diberi perhatian dan menyediakan mesej susulan untuk semakan anda.',
    example: '“Susun pertanyaan ini dan sediakan draf susulan untuk saya semak.”',
  },
  {
    number: '02',
    kicker: 'Penyediaan pemasaran',
    title: 'Siapkan kandungan minggu hadapan.',
    body:
      'Tukar ringkasan, butiran produk dan keputusan lalu anda menjadi rancangan kandungan dan draf hantaran. '
      + 'Semak dan terbitkan melalui saluran anda sendiri.',
    example: '“Guna senarai produk ini untuk sediakan lima hantaran untuk minggu depan.”',
  },
  {
    number: '03',
    kicker: 'Penyediaan sebut harga',
    title: 'Dari pertanyaan ke sebut harga.',
    body:
      'Kongsi keperluan pelanggan, senarai harga dan templat anda. Jentera boleh menyediakan fail sebut harga '
      + 'dan menandakan butiran yang tertinggal sebelum anda menghantarnya.',
    example: '“Sediakan sebut harga guna templat saya dan tandakan apa yang kurang.”',
  },
  {
    number: '04',
    kicker: 'Kajian jualan',
    title: 'Cari peluang seterusnya.',
    body:
      'Kaji laman web perniagaan yang terbuka kepada umum, banding prospek dan susun penemuan menjadi senarai '
      + 'prospek. Semak sumbernya sebelum anda menghubungi mereka.',
    example: '“Cari 30 bakal pelanggan perniagaan di KL dan masukkan dalam spreadsheet.”',
  },
  {
    number: '05',
    kicker: 'Pemantauan laman web',
    title: 'Pantau harga pembekal.',
    body:
      'Banding halaman pembekal yang boleh diakses umum dengan harga yang anda simpan. Dapat laporan jelas '
      + 'tentang apa yang berubah dan apa yang perlu disemak.',
    example: '“Banding harga pembekal ini dengan senarai minggu lepas.”',
  },
  {
    number: '06',
    kicker: 'Fail dan rekod',
    title: 'Kemas kini fail kerja anda.',
    body:
      'Muat naik fail pesanan atau spreadsheet anda. Jentera boleh menyusun maklumat itu dan menyediakan '
      + 'penjejak pesanan yang dikemas kini dalam ruang kerjanya untuk anda semak.',
    example: '“Baca fail pesanan ini dan kemas kini penjejak pesanan saya.”',
  },
  {
    number: '07',
    kicker: 'Laporan perniagaan',
    title: 'Tukar angka menjadi laporan.',
    body:
      'Kongsi angka jualan, pesanan atau fail stok anda. Jentera boleh meringkaskan angka itu, menonjolkan '
      + 'perkara luar biasa dan menyediakan laporan anda yang seterusnya.',
    example: '“Guna spreadsheet ini untuk sediakan laporan jualan mingguan saya.”',
  },
  {
    number: '08',
    kicker: 'Proses anda sendiri',
    title: 'Jalankan SOP anda.',
    body:
      'Kongsi senarai semak, bahan masukan dan rupa hasil yang baik. Minta Jentera ikut proses yang sama '
      + 'untuk kerja seterusnya, kemudian semak hasilnya.',
    example: '“Ikut senarai semak laporan ini dan simpan hasilnya untuk semakan saya.”',
  },
] as const;

export const SETUP_STEPS_MS = [
  { number: '01', title: 'Terangkan.', body: 'Satu ayat tentang apa yang perniagaan anda lakukan, dalam Bahasa Malaysia atau Bahasa Inggeris.' },
  { number: '02', title: 'Semak butirannya.', body: 'Semak apa yang Jentera faham tentang perniagaan anda dan betulkan apa-apa yang perlu diubah.' },
  { number: '03', title: 'Beri ia kerja.', body: 'Minta sesuatu yang berguna, semak hasilnya, dan tentukan langkah seterusnya.' },
] as const;

export const CONTROL_MS = [
  'Jentera bekerja pada komputernya sendiri. Apa-apa yang keluar daripada komputer itu menunggu keputusan anda.',
  'Draf yang menghadap pelanggan adalah untuk semakan anda. Anda yang menghantarnya melalui saluran anda sendiri.',
  'Chat Telegram peribadi anda adalah untuk anda, si pemilik — bukan untuk pelanggan anda.',
  'Sambungan yang belum kami bina ditandakan sebagai dirancang, bukan dijual sebagai ciri.',
] as const;

export const LIMITS_MS = [
  'Penggunaan AI tidak tanpa had. Penggunaan standard disertakan, tertakluk kepada had penggunaan berpatutan.',
  'Satu tugasan komputer pada satu masa. Pelan ini termasuk satu komputer khusus, bukan beberapa staf AI serentak.',
  'Automasi WhatsApp untuk pelanggan belum tersedia. Sokongan WhatsApp adalah bantuan manusia, bukan penyambung.',
  'E-invois belum tersedia. Jentera tidak menyerahkan e-invois atau bersambung dengan MyInvois hari ini.',
  'Rutin berjadual masih dalam perintis terhad dan belum dibuka untuk semua akaun.',
] as const;

export const FAQS_MS = [
  {
    question: 'Boleh saya cuba dahulu sebelum bayar?',
    answer:
      'Boleh. Daftar dan sahkan akaun anda untuk meneroka platform serta menghantar 10 permintaan chat '
      + 'percuma. Peruntukan itu dikongsi merentas semua chat dan perniagaan anda, bukan 10 setiap '
      + `perbualan. Selepas itu, naik taraf untuk terus menghantar kerja. Pelan pelancaran ialah RM${launchOffer.monthlyPrice}/bulan `
      + `untuk ${launchOffer.introductoryMonths} bulan pertama, kemudian RM${launchOffer.renewalPrice}/bulan.`,
  },
  {
    question: 'Bagaimana tawaran pelancaran berfungsi?',
    answer:
      `RM${launchOffer.monthlyPrice}/bulan untuk ${launchOffer.introductoryMonths} tempoh bil bulanan pertama, `
      + `kemudian RM${launchOffer.renewalPrice}/bulan mulai bulan ke-4. Pelan anda termasuk staf AI, komputer `
      + 'khususnya sendiri dan penggunaan AI tertakluk kepada had penggunaan berpatutan. Pengguna awal '
      + 'berbayar juga mendapat sokongan WhatsApp peribadi dan akses terus kepada pengasas. Semak had '
      + 'penggunaan dan terma pembatalan sebelum melanggan.',
  },
  {
    question: 'Perlukah saya mahir teknologi?',
    answer:
      'Tidak. Terangkan kerja itu seperti anda terangkan kepada seorang pekerja, kongsikan fail atau butiran '
      + 'yang diperlukan, dan semak hasilnya. Tiada model, kunci API atau pelayan untuk anda konfigurasi. '
      + 'Sesetengah laman dan alat masih memerlukan log masuk atau kebenaran anda.',
  },
  {
    question: 'Adakah ia menghantar mesej kepada pelanggan saya?',
    answer:
      'Tidak. Chat Telegram peribadi yang anda pasangkan adalah untuk anda, si pemilik. Draf susulan yang '
      + 'disebut di halaman ini adalah untuk semakan anda dan dihantar melalui saluran anda sendiri. '
      + 'Automasi WhatsApp untuk pelanggan belum tersedia.',
  },
  {
    question: 'Adakah Jentera mengurus e-invois?',
    answer:
      'Belum. Perakaunan dan pematuhan tempatan adalah sebahagian daripada sebab kami membina untuk rantau '
      + 'ini, tetapi Jentera tidak menyerahkan e-invois atau bersambung dengan MyInvois pada masa ini.',
  },
  {
    question: 'Apakah hubungan antara AISAR dan Jentera?',
    answer:
      'AISAR membina ejen AI yang menjalankan perniagaan Asia Tenggara. Jentera ialah produk yang anda guna '
      + 'untuk menggerakkan ejen itu. Teknologi di sebaliknya kekal di belakang tabir.',
  },
] as const;

export const FOOTNOTE_MS = {
  englishLabel: 'Read this page in English',
  englishHref: '/',
} as const;

/* Chrome for /ms. An English header over Malay copy reads as a machine
   translation of someone else's page, which is exactly the impression the
   page exists to avoid. */
export const NAV_LINKS_MS = [
  { href: '#kerja', label: 'Apa ia buat' },
  { href: '/connect', label: 'Sambungan' },
  { href: '/pricing', label: 'Harga' },
  { href: '/about', label: 'Tentang kami' },
] as const;

export const FOOTER_MS = {
  tagline: 'Dibina oleh AISAR untuk perniagaan Malaysia.',
  label: 'Pautan syarikat',
  links: [
    { href: '/pricing', label: 'Harga' },
    { href: '/connect', label: 'Sambungan' },
    { href: '/about', label: 'Tentang kami' },
    { href: '/privacy', label: 'Privasi' },
    { href: '/terms', label: 'Terma' },
    { href: '/', label: 'English' },
    { href: 'https://aisar.ai', label: 'AISAR ↗' },
  ],
} as const;
