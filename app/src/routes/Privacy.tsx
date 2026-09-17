import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LandingFooter, LandingHeader } from '@/components/landing/LandingChrome';
import { AnalyticsSettings } from '@/components/GoogleAnalytics';

type Language = 'en' | 'bm';

interface Section {
  title: string;
  body: ReactNode;
}

const CONTACT = 'hello@kitakodventures.com';

const ENGLISH: Section[] = [
  {
    title: '1. Who we are',
    body: <p>Kitakod Ventures (SSM 202203226187 (003430123-M)) operates Jentera and is the data controller for the personal data described in this notice. Contact us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a> for any privacy question or request.</p>,
  },
  {
    title: '2. Personal data we collect',
    body: <>
      <p>Depending on how you use Jentera, we may collect:</p>
      <ul>
        <li><strong>Account and contact data:</strong> email address, sign-in method, verification state, team membership, invitations and messages you send to support.</li>
        <li><strong>Business data:</strong> business name, address, contact details, descriptions, confirmed knowledge, connections, policies, approvals and team or workspace settings.</li>
        <li><strong>Content and work data:</strong> chats, instructions, documents, photographs, website addresses, extracted facts, task and activity history, AI outputs, files, reminders and routines.</li>
        <li><strong>Connected-service data:</strong> account identifiers, credentials or tokens, messages and actions needed for a connection you choose, such as Telegram, Google sign-in or Google Calendar. Section 14 explains Google data specifically.</li>
        <li><strong>Device and technical data:</strong> session cookies, IP-derived security records, browser or app information, push-subscription tokens, service logs, errors and security events.</li>
        <li><strong>Limited product analytics:</strong> an allowed event name, a random 30-day browser identifier, a coarse route and elapsed time. These events exclude prompts, answers, emails, business names, URLs, connector names and error messages.</li>
        <li><strong>Optional public-page analytics:</strong> if you allow Google Analytics, Google receives public pageviews, approved campaign labels, a referrer origin, cookie identifiers and browser/device information. Our tag does not run in sign-in, onboarding, Chat, billing or other private screens. We do not send chat content, uploads, credentials, emails, business names or URL tokens to Google Analytics.</li>
      </ul>
    </>,
  },
  {
    title: '3. Where the data comes from',
    body: <p>We receive data from you; your business owner or team; services you choose to connect; public pages you ask Jentera to read; Google when you choose Google sign-in; and technical or security signals created when the service is used.</p>,
  },
  {
    title: '4. Why we use it',
    body: <>
      <p>We process personal data to provide and secure Jentera: create and verify accounts, operate your business workspace, carry out requested work, generate and deliver results, maintain business knowledge, connect chosen services, send service messages and notifications, provide support, prevent abuse, measure whether core features work, improve reliability, and meet legal obligations.</p>
      <p>We do not sell personal data or use it for third-party targeted advertising.</p>
    </>,
  },
  {
    title: '5. AI, documents and photographs',
    body: <>
      <p>Jentera sends the relevant parts of your instructions, business context and uploaded content to AI and infrastructure providers to perform the work you request. AI output can be incomplete or wrong. Review important customer, financial, legal or operational work before relying on it.</p>
      <p>The document-ingestion feature processes source documents or photographs to extract text without keeping the original upload. Chat attachments are different: original pictures, spreadsheets and other files may be stored in private file storage and copied to your business’s computer so the agent can work on them and answer follow-up questions. Extracted facts, suggestions, task records and deliberately saved outputs may also be retained. The retention practices in section 9 apply; uploading a file does not mean it is immediately deleted after processing.</p>
      <p>Do not provide sensitive personal data, confidential third-party data or a person’s photograph unless it is necessary for the task and you are authorised to do so.</p>
    </>,
  },
  {
    title: '6. Who receives data',
    body: <>
      <p>We disclose only what is needed to operate a feature, to authorised personnel, and to service providers acting for us. Current categories and examples include:</p>
      <ul>
        <li>Cloudflare for website delivery, API security, logs, file storage and document conversion;</li>
        <li>Neon for the application database, and Fly.io/Sprites for each business’s isolated computer;</li>
        <li>AI/model providers, currently including DeepSeek, and other providers where a task requires them;</li>
        <li>Resend for service email, Google for optional sign-in and Calendar access, and Telegram or another connection only when you choose to connect or use it;</li>
        <li>Google for optional public-page analytics when you allow it;</li>
        <li>websites and services you instruct Jentera to access or contact; and</li>
        <li>professional advisers, regulators, courts or authorities when reasonably necessary or legally required.</li>
      </ul>
      <p>A third-party service you connect also handles data under its own privacy terms.</p>
    </>,
  },
  {
    title: '7. Processing outside Malaysia',
    body: <p>Jentera uses providers outside Malaysia. Core database and business-computer infrastructure is configured in Singapore. Other processing may occur where a provider operates; for example, current DeepSeek processing is in the People’s Republic of China and global infrastructure providers may process data in other countries. We assess these transfers and use contractual, security and access controls appropriate to the data and service.</p>,
  },
  {
    title: '8. Cookies, local storage and choices',
    body: <>
      <p>Jentera uses essential cookies and browser storage for sign-in, security, language, setup state and app operation. We do not use advertising cookies. First-party activation analytics stops when your browser sends Global Privacy Control or Do Not Track. Push notifications, camera access, document upload, Google sign-in and service connections are optional and start only when you choose them.</p>
      <p>Google Analytics is separate and optional. Its tag and analytics cookies load only after you allow analytics on a public page. The choice is stored in this browser for up to 180 days. Global Privacy Control and Do Not Track override an opt-in. Change or withdraw your choice below; withdrawal disables our Google tracking, clears accessible Google Analytics cookies and reloads the page. Cloudflare traffic measurement and first-party product measurement are separate from this Google preference.</p>
      <p>You can disconnect a service, turn off notifications in Jentera or your device, and remove browser permissions in browser or phone settings.</p>
    </>,
  },
  {
    title: '9. How long we keep data',
    body: <p>We keep data only while it is needed for the purposes above. Sign-in sessions normally expire after 30 days; temporary authentication and security records expire or are periodically removed; operational model-call records are normally swept after 90 days. Account, business, task and saved-output records are kept while the service is used and until they are deleted or no longer needed. Some records may remain longer where required for security, fraud prevention, legal duties, disputes or backup recovery. We delete or anonymise data when it is no longer needed.</p>,
  },
  {
    title: '10. Security and incidents',
    body: <p>We use access controls, tenant isolation, encryption in transit, restricted credentials, audit records and service-level safeguards. No online service is completely secure. If a personal-data breach meets the legal notification threshold, we will notify Malaysia’s Personal Data Protection Commissioner and affected people within the periods required by law.</p>,
  },
  {
    title: '11. Your rights',
    body: <>
      <p>Subject to applicable law, you may ask whether we hold your personal data; request access or correction; withdraw consent; object to or limit particular processing; ask us to delete data; or ask about a cross-border transfer. We may need to verify your identity and may retain information where the law permits or requires it.</p>
      <p>Email <a href={`mailto:${CONTACT}?subject=Jentera%20privacy%20request`}>{CONTACT}</a>. Please state the account email and what you need. You may also complain to Malaysia’s Personal Data Protection Commissioner.</p>
    </>,
  },
  {
    title: '12. What is required',
    body: <p>An email address, essential security data and the minimum business information are required to create and operate an account. If you do not provide them, we cannot provide the workspace. Other information and features are optional, but Jentera may be unable to complete a particular task or connection without the data it needs.</p>,
  },
  {
    title: '13. Children and changes',
    body: <><p>Jentera is a business service and is not intended for children under 18. Do not use it to submit children’s data unless you have a lawful business need and appropriate authority.</p><p>We may update this notice when the product, providers or law changes. We will publish the new date here and give additional notice when a change materially affects how we use personal data.</p></>,
  },
  {
    title: '14. Google sign-in and Google Calendar',
    body: <>
      <p><strong>Access and purpose:</strong> Google sign-in provides your account identifier, email address and basic profile information to authenticate you. Calendar is a separate, optional connection: you authorise it on Google’s page in your normal browser. Its permission covers reading and managing events on calendars you own. Current Jentera tools read your primary calendar within requested ranges of up to 31 days and create events only after a separate owner approval. They do not edit or delete existing events, read Gmail or access Google Drive.</p>
      <p><strong>Data used and shared:</strong> Calendar reads return event identifiers, titles, status, start and end times, locations and event links. Event drafts may also contain the description you supply. Relevant event information may be passed to your business’s computer and the AI and infrastructure providers in section 6 to answer your question or perform the requested task; an approved event is sent to Google. Your Google password is not requested by Jentera. Calendar refresh tokens are encrypted in the application database and are not given to the agent, included in chat replies or sent to AI providers.</p>
      <p><strong>Storage and withdrawal:</strong> Connection identifiers and encrypted authorisation are kept while needed for the connection. Event information may remain in chats, proposals, outputs and work records under section 9. Disconnect Calendar in My Business → Connections or revoke Jentera’s access in <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">your Google Account</a>. Disconnection does not delete Google events already created or automatically erase historical Jentera records. Contact us to request deletion as described in section 11.</p>
      <p>Google-derived data is subject to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including its Limited Use requirements, and the <a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy" target="_blank" rel="noopener noreferrer">Google Workspace user data and developer policy</a>. These restrict advertising, resale, human access and general-purpose AI training. Google data is not permission for unrelated processing.</p>
    </>,
  },
];

