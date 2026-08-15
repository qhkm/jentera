const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('https://3928c8a0.aisar-ez8.pages.dev/', { waitUntil: 'networkidle' });
  const info = await p.evaluate(() => {
    const btn = document.querySelector('.lp .btn-primary');
    const s = getComputedStyle(btn);
    const out = {
      className: btn.className,
      paddingTop: s.paddingTop,
      paddingBlock: s.paddingBlock,
      matched: []
    };
    // cari semua CSS rules yang match button & set padding-block
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { out.matched.push('SKIP (CORS): ' + sheet.href); continue; }
      const walk = (list) => {
        for (const r of list) {
          if (!r) continue;
          if (r.cssRules) { walk(r.cssRules); continue; }
          if (r.selectorText && r.style && r.style.paddingBlock) {
            try {
              if (btn.matches(r.selectorText)) {
                out.matched.push({ sel: r.selectorText, paddingBlock: r.style.paddingBlock, important: r.style.getPropertyPriority('padding-block'), sheet: (sheet.href || 'inline<style>').split('/').pop() });
              }
            } catch (e) {}
          }
        }
      };
      walk(rules);
    }
    // test override manual important
    btn.style.setProperty('padding-top', '16px', 'important');
    out.afterJsOverride = getComputedStyle(btn).paddingTop;
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  await b.close();
})();
