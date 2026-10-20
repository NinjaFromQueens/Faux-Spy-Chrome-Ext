'use strict';

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };

// Sensitivity
const sensitivitySelect = document.getElementById('sensitivity');

// Video widget toggle
const showVideoWidgetCheckbox = document.getElementById('showVideoWidget');

// Load existing settings
async function loadSettings() {
  const data = await chrome.storage.local.get([
    'aiSensitivity',
    'showVideoWidget',
    'apiStats'
  ]);

  if (data.aiSensitivity) {
    sensitivitySelect.value = data.aiSensitivity;
  } else {
    sensitivitySelect.value = 'balanced';
  }

  if (showVideoWidgetCheckbox) {
    showVideoWidgetCheckbox.checked = data.showVideoWidget !== false;
  }

  if (data.apiStats) {
    updateStats(data.apiStats);
  }

  log('✅ Settings loaded');
}

function updateStats(stats) {
  const totalEl = document.getElementById('totalScans');
  const cachedEl = document.getElementById('cachedResults');
  const apiEl = document.getElementById('apiCalls');
  if (totalEl) totalEl.textContent = stats.total || 0;
  if (cachedEl) cachedEl.textContent = stats.cached || 0;
  if (apiEl) apiEl.textContent = stats.apiCalls || 0;
}

document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
  if (!confirm('Clear all cached scan results?')) return;
  await chrome.storage.local.remove('imageCache');
});

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiStats) {
    updateStats(changes.apiStats.newValue);
  }
});

// ============================================================================
// v1.6: License Management UI
// ============================================================================

const licenseKeyInput = document.getElementById('licenseKeyInput');
const activateLicenseBtn = document.getElementById('activateLicenseBtn');
const deactivateLicenseBtn = document.getElementById('deactivateLicenseBtn');
const licenseStatus = document.getElementById('licenseStatus');
const licenseStatus2 = document.getElementById('licenseStatus2');
const freeTierState = document.getElementById('freeTierState');
const proTierState = document.getElementById('proTierState');

const proPlan = document.getElementById('proPlan');
const proEmail = document.getElementById('proEmail');
const proExpires = document.getElementById('proExpires');
const proLicenseDisplay = document.getElementById('proLicenseDisplay');
const videoStatusBox = document.getElementById('videoStatusBox');
const videoUpgradeHint = document.getElementById('videoUpgradeHint');
const videoTokenBalance = document.getElementById('videoTokenBalance');
const proTokenBalance = document.getElementById('proTokenBalance');
const refreshLicenseLink = document.getElementById('refreshLicenseLink');

// Show appropriate license state based on stored license
async function refreshLicenseUI() {
  const { license } = await chrome.storage.local.get('license');

  if (license?.isPro && license?.key) {
    // Show Pro state
    freeTierState.style.display = 'none';
    proTierState.style.display = 'block';

    const hasVideo = license.features?.videoDetection;
    const planLabel = hasVideo
      ? 'Pro + Video'
      : (license.plan === 'yearly' ? 'Master Spy (Yearly)' : 'Secret Agent (Monthly)');
    proPlan.textContent = planLabel;
    proEmail.textContent = license.email || '—';

    const tokens = license.tokenBalance !== undefined
      ? `${((license.tokenBalance || 0) + (license.topupBalance || 0)).toLocaleString()} tokens`
      : '—';
    proTokenBalance.textContent = tokens;
    // The token page needs the key to show the balance and add tokens to it.
    const buyUrl = `https://www.fauxspy.com/buy-tokens?key=${encodeURIComponent(license.key)}`;
    document.getElementById('buyTokensLink').href = buyUrl;
    document.getElementById('buyVideoTokensLink').href = buyUrl;

    // Video detection status
    if (videoStatusBox && videoUpgradeHint) {
      if (hasVideo) {
        videoStatusBox.style.display = 'block';
        videoUpgradeHint.style.display = 'none';
        if (videoTokenBalance) videoTokenBalance.textContent = tokens;
      } else {
        videoStatusBox.style.display = 'none';
        videoUpgradeHint.style.display = 'block';
      }
    }

    const longDate = ms => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const onTrial = license.trialEndsAt && license.trialEndsAt > Date.now();
    // During a free trial the first charge is when the trial ends, so say so.
    document.getElementById('proExpiresLabel').textContent = onTrial ? 'Free trial ends:' : 'Renews:';
    if (onTrial) {
      proExpires.textContent = `${longDate(license.trialEndsAt)} (your plan and full allowance start then)`;
    } else {
      proExpires.textContent = license.expiresAt ? longDate(license.expiresAt) : '—';
    }

    proLicenseDisplay.textContent = license.key;
  } else {
    // Show Free state
    freeTierState.style.display = 'block';
    proTierState.style.display = 'none';
  }
}

