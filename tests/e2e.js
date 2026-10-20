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
  const TEST_KEY = 'FAUX-ABCD-EFGH-JKMN-PQRS';
  const env = await launch({
    headless: !process.env.HEADED,
    onRequest: ({ url, body }) => {
      if (/\/api\/detect(\?|$)/.test(url)) return nextDetectReply;
      if (/\/api\/validate-license$/.test(url)) {
        return body?.licenseKey === TEST_KEY
          ? { json: { valid: true, isPro: true, plan: 'monthly', email: 'buyer@example.com', expiresAt: Date.now() + 30 * 864e5, tokenBalance: 200, topupBalance: 0, tokensIncluded: 200, features: { videoDetection: false } } }
          : { status: 404, json: { valid: false, error: 'License not found', message: 'This license key does not exist. Check for typos.' } };
      }
      return undefined;
    },
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
    for (const p of ['popup.html', 'settings.html', 'history.html', 'welcome.html']) {
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

    // ── Free limit → upgrade prompt opens the pricing page ────────────────
    await env.setStorage({ dailyScans: 3, lastResetDate: await page.evaluate(() => new Date().toDateString()) });
    await page.goto(`${env.origin}/profile.html`, { waitUntil: 'networkidle2' });
    await investigate(page, '#p2');
    await page.waitForSelector('.ai-badge-upgrade', { timeout: 5000 });
    const tip = await page.$eval('.ai-badge-upgrade', b => b.title);
    check('free-limit badge explains the limit (no "undefined")', /3 free scans/.test(tip) && !/undefined/.test(tip), tip);
    const proTab = env.browser.waitForTarget(t => t.url().startsWith('https://www.fauxspy.com/pro'), { timeout: 5000 }).catch(() => null);
    await page.click('.ai-badge-upgrade');
    const proTarget = await proTab;
    check('free-limit badge opens fauxspy.com/pro', !!proTarget, (await env.browser.pages()).map(p => p.url()));
    if (proTarget) await (await proTarget.page())?.close();

    // A web page other than fauxspy.com/success can't hand over a key.
    const before = env.requests.length;
    await page.evaluate(k => window.postMessage({ source: 'fauxspy-page', type: 'FAUXSPY_ACTIVATE', key: k }, location.origin), TEST_KEY);
    await sleep(500);
    check('other sites cannot trigger license activation', !env.requests.slice(before).some(r => r.url.includes('validate-license')) && !(await env.storage(['license'])).license?.isPro);

    // ── Settings: paste a key and activate ────────────────────────────────
    const settings = await env.browser.newPage();
    const settingsErrors = watchErrors(settings);
    await settings.goto(env.extUrl('settings.html'), { waitUntil: 'networkidle2' });
    await settings.type('#licenseKeyInput', 'faux-ABCD-EFGH-JKMN-PQRS');
    await settings.click('#activateLicenseBtn');
    await settings.waitForFunction(() => document.getElementById('proTierState').style.display === 'block', { timeout: 5000 }).catch(() => {});
    check('settings: pasted key activates Pro and the page switches to the Pro view',
      (await settings.$eval('#proLicenseDisplay', e => e.textContent)) === TEST_KEY && (await settings.$eval('#proTokenBalance', e => e.textContent)) === '200 tokens');
    check('settings: "Buy more" carries the key to the token page',
      (await settings.$eval('#buyTokensLink', a => a.href)) === `https://www.fauxspy.com/buy-tokens?key=${TEST_KEY}`);
    check('settings page has no console errors', settingsErrors.length === 0, settingsErrors);

    // ── Checkout success page hands the key to the extension ──────────────
    await env.setStorage({ license: { isPro: false, plan: 'free', limits: { scansPerDay: 3 } } });
    await settings.waitForFunction(() => document.getElementById('freeTierState').style.display === 'block', { timeout: 3000 }).catch(() => {});
    const fixture = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'checkout-success.html'), 'utf8');
    const success = await env.browser.newPage();
    await success.setRequestInterception(true);
    success.on('request', r => (r.url() === 'https://www.fauxspy.com/success'
      ? r.respond({ status: 200, contentType: 'text/html', body: fixture })
      : r.abort()));
    await success.goto('https://www.fauxspy.com/success', { waitUntil: 'domcontentloaded' });
    await success.waitForFunction(() => window.__replies.includes('FAUXSPY_ACTIVATED') || window.__replies.includes('FAUXSPY_ACTIVATE_FAILED'), { timeout: 8000 }).catch(() => {});
    const replies = await success.evaluate(() => window.__replies);
    const handedOver = (await env.storage(['license'])).license;
    check('checkout success page activates Pro without copy-paste', replies.includes('FAUXSPY_ACTIVATED') && handedOver?.isPro && handedOver.key === TEST_KEY, { replies, handedOver });
    await settings.waitForFunction(() => document.getElementById('proTierState').style.display === 'block', { timeout: 3000 }).catch(() => {});
    check('an open settings page switches to Pro when the key arrives', await settings.$eval('#proTierState', e => e.style.display === 'block'));
    await success.close();
    await settings.close();

    check('service worker threw no uncaught errors', env.swErrors.length === 0, env.swErrors);
  } finally {
    await env.close();
  }

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
