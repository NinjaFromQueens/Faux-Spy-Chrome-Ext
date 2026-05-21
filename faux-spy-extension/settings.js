// ============================================================================

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// Faux Spy v1.3 Settings Page
// Primary: Sightengine (recommended)
// Secondary: Hive AI (legacy support)
// ============================================================================

'use strict';

// Sightengine elements
const seApiUserInput = document.getElementById('seApiUser');
const seApiSecretInput = document.getElementById('seApiSecret');
const showSightengineKeysCheckbox = document.getElementById('showSightengineKeys');
const saveSightengineBtn = document.getElementById('saveSightengineBtn');
const testSightengineBtn = document.getElementById('testSightengineBtn');
const clearSightengineBtn = document.getElementById('clearSightengineBtn');
const sightengineStatusDiv = document.getElementById('sightengineStatus');
const sightengineTestResultsDiv = document.getElementById('sightengineTestResults');

// Hive elements (legacy)
const apiTokenInput = document.getElementById('apiToken');
const accessIdInput = document.getElementById('accessId');
const secretKeyInput = document.getElementById('secretKey');
const showKeysCheckbox = document.getElementById('showKeys');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const testResultsDiv = document.getElementById('testResults');
const singleKeyFields = document.getElementById('singleKeyFields');
const dualKeyFields = document.getElementById('dualKeyFields');

// Sensitivity
const sensitivitySelect = document.getElementById('sensitivity');

// Toggle Hive auth format
document.querySelectorAll('input[name="keyFormat"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'single') {
      singleKeyFields.style.display = 'block';
      dualKeyFields.style.display = 'none';
    } else {
      singleKeyFields.style.display = 'none';
      dualKeyFields.style.display = 'block';
    }
  });
});

// Load existing settings
async function loadSettings() {
  const data = await chrome.storage.local.get([
    'sightengineApiUser',
    'sightengineApiSecret',
    'hiveApiKey',
    'hiveAccessId',
    'hiveSecretKey',
    'aiSensitivity',
    'apiStats'
  ]);
  
  // Load Sightengine credentials
  if (data.sightengineApiUser) seApiUserInput.value = data.sightengineApiUser;
  if (data.sightengineApiSecret) seApiSecretInput.value = data.sightengineApiSecret;
  
  // Load Hive credentials
  if (data.hiveApiKey) {
    apiTokenInput.value = data.hiveApiKey;
    document.querySelector('input[name="keyFormat"][value="single"]').checked = true;
    singleKeyFields.style.display = 'block';
    dualKeyFields.style.display = 'none';
  } else if (data.hiveAccessId || data.hiveSecretKey) {
    if (data.hiveAccessId) accessIdInput.value = data.hiveAccessId;
    if (data.hiveSecretKey) secretKeyInput.value = data.hiveSecretKey;
    document.querySelector('input[name="keyFormat"][value="dual"]').checked = true;
    singleKeyFields.style.display = 'none';
    dualKeyFields.style.display = 'block';
  }
  
  if (data.aiSensitivity) {
    sensitivitySelect.value = data.aiSensitivity;
  } else {
    sensitivitySelect.value = 'balanced';
  }
  
  if (data.apiStats) {
    updateStats(data.apiStats);
  }
  
  log('✅ Settings loaded');
}

// ============================================================================
// SIGHTENGINE FUNCTIONS
// ============================================================================

async function saveSightengineSettings() {
  const apiUser = seApiUserInput.value.trim();
  const apiSecret = seApiSecretInput.value.trim();
  const sensitivity = sensitivitySelect.value;
  
  if (!apiUser || !apiSecret) {
    showSightengineStatus('❌ Please enter both API user and API secret', 'error');
    return;
  }
  
  try {
    await chrome.storage.local.set({
      sightengineApiUser: apiUser,
      sightengineApiSecret: apiSecret,
      aiSensitivity: sensitivity,
      apiKeySet: true
    });
    
    // Notify content scripts
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'sensitivityChanged',
          sensitivity: sensitivity
        });
      } catch (error) { /* ignore */ }
    }
    
    showSightengineStatus('✅ Sightengine credentials saved! Click "Test Connection" to verify', 'success');
  } catch (error) {
    console.error('Save error:', error);
    showSightengineStatus('❌ Failed to save settings', 'error');
  }
}

