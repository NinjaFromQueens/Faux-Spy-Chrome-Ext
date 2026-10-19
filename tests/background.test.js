// Unit tests for the extension's background scripts.
//
// Loads background.js (+ license.js, sentry-reporter.js) into one shared
// global scope exactly as each browser does — Chrome via importScripts in the
// service worker, Firefox via manifest background.scripts — with stubbed
// chrome.* APIs and fetch, then drives real messages through the listeners.
//
// Usage: npm test

'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// EXT_DIR lets you run the suite against another build (e.g. an older release).
const EXT = process.env.EXT_DIR || path.resolve(__dirname, '..', 'faux-spy-extension');
const read = f => fs.readFileSync(path.join(EXT, f), 'utf8');

function makeEnv(browser, { ortStub = null } = {}) {
  const storage = {};
  const listeners = { message: [], installed: [], startup: [], changed: [], other: [] };
  const errors = [];
  const fetchLog = [];
  const tabsCreated = [];
  let uninstallUrl = null;
  const env = { storage, listeners, errors, fetchLog, tabsCreated, fetchImpl: async () => { throw new Error('no fetch impl'); } };
  const evt = name => ({ addListener: fn => listeners[name].push(fn) });
  const manifest = JSON.parse(read(browser === 'firefox' ? 'manifest.firefox.json' : 'manifest.json'));
  const local = {
    get(keys, cb) {
      const ks = keys == null ? Object.keys(storage) : [].concat(keys);
      const out = {};
      for (const k of ks) if (k in storage) out[k] = JSON.parse(JSON.stringify(storage[k]));
      if (cb) { cb(out); return; }
      return Promise.resolve(out);
    },
    set(obj, cb) { Object.assign(storage, JSON.parse(JSON.stringify(obj))); if (cb) { cb(); return; } return Promise.resolve(); },
  };
  const chrome = {
    runtime: {
      onMessage: evt('message'), onInstalled: evt('installed'), onStartup: evt('startup'), onConnect: evt('other'),
      getURL: p => `chrome-extension://x/${p}`, getManifest: () => manifest,
      setUninstallURL: u => { uninstallUrl = u; }, lastError: null,
    },
    storage: { local, onChanged: evt('changed') },
    contextMenus: { create: (o, cb) => cb && cb(), onClicked: evt('other') },
    tabs: { create: o => { tabsCreated.push(o.url); }, sendMessage: async () => {} },
  };
  const ctx = {
    chrome, console: { log() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Error, TypeError, Object, Array, String, Number, Boolean, Map, Set, URL, URLSearchParams,
    AbortController, DOMException, TextEncoder, btoa, atob, Uint8Array, Float32Array, ArrayBuffer, crypto: globalThis.crypto,
    // Detect timeouts fire fast in tests; everything else unchanged.
    AbortSignal: { timeout: ms => AbortSignal.timeout(ms >= 20000 && ms < 60000 ? 60 : ms) },
    fetch: (url, opts) => { fetchLog.push(String(url)); return env.fetchImpl(String(url), opts || {}); },
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) },
    ort: ortStub || undefined,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  const run = f => vm.runInContext(read(f), ctx, { filename: f });
  // Firefox background pages have no importScripts; the shim installs a no-op.
  if (browser !== 'firefox') {
    ctx.importScripts = (...files) => {
      for (const f of files) {
        if (f === 'ort.min.js') { if (!ortStub) throw new Error('ort not loaded in test'); continue; }
        run(f);
      }
    };
  }
  env.ctx = ctx;
  env.uninstallUrl = () => uninstallUrl;
  env.load = () => {
    if (browser === 'firefox') {
      for (const f of manifest.background.scripts) run(f);
    } else {
      run(manifest.background.service_worker);
    }
  };
  env.send = msg => new Promise(resolve => {
    let done = false;
    for (const l of listeners.message) {
      const keepOpen = l(msg, {}, r => { if (!done) { done = true; resolve(r); } });
      if (keepOpen === true) return;
    }
    if (!done) resolve(undefined);
  });
  return env;
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const results = [];
const check = (name, cond, detail) => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + JSON.stringify(detail).slice(0, 240)}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scan = (env, src = 'https://cdn.example.com/a.jpg') =>
  env.send({ action: 'analyzeImage', imageData: { src, width: 800, height: 800, pageHost: 'www.tinder.com' } });
