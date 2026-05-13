// License Management Module v1.6

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// Handles license activation, validation, and Pro status
// Connects to fauxspy.com/api/validate-license

const BACKEND_URL = 'https://fauxspy.com';

// Re-validate license every 24 hours to catch cancellations
const LICENSE_RECHECK_INTERVAL = 24 * 60 * 60 * 1000;

// ============================================================================
// LICENSE ACTIVATION (when user enters key in settings)
// ============================================================================

/**
 * Activate a license key — call this when user submits key in settings
 * Returns { success: true, license } or { success: false, error }
 */
async function activateLicense(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { 
      success: false, 
      error: 'License key required' 
    };
  }
  
  // Normalize format
  const cleanKey = licenseKey.trim().toUpperCase();
  
  // Validate format before sending to server
  if (!cleanKey.match(/^FAUX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)) {
    return {
      success: false,
      error: 'Invalid format. License keys look like: FAUX-XXXX-XXXX-XXXX-XXXX'
    };
  }
  
  try {
    log('🔐 Activating license:', cleanKey);
    
    const response = await fetch(`${BACKEND_URL}/api/validate-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: cleanKey })
    });
    
    const data = await response.json();
    
    if (!data.valid) {
      console.warn('❌ License invalid:', data.error);
      return {
        success: false,
        error: data.message || data.error || 'License could not be validated'
      };
    }
    
    // License is valid! Save it
    const license = {
      isPro: true,
      key: cleanKey,
      plan: data.plan,
      email: data.email,
      expiresAt: data.expiresAt,
      activatedAt: Date.now(),
      features: data.features || {
        unlimitedScans: true,
        deepDive: true,
        caseFiles: true,
        priorityDetection: true
      },
      limits: {
        scansPerDay: -1, // -1 = unlimited
        caching: true,
        batchScanning: true,
        maxBatchSize: 50
      }
    };
    
    await chrome.storage.local.set({ 
      license,
      lastLicenseCheck: Date.now()
    });
    
    log('✅ License activated! Plan:', data.plan);
    
    return {
      success: true,
      license
    };
    
  } catch (error) {
    console.error('❌ License activation network error:', error);
    return {
      success: false,
      error: 'Network error. Check your connection and try again.'
    };
  }
}

/**
 * Deactivate the current license (logout)
 */
async function deactivateLicense() {
  await chrome.storage.local.set({
    license: getDefaultFreeLicense(),
    lastLicenseCheck: Date.now()
  });
  log('🔓 License deactivated, reverted to free tier');
}

// ============================================================================
// LICENSE VALIDATION (periodic re-check)
// ============================================================================

/**
 * Re-validate the stored license against backend
 * Called periodically to catch cancellations/expirations
 */
async function revalidateLicense() {
  const { license } = await chrome.storage.local.get('license');
  
  // No license stored, nothing to validate
  if (!license || !license.isPro || !license.key) {
    return getDefaultFreeLicense();
  }
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/validate-license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: license.key })
    });
    
    const data = await response.json();
    
    if (!data.valid) {
      // License became invalid — revert to free
      console.warn('⚠️ License no longer valid:', data.error);
      const freeLicense = getDefaultFreeLicense();
      freeLicense.previousIssue = data.error;
      await chrome.storage.local.set({
        license: freeLicense,
        lastLicenseCheck: Date.now()
      });
      return freeLicense;
    }
    
    // Update license with fresh info from server
    const updatedLicense = {
      ...license,
      expiresAt: data.expiresAt,
      plan: data.plan,
      features: data.features || license.features
    };
    
    await chrome.storage.local.set({
      license: updatedLicense,
      lastLicenseCheck: Date.now()
    });
    
    log('✅ License still valid, refreshed');
    return updatedLicense;
    
  } catch (error) {
    // Network error — keep using cached license but don't update timestamp
    // This way we'll retry next time, and license stays usable offline
    console.warn('⚠️ Could not revalidate (offline?):', error.message);
    return license;
  }
}

// ============================================================================
// LICENSE GETTERS (used throughout extension)
// ============================================================================

/**
 * Get current license — uses cache if fresh, revalidates if stale
 */
async function getLicense() {
  const { license, lastLicenseCheck } = await chrome.storage.local.get(['license', 'lastLicenseCheck']);
  
  // No license stored at all — first run
  if (!license) {
    const freeLicense = getDefaultFreeLicense();
    await chrome.storage.local.set({ 
      license: freeLicense,
      lastLicenseCheck: Date.now()
    });
    return freeLicense;
  }
  
  // Migration: normalize free tier to current 10 scans/day
  if (license && !license.isPro && license.limits && license.limits.scansPerDay !== 10) {
    license.limits.scansPerDay = 10;
    await chrome.storage.local.set({ license });
  }
  
  // If user has Pro license and it's stale, revalidate
  const isStale = !lastLicenseCheck || (Date.now() - lastLicenseCheck) > LICENSE_RECHECK_INTERVAL;
  
  if (license.isPro && isStale) {
    log('🔄 Pro license cache stale, revalidating...');
    return await revalidateLicense();
  }
  
  return license;
}

/**
 * Check if user can perform a scan (respects daily limits)
 */
async function canScan() {
  const license = await getLicense();
  
  // Pro users have unlimited scans
  if (license?.isPro) {
    return {
      allowed: true,
      remaining: -1, // Unlimited
      isPro: true,
    };
  }
  
  // Free users: check daily limit
  const today = new Date().toDateString();
  const { dailyScans, lastResetDate } = await chrome.storage.local.get(['dailyScans', 'lastResetDate']);
  
  let scans = (lastResetDate === today) ? (dailyScans || 0) : 0;
  
  // Reset counter if new day
  if (lastResetDate !== today) {
    await chrome.storage.local.set({ 
      dailyScans: 0, 
      lastResetDate: today,
    });
    scans = 0;
  }
  
  const limit = license.limits?.scansPerDay || 10;
  const remaining = Math.max(0, limit - scans);
  
  return {
    allowed: scans < limit,
    remaining,
    isPro: false,
    limit,
  };
}

/**
 * Increment daily scan count (for free users)
 */
async function incrementDailyScans() {
  const license = await getLicense();
  
  // Pro users don't have a counter
  if (license?.isPro) return;
  
  const today = new Date().toDateString();
  const { dailyScans, lastResetDate } = await chrome.storage.local.get(['dailyScans', 'lastResetDate']);
  
  let scans = (lastResetDate === today) ? (dailyScans || 0) : 0;
  
  await chrome.storage.local.set({ 
    dailyScans: scans + 1,
    lastResetDate: today,
  });
}

/**
 * Default free license object
 */
function getDefaultFreeLicense() {
  return {
    isPro: false,
    plan: 'free',
    limits: {
      scansPerDay: 10,
      caching: false,
      batchScanning: false,
      maxBatchSize: 0,
    }
  };
}

// Export for use in other modules (background.js)
if (typeof self !== 'undefined') {
  self.activateLicense = activateLicense;
  self.deactivateLicense = deactivateLicense;
  self.revalidateLicense = revalidateLicense;
  self.getLicense = getLicense;
  self.canScan = canScan;
  self.incrementDailyScans = incrementDailyScans;
}
