// ============================================================================

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// Popup Script - Optimized v7.0
// Cached DOM, Better Performance, Modern UX
// ============================================================================

'use strict';

// ============================================================================
// DOM CACHE (Query once, reuse many times)
// ============================================================================

const DOM = {
  // Cards
  proCard: null,
  usageCard: null,
  
  // Buttons
  scanBtn: null,
  clearBtn: null,
  settingsBtn: null,
  upgradeBtn: null,
  manageBtn: null,
  
  // Text elements
  scanText: null,
  scansUsed: null,
  progressFill: null,
  totalScanned: null,
  aiCount: null,
  humanCount: null,
  
  // Toast
  toast: null,
  
  // Cache all elements
  cache() {
    this.proCard = document.getElementById('proCard');
    this.usageCard = document.getElementById('usageCard');
    
    this.scanBtn = document.getElementById('scanBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.upgradeBtn = document.getElementById('upgradeBtn');
    this.manageBtn = document.getElementById('manageBtn');
    
    this.scanText = document.getElementById('scanText');
    this.scansUsed = document.getElementById('scansUsed');
    this.progressFill = document.getElementById('progressFill');
    this.totalScanned = document.getElementById('totalScanned');
    this.aiCount = document.getElementById('aiCount');
    this.humanCount = document.getElementById('humanCount');
    
    this.toast = document.getElementById('toast');
  }
};

// ============================================================================
// STATE
// ============================================================================

const state = {
  isScanning: false,
  license: null,
  stats: { total: 0, ai: 0, human: 0 },
  usage: { used: 0, limit: 5 }
};

// ============================================================================
// UI UPDATES (Batched, efficient)
// ============================================================================

const UI = {
  // Show toast notification
  showToast(message, duration = 3000) {
    DOM.toast.textContent = message;
    DOM.toast.classList.add('show');
    
    setTimeout(() => {
      DOM.toast.classList.remove('show');
    }, duration);
  },
  
  // Update license display
  updateLicense(license, usage) {
    if (license?.isPro) {
      DOM.proCard.hidden = false;
      DOM.usageCard.hidden = true;
    } else {
      DOM.proCard.hidden = true;
      DOM.usageCard.hidden = false;
      
      // Update usage
      DOM.scansUsed.textContent = usage.used;
      const limitEl = document.getElementById('scansLimit');
      if (limitEl) limitEl.textContent = usage.limit;
      const percentage = (usage.used / usage.limit) * 100;
      DOM.progressFill.style.width = `${percentage}%`;
      
      // Change color based on usage (v1.4.1: scales to actual limit)
      const percentUsed = (usage.used / usage.limit);
      if (usage.used >= usage.limit) {
        DOM.progressFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
      } else if (percentUsed >= 0.75) {
        DOM.progressFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
      } else {
        DOM.progressFill.style.background = 'linear-gradient(90deg, #10b981, #22c55e)';
      }
    }
  },
  
  // Update stats display
  updateStats(stats) {
    DOM.totalScanned.textContent = stats.total || 0;
    DOM.aiCount.textContent = stats.ai || 0;
    DOM.humanCount.textContent = stats.human || 0;
  },
  
  // Set scan button state
  setScanButtonState(isScanning) {
    DOM.scanBtn.disabled = isScanning;
    DOM.scanText.textContent = isScanning ? 'Scanning...' : 'Scan Page';
  }
};

// ============================================================================
// DATA FETCHERS (With simple caching)
// ============================================================================

let licenseCache = { data: null, timestamp: 0 };
const CACHE_TTL = 60000; // 1 minute

async function fetchLicense() {
  // Return cached data if fresh
  if (licenseCache.data && Date.now() - licenseCache.timestamp < CACHE_TTL) {
    return licenseCache.data;
  }
  
  const { license, dailyScans, lastResetDate } = await chrome.storage.local.get([
    'license', 'dailyScans', 'lastResetDate'
  ]);
  
  const today = new Date().toDateString();
  const used = (lastResetDate === today) ? (dailyScans || 0) : 0;
  
  // v1.4.1: Use actual license limit instead of hardcoded 5
  const dailyLimit = license?.limits?.scansPerDay || 20;
  
  const data = {
    license: license || { isPro: false, plan: 'free' },
    usage: { used, limit: dailyLimit }
  };
  
  // Update cache
  licenseCache = { data, timestamp: Date.now() };
  
  return data;
}

async function fetchStats() {
  // v8.1: Use lifetime stats instead of session stats
  let { stats, sessionStats } = await chrome.storage.local.get(['stats', 'sessionStats']);
  
  // Use new v8.1 stats if available
  if (stats) {
    return {
      total: stats.totalScanned || 0,
      ai: stats.aiDetected || 0,
      human: stats.humanDetected || 0
    };
  }
  
  // Fallback to old session stats
  if (!sessionStats) {
    sessionStats = { total: 0, ai: 0, human: 0 };
    await chrome.storage.local.set({ sessionStats });
  }
  
  return sessionStats;
}

// v8.1: Fetch achievements
async function fetchAchievements() {
  const { achievements } = await chrome.storage.local.get('achievements');
  return achievements || {
    firstCatch: false,
    sharpEye: false,
    aiHunter: false,
    masterDetective: false
  };
}

// v8.1: Update achievements UI
function updateAchievementsUI(achievements) {
  Object.keys(achievements).forEach(key => {
    const element = document.getElementById(`ach-${key}`);
    if (!element) return;
    
    const status = element.querySelector('.ach-status');
    
    if (achievements[key]) {
      element.classList.add('unlocked');
      if (status) status.textContent = '✅';
    } else {
      element.classList.remove('unlocked');
      if (status) status.textContent = '🔒';
    }
  });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

async function handleScan() {
  if (state.isScanning) return;
  
  state.isScanning = true;
  UI.setScanButtonState(true);
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanVisible' });
    
    UI.showToast(`✅ Investigated ${response?.scanned || 0} images`);
    
    // Refresh stats after a moment
    setTimeout(async () => {
      const stats = await fetchStats();
      UI.updateStats(stats);
    }, 1000);
    
  } catch (error) {
    console.error('Scan error:', error);
    UI.showToast('⚠️ Please reload the page and try again');
  } finally {
    state.isScanning = false;
    UI.setScanButtonState(false);
  }
}

async function handleClear() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
    
    UI.showToast('✨ Evidence cleared');
    
    const stats = await fetchStats();
    UI.updateStats(stats);
  } catch (error) {
    console.error('Clear error:', error);
  }
}