async function testSightengine() {
  testSightengineBtn.disabled = true;
  testSightengineBtn.textContent = '🔄 Testing...';
  sightengineTestResultsDiv.innerHTML = '<div style="color: #94a3b8; padding: 8px;">Calling Sightengine directly...</div>';
  
  // Get current values from inputs (don't rely on save)
  const apiUser = seApiUserInput.value.trim();
  const apiSecret = seApiSecretInput.value.trim();
  
  if (!apiUser || !apiSecret) {
    sightengineTestResultsDiv.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 12px; color: #f87171;">
        <strong>❌ Missing credentials</strong><br>
        <small>Enter both API user and API secret first.</small>
      </div>
    `;
    testSightengineBtn.disabled = false;
    testSightengineBtn.textContent = '🧪 Test Connection';
    return;
  }
  
  // Save credentials first
  await chrome.storage.local.set({
    sightengineApiUser: apiUser,
    sightengineApiSecret: apiSecret
  });
  
  // Use Sightengine's own test image
  const testImageUrl = 'https://sightengine.com/assets/img/examples/example-prop-c2.jpg';
  
  // CRITICAL: Call Sightengine API DIRECTLY from the settings page
  // This gives us full visibility into what's happening
  try {
    const params = new URLSearchParams({
      url: testImageUrl,
      models: 'genai',
      api_user: apiUser,
      api_secret: apiSecret
    });
    
    const apiUrl = `https://api.sightengine.com/1.0/check.json?${params.toString()}`;
    
    log('🧪 [TEST] Calling Sightengine API directly...');
    log('🧪 [TEST] API user:', apiUser);
    log('🧪 [TEST] API secret (first 8 chars):', apiSecret.substring(0, 8) + '...');
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    const responseText = await response.text();
    log('🧪 [TEST] HTTP status:', response.status);
    log('🧪 [TEST] Raw response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }
    
    if (data.status === 'success') {
      // v1.3.2 FIX: ai_generated is nested inside data.type
      // Real Sightengine response: { status: "success", type: { ai_generated: 0.01 }, ... }
      const aiScore = data.type?.ai_generated ?? data.ai_generated;
      
      if (typeof aiScore !== 'number') {
        sightengineTestResultsDiv.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 12px; color: #f87171;">
            <strong>❌ Score not found in response</strong><br>
            <small style="color: #94a3b8;">API returned success but no ai_generated score. Maybe the GenAI model isn't enabled?</small>
            <details style="margin-top: 8px; color: #94a3b8;">
              <summary style="cursor: pointer; color: #fbbf24;">Show response</summary>
              <pre style="margin-top: 8px; font-size: 11px; white-space: pre-wrap;">${JSON.stringify(data, null, 2)}</pre>
            </details>
          </div>
        `;
        return;
      }
      
      // SUCCESS!
      const score = (aiScore * 100).toFixed(1);
      const verdict = aiScore > 0.5 ? 'AI-generated' : 'Real/Human-made';
      
      sightengineTestResultsDiv.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 12px; color: #34d399;">
          <strong>✅ Sightengine Connected Successfully!</strong><br>
          <small style="color: #94a3b8; display: block; margin-top: 6px;">
            Test image classified as: <strong>${verdict}</strong> (${score}% AI confidence)<br>
            Faux Spy will now use Sightengine for all detections.
          </small>
        </div>
      `;
      showSightengineStatus('✅ Sightengine is working!', 'success', 5000);
      
    } else if (data.status === 'failure') {
      // API returned a structured error
      const errorMsg = data.error?.message || 'Unknown API error';
      const errorType = data.error?.type || 'unknown';
      const errorCode = data.error?.code || '';
      
      sightengineTestResultsDiv.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px; color: #f87171;">
          <strong>❌ Sightengine API Error</strong><br>
          <small style="color: #fbbf24; display: block; margin-top: 6px;">${errorType}${errorCode ? ` (${errorCode})` : ''}</small>
          <small style="color: #cbd5e1; display: block; margin-top: 4px;">${errorMsg}</small>
          
          ${errorType.includes('credential') || errorType.includes('auth') ? `
            <div style="margin-top: 12px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 6px;">
              <strong style="color: #fbbf24;">Likely cause:</strong>
              <small style="color: #cbd5e1; display: block;">Your API user or secret is wrong. Double-check from sightengine.com → Account → API.</small>
            </div>
          ` : ''}
          
          ${errorType.includes('quota') || errorType.includes('limit') ? `
            <div style="margin-top: 12px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 6px;">
              <strong style="color: #fbbf24;">Likely cause:</strong>
              <small style="color: #cbd5e1; display: block;">You've used your free quota. Wait until next month or upgrade.</small>
            </div>
          ` : ''}
          
          ${errorType.includes('model') ? `
            <div style="margin-top: 12px; padding: 8px; background: rgba(251, 191, 36, 0.1); border-radius: 6px;">
              <strong style="color: #fbbf24;">Likely cause:</strong>
              <small style="color: #cbd5e1; display: block;">Enable the GenAI model in your Sightengine dashboard.</small>
            </div>
          ` : ''}
          
          <details style="margin-top: 12px; color: #94a3b8;">
            <summary style="cursor: pointer; color: #fbbf24;">▼ Show full response</summary>
            <pre style="margin-top: 8px; font-size: 11px; white-space: pre-wrap; word-break: break-all; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">${JSON.stringify(data, null, 2)}</pre>
          </details>
        </div>
      `;
      
    } else {
      // Unexpected response shape
      sightengineTestResultsDiv.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 12px; color: #f87171;">
          <strong>❌ Unexpected response format</strong><br>
          <small style="color: #94a3b8;">HTTP ${response.status}</small>
          <details style="margin-top: 8px; color: #94a3b8;">
            <summary style="cursor: pointer; color: #fbbf24;">Show response</summary>
            <pre style="margin-top: 8px; font-size: 11px; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(data, null, 2)}</pre>
          </details>
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Test error:', error);
    const errDiv = document.createElement('div');
    errDiv.style.cssText = 'background: rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 12px; color: #f87171;';
    const errMsg = document.createElement('small');
    errMsg.style.cssText = 'color: #cbd5e1; display: block; margin-top: 4px;';
    errMsg.textContent = error.message;
    errDiv.innerHTML = '<strong>❌ Network Error</strong><br>';
    errDiv.appendChild(errMsg);
    const errHint = document.createElement('small');
    errHint.style.cssText = 'color: #94a3b8; display: block; margin-top: 8px;';
    errHint.textContent = 'This usually means: firewall, network issue, or browser extension permissions problem.';
    errDiv.appendChild(errHint);
    sightengineTestResultsDiv.innerHTML = '';
    sightengineTestResultsDiv.appendChild(errDiv);
  } finally {
    testSightengineBtn.disabled = false;
    testSightengineBtn.textContent = '🧪 Test Connection';
  }
}

async function clearSightengineSettings() {
  if (!confirm('Clear Sightengine credentials?')) return;
  
  seApiUserInput.value = '';
  seApiSecretInput.value = '';
  sightengineTestResultsDiv.innerHTML = '';
  
  await chrome.storage.local.set({
    sightengineApiUser: null,
    sightengineApiSecret: null
  });
  
  showSightengineStatus('🗑️ Sightengine credentials cleared', 'success');
}

// ============================================================================
// HIVE FUNCTIONS (Legacy)
// ============================================================================

async function saveHiveSettings() {
  const format = document.querySelector('input[name="keyFormat"]:checked').value;
  const sensitivity = sensitivitySelect.value;
  
  let saveData = { aiSensitivity: sensitivity };
  
  if (format === 'single') {
    const token = apiTokenInput.value.trim();
    if (!token) {
      showStatus('❌ Please enter your Hive API token', 'error');
      return;
    }
    saveData.hiveApiKey = token;
    saveData.hiveAccessId = null;
    saveData.hiveSecretKey = null;
  } else {
    const accessId = accessIdInput.value.trim();
    const secretKey = secretKeyInput.value.trim();
    if (!accessId || !secretKey) {
      showStatus('❌ Please enter both Access ID and Secret Key', 'error');
      return;
    }
    saveData.hiveApiKey = null;
    saveData.hiveAccessId = accessId;
    saveData.hiveSecretKey = secretKey;
  }
  
  saveData.workingHiveAuth = null;
  
  try {
    await chrome.storage.local.set(saveData);
    showStatus('✅ Hive settings saved (will only be used if Sightengine is not configured)', 'success');
  } catch (error) {
    showStatus('❌ Failed to save', 'error');
  }
}

async function testHive() {
  testBtn.disabled = true;
  testBtn.textContent = '🔄 Testing...';
  testResultsDiv.innerHTML = '<div style="color: #94a3b8; padding: 8px;">Trying multiple auth formats with Hive AI...</div>';
  
  await saveHiveSettings();
  
  // Temporarily disable Sightengine for this test
  const seData = await chrome.storage.local.get(['sightengineApiUser', 'sightengineApiSecret']);
  await chrome.storage.local.set({ sightengineApiUser: null, sightengineApiSecret: null });
  
  const testImageUrl = 'https://d24edro6ichpbm.thehive.ai/example-images/vlm-example-image.jpeg';
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'analyzeImage',
      imageData: {
        src: testImageUrl,
        width: 512,
        height: 512,
        pageUrl: 'test',
        pageHost: 'test',
        pageTitle: 'Hive API Test'
      }
    });
    
    if (response && response.method === 'hive_api') {
      testResultsDiv.innerHTML = `<div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; color: #34d399;"><strong>✅ Hive Working!</strong></div>`;
    } else {
      const errorMsg = response?.errorDetail || response?.indicators?.join(', ') || 'Unknown error';
      testResultsDiv.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.1); border-radius: 8px; padding: 12px; color: #f87171;">
          <strong>❌ Hive Failed</strong>
          <details style="margin-top: 8px;"><summary style="cursor: pointer; color: #fbbf24;">Details</summary>
          <pre style="margin-top: 8px; font-size: 11px; white-space: pre-wrap;">${errorMsg.substring(0, 300)}</pre>
          </details>
        </div>
      `;
    }
  } catch (error) {
    testResultsDiv.innerHTML = `<div style="background: rgba(239, 68, 68, 0.1); padding: 12px; color: #f87171;"><strong>❌ Failed:</strong> ${error.message}</div>`;
  } finally {
    // Restore Sightengine credentials
    if (seData.sightengineApiUser) {
      await chrome.storage.local.set(seData);
    }
    testBtn.disabled = false;
    testBtn.textContent = '🧪 Test Hive';
  }
}

async function clearHiveSettings() {
  if (!confirm('Clear all Hive credentials?')) return;
  
  apiTokenInput.value = '';
  accessIdInput.value = '';
  secretKeyInput.value = '';
  testResultsDiv.innerHTML = '';
  
  await chrome.storage.local.set({
    hiveApiKey: null,
    hiveAccessId: null,
    hiveSecretKey: null,
    workingHiveAuth: null
  });
  
  showStatus('🗑️ Hive credentials cleared', 'success');
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

showSightengineKeysCheckbox.addEventListener('change', (e) => {
  const type = e.target.checked ? 'text' : 'password';
  seApiSecretInput.type = type;
});

showKeysCheckbox.addEventListener('change', (e) => {
  const type = e.target.checked ? 'text' : 'password';
  apiTokenInput.type = type;
  accessIdInput.type = type;
  secretKeyInput.type = type;
});

function showStatus(message, type, duration = 3000) {
  statusDiv.textContent = message;
  statusDiv.className = 'status show ' + type;
  setTimeout(() => statusDiv.classList.remove('show'), duration);
}

function showSightengineStatus(message, type, duration = 3000) {
  sightengineStatusDiv.textContent = message;
  sightengineStatusDiv.className = 'status show ' + type;
  setTimeout(() => sightengineStatusDiv.classList.remove('show'), duration);
}

function updateStats(stats) {
  const totalEl = document.getElementById('totalScans');
  const cachedEl = document.getElementById('cachedResults');
  const apiEl = document.getElementById('apiCalls');
  if (totalEl) totalEl.textContent = stats.total || 0;
  if (cachedEl) cachedEl.textContent = stats.cached || 0;
  if (apiEl) apiEl.textContent = stats.apiCalls || 0;
}

// Event listeners
saveSightengineBtn.addEventListener('click', saveSightengineSettings);
testSightengineBtn.addEventListener('click', testSightengine);
clearSightengineBtn.addEventListener('click', clearSightengineSettings);

saveBtn.addEventListener('click', saveHiveSettings);
testBtn.addEventListener('click', testHive);
clearBtn.addEventListener('click', clearHiveSettings);

document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
  if (!confirm('Clear all cached scan results?')) return;
  await chrome.storage.local.remove('imageCache');
  showSightengineStatus('🗑️ Cache cleared', 'success');
});

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);

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

// Show appropriate license state based on stored license
async function refreshLicenseUI() {
  const { license } = await chrome.storage.local.get('license');
  
  if (license?.isPro && license?.key) {
    // Show Pro state
    freeTierState.style.display = 'none';
    proTierState.style.display = 'block';
    
    proPlan.textContent = license.plan === 'yearly' 
      ? 'Master Spy (Yearly)' 
      : 'Secret Agent (Monthly)';
    proEmail.textContent = license.email || '—';
    
    if (license.expiresAt) {
      const expiresDate = new Date(license.expiresAt);
      proExpires.textContent = expiresDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } else {
      proExpires.textContent = '—';
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
      // Call backend validation directly (extension's license.js can't be loaded in settings page)
      const response = await fetch('https://fauxspy.com/api/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key.toUpperCase() })
      });
      
      const data = await response.json();
      
      if (!data.valid) {
        showLicenseStatus('❌ ' + (data.message || data.error || 'License invalid'), 'error', 8000);
        return;
      }
      
      // Save license
      const license = {
        isPro: true,
        key: key.toUpperCase(),
        plan: data.plan,
        email: data.email,
        expiresAt: data.expiresAt,
        activatedAt: Date.now(),
        features: data.features,
        limits: {
          scansPerDay: -1,
          caching: true,
          batchScanning: true,
          maxBatchSize: 50
        }
      };
      
      await chrome.storage.local.set({
        license,
        lastLicenseCheck: Date.now()
      });
      
      showLicenseStatus('✅ Pro activated! Welcome, Secret Agent.', 'success', 5000);
      
      licenseKeyInput.value = '';
      
      // Refresh UI to show Pro state
      setTimeout(() => refreshLicenseUI(), 1000);
      
    } catch (error) {
      console.error('Activation error:', error);
      showLicenseStatus('❌ Network error. Check your connection.', 'error');
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
        scansPerDay: 10,
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
  licenseStatus.className = 'status show ' + type;
  setTimeout(() => licenseStatus.classList.remove('show'), duration);
}

function showLicenseStatus2(message, type, duration = 3000) {
  if (!licenseStatus2) return;
  licenseStatus2.textContent = message;
  licenseStatus2.className = 'status show ' + type;
  setTimeout(() => licenseStatus2.classList.remove('show'), duration);
}

// Refresh UI on load
refreshLicenseUI();
