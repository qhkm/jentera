import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';

interface Section {
  title: string;
  body: ReactNode;
}

const CONTACT = 'hello@kitakodventures.com';

const ENGLISH: Section[] = [
  {
    title: '1. Who these terms apply to',
    body: <><p>These terms govern your use of Jentera’s website, business workspace and mobile apps, operated by Kitakod Ventures (SSM 202203226187 (003430123-M)). By using Jentera, you agree to these terms. If you use it for a business, you must have authority to act for that business.</p><p>Jentera is intended for business users aged 18 or older. If you do not agree to these terms, do not use the service.</p></>,
  },
  {
    title: '2. Your account and workspace',
    body: <p>Provide accurate account information, protect your sign-in details and give team members only the access they need. You are responsible for instructions and approvals you are authorised to give. Tell us promptly at <a href={`mailto:${CONTACT}`}>{CONTACT}</a> if you suspect unauthorised access. We also have responsibilities to secure and operate the service; these terms do not transfer those responsibilities to you.</p>,
  },
  {
    title: '3. What Jentera does—and its limits',
    body: <><p>Jentera uses AI and connected tools to answer questions, prepare content and carry out supported business tasks. Availability depends on your access, usage limits, connected services and permissions. Features described as planned or coming soon are not promises of current availability.</p><p>AI outputs may be inaccurate, incomplete or unsuitable. Review important work before relying on it. Jentera is not a substitute for qualified medical, legal, financial or other professional advice, and is not an emergency service. Reminders and background tasks may be delayed and must not be your only safeguard for time-critical or safety-critical matters.</p></>,
  },
  {
    title: '4. Connections, approvals and browser control',
    body: <><p>Connect only accounts and services you have permission to use. Authorising a connection grants the permissions shown by that provider; it does not approve every possible action. Read each approval request and check its destination, content, timing and consequences before confirming. Current Google Calendar event creation requires a separate owner approval.</p><p>Not every browser interaction or external action has a separate approval prompt. Do not assume Jentera can detect every sensitive action or undo work already completed. When you take control of the business browser, agent browser control stays paused until you explicitly hand it back; closing the window does not hand it back. Enter passwords only on a trusted provider page, not in Chat.</p><p>Third-party services have their own terms and may restrict or revoke access. Disconnecting a service stops future use through that connection but does not undo an event, message or other action already completed.</p></>,
  },
  {
    title: '5. Your content and personal data',
    body: <><p>You retain any rights you have in the content you provide. You give us permission to process, store and transmit that content only as needed to provide and secure Jentera, perform your instructions and meet legal obligations, as described in our <Link to="/privacy">privacy notice</Link>. This includes using the relevant AI and infrastructure providers.</p><p>Submit only content you are authorised to use, and provide any notices or permissions needed for other people’s data. Do not upload unnecessary sensitive information. AI-generated outputs may resemble other outputs and may not be unique or eligible for intellectual-property protection; check third-party rights before publishing or distributing them.</p></>,
  },
  {
    title: '6. Acceptable use',
    body: <p>Do not use Jentera for unlawful activity, fraud, harassment, infringement, unauthorised account access or harmful interference with a service. Do not bypass security, tenant isolation, approvals or usage limits; extract other users’ data; or upload malicious material intended to compromise the service. Legitimate security research must not access another person’s data or disrupt their workspace; contact us to report a vulnerability.</p>,
  },
  {
    title: '7. Trials, usage and payments',
    body: <p>Trials and access may have time or usage limits. Any paid offer must state its price, billing period, included usage and applicable cancellation or renewal conditions before you purchase it. We will not treat a chat instruction or a connected account as permission to charge you. Refunds and cancellations remain subject to the offer you accepted and any rights required by applicable law. Contact us with billing questions.</p>,
  },
  {
    title: '8. Suspension, leaving and saved work',
    body: <p>We may restrict access where reasonably necessary to address abuse, a security risk, a legal obligation or a material breach of these terms. Where appropriate and safe, we will explain the restriction and provide a way to contact us. You can stop using Jentera, disconnect services and request account closure or deletion at <a href={`mailto:${CONTACT}?subject=Jentera%20account%20request`}>{CONTACT}</a>. Keep copies of important outputs. Data retention and any legally required exceptions are explained in the privacy notice; account closure does not itself cancel a separate agreement you have with another provider.</p>,
  },
  {
    title: '9. Availability and responsibility',
    body: <><p>To the extent permitted by applicable law, Jentera is provided on an “as available” basis without a guarantee of uninterrupted access, error-free AI output or a particular business result. We use safeguards, but cannot promise that every security incident, provider outage or user error will be prevented.</p><p>We remain responsible where applicable law makes us responsible. Nothing in these terms excludes or limits liability that cannot lawfully be excluded or limited, removes mandatory consumer or data-protection rights, or excuses unauthorised use of your data. Your own business decisions and third-party services remain outside our control, but that does not remove our legal duties.</p></>,
  },
  {
    title: '10. Changes, law and contact',
    body: <><p>We may update these terms as the service changes. We will publish the revised date here and give additional notice where a material change or applicable law requires it. These terms are governed by Malaysian law, subject to any mandatory protections that apply to you in your jurisdiction.</p><p>For questions, complaints or a request to resolve a dispute, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. These terms do not require you to waive access to a regulator or a court where the law gives you that right.</p></>,
  },
];

