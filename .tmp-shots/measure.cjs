const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  // 1) Index hero mobile
  const p1 = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p1.goto('https://3928c8a0.aisar-ez8.pages.dev/', { waitUntil: 'networkidle' });
  const hero = await p1.evaluate(() => {
    const btn = document.querySelector('.lp .btn-primary');
    if (!btn) return null;
    const s = getComputedStyle(btn);
    return { pt: s.paddingTop, pb: s.paddingBottom, h: btn.offsetHeight, cls: btn.className };
  });
  console.log('HERO MOBILE:', JSON.stringify(hero));
  // 2) Onboard step 3 confirmation
  const p2 = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p2.goto('https://3928c8a0.aisar-ez8.pages.dev/onboard', { waitUntil: 'networkidle' });
  await p2.evaluate(() => { try { kvStep(2); } catch (e) {} });
  await p2.waitForTimeout(500);
  const onb = await p2.evaluate(() => {
    const btns = [...document.querySelectorAll('.as-step.active .btn')];
    return btns.map(b => { const s = getComputedStyle(b); return { txt: b.textContent.trim().slice(0, 25), pt: s.paddingTop, pb: s.paddingBottom, h: b.offsetHeight, cls: b.className }; });
  });
  console.log('ONBOARD CONFIRM:', JSON.stringify(onb));
  // 3) Onboard desktop too
  const p3 = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p3.goto('https://3928c8a0.aisar-ez8.pages.dev/onboard', { waitUntil: 'networkidle' });
  await p3.evaluate(() => { try { kvStep(2); } catch (e) {} });
  await p3.waitForTimeout(500);
  const onbD = await p3.evaluate(() => {
    const btns = [...document.querySelectorAll('.as-step.active .btn')];
    return btns.map(b => { const s = getComputedStyle(b); return { txt: b.textContent.trim().slice(0, 25), pt: s.paddingTop, pb: s.paddingBottom, h: b.offsetHeight }; });
  });
  console.log('ONBOARD CONFIRM DESKTOP:', JSON.stringify(onbD));
  await b.close();
})();
