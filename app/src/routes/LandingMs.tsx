import { Link } from 'react-router';
import { ArrowUpRight, Check, Plus, Prohibit, ShieldCheck } from '@phosphor-icons/react';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { JenteraMark } from '@/components/JenteraMark';
import {
  CHROME_LABELS_MS,
  CONTROL_MS,
  EVERYDAY_WORK_MS,
  FAQS_MS,
  FOOTER_MS,
  FOOTNOTE_MS,
  HERO_MS,
  LIMITS_MS,
  NAV_LINKS_MS,
  OFFER_MS,
  PLAN_BENEFITS_MS,
  SETUP_STEPS_MS,
} from '@/lib/landing-content-ms';
import { launchOffer } from '@/lib/launch-offer';

/* The Bahasa Malaysia landing page. Served at /ms and paired with / by
   hreflang, so a reader who searches in Malay lands on Malay copy instead
   of an English page with a translate banner over it. */
export default function LandingMs() {
  const saving = (launchOffer.renewalPrice - launchOffer.monthlyPrice) * launchOffer.introductoryMonths;

  return (
    <div className="marketing-page min-h-dvh bg-bg text-text" lang="ms">
      <LandingHeader
        navLinks={NAV_LINKS_MS}
        primaryAction={{ href: '/signin?mode=signup', label: 'Mula sekarang' }}
        labels={CHROME_LABELS_MS}
      />
      <main id="main-content">
        <section className="lp-container lp-section">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> {HERO_MS.eyebrow}</span>
            <h1>
              {HERO_MS.headline.lead}
              <br />
              <span className="text-brand">
                {HERO_MS.headline.preposition} <span aria-hidden="true">{HERO_MS.headline.flag}</span>{' '}
                {HERO_MS.headline.country} {HERO_MS.headline.audience}
              </span>
            </h1>
            <p>{HERO_MS.detail}</p>
            <div className="lp-hero-offer">
              <Link to={launchOffer.href} className="btn btn-primary">
                {HERO_MS.ctaPrimary} <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
              <a href="#kerja" className="lp-text-link">{HERO_MS.ctaSecondary}</a>
            </div>
            {/* The language pair, stated in the page as well as in hreflang.
                A reader who wants the English wording should not have to
                guess the URL. */}
            <p className="mp-lang-switch">
              <Link to={FOOTNOTE_MS.englishHref} hrefLang="en-MY" className="lp-text-link">
                {FOOTNOTE_MS.englishLabel} <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </p>
          </div>
        </section>

        <section id="kerja" className="lp-container lp-section" aria-labelledby="ms-kerja">
          <div className="lp-section-heading">
            <h2 id="ms-kerja">Kerja harian yang<br /><span className="text-brand">boleh anda serahkan.</span></h2>
            <p>
              Ini kerja yang perlu disiapkan dengan fail atau akses yang anda sediakan, bukan integrasi satu
              klik. Semak mesej yang menghadap pelanggan dan dokumen kewangan sebelum menghantarnya.
            </p>
          </div>
          <div className="lp-job-grid">
            {EVERYDAY_WORK_MS.map((work) => (
              <article key={work.number} className="lp-work-row">
                <span className="lp-row-number">{work.number}</span>
                <div className="lp-work-title">
                  <div>
                    <span className="lp-work-kicker">{work.kicker}</span>
                    <h3>{work.title}</h3>
                  </div>
                </div>
                <div className="lp-work-description"><p>{work.body}</p></div>
                <p className="lp-job-example">{work.example}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-container lp-section" aria-labelledby="ms-mula">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> Tiga langkah</span>
            <h2 id="ms-mula">Cara ia bermula.</h2>
          </div>
          <ol className="mp-steps">
            {SETUP_STEPS_MS.map((step) => (
              <li key={step.number}>
                <span className="lp-row-number">{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-container lp-section" aria-labelledby="ms-kawalan">
          <div className="lp-section-heading">
            <ShieldCheck size={28} weight="duotone" className="text-brand" aria-hidden="true" />
            <h2 id="ms-kawalan">Anda yang memegang kawalan.</h2>
          </div>
          <ul className="mp-related">
            {CONTROL_MS.map((item) => (
              <li key={item}><Check size={18} weight="bold" aria-hidden="true" className="text-brand" /> <span>{item}</span></li>
            ))}
          </ul>
        </section>

        <section className="lp-container lp-section lp-pricing" aria-labelledby="ms-harga">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> Tawaran pengguna awal</span>
            <h2 id="ms-harga">Staf AI anda.<br /><span className="text-brand">Harga pelancaran istimewa.</span></h2>
            <p>
              Dibina di Malaysia, untuk pasukan kecil yang memikul terlalu banyak tugas dan pemilik yang masih
              buat semuanya sendiri.
            </p>
            <p>{OFFER_MS.availability}</p>
          </div>
          <div className="lp-launch-plan">
            <span className="lp-launch-badge">Tawaran pelancaran</span>
            <h3>Staf AI pertama anda</h3>
            <p className="lp-launch-price"><span>RM{launchOffer.monthlyPrice}</span><span>/bulan</span></p>
            <p className="lp-launch-renewal">
              Untuk {launchOffer.introductoryMonths} bulan pertama. Kemudian RM{launchOffer.renewalPrice}/bulan mulai bulan ke-4.
            </p>
            <p className="lp-launch-saving">
              Jimat RM{saving} sepanjang {launchOffer.introductoryMonths} bulan pertama berbanding harga bulanan biasa.
            </p>
            <ul aria-label="Apa yang disertakan">
              {PLAN_BENEFITS_MS.map((feature) => <li key={feature}><Check size={18} aria-hidden="true" /><span>{feature}</span></li>)}
            </ul>
            <Link to={launchOffer.href} className="btn btn-primary">
              {HERO_MS.ctaPrimary} <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <p className="lp-launch-terms">{OFFER_MS.terms}</p>
          </div>
        </section>

        <section className="lp-container lp-section mp-limits" aria-labelledby="ms-had">
          <div className="lp-section-heading">
            <h2 id="ms-had">Apa yang belum tersedia.</h2>
            <p>Baca ini dahulu supaya tiada yang mengejutkan kemudian.</p>
          </div>
          <ul>
            {LIMITS_MS.map((limit) => (
              <li key={limit}><Prohibit size={18} weight="bold" aria-hidden="true" /><span>{limit}</span></li>
            ))}
          </ul>
        </section>

        <section className="lp-container lp-section lp-faq-section" aria-labelledby="ms-soalan">
          <div className="lp-section-heading">
            <span className="lp-eyebrow"><span className="lp-dot" /> Soalan lazim</span>
            <h2 id="ms-soalan">Sebelum anda mula.</h2>
            <a href="mailto:hello@kitakodventures.com" className="lp-text-link">
              Bercakap dengan seseorang <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          <div className="lp-faq-list">
            {FAQS_MS.map((faq) => (
              <details key={faq.question}>
                <summary>{faq.question}<Plus size={17} aria-hidden="true" /></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-closing">
          <div className="lp-container">
            <JenteraMark size={64} className="closing-mark" />
            <span className="lp-closing-label">Dibina di Malaysia. Untuk perniagaan yang anda sudah jalankan.</span>
            <h2>Apa yang masih anda buat secara manual?<br /><span>Serahkan kepada Jentera.</span></h2>
            <Link to={launchOffer.href} className="btn btn-primary">
              {HERO_MS.ctaPrimary} <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            <p>RM{launchOffer.monthlyPrice}/bulan untuk {launchOffer.introductoryMonths} bulan pertama, kemudian RM{launchOffer.renewalPrice}/bulan.</p>
          </div>
        </section>
      </main>
      <LandingFooter
        tagline={FOOTER_MS.tagline}
        links={FOOTER_MS.links}
        label={FOOTER_MS.label}
        brandLabel={CHROME_LABELS_MS.brand}
        contactLabel={OFFER_MS.contact}
      />
    </div>
  );
}
