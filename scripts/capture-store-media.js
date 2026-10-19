// Captures Chrome Web Store media from the REAL extension and REAL backend:
//   web-store-assets/out/screenshot-{1..5}.png   1280x800
//   web-store-assets/out/small-tile-440x280.png
//   web-store-assets/out/marquee-1400x560.png
//   web-store-assets/out/demo.webm               ~25s silent demo (upload to YouTube)
//
// Usage: npm run capture
//
// Scans use the sample images from fauxspy.com/try-it. Once they're in the
// server's cache, re-running costs nothing and doesn't count against limits.
// The verdicts shown are whatever the backend actually returns — check the
// printed verdicts and the images before uploading.

'use strict';

const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const { launch, investigate, sleep, ROOT, EXT_DIR } = require('../tests/lib/harness');

const OUT = path.join(ROOT, 'web-store-assets', 'out');
const RAW = { width: 1280, height: 720 };   // + 80px caption bar = 1280x800
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(EXT_DIR, 'icons', 'icon128.png')).toString('base64')}`;
const dataUrl = buf => `data:image/png;base64,${buf.toString('base64')}`;

const NOIR = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #0a0e1a; color: #f8fafc; overflow: hidden; }
  .gold { background: linear-gradient(135deg, #fbbf24, #d97706); -webkit-background-clip: text; background-clip: text; color: transparent; }
`;

async function render(browser, html, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({ type: 'png' });
  await page.close();
  return buf;
}

// Real UI screenshot under a short caption bar.
function captioned(caption, imgUrl, overlay = '') {
  return `<!DOCTYPE html><html><head><style>${NOIR}
    .bar { height: 80px; display: flex; align-items: center; gap: 16px; padding: 0 40px; border-bottom: 2px solid #fbbf24; }
    .bar img { width: 40px; height: 40px; }
    .bar h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; }
    .shot { position: relative; width: 1280px; height: 720px; }
    .shot > img.bg { display: block; width: 1280px; height: 720px; }
  </style></head><body>
    <div class="bar"><img src="${ICON}" alt=""><h1>${caption}</h1></div>
    <div class="shot"><img class="bg" src="${imgUrl}" alt="">${overlay}</div>
  </body></html>`;
}