// Activate license
if (activateLicenseBtn) {
  activateLicenseBtn.addEventListener('click', async () => {
    const key = licenseKeyInput.value.trim();

    if (!key) {
      showLicenseStatus('Please enter a license key', 'error');
      return;
    }

    activateLicenseBtn.disabled = true;
    activateLicenseBtn.textContent = '🔄 Activating...';
    licenseStatus.innerHTML = '';

    try {
      // Same code path as the automatic hand-off from the checkout page.
      const result = await chrome.runtime.sendMessage({ action: 'activateLicense', key });

      if (!result?.success) {
        showLicenseStatus('❌ ' + (result?.error || 'License could not be activated'), 'error', 8000);
        return;
      }

      showLicenseStatus('✅ Pro activated! Welcome, Secret Agent.', 'success', 5000);
      licenseKeyInput.value = '';
      // The storage listener below switches the page to the Pro state.
    } catch (error) {
      console.error('Activation error:', error);
      showLicenseStatus('❌ Something went wrong. Try again in a moment.', 'error');
    } finally {
      activateLicenseBtn.disabled = false;
      activateLicenseBtn.textContent = '🔓 Activate Pro';
    }
  });
}

// Deactivate license
if (deactivateLicenseBtn) {
  deactivateLicenseBtn.addEventListener('click', async () => {
    if (!confirm('Deactivate Pro on this device?\n\nYou can re-enter your license key anytime.\n\n(This does not cancel your subscription — visit Manage Subscription to do that.)')) {
      return;
    }

    const freeLicense = {
      isPro: false,
      plan: 'free',
      limits: {
        scansPerDay: 3,
        caching: false,
        batchScanning: false,
        maxBatchSize: 0
      }
    };

    await chrome.storage.local.set({
      license: freeLicense,
      lastLicenseCheck: Date.now()
    });

    showLicenseStatus2('🔓 License deactivated. Reverted to free tier.', 'success', 4000);

    setTimeout(() => refreshLicenseUI(), 1000);
  });
}

// Re-check the plan and token balance with the server now, e.g. right after
// a top-up, instead of waiting for the daily check.
if (refreshLicenseLink) {
  refreshLicenseLink.addEventListener('click', async (e) => {
    e.preventDefault();
    refreshLicenseLink.textContent = 'Refreshing…';
    try {
      const { license } = await chrome.runtime.sendMessage({ action: 'refreshLicense', force: true });
      if (license && !license.isPro) {
        showLicenseStatus('Your Pro plan is no longer active' + (license.previousIssue ? ` (${license.previousIssue})` : '') + '.', 'error', 8000);
      }
    } catch {
      showLicenseStatus2('❌ Could not reach Faux Spy. Try again in a moment.', 'error', 5000);
    } finally {
      refreshLicenseLink.textContent = 'Refresh';
    }
  });
}

// Activation can also happen from the checkout page in another tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.license) refreshLicenseUI();
});

// Helper: format license key as user types
if (licenseKeyInput) {
  licenseKeyInput.addEventListener('input', (e) => {
    let value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');

    // Auto-add dashes after every 4 chars (after FAUX-)
    if (value.startsWith('FAUX-')) {
      const parts = value.substring(5).replace(/-/g, '').match(/.{1,4}/g) || [];
      value = 'FAUX-' + parts.join('-');
    }

    // Cap length
    if (value.length > 24) value = value.substring(0, 24);

    e.target.value = value;
  });
}

function showLicenseStatus(message, type, duration = 3000) {
  if (!licenseStatus) return;
  licenseStatus.textContent = message;
  licenseStatus.className = 'status ' + type;
  setTimeout(() => { licenseStatus.className = 'status'; }, duration);
}

function showLicenseStatus2(message, type, duration = 3000) {
  if (!licenseStatus2) return;
  licenseStatus2.textContent = message;
  licenseStatus2.className = 'status ' + type;
  setTimeout(() => { licenseStatus2.className = 'status'; }, duration);
}

// Sensitivity auto-save
if (sensitivitySelect) {
  sensitivitySelect.addEventListener('change', async () => {
    const sensitivity = sensitivitySelect.value;
    await chrome.storage.local.set({ aiSensitivity: sensitivity });
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'sensitivityChanged', sensitivity });
      } catch (_) { /* tab may not have content script */ }
    }
    const statusEl = document.getElementById('sensitivityStatus');
    if (statusEl) {
      statusEl.textContent = '✅ Sensitivity saved';
      statusEl.className = 'status success';
      setTimeout(() => { statusEl.className = 'status'; }, 2500);
    }
  });
}

// Video widget toggle
if (showVideoWidgetCheckbox) {
  showVideoWidgetCheckbox.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await chrome.storage.local.set({ showVideoWidget: enabled });
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'toggleVideoWidget', enabled });
      } catch (_) { /* tab may not have content script */ }
    }
  });
}

// Refresh UI on load
refreshLicenseUI();