const MALAY: Section[] = [
  {
    title: '1. Siapa kami',
    body: <p>Kitakod Ventures (SSM 202203226187 (003430123-M)) mengendalikan Jentera dan merupakan pengawal data bagi data peribadi yang diterangkan dalam notis ini. Hubungi kami di <a href={`mailto:${CONTACT}`}>{CONTACT}</a> untuk sebarang pertanyaan atau permintaan privasi.</p>,
  },
  {
    title: '2. Data peribadi yang kami kumpulkan',
    body: <>
      <p>Bergantung pada cara anda menggunakan Jentera, kami mungkin mengumpulkan:</p>
      <ul>
        <li><strong>Data akaun dan hubungan:</strong> alamat e-mel, kaedah log masuk, status pengesahan, keahlian pasukan, jemputan dan mesej yang anda hantar kepada sokongan.</li>
        <li><strong>Data perniagaan:</strong> nama, alamat dan butiran hubungan perniagaan, penerangan, pengetahuan yang disahkan, sambungan, dasar, kelulusan serta tetapan pasukan atau ruang kerja.</li>
        <li><strong>Data kandungan dan kerja:</strong> perbualan, arahan, dokumen, gambar, alamat laman web, fakta yang diekstrak, sejarah tugasan dan aktiviti, output AI, fail, peringatan dan rutin.</li>
        <li><strong>Data perkhidmatan yang disambungkan:</strong> pengecam akaun, kelayakan atau token, mesej dan tindakan yang diperlukan untuk sambungan pilihan anda seperti Telegram, log masuk Google atau Google Calendar. Bahagian 14 menerangkan data Google secara khusus.</li>
        <li><strong>Data peranti dan teknikal:</strong> kuki sesi, rekod keselamatan berasaskan IP, maklumat pelayar atau aplikasi, token langganan pemberitahuan, log perkhidmatan, ralat dan peristiwa keselamatan.</li>
        <li><strong>Analitik produk terhad:</strong> nama peristiwa yang dibenarkan, pengecam pelayar rawak selama 30 hari, laluan umum dan masa berlalu. Peristiwa ini tidak mengandungi arahan, jawapan, e-mel, nama perniagaan, URL, nama sambungan atau mesej ralat.</li>
        <li><strong>Analitik halaman awam pilihan:</strong> jika anda membenarkan Google Analytics, Google menerima paparan halaman awam, label kempen yang diluluskan, asal perujuk, pengecam kuki dan maklumat pelayar/peranti. Tag kami tidak berjalan pada halaman log masuk, onboarding, Chat, bil atau skrin persendirian lain. Kami tidak menghantar kandungan chat, muat naik, kelayakan, e-mel, nama perniagaan atau token URL kepada Google Analytics.</li>
      </ul>
    </>,
  },
  {
    title: '3. Sumber data',
    body: <p>Kami menerima data daripada anda; pemilik atau pasukan perniagaan anda; perkhidmatan yang anda pilih untuk disambungkan; halaman awam yang anda minta Jentera baca; Google apabila anda memilih log masuk Google; serta isyarat teknikal atau keselamatan yang terhasil apabila perkhidmatan digunakan.</p>,
  },
  {
    title: '4. Tujuan kami menggunakannya',
    body: <><p>Kami memproses data peribadi untuk menyediakan dan melindungi Jentera: mencipta dan mengesahkan akaun, mengendalikan ruang kerja perniagaan, melaksanakan kerja yang diminta, menjana dan menyampaikan hasil, menyelenggara pengetahuan perniagaan, menyambungkan perkhidmatan pilihan, menghantar mesej dan pemberitahuan perkhidmatan, memberi sokongan, mencegah penyalahgunaan, mengukur fungsi ciri utama, meningkatkan kebolehpercayaan dan memenuhi kewajipan undang-undang.</p><p>Kami tidak menjual data peribadi atau menggunakannya untuk pengiklanan sasaran pihak ketiga.</p></>,
  },
  {
    title: '5. AI, dokumen dan gambar',
    body: <><p>Jentera menghantar bahagian berkaitan daripada arahan, konteks perniagaan dan kandungan yang anda muat naik kepada penyedia AI dan infrastruktur untuk melaksanakan kerja yang anda minta. Output AI mungkin tidak lengkap atau salah. Semak kerja pelanggan, kewangan, undang-undang atau operasi yang penting sebelum bergantung padanya.</p><p>Ciri pengingesan dokumen memproses dokumen sumber atau gambar untuk mengekstrak teks tanpa menyimpan muat naik asal. Lampiran chat berbeza: gambar, hamparan dan fail asal lain mungkin disimpan dalam storan fail persendirian dan disalin ke komputer perniagaan anda supaya ejen boleh mengerjakannya dan menjawab soalan susulan. Fakta, cadangan, rekod tugasan dan output yang sengaja disimpan juga mungkin dikekalkan. Amalan penyimpanan dalam bahagian 9 terpakai; muat naik tidak bermakna fail dipadamkan serta-merta selepas pemprosesan.</p><p>Jangan berikan data peribadi sensitif, data sulit pihak ketiga atau gambar seseorang melainkan ia perlu untuk tugasan dan anda diberi kuasa untuk berbuat demikian.</p></>,
  },
  {
    title: '6. Pihak yang menerima data',
    body: <><p>Kami hanya mendedahkan apa yang diperlukan untuk mengendalikan sesuatu ciri, kepada kakitangan yang dibenarkan dan kepada penyedia perkhidmatan yang bertindak untuk kami. Kategori dan contoh semasa termasuk:</p><ul><li>Cloudflare untuk penghantaran laman web, keselamatan API, log, penyimpanan fail dan penukaran dokumen;</li><li>Neon untuk pangkalan data aplikasi, serta Fly.io/Sprites untuk komputer berasingan setiap perniagaan;</li><li>penyedia AI/model, kini termasuk DeepSeek, dan penyedia lain apabila diperlukan oleh sesuatu tugasan;</li><li>Resend untuk e-mel perkhidmatan, Google untuk log masuk pilihan dan akses Calendar, dan Telegram atau sambungan lain hanya apabila anda memilih untuk menyambung atau menggunakannya;</li><li>Google untuk analitik halaman awam pilihan apabila anda membenarkannya;</li><li>laman web dan perkhidmatan yang anda arahkan Jentera untuk akses atau hubungi; dan</li><li>penasihat profesional, pengawal selia, mahkamah atau pihak berkuasa apabila munasabah atau diwajibkan undang-undang.</li></ul><p>Perkhidmatan pihak ketiga yang anda sambungkan turut mengendalikan data di bawah terma privasinya sendiri.</p></>,
  },
  {
    title: '7. Pemprosesan di luar Malaysia',
    body: <p>Jentera menggunakan penyedia di luar Malaysia. Infrastruktur pangkalan data teras dan komputer perniagaan dikonfigurasi di Singapura. Pemprosesan lain mungkin berlaku di tempat penyedia beroperasi; contohnya, pemprosesan DeepSeek semasa berlaku di Republik Rakyat China dan penyedia infrastruktur global mungkin memproses data di negara lain. Kami menilai pemindahan ini dan menggunakan kawalan kontrak, keselamatan dan akses yang sesuai dengan data dan perkhidmatan.</p>,
  },
  {
    title: '8. Kuki, storan setempat dan pilihan',
    body: <><p>Jentera menggunakan kuki penting dan storan pelayar untuk log masuk, keselamatan, bahasa, status persediaan dan operasi aplikasi. Kami tidak menggunakan kuki pengiklanan. Analitik pengaktifan pihak pertama berhenti apabila pelayar anda menghantar Kawalan Privasi Global atau Jangan Jejak. Pemberitahuan, akses kamera, muat naik dokumen, log masuk Google dan sambungan perkhidmatan adalah pilihan dan hanya bermula apabila anda memilihnya.</p><p>Google Analytics berasingan dan pilihan. Tag serta kuki analitiknya hanya dimuatkan selepas anda membenarkan analitik pada halaman awam. Pilihan disimpan dalam pelayar ini sehingga 180 hari. Kawalan Privasi Global dan Jangan Jejak mengatasi persetujuan anda. Ubah atau tarik balik pilihan di bawah; penarikan balik mematikan penjejakan Google kami, memadamkan kuki Google Analytics yang boleh dicapai dan memuat semula halaman. Pengukuran trafik Cloudflare dan produk pihak pertama berasingan daripada pilihan Google ini.</p><p>Anda boleh memutuskan sambungan perkhidmatan, mematikan pemberitahuan dalam Jentera atau peranti, dan membuang kebenaran pelayar melalui tetapan pelayar atau telefon.</p></>,
  },
  {
    title: '9. Tempoh penyimpanan data',
    body: <p>Kami menyimpan data hanya selama ia diperlukan untuk tujuan di atas. Sesi log masuk biasanya tamat selepas 30 hari; rekod pengesahan dan keselamatan sementara tamat atau dibuang secara berkala; rekod operasi panggilan model biasanya dibuang selepas 90 hari. Rekod akaun, perniagaan, tugasan dan hasil tersimpan dikekalkan semasa perkhidmatan digunakan dan sehingga dipadamkan atau tidak lagi diperlukan. Sesetengah rekod mungkin disimpan lebih lama apabila diperlukan untuk keselamatan, pencegahan penipuan, kewajipan undang-undang, pertikaian atau pemulihan sandaran. Kami memadamkan atau menyahnamakan data apabila ia tidak lagi diperlukan.</p>,
  },
  {
    title: '10. Keselamatan dan insiden',
    body: <p>Kami menggunakan kawalan akses, pengasingan penyewa, penyulitan semasa penghantaran, kelayakan terhad, rekod audit dan perlindungan pada peringkat perkhidmatan. Tiada perkhidmatan dalam talian yang selamat sepenuhnya. Jika pelanggaran data peribadi mencapai ambang pemberitahuan undang-undang, kami akan memaklumkan Pesuruhjaya Perlindungan Data Peribadi Malaysia dan individu yang terjejas dalam tempoh yang diwajibkan undang-undang.</p>,
  },
  {
    title: '11. Hak anda',
    body: <><p>Tertakluk pada undang-undang yang terpakai, anda boleh bertanya sama ada kami menyimpan data peribadi anda; meminta akses atau pembetulan; menarik balik persetujuan; membantah atau mengehadkan pemprosesan tertentu; meminta data dipadamkan; atau bertanya tentang pemindahan rentas sempadan. Kami mungkin perlu mengesahkan identiti anda dan mungkin mengekalkan maklumat apabila dibenarkan atau diwajibkan undang-undang.</p><p>E-mel <a href={`mailto:${CONTACT}?subject=Permintaan%20privasi%20Jentera`}>{CONTACT}</a>. Nyatakan e-mel akaun dan perkara yang anda perlukan. Anda juga boleh membuat aduan kepada Pesuruhjaya Perlindungan Data Peribadi Malaysia.</p></>,
  },
  {
    title: '12. Maklumat yang wajib',
    body: <p>Alamat e-mel, data keselamatan penting dan maklumat minimum perniagaan diperlukan untuk mencipta dan mengendalikan akaun. Jika anda tidak memberikannya, kami tidak dapat menyediakan ruang kerja. Maklumat dan ciri lain adalah pilihan, tetapi Jentera mungkin tidak dapat menyelesaikan tugasan atau sambungan tertentu tanpa data yang diperlukan.</p>,
  },
  {
    title: '13. Kanak-kanak dan perubahan',
    body: <><p>Jentera ialah perkhidmatan perniagaan dan tidak ditujukan kepada individu di bawah umur 18 tahun. Jangan gunakannya untuk menyerahkan data kanak-kanak melainkan anda mempunyai keperluan perniagaan yang sah dan kuasa yang sesuai.</p><p>Kami mungkin mengemas kini notis ini apabila produk, penyedia atau undang-undang berubah. Kami akan menerbitkan tarikh baharu di sini dan memberi notis tambahan apabila perubahan memberi kesan penting kepada cara kami menggunakan data peribadi.</p></>,
  },
  {
    title: '14. Log masuk Google dan Google Calendar',
    body: <>
      <p><strong>Akses dan tujuan:</strong> Log masuk Google memberikan pengecam akaun, alamat e-mel dan maklumat profil asas untuk mengesahkan anda. Calendar ialah sambungan pilihan yang berasingan: anda memberikan kebenaran pada halaman Google dalam pelayar biasa. Kebenarannya meliputi pembacaan dan pengurusan acara pada kalendar milik anda. Alat Jentera semasa membaca kalendar utama anda bagi julat yang diminta sehingga 31 hari dan mencipta acara hanya selepas kelulusan pemilik yang berasingan. Ia tidak menyunting atau memadamkan acara sedia ada, membaca Gmail atau mengakses Google Drive.</p>
      <p><strong>Data yang digunakan dan dikongsi:</strong> Pembacaan Calendar mengembalikan pengecam, tajuk, status, masa mula dan tamat, lokasi serta pautan acara. Draf acara juga mungkin mengandungi penerangan yang anda berikan. Maklumat acara yang berkaitan mungkin dihantar ke komputer perniagaan serta penyedia AI dan infrastruktur dalam bahagian 6 untuk menjawab soalan atau menjalankan tugasan anda; acara yang diluluskan dihantar kepada Google. Jentera tidak meminta kata laluan Google anda. Token penyegaran Calendar disulitkan dalam pangkalan data aplikasi dan tidak diberikan kepada ejen, dimasukkan dalam jawapan chat atau dihantar kepada penyedia AI.</p>
      <p><strong>Penyimpanan dan penarikan balik:</strong> Pengecam sambungan dan kebenaran yang disulitkan disimpan selama diperlukan untuk sambungan. Maklumat acara mungkin kekal dalam chat, cadangan, output dan rekod kerja mengikut bahagian 9. Putuskan sambungan Calendar dalam My Business → Connections atau tarik balik akses Jentera dalam <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">Akaun Google anda</a>. Pemutusan sambungan tidak memadamkan acara Google yang telah dicipta atau menghapuskan rekod sejarah Jentera secara automatik. Hubungi kami untuk meminta pemadaman seperti diterangkan dalam bahagian 11.</p>
      <p>Data yang diperoleh daripada Google tertakluk pada <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Dasar Data Pengguna Perkhidmatan API Google</a>, termasuk keperluan Penggunaan Terhad, serta <a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy" target="_blank" rel="noopener noreferrer">dasar data pengguna dan pembangun Google Workspace</a>. Dasar ini mengehadkan pengiklanan, penjualan semula, akses manusia dan latihan AI tujuan umum. Data Google bukan kebenaran untuk pemprosesan yang tidak berkaitan.</p>
    </>,
  },
];