function handleSettings() {
  chrome.runtime.openOptionsPage();
}

function handleUpgrade() {
  // v1.4: Open external Pro page on fauxspy.com
  chrome.tabs.create({ url: 'https://fauxspy.com/pro' });
}

function handleManage() {
  // v1.6: Open Stripe customer portal via fauxspy.com/account
  // This page should redirect to Stripe billing portal for subscription management
  chrome.tabs.create({ url: 'https://fauxspy.com/account' });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  log('🕵️ Faux Spy v1.0 initialized');
  
  // Cache DOM elements
  DOM.cache();
  
  // v8.3: Detect current social media platform
  await detectAndDisplaySocialPlatform();
  
  // Attach event listeners
  DOM.scanBtn?.addEventListener('click', handleScan);
  DOM.clearBtn?.addEventListener('click', handleClear);
  DOM.settingsBtn?.addEventListener('click', handleSettings);
  DOM.upgradeBtn?.addEventListener('click', handleUpgrade);
  DOM.manageBtn?.addEventListener('click', handleManage);
  
  // v8.2: Scan mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      
      // v1.4: Check if this is a Pro-only mode
      if (btn.classList.contains('mode-btn-pro')) {
        // Check if user has Pro license
        const { license } = await chrome.storage.local.get('license');
        const isPro = license && license.isValid;
        
        if (!isPro) {
          // Open Pro upgrade page in new tab
          chrome.tabs.create({ url: 'https://fauxspy.com/pro' });
          UI.showToast('🔒 Deep Dive is a Pro feature', 3000);
          return; // Don't switch mode
        }
      }
      
      // Update UI
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Save and notify
      await chrome.storage.local.set({ scanMode: mode });
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'setScanMode', mode }).catch(() => {});
      }
      
      log('🎯 Mode switched to:', mode);
      UI.showToast(`Switched to ${btn.querySelector('.mode-name').textContent.replace(/🔒 PRO/g, '').trim()}`, 2000);
    });
  });
  
  // Load saved mode
  const { scanMode } = await chrome.storage.local.get('scanMode');
  if (scanMode) {
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === scanMode);
    });
  }
  
  // Load data in parallel
  const [licenseData, stats, achievements] = await Promise.all([
    fetchLicense(),
    fetchStats(),
    fetchAchievements()
  ]);
  
  // Update UI
  UI.updateLicense(licenseData.license, licenseData.usage);
  UI.updateStats(stats);
  updateAchievementsUI(achievements);
  
  // v8.1: Listen for stats updates from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'statsUpdated') {
      const stats = message.stats;
      UI.updateStats({
        total: stats.totalScanned,
        ai: stats.aiDetected,
        human: stats.humanDetected
      });
      // Re-fetch achievements to update display
      fetchAchievements().then(updateAchievementsUI);
    }
  });
  
  // Check API keys
  const { hiveAccessId, hiveSecretKey } = await chrome.storage.local.get([
    'hiveAccessId', 'hiveSecretKey'
  ]);
  
  if (!hiveAccessId || !hiveSecretKey) {
    UI.showToast('⚙️ Configure API keys in Settings', 5000);
  }
  
  log('✅ Popup ready');
}