const MALAY: Section[] = [
  {
    title: '1. Pihak yang tertakluk pada terma ini',
    body: <><p>Terma ini mengawal penggunaan laman web, ruang kerja perniagaan dan aplikasi mudah alih Jentera, yang dikendalikan oleh Kitakod Ventures (SSM 202203226187 (003430123-M)). Dengan menggunakan Jentera, anda bersetuju dengan terma ini. Jika anda menggunakannya bagi pihak perniagaan, anda mesti mempunyai kuasa untuk bertindak bagi perniagaan tersebut.</p><p>Jentera ditujukan kepada pengguna perniagaan berumur 18 tahun ke atas. Jika anda tidak bersetuju dengan terma ini, jangan gunakan perkhidmatan.</p></>,
  },
  {
    title: '2. Akaun dan ruang kerja anda',
    body: <p>Berikan maklumat akaun yang tepat, lindungi butiran log masuk dan berikan ahli pasukan hanya akses yang diperlukan. Anda bertanggungjawab terhadap arahan dan kelulusan yang anda diberi kuasa untuk berikan. Maklumkan kami segera di <a href={`mailto:${CONTACT}`}>{CONTACT}</a> jika anda mengesyaki akses tanpa kebenaran. Kami juga bertanggungjawab untuk melindungi dan mengendalikan perkhidmatan; terma ini tidak memindahkan tanggungjawab tersebut kepada anda.</p>,
  },
  {
    title: '3. Fungsi Jentera—dan batasannya',
    body: <><p>Jentera menggunakan AI dan alat yang disambungkan untuk menjawab soalan, menyediakan kandungan dan menjalankan tugasan perniagaan yang disokong. Ketersediaan bergantung pada akses, had penggunaan, perkhidmatan yang disambungkan dan kebenaran anda. Ciri yang diterangkan sebagai dirancang atau akan datang bukan janji bahawa ciri tersebut tersedia sekarang.</p><p>Output AI mungkin tidak tepat, tidak lengkap atau tidak sesuai. Semak kerja penting sebelum bergantung padanya. Jentera bukan pengganti nasihat perubatan, undang-undang, kewangan atau profesional lain yang berkelayakan, dan bukan perkhidmatan kecemasan. Peringatan dan tugasan latar belakang mungkin lewat dan tidak boleh menjadi satu-satunya perlindungan anda bagi perkara yang kritikal dari segi masa atau keselamatan.</p></>,
  },
  {
    title: '4. Sambungan, kelulusan dan kawalan pelayar',
    body: <><p>Sambungkan hanya akaun dan perkhidmatan yang anda dibenarkan gunakan. Kebenaran sambungan memberikan izin yang dipaparkan oleh penyedia tersebut; ia tidak meluluskan semua tindakan yang mungkin dilakukan. Baca setiap permintaan kelulusan dan semak destinasi, kandungan, masa serta akibatnya sebelum mengesahkan. Penciptaan acara Google Calendar semasa memerlukan kelulusan pemilik yang berasingan.</p><p>Bukan setiap interaksi pelayar atau tindakan luar mempunyai permintaan kelulusan berasingan. Jangan anggap Jentera boleh mengesan setiap tindakan sensitif atau membatalkan kerja yang telah selesai. Apabila anda mengambil kawalan pelayar perniagaan, kawalan pelayar oleh ejen kekal dijeda sehingga anda menyerahkannya kembali secara jelas; menutup tetingkap tidak menyerahkan kawalan. Masukkan kata laluan hanya pada halaman penyedia yang dipercayai, bukan dalam Chat.</p><p>Perkhidmatan pihak ketiga mempunyai terma sendiri dan mungkin mengehadkan atau menarik balik akses. Memutuskan sambungan menghentikan penggunaan seterusnya melalui sambungan itu tetapi tidak membatalkan acara, mesej atau tindakan lain yang telah selesai.</p></>,
  },
  {
    title: '5. Kandungan dan data peribadi anda',
    body: <><p>Anda mengekalkan apa-apa hak yang anda miliki dalam kandungan yang diberikan. Anda membenarkan kami memproses, menyimpan dan menghantar kandungan tersebut hanya setakat yang diperlukan untuk menyediakan dan melindungi Jentera, melaksanakan arahan anda dan memenuhi kewajipan undang-undang, seperti diterangkan dalam <Link to="/privacy">notis privasi</Link> kami. Ini termasuk penggunaan penyedia AI dan infrastruktur yang berkaitan.</p><p>Serahkan hanya kandungan yang anda dibenarkan gunakan, dan berikan notis atau dapatkan kebenaran yang diperlukan untuk data orang lain. Jangan muat naik maklumat sensitif yang tidak diperlukan. Output AI mungkin menyerupai output lain dan mungkin tidak unik atau layak mendapat perlindungan harta intelek; semak hak pihak ketiga sebelum menerbitkan atau mengedarkannya.</p></>,
  },
  {
    title: '6. Penggunaan yang dibenarkan',
    body: <p>Jangan gunakan Jentera untuk aktiviti menyalahi undang-undang, penipuan, gangguan, pelanggaran hak, akses akaun tanpa kebenaran atau gangguan berbahaya terhadap sesuatu perkhidmatan. Jangan memintas keselamatan, pengasingan penyewa, kelulusan atau had penggunaan; mengambil data pengguna lain; atau memuat naik bahan berniat jahat untuk menjejaskan perkhidmatan. Penyelidikan keselamatan yang sah tidak boleh mengakses data orang lain atau mengganggu ruang kerja mereka; hubungi kami untuk melaporkan kelemahan keselamatan.</p>,
  },
  {
    title: '7. Percubaan, penggunaan dan pembayaran',
    body: <p>Percubaan dan akses mungkin mempunyai had masa atau penggunaan. Sebarang tawaran berbayar mesti menyatakan harga, tempoh bil, penggunaan yang disertakan serta syarat pembatalan atau pembaharuan yang terpakai sebelum pembelian. Kami tidak menganggap arahan chat atau akaun yang disambungkan sebagai kebenaran untuk mengenakan caj. Bayaran balik dan pembatalan tertakluk pada tawaran yang anda terima serta hak yang diwajibkan undang-undang. Hubungi kami untuk pertanyaan bil.</p>,
  },
  {
    title: '8. Penggantungan, berhenti dan kerja tersimpan',
    body: <p>Kami mungkin mengehadkan akses apabila munasabah untuk menangani penyalahgunaan, risiko keselamatan, kewajipan undang-undang atau pelanggaran penting terma ini. Jika sesuai dan selamat, kami akan menerangkan sekatan tersebut dan menyediakan cara untuk menghubungi kami. Anda boleh berhenti menggunakan Jentera, memutuskan sambungan perkhidmatan dan meminta penutupan akaun atau pemadaman di <a href={`mailto:${CONTACT}?subject=Permintaan%20akaun%20Jentera`}>{CONTACT}</a>. Simpan salinan output penting. Tempoh penyimpanan data dan pengecualian yang diwajibkan undang-undang diterangkan dalam notis privasi; penutupan akaun tidak dengan sendirinya membatalkan perjanjian berasingan dengan penyedia lain.</p>,
  },
  {
    title: '9. Ketersediaan dan tanggungjawab',
    body: <><p>Setakat yang dibenarkan undang-undang, Jentera disediakan atas dasar “mengikut ketersediaan” tanpa jaminan akses tanpa gangguan, output AI bebas ralat atau hasil perniagaan tertentu. Kami menggunakan perlindungan, tetapi tidak boleh menjanjikan bahawa setiap insiden keselamatan, gangguan penyedia atau kesilapan pengguna akan dicegah.</p><p>Kami kekal bertanggungjawab apabila undang-undang menetapkan tanggungjawab kami. Tiada apa-apa dalam terma ini mengecualikan atau mengehadkan liabiliti yang tidak boleh dikecualikan atau dihadkan secara sah, menghapuskan hak pengguna atau perlindungan data yang wajib, atau membenarkan penggunaan data anda tanpa kebenaran. Keputusan perniagaan anda sendiri dan perkhidmatan pihak ketiga berada di luar kawalan kami, tetapi itu tidak menghapuskan kewajipan undang-undang kami.</p></>,
  },
  {
    title: '10. Perubahan, undang-undang dan hubungan',
    body: <><p>Kami mungkin mengemas kini terma ini apabila perkhidmatan berubah. Kami akan menerbitkan tarikh pindaan di sini dan memberikan notis tambahan jika perubahan penting atau undang-undang memerlukannya. Terma ini ditadbir oleh undang-undang Malaysia, tertakluk pada perlindungan mandatori yang terpakai kepada anda dalam bidang kuasa anda.</p><p>Untuk pertanyaan, aduan atau permintaan penyelesaian pertikaian, e-mel <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Terma ini tidak mewajibkan anda mengetepikan akses kepada pengawal selia atau mahkamah apabila undang-undang memberikan hak tersebut.</p></>,
  },
];

