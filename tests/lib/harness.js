// Shared Puppeteer setup for the E2E tests and the store-media capture.
//
// - Launches Chrome for Testing (bundled with puppeteer) with the unpacked
//   extension loaded into a fresh profile, so every run is a first install.
// - Serves tests/fixtures/ over http://localhost so content scripts run.
// - Intercepts the service worker's network requests over CDP so scans can
//   be mocked (tests) or passed through to the real backend (media capture).

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT_DIR = path.join(ROOT, 'faux-spy-extension');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const ONNX_MODEL = 'https://www.fauxspy.com/static/ai-detector.onnx';

function serveFixtures() {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'profile.html';
    const file = path.join(FIXTURES, rel);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, origin: `http://localhost:${server.address().port}` });
  }));
}

/**
 * Launch the browser with the extension.
 * opts.headless   — default true
 * opts.viewport   — default 1280x800
 * opts.onRequest  — async ({ url, method, body }) => undefined (pass through)
 *                   or { status, json } to answer it. Applied to the
 *                   extension service worker's requests to fauxspy.com.
 */
async function launch({ headless = true, viewport = { width: 1280, height: 800 }, onRequest } = {}) {
  const browser = await puppeteer.launch({
    headless,
    pipe: true,
    enableExtensions: [EXT_DIR],
    defaultViewport: viewport,
    args: [`--window-size=${viewport.width},${viewport.height + 120}`],
  });

  const swTarget = await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().endsWith('/background.js'),
    { timeout: 20000 }
  );
  const extensionId = new URL(swTarget.url()).host;
  const worker = await swTarget.worker();
  const sw = await swTarget.createCDPSession();
  const swErrors = [];
  sw.on('Runtime.exceptionThrown', e => swErrors.push(e.exceptionDetails?.exception?.description || e.exceptionDetails?.text));
  await sw.send('Runtime.enable');

  const requests = [];
  await sw.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.fauxspy.com/*' }, { urlPattern: 'https://fauxspy.com/*' }] });
  sw.on('Fetch.requestPaused', async ({ requestId, request }) => {
    try {
      // Never download the ~50 MB local model in tests or captures: scans
      // then always go to the API, which is the path we want to exercise.
      if (request.url.startsWith(ONNX_MODEL)) {
        await sw.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        return;
      }
      let body = null;
      try { body = request.postData ? JSON.parse(request.postData) : null; } catch { /* not JSON */ }
      const entry = { url: request.url, method: request.method, body };
      requests.push(entry);
      const reply = onRequest ? await onRequest(entry) : undefined;
      if (!reply) {
        await sw.send('Fetch.continueRequest', { requestId });
        return;
      }
      await sw.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: reply.status || 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
        body: Buffer.from(JSON.stringify(reply.json ?? {})).toString('base64'),
      });
    } catch (err) {
      // The worker may have been torn down mid-request; nothing to answer.
      if (!/Target closed|Session closed/.test(err.message)) console.warn('intercept error:', err.message);
    }
  });

  const { server, origin } = await serveFixtures();

  return {
    browser, worker, extensionId, origin, requests, swErrors,
    extUrl: p => `chrome-extension://${extensionId}/${p}`,
    async storage(keys) { return worker.evaluate(k => chrome.storage.local.get(k), keys); },
    async setStorage(obj) { return worker.evaluate(o => chrome.storage.local.set(o), obj); },
    async close() { server.close(); await browser.close(); },
  };
}

/** Collect console errors and uncaught exceptions on a page. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return errors;
}

/** Hover an image until the Investigate widget shows, then click it. */
async function investigate(page, selector) {
  await page.mouse.move(5, 5);
  await page.hover(selector);
  // Wait until the (single, reused) widget is showing over THIS image — not
  // still lingering over the previous one.
  await page.waitForFunction(sel => {
    const w = document.querySelector('.ai-detector-widget');
    const img = document.querySelector(sel);
    if (!w || !img) return false;
    if (!w.classList.contains('visible')) return false;
    const a = w.getBoundingClientRect();
    const b = img.getBoundingClientRect();
    const cx = a.left + a.width / 2, cy = a.top + a.height / 2;
    return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
  }, { timeout: 5000 }, selector);
  await page.click('.ai-detector-widget #ai-check-btn');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { launch, watchErrors, investigate, sleep, ROOT, EXT_DIR };
