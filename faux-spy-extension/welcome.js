'use strict';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension:');

if (isMac) document.getElementById('modKey').textContent = '⌘';

if (isFirefox) {
  document.getElementById('pinHint').textContent =
    'Click the Extensions button (the puzzle piece) in the toolbar, then the gear next to Faux Spy and choose "Pin to Toolbar". Then clicking the Faux Spy icon shows your scans left today and lets you scan a whole page.';
}

document.getElementById('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('enterKey').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