export default function Terms() {
  const [malay, setMalay] = useState(false);

  useEffect(() => {
    document.documentElement.lang = malay ? 'ms' : 'en';
    return () => { document.documentElement.lang = 'en'; };
  }, [malay]);

  return (
    <div className="marketing-page privacy-page min-h-dvh bg-bg text-text">
      <LandingHeader navLinks={[{ href: '/', label: malay ? 'Laman utama' : 'Home' }, { href: '/privacy', label: malay ? 'Privasi' : 'Privacy' }]} />
      <main id="main-content" className="lp-container privacy-main" lang={malay ? 'ms' : 'en'}>
        <header className="privacy-hero">
          <p className="lp-eyebrow">{malay ? 'Menggunakan Jentera' : 'Using Jentera'}</p>
          <h1>{malay ? 'Terma perkhidmatan' : 'Terms of service'}</h1>
          <p className="privacy-intro">{malay ? 'Terma yang jelas untuk akaun, kerja AI, perkhidmatan yang disambungkan dan kawalan anda.' : 'Clear terms for your account, AI-assisted work, connected services and your control.'}</p>
          <p className="privacy-date">{malay ? 'Berkuat kuasa: 16 September 2026' : 'Effective: 16 September 2026'}</p>
          <div className="privacy-language" role="group" aria-label={malay ? 'Bahasa terma perkhidmatan' : 'Terms of service language'}>
            <button type="button" aria-pressed={!malay} onClick={() => setMalay(false)}>English</button>
            <button type="button" aria-pressed={malay} onClick={() => setMalay(true)}>Bahasa Malaysia</button>
          </div>
        </header>
        <article className="privacy-notice">
          {(malay ? MALAY : ENGLISH).map((section) => <section key={section.title}><h2>{section.title}</h2>{section.body}</section>)}
        </article>
      </main>
      <LandingFooter tagline={malay ? 'Dibina oleh AISAR untuk perniagaan Malaysia.' : undefined} />
    </div>
  );
}