// ============================================================================
// START
// ============================================================================

document.addEventListener('DOMContentLoaded', init);

// ============================================================================
// v8.3: SOCIAL MEDIA PLATFORM DETECTION
// ============================================================================

const SOCIAL_PLATFORMS = {
  'instagram.com': { icon: '📸', name: 'Instagram', text: 'Optimized for Instagram posts & stories' },
  'pinterest.com': { icon: '📌', name: 'Pinterest', text: 'Optimized for Pinterest pins' },
  'twitter.com': { icon: '𝕏', name: 'X (Twitter)', text: 'Optimized for X (Twitter) media' },
  'x.com': { icon: '𝕏', name: 'X (Twitter)', text: 'Optimized for X (Twitter) media' },
  'facebook.com': { icon: '📘', name: 'Facebook', text: 'Optimized for Facebook posts' },
  'reddit.com': { icon: '🔻', name: 'Reddit', text: 'Optimized for Reddit posts' },
  'tiktok.com': { icon: '🎵', name: 'TikTok', text: 'Optimized for TikTok content' },
  'threads.net': { icon: '🧵', name: 'Threads', text: 'Optimized for Threads posts' },
  'linkedin.com': { icon: '💼', name: 'LinkedIn', text: 'Optimized for LinkedIn posts' }
};

async function detectAndDisplaySocialPlatform() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    
    const url = new URL(tab.url);
    const host = url.hostname.toLowerCase();
    
    let platform = null;
    for (const [domain, info] of Object.entries(SOCIAL_PLATFORMS)) {
      if (host.includes(domain)) {
        platform = info;
        break;
      }
    }
    
    if (platform) {
      const indicator = document.getElementById('socialIndicator');
      const icon = document.getElementById('socialIcon');
      const name = document.getElementById('socialName');
      const text = document.getElementById('socialText');
      
      if (indicator) {
        indicator.style.display = 'flex';
        if (icon) icon.textContent = platform.icon;
        if (name) name.textContent = platform.name + ' Detected';
        if (text) text.textContent = platform.text;
      }
      
      log('🌐 Social platform detected:', platform.name);
    }
  } catch (error) {
    log('Could not detect platform:', error);
  }
}