export default function Privacy() {
  const [language, setLanguage] = useState<Language>('en');
  const malay = language === 'bm';
  const sections = malay ? MALAY : ENGLISH;

  useEffect(() => {
    document.documentElement.lang = malay ? 'ms' : 'en';
    return () => { document.documentElement.lang = 'en'; };
  }, [malay]);

  return (
    <div className="marketing-page privacy-page min-h-dvh bg-bg text-text">
      <LandingHeader navLinks={[{ href: '/', label: malay ? 'Laman utama' : 'Home' }, { href: '/terms', label: malay ? 'Terma' : 'Terms' }]} />
      <main id="main-content" className="lp-container privacy-main" lang={malay ? 'ms' : 'en'}>
        <header className="privacy-hero">
          <p className="lp-eyebrow">{malay ? 'Privasi di Jentera' : 'Privacy at Jentera'}</p>
          <h1>{malay ? 'Notis privasi' : 'Privacy notice'}</h1>
          <p className="privacy-intro">
            {malay
              ? 'Notis ini menerangkan cara Kitakod Ventures mengumpul, menggunakan, mendedahkan, menyimpan dan melindungi data peribadi apabila anda melawat jentera.ai, menggunakan Jentera atau aplikasi mudah alihnya, dan menyambungkan perkhidmatan lain.'
              : 'This notice explains how Kitakod Ventures collects, uses, discloses, stores and protects personal data when you visit jentera.ai, use Jentera or its mobile apps, and connect other services.'}
          </p>
          <p className="privacy-date">{malay ? 'Berkuat kuasa: 17 September 2026' : 'Effective: 17 September 2026'}</p>
          <div className="privacy-language" role="group" aria-label="Privacy notice language">
            <button type="button" aria-pressed={!malay} onClick={() => setLanguage('en')}>English</button>
            <button type="button" aria-pressed={malay} onClick={() => setLanguage('bm')}>Bahasa Malaysia</button>
          </div>
        </header>

        <article className="privacy-notice">
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.body}
            </section>
          ))}
        </article>
        <AnalyticsSettings malay={malay} />
        <p className="privacy-intro">{malay ? 'Lihat juga ' : 'See also our '}<Link className="text-brand underline" to="/terms">{malay ? 'terma perkhidmatan' : 'terms of service'}</Link>.</p>
      </main>
      <LandingFooter tagline={malay ? 'Dibina oleh AISAR untuk perniagaan Malaysia.' : undefined} />
    </div>
  );
}
