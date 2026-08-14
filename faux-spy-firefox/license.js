// License Management Module v1.6

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// Handles license activation, validation, and Pro status
// Connects to fauxspy.com/api/validate-license

const BACKEND_URL = 'https://www.fauxspy.com';

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
      tokenBalance: data.tokenBalance ?? 0,
      topupBalance: data.topupBalance ?? 0,
      tokensIncluded: data.tokensIncluded ?? 200,
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
    
    // Update license with fresh info from server (including token balances)
    const updatedLicense = {
      ...license,
      expiresAt: data.expiresAt,
      plan: data.plan,
      tokenBalance: data.tokenBalance ?? license.tokenBalance ?? 0,
      topupBalance: data.topupBalance ?? license.topupBalance ?? 0,
      tokensIncluded: data.tokensIncluded ?? license.tokensIncluded ?? 200,
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
  
  // Migration: normalize free tier to current 3 scans/day
  if (license && !license.isPro && license.limits && license.limits.scansPerDay > 3) {
    license.limits.scansPerDay = 3;
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
 * Check if user can perform a scan (respects daily limits and token balance)
 */
async function canScan() {
  const license = await getLicense();

  // Pro users: token-based limit
  if (license?.isPro) {
    // If token system is active (tokenBalance is defined), check balance
    if (license.tokenBalance !== undefined) {
      const totalTokens = (license.tokenBalance || 0) + (license.topupBalance || 0);
      if (totalTokens <= 0) {
        return {
          allowed: false,
          remaining: 0,
          isPro: true,
          tokenBalance: 0,
          topupBalance: 0,
          tokensExhausted: true,
        };
      }
      return {
        allowed: true,
        remaining: totalTokens,
        isPro: true,
        tokenBalance: license.tokenBalance,
        topupBalance: license.topupBalance,
      };
    }
    // Legacy license without token data — allow scan (server enforces)
    return {
      allowed: true,
      remaining: -1,
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
  
  const limit = license.limits?.scansPerDay || 3;
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
 * Decrement local token cache after a successful scan.
 * The server is authoritative; this just keeps the UI responsive between revalidations.
 */
async function decrementTokenBalance() {
  const { license } = await chrome.storage.local.get('license');
  if (!license?.isPro || license.tokenBalance === undefined) return;

  if (license.tokenBalance > 0) {
    license.tokenBalance -= 1;
  } else if (license.topupBalance > 0) {
    license.topupBalance -= 1;
  }
  await chrome.storage.local.set({ license });
}

/**
 * Sync token balance returned by detect API into local cache.
 */
async function syncTokenBalance(tokenBalance, topupBalance) {
  const { license } = await chrome.storage.local.get('license');
  if (!license?.isPro) return;
  license.tokenBalance = tokenBalance;
  license.topupBalance = topupBalance;
  await chrome.storage.local.set({ license });
}

/**
 * Default free license object
 */
function getDefaultFreeLicense() {
  return {
    isPro: false,
    plan: 'free',
    limits: {
      scansPerDay: 3,
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
  self.decrementTokenBalance = decrementTokenBalance;
  self.syncTokenBalance = syncTokenBalance;
}