const PRO = { isPro: true, key: 'FAUX-1111-2222-3333-4444', plan: 'monthly', tokenBalance: 10, topupBalance: 0, features: { videoDetection: true } };

function freshEnv(license = PRO, opts) {
  const env = makeEnv('chrome', opts);
  env.load();
  env.storage.userId = 'fs_test';
  env.storage.license = license;
  env.storage.lastLicenseCheck = Date.now();
  return env;
}

// Node exits when only promise callbacks are pending; keep it alive until done.
const keepAlive = setInterval(() => {}, 1000);

(async () => {
  // ── Loading ──────────────────────────────────────────────────────────────
  for (const browser of ['chrome', 'firefox']) {
    const env = makeEnv(browser);
    let loadErr = null;
    try { env.load(); } catch (e) { loadErr = e.message; }
    check(`${browser}: background scripts load without errors`, !loadErr && !env.errors.some(e => /license\.js|already been declared/.test(e)), { loadErr, errors: env.errors });
    check(`${browser}: license functions available to background`, typeof env.ctx.getLicense === 'function' && typeof env.ctx.revalidateLicense === 'function', {});
    check(`${browser}: image + video message handlers registered`, env.listeners.message.length >= 2, env.listeners.message.length);
  }

  // ── Manifests ────────────────────────────────────────────────────────────
  for (const m of ['manifest.json', 'manifest.firefox.json']) {
    const j = JSON.parse(read(m));
    check(`${m}: no web_accessible_resources (sites can't fingerprint the extension)`, !('web_accessible_resources' in j), j.web_accessible_resources);
  }
  const versions = ['manifest.json', 'manifest.firefox.json'].map(m => JSON.parse(read(m)).version);
  check('Chrome and Firefox manifests have the same version', versions[0] === versions[1], versions);

  // ── Install / uninstall ──────────────────────────────────────────────────
  {
    const env = makeEnv('chrome'); env.load();
    env.listeners.installed.forEach(fn => fn({ reason: 'install' }));
    check('first install opens the welcome page', env.tabsCreated.length === 1 && env.tabsCreated[0].endsWith('/welcome.html'), env.tabsCreated);
    const env2 = makeEnv('chrome'); env2.load();
    env2.listeners.installed.forEach(fn => fn({ reason: 'update', previousVersion: '1.9.6' }));
    env2.listeners.installed.forEach(fn => fn({ reason: 'chrome_update' }));
    check('updates never open the welcome page', env2.tabsCreated.length === 0, env2.tabsCreated);
    check('uninstall survey URL set with current version', env.uninstallUrl() === `https://www.fauxspy.com/goodbye?v=${versions[0]}`, env.uninstallUrl());
  }

  // ── Scan outcomes ────────────────────────────────────────────────────────
  async function scenario(name, { license = PRO, fetchImpl, expect, opts }) {
    const env = freshEnv(license, opts);
    env.fetchImpl = fetchImpl;
    const r = await scan(env);
    await sleep(20);
    check(name, expect(r, env), r);
  }
  const detectOnly = (handler) => async (u, o) => (u.includes('/api/detect') ? handler(u, o) : json(200, {}));

  await scenario('Pro out of tokens -> TOKENS_EXHAUSTED (not a guessed verdict)', {
    fetchImpl: detectOnly(async () => json(402, { error: 'TOKENS_EXHAUSTED', buyUrl: 'https://fauxspy.com/buy-tokens' })),
    expect: r => r.error === 'TOKENS_EXHAUSTED' && r.verdictLabel === undefined,
  });
  await scenario('backend error -> error with readable message, no verdict', {
    fetchImpl: detectOnly(async () => json(500, { error: 'SERVICE_BUSY' })),
    expect: r => r.error === 'SERVICE_BUSY' && /busy/i.test(r.message) && r.method === 'error',
  });
  await scenario('offline -> NETWORK_ERROR, no verdict', {
    fetchImpl: detectOnly(async () => { throw new TypeError('Failed to fetch'); }),
    expect: r => r.error === 'NETWORK_ERROR' && /connection/.test(r.message) && r.method === 'error',
  });
  await scenario('hung request -> DETECTION_TIMEOUT instead of blocking forever', {
    fetchImpl: (u, o) => u.includes('/api/detect')
      ? new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason)))
      : Promise.resolve(json(200, {})),
    expect: r => r.error === 'DETECTION_TIMEOUT',
  });
  await scenario('image too small -> "Image Too Small" result, not an error', {
    license: { isPro: false, plan: 'free' },
    fetchImpl: detectOnly(async () => json(200, { success: true, verdict: 'insufficient_data', category: 'insufficient_data', verdictLabel: 'Image Too Small' })),
    expect: r => !r.error && r.category === 'insufficient_data' && r.method === 'pre_check_failed',
  });
  await scenario('successful scan -> verdict passes through', {
    fetchImpl: detectOnly(async () => json(200, { success: true, isAI: true, aiProbability: 0.93, category: 'ai_photo', verdictLabel: 'AI Photo', tokenBalance: 9 })),
    expect: r => !r.error && r.verdictLabel === 'AI Photo' && r.method === 'sightengine_api',
  });
  await scenario('daily limit -> DAILY_LIMIT_REACHED, copy no longer says "unlimited"', {
    license: { isPro: false, plan: 'free' },
    fetchImpl: detectOnly(async () => json(429, { error: 'DAILY_LIMIT_REACHED', used: 3, limit: 3 })),
    expect: r => r.error === 'DAILY_LIMIT_REACHED' && !JSON.stringify(r).toLowerCase().includes('unlimited'),
  });
  {
    const env = freshEnv();
    env.fetchImpl = async () => json(200, {});
    const r = await scan(env, 'blob:https://x/abc');
    check('blob: image -> UNSCANNABLE_URL with message, no backend call', r.error === 'UNSCANNABLE_URL' && r.message && !env.fetchLog.some(u => u.includes('/api/detect')), r);
  }

  // ── Local model never blocks a scan ──────────────────────────────────────
  {
    // ort is available but the model isn't cached and its download never finishes.
    const ortStub = { env: { wasm: {} }, InferenceSession: { create: async () => ({}) }, Tensor: function () {} };
    const env = freshEnv({ isPro: false, plan: 'free' }, { ortStub });
    env.fetchImpl = (u, o) => {
      if (u.includes('ai-detector.onnx')) return new Promise((_, rej) => o.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
      if (u.includes('/api/detect')) return Promise.resolve(json(200, { success: true, isAI: false, aiProbability: 0.1, category: 'real', verdictLabel: 'No AI Detected' }));
      return Promise.resolve(json(200, {}));
    };
    const t0 = Date.now();
    const r = await scan(env);
    const ms = Date.now() - t0;
    await sleep(20); // the background download starts on a later tick
    check('first scan goes straight to the API while the model downloads in background', !r.error && r.verdictLabel === 'No AI Detected' && ms < 1000 && env.fetchLog.some(u => u.includes('ai-detector.onnx')), { ms, r, fetches: env.fetchLog });
  }

  // ── Error reports don't carry the page's domain ──────────────────────────
  {
    const env = freshEnv();
    const sentryBodies = [];
    env.fetchImpl = async (u, o) => {
      if (u.includes('sentry.io')) { sentryBodies.push(String(o.body)); return json(200, {}); }
      if (u.includes('/api/detect')) return json(500, { error: 'SERVICE_BUSY' });
      return json(200, {});
    };
    await scan(env); await sleep(30);
    const all = sentryBodies.join('\n');
    check('error report names the platform ("Tinder"), not the page domain', sentryBodies.length > 0 && all.includes('Tinder') && !all.includes('www.tinder.com'), sentryBodies.map(b => b.slice(0, 200)));
  }

  // ── License re-validation ────────────────────────────────────────────────
  {
    const env = freshEnv();
    env.fetchImpl = async u => {
      if (u.includes('/api/detect')) return json(200, { success: true, category: 'real', verdictLabel: 'No AI Detected', aiProbability: 0.1, proDenied: true });
      if (u.includes('validate-license')) return json(200, { valid: false, error: 'Subscription cancelled' });
      return json(200, {});
    };
    await scan(env); await sleep(50);
    check('server says proDenied -> license re-checked and dropped to free', env.fetchLog.some(u => u.includes('validate-license')) && env.storage.license.isPro === false, env.storage.license);
  }
  {
    const env = freshEnv();
    env.storage.lastLicenseCheck = Date.now() - 2 * 86400000; // stale
    env.fetchImpl = async u => {
      if (u.includes('validate-license')) return json(500, { valid: false, error: 'Validation failed' });
      if (u.includes('/api/detect')) return json(200, { success: true, category: 'real', verdictLabel: 'No AI Detected', aiProbability: 0.1 });
      return json(200, {});
    };
    await scan(env); await sleep(20);
    const nextCheckIn = env.storage.lastLicenseCheck + 86400000 - Date.now();
    check('stale Pro license is re-checked during a scan', env.fetchLog.some(u => u.includes('validate-license')), env.fetchLog);
    check('server 5xx on re-check keeps Pro, retries in ~1h (not every scan)', env.storage.license.isPro === true && nextCheckIn > 55 * 60000 && nextCheckIn < 65 * 60000, { isPro: env.storage.license.isPro, nextCheckInMin: Math.round(nextCheckIn / 60000) });
  }
  {
    const env = freshEnv();
    env.storage.lastLicenseCheck = Date.now() - 2 * 86400000;
    env.fetchImpl = async u => (u.includes('validate-license') ? json(200, { valid: true, plan: 'monthly', tokenBalance: 77, topupBalance: 0 }) : json(200, {}));
    env.listeners.startup.forEach(fn => fn()); await sleep(30);
    check('browser startup re-validates a stale Pro license', env.storage.license.tokenBalance === 77, env.storage.license);
  }

  // ── Video ────────────────────────────────────────────────────────────────
  async function video(name, status, body, expect) {
    const env = freshEnv();
    env.fetchImpl = async u => {
      if (u.includes('detect-video')) return json(status, body);
      if (u.includes('validate-license')) return json(200, { valid: false, error: 'License expired' });
      return json(200, {});
    };
    const r = await env.send({ action: 'analyzeVideo', videoData: { src: 'https://cdn.example.com/v.mp4' } });
    await sleep(30);
    check(name, expect(r, env), r);
  }
  await video('video 402 -> TOKENS_EXHAUSTED reaches the page', 402, { error: 'TOKENS_EXHAUSTED', tokenBalance: 3, topupBalance: 0 }, r => r.error === 'TOKENS_EXHAUSTED');
  await video('video 403 expired -> LICENSE_EXPIRED + message, license re-checked', 403, { error: 'LICENSE_EXPIRED', message: 'Your subscription has expired. Renew at fauxspy.com/pro.' },
    (r, env) => r.error === 'LICENSE_EXPIRED' && /expired/.test(r.message) && env.storage.license.isPro === false);
  await video('video 502 with non-JSON body -> INTERNAL_ERROR with status', 502, undefined, r => r.error === 'INTERNAL_ERROR' && /502/.test(r.message));

  clearInterval(keepAlive);
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
