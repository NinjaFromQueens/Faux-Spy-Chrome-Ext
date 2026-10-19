// Lightweight Sentry reporter for Chrome Extension service worker (no SDK required)
const SENTRY_DSN = 'https://673ca7f85364b0d07aad9469b32737b2@o4511531878252544.ingest.us.sentry.io/4511531895750656';

let _sentryKey, _sentryHost, _sentryProject;
(function initSentry() {
  try {
    const url = new URL(SENTRY_DSN);
    _sentryKey = url.username;
    _sentryHost = url.host;
    _sentryProject = url.pathname.replace(/^\//, '');
  } catch {}
})();

// Firefox: error reports are "technical and interaction" data, which Mozilla
// requires to be optional (manifest data_collection_permissions). Only send
// them if the user allowed it at install or later in about:addons.
const _sentryIsFirefox = typeof chrome !== 'undefined' && chrome?.runtime?.getURL?.('').startsWith('moz-extension:');
let _sentryAllowed = _sentryIsFirefox ? null : true; // null = not checked yet

async function _sentryConsent() {
  if (_sentryAllowed !== null) return _sentryAllowed;
  try {
    _sentryAllowed = await browser.permissions.contains({ data_collection: ['technicalAndInteraction'] });
  } catch {
    _sentryAllowed = false; // can't confirm consent, so don't send
  }
  return _sentryAllowed;
}

if (_sentryIsFirefox && typeof browser !== 'undefined' && browser.permissions?.onAdded) {
  const recheck = () => { _sentryAllowed = null; };
  browser.permissions.onAdded.addListener(recheck);
  browser.permissions.onRemoved.addListener(recheck);
}

async function sentryCapture(message, opts = {}) {
  if (!_sentryKey) return;
  try {
    if (!(await _sentryConsent())) return;
    const manifest = (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest?.()) || {};
    const payload = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: opts.level || 'error',
      logger: 'faux-spy-extension',
      release: manifest.version || 'unknown',
      message,
      tags: { extension_version: manifest.version || 'unknown', ...opts.tags },
      extra: opts.extra || {},
      ...(opts.userId ? { user: { id: opts.userId } } : {})
    };
    await fetch(`https://${_sentryHost}/api/${_sentryProject}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${_sentryKey}, sentry_client=faux-spy/1.0`
      },
      body: JSON.stringify(payload)
    });
  } catch {}
}
