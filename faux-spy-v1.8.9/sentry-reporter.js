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

async function sentryCapture(message, opts = {}) {
  if (!_sentryKey) return;
  try {
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