async function freshScanBudget(env) {
  // A new anonymous ID and local counter for each segment, so the 3/day free
  // limit doesn't cut a capture short. (The backend's per-IP cap still applies.)
  await env.setStorage({ dailyScans: 0, userId: `fs_capture_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
}

async function panelText(page) {
  return page.$eval('.ai-result-panel-v8 .ai-verdict-label', el => el.textContent.trim()).catch(() => null);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const env = await launch({ viewport: RAW });
  const { browser } = env;
  const report = [];

  try {
    // Close the welcome tab opened on install; we screenshot it separately.
    for (const p of await browser.pages()) if (p.url().endsWith('/welcome.html')) await p.close();

    const page = await browser.newPage();
    await page.setViewport(RAW);
    const profile = `${env.origin}/profile.html`;

    // ── 1. Hover → verdict on an AI photo ─────────────────────────────────
    await freshScanBudget(env);
    await env.setStorage({ scanMode: 'detective', showResultPanel: true });
    await page.goto(profile, { waitUntil: 'networkidle2' });
    await investigate(page, '#p1');
    await page.waitForSelector('.ai-result-panel-v8', { visible: true, timeout: 30000 });
    await sleep(1800); // let the confidence bars finish animating
    const v1 = await panelText(page);
    report.push(`screenshot 1 (#p1, AI sample): ${v1}`);
    const shot1 = await page.screenshot();
    // Panel crop for the marquee: header through the accuracy disclaimer.
    const panelBox = await page.$eval('.ai-result-panel-v8', p => {
      const r = p.getBoundingClientRect();
      const end = p.querySelector('.ai-panel-details')?.getBoundingClientRect().top ?? r.bottom;
      return { x: r.left, y: r.top, width: r.width, height: Math.min(r.bottom, end) - r.top };
    });
    const panelShot = await page.screenshot({ clip: panelBox });

    // ── 2. A real photo comes back clean ──────────────────────────────────
    await page.keyboard.press('Escape');
    let shot2 = null;
    for (const sel of ['#p4', '#p2']) {
      await freshScanBudget(env);
      await investigate(page, sel);
      await page.waitForSelector('.ai-result-panel-v8', { visible: true, timeout: 30000 });
      await sleep(1800);
      const v = await panelText(page);
      report.push(`screenshot 2 candidate (${sel}, real photo): ${v}`);
      if (/No AI|Real/i.test(v || '')) { shot2 = await page.screenshot(); break; }
      await page.keyboard.press('Escape');
    }

    // ── 3. Scan the whole page (Stakeout mode badges) ─────────────────────
    await freshScanBudget(env);
    await env.setStorage({ scanMode: 'quick' });
    await page.goto(profile, { waitUntil: 'networkidle2' });
    // Same message the popup's "Investigate Page" button sends. The extension
    // has no "tabs" permission, so find the tab as the active one (no URLs).
    await page.bringToFront();
    const scanned = await env.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return chrome.tabs.sendMessage(tab.id, { action: 'scanVisible' });
    });
    await page.waitForFunction(() => document.querySelectorAll('.ai-badge').length >= 4, { timeout: 60000 }).catch(() => {});
    await sleep(800);
    const badges = await page.$$eval('.ai-badge', bs => bs.map(b => b.textContent.trim()));
    report.push(`screenshot 3 (page scan, ${scanned?.scanned ?? '?'} images): ${badges.join(' | ')}`);
    await page.mouse.move(1270, 710);
    const shot3 = await page.screenshot();

    // ── 4. Popup ──────────────────────────────────────────────────────────
    const popup = await browser.newPage();
    await popup.setViewport({ width: 400, height: 760, deviceScaleFactor: 2 });
    await popup.goto(env.extUrl('popup.html'), { waitUntil: 'networkidle2' });
    await sleep(500);
    const popupShot = await popup.screenshot({ clip: await (await popup.$('body')).boundingBox() });
    await popup.close();

    // ── 5. Welcome / onboarding ───────────────────────────────────────────
    const welcome = await browser.newPage();
    await welcome.setViewport(RAW);
    await welcome.goto(env.extUrl('welcome.html'), { waitUntil: 'networkidle2' });
    await welcome.evaluate(() => { document.body.style.zoom = '0.8'; });
    await sleep(300);
    const shot5 = await welcome.screenshot();
    await welcome.close();

    // ── Compose 1280x800 screenshots ──────────────────────────────────────
    const shots = [
      ['Hover any photo to check it for AI', dataUrl(shot1)],
      shot2 && ['Real photos come back clean, with a confidence score', dataUrl(shot2)],
      ['Scan a whole page in one click', dataUrl(shot3)],
      ['3 free scans a day. No account needed.', dataUrl(shot3),
        `<div style="position:absolute;inset:0;background:rgba(10,14,26,0.55)"></div>
         <img src="${dataUrl(popupShot)}" alt="" style="position:absolute;top:12px;right:40px;height:700px;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.6)">`],
      ['Set up in under a minute', dataUrl(shot5)],
    ].filter(Boolean);
    let n = 0;
    for (const [caption, img, overlay] of shots) {
      const buf = await render(browser, captioned(caption, img, overlay), 1280, 800);
      fs.writeFileSync(path.join(OUT, `screenshot-${++n}.png`), buf);
    }
    if (!shot2) report.push('⚠️  No real-photo sample came back "No AI Detected", so that screenshot was skipped.');

    // ── Promo images ──────────────────────────────────────────────────────
    fs.writeFileSync(path.join(OUT, 'small-tile-440x280.png'), await render(browser, `<!DOCTYPE html><html><head><style>${NOIR}
      body { width: 440px; height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
             background: radial-gradient(circle at 50% 35%, #1e2536 0%, #0a0e1a 75%); }
      img { width: 88px; height: 88px; } h1 { font-size: 44px; font-weight: 800; } p { font-size: 20px; color: #cbd5e1; }
    </style></head><body><img src="${ICON}" alt=""><h1 class="gold">Faux Spy</h1><p>Spot AI-generated photos</p></body></html>`, 440, 280));

    fs.writeFileSync(path.join(OUT, 'marquee-1400x560.png'), await render(browser, `<!DOCTYPE html><html><head><style>${NOIR}
      body { width: 1400px; height: 560px; display: flex; align-items: center; justify-content: space-between; padding: 0 90px;
             background: radial-gradient(circle at 75% 50%, #1e2536 0%, #0a0e1a 70%); }
      .copy img { width: 96px; height: 96px; margin-bottom: 22px; }
      h1 { font-size: 64px; font-weight: 800; line-height: 1.05; margin-bottom: 18px; }
      p { font-size: 26px; color: #cbd5e1; max-width: 560px; }
      .ui { max-height: 470px; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,0.65); }
    </style></head><body>
      <div class="copy"><img src="${ICON}" alt=""><h1 class="gold">Spy on the fakes.</h1><p>Check any photo for AI before you trust it.</p></div>
      <img class="ui" src="${dataUrl(panelShot)}" alt="">
    </body></html>`, 1400, 560));

    // ── Demo clip (silent) ────────────────────────────────────────────────
    await freshScanBudget(env);
    await env.setStorage({ scanMode: 'detective' });
    const demo = await browser.newPage();
    await demo.setViewport(RAW);
    // Headless screencasts don't show the mouse, so draw one.
    await demo.evaluateOnNewDocument(() => {
      addEventListener('DOMContentLoaded', () => {
        const c = document.createElement('div');
        c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;left:-50px;top:-50px;' +
          'background:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M4 2l16 9-7 2-3 7z%27 fill=%27white%27 stroke=%27black%27 stroke-width=%271.5%27/%3E%3C/svg%3E") no-repeat;';
        document.body.appendChild(c);
        addEventListener('mousemove', e => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
      });
    });
    await demo.goto(profile, { waitUntil: 'networkidle2' });
    const recorder = await demo.screencast({ path: path.join(OUT, 'demo.webm'), ffmpegPath });
    const glide = async (sel, steps = 30) => {
      const b = await (await demo.$(sel)).boundingBox();
      await demo.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
    };
    await demo.mouse.move(640, 650);
    await sleep(1200);
    await glide('#p1');
    await sleep(900);
    await demo.waitForSelector('.ai-detector-widget.visible', { timeout: 5000 });
    await glide('.ai-detector-widget #ai-check-btn', 12);
    await sleep(400);
    await demo.click('.ai-detector-widget #ai-check-btn');
    await demo.waitForSelector('.ai-result-panel-v8', { visible: true, timeout: 30000 });
    await sleep(4500);
    await demo.keyboard.press('Escape');
    await sleep(600);
    await glide(shot2 ? '#p4' : '#p2');
    await sleep(900);
    await demo.waitForSelector('.ai-detector-widget.visible', { timeout: 5000 });
    await glide('.ai-detector-widget #ai-check-btn', 12);
    await sleep(400);
    await demo.click('.ai-detector-widget #ai-check-btn');
    await demo.waitForSelector('.ai-result-panel-v8', { visible: true, timeout: 30000 });
    await sleep(4500);
    await demo.keyboard.press('Escape');
    await sleep(800);
    // Then scan the whole page (what the popup's "Investigate Page" does).
    await freshScanBudget(env);
    await env.setStorage({ scanMode: 'quick' });
    await demo.reload({ waitUntil: 'networkidle2' });
    await demo.mouse.move(640, 680, { steps: 10 });
    await sleep(1200);
    await demo.bringToFront();
    await env.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return chrome.tabs.sendMessage(tab.id, { action: 'scanVisible' });
    });
    await demo.waitForFunction(() => document.querySelectorAll('.ai-badge').length >= 4, { timeout: 60000 }).catch(() => {});
    await sleep(4000);
    await recorder.stop();

    // YouTube and most players want H.264 in yuv420p; the screencast is VP9/RGB.
    const { execFileSync } = require('child_process');
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-i', path.join(OUT, 'demo.webm'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', path.join(OUT, 'demo.mp4')]);
    report.push('demo.webm + demo.mp4 recorded');
  } finally {
    await env.close();
  }

  console.log(report.map(l => `  ${l}`).join('\n'));
  console.log(`\n✅ Media written to ${path.relative(ROOT, OUT)}${path.sep}`);
}

main().catch(e => { console.error('❌ Capture failed:', e); process.exit(1); });
