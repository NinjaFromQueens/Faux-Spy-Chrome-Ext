// End-to-end smoke test: loads the real unpacked extension in Chrome for
// Testing, scans images on a local page with a mocked backend, and checks
// the parts reviewers and users hit first.
//
// Usage: npm run test:e2e   (HEADED=1 to watch it)

'use strict';

const { launch, watchErrors, investigate, sleep } = require('./lib/harness');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : '  -> ' + JSON.stringify(detail).slice(0, 300)}`);
};

const verdict = over => ({
  success: true, isAI: true, aiProbability: 0.93, confidence: 0.86,
  verdict: 'likely_ai', verdictLabel: 'Likely AI', category: 'ai', method: 'signal_trace',
  indicators: ['Strong AI generation signals'], timestamp: Date.now(), ...over,
});

(async () => {
  let nextDetectReply = null;
  const env = await launch({
    headless: !process.env.HEADED,
    onRequest: ({ url }) => (/\/api\/detect(\?|$)/.test(url) ? nextDetectReply : undefined),
  });

  try {
    // ── Service worker + install ──────────────────────────────────────────
    const swFns = await env.worker.evaluate(() => [typeof getLicense, typeof revalidateLicense, typeof canScan]);
    check('service worker loads license.js (getLicense, revalidateLicense, canScan)', swFns.every(t => t === 'function'), swFns);

    await sleep(1000);
    const welcomeTabs = (await env.browser.pages()).filter(p => p.url() === env.extUrl('welcome.html'));
    check('welcome page opens once on first install', welcomeTabs.length === 1, (await env.browser.pages()).map(p => p.url()));

    const menus = await env.worker.evaluate(() => Promise.all(['checkAI', 'checkVideo'].map(id =>
      new Promise(r => chrome.contextMenus.update(id, {}, () => r(!chrome.runtime.lastError))))));
    check('right-click menu items registered (image + video)', menus.every(Boolean), menus);

    // ── Extension pages render without errors ─────────────────────────────
    for (const p of ['popup.html', 'settings.html', 'upgrade.html', 'history.html', 'welcome.html']) {
      const page = await env.browser.newPage();
      const errors = watchErrors(page);
      await page.goto(env.extUrl(p), { waitUntil: 'networkidle2' });
      await sleep(300);
      check(`${p} renders with no console errors`, errors.length === 0, errors);
      await page.close();
    }

    // ── Scanning on a web page ────────────────────────────────────────────
    const page = await env.browser.newPage();
    const pageErrors = watchErrors(page);
    await page.goto(`${env.origin}/profile.html`, { waitUntil: 'networkidle2' });
    const scans = async () => (await env.storage(['dailyScans'])).dailyScans || 0;

    nextDetectReply = { json: verdict() };
    await investigate(page, '#p1');
    await page.waitForSelector('.ai-result-panel-v8', { visible: true, timeout: 10000 });
    const badge = await page.$eval('.ai-badge', b => ({ text: b.textContent.trim(), error: b.classList.contains('ai-badge-error') })).catch(() => null);
    check('hover → Investigate → verdict badge + result panel', badge && !badge.error && /Likely AI/.test(badge.text), badge);
    check('result panel is announced as a dialog', await page.$eval('.ai-result-panel-v8', p => p.getAttribute('role') === 'dialog' && !!p.getAttribute('aria-label')));
    check('successful scan uses one free scan', (await scans()) === 1, await scans());

    const req = env.requests.filter(r => /\/api\/detect(\?|$)/.test(r.url)).pop();
    check('scan request sends image URL + page domain, never a Pro claim', req?.body?.imageUrl?.endsWith('/ai-1.jpg') && req.body.pageHost === 'localhost' && req.body.isPro === false, req?.body);

    await page.keyboard.press('Escape');
    check('Escape closes the result panel', (await page.$('.ai-result-panel-v8')) === null);

    nextDetectReply = { json: verdict({ cached: true, isAI: false, aiProbability: 0.08, verdict: 'likely_real', verdictLabel: 'No AI Detected', category: 'real' }) };
    await investigate(page, '#p2');
    await page.waitForSelector('.ai-result-panel-v8', { visible: true, timeout: 10000 });
    check('server cache hit does not use a free scan', (await scans()) === 1, await scans());
    await page.keyboard.press('Escape');

    nextDetectReply = { status: 503, json: { error: 'SERVICE_BUSY' } };
    await investigate(page, '#p3');
    await page.waitForSelector('.ai-badge-error', { visible: true, timeout: 10000 });
    const errBadge = await page.$eval('.ai-badge-error', b => b.textContent.trim());
    check('failed scan shows "not checked" state, not a verdict', /Unavailable/.test(errBadge) && (await page.$('.ai-result-panel-v8')) === null, errBadge);
    check('failed scan does not use a free scan', (await scans()) === 1, await scans());

    nextDetectReply = { json: verdict({ isAI: false, aiProbability: 0.11, verdict: 'likely_real', verdictLabel: 'No AI Detected', category: 'real' }) };
    await investigate(page, '#p4');
    await page.waitForSelector('.ai-review-prompt', { visible: true, timeout: 10000 });
    check('review prompt appears after the 3rd verdict', true);
    await page.click('.ai-review-dismiss');
    await sleep(200);
    const rp = (await env.storage(['reviewPrompt'])).reviewPrompt;
    check('dismissing the review prompt stops it for good', rp?.done === true && (await page.$('.ai-review-prompt')) === null, rp);
    await page.keyboard.press('Escape');

    check('no errors on the host page', pageErrors.length === 0, pageErrors);

    // ── Single-page-app navigation (Navigation API, no polling) ───────────
    // #p3's scan failed, so it can be hovered again.
    await page.mouse.move(5, 5);
    await page.hover('#p3');
    await page.waitForSelector('.ai-detector-widget.visible', { timeout: 5000 });
    await page.evaluate(() => history.pushState({}, '', '/profiles/next'));
    await sleep(150);
    check('pushState navigation hides the hover widget (no 1s polling)', (await page.$('.ai-detector-widget.visible')) === null);

    // ── Privacy: websites can't detect the extension ──────────────────────
    const probe = await page.evaluate(async id => {
      try { await fetch(`chrome-extension://${id}/ort.min.js`); return 'reachable'; } catch { return 'blocked'; }
    }, env.extensionId);
    check('websites cannot fetch extension files (no fingerprinting)', probe === 'blocked', probe);

    // ── Back/forward cache ────────────────────────────────────────────────
    const cdp = await page.createCDPSession();
    await cdp.send('Page.enable');
    let notRestored = null;
    cdp.on('Page.backForwardCacheNotUsed', e => { notRestored = e; });
    await page.goto(`${env.origin}/profile.html`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => { window.__bfcacheMarker = true; });
    await page.goto(`${env.origin}/other.html`, { waitUntil: 'networkidle2' });
    await page.goBack({ waitUntil: 'networkidle2' });
    const restored = await page.evaluate(() => window.__bfcacheMarker === true);
    const reasons = (notRestored?.notRestoredExplanations || []).map(r => r.reason);
    const extensionBlockers = reasons.filter(r => /Extension|ContentScript/i.test(r));
    console.log(`      bfcache: ${restored ? 'restored' : 'not restored — ' + (reasons.join(', ') || 'no reason given')}`);
    check('page is restored from back/forward cache (extension does not block it)',
      restored || extensionBlockers.length === 0, { restored, reasons });

    check('service worker threw no uncaught errors', env.swErrors.length === 0, env.swErrors);
  } finally {
    await env.close();
  }

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
