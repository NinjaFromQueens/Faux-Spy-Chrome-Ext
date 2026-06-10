// ============================================================================

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };
// AI Media Detector - v7.2 IMPROVED AI DETECTION
// Fixed threshold logic, confidence levels, better accuracy
// ============================================================================

'use strict';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  minImageSize: 100,
  hoverDelay: 500,
  maxBatchSize: 10,
  intersectionMargin: '50px',
  throttleWait: 16,
  
  // AI Detection Sensitivity (can be changed in settings)
  defaultSensitivity: 'balanced', // 'strict', 'balanced', or 'sensitive'
  
  // Thresholds for different sensitivity levels
  thresholds: {
    strict: 0.60,      // Only flag obvious AI (60%+)
    balanced: 0.40,    // Default - good balance (40%+)
    sensitive: 0.30    // Catch more AI, some false positives (30%+)
  },
  
  // v8.3: Social Media Platform Selectors
  // These help us find images on social media even when they use background-image or special structures
  socialMediaPlatforms: {
    instagram: {
      hosts: ['instagram.com', 'cdninstagram.com'],
      imageSelectors: [
        'img[srcset*="cdninstagram"]',
        'img[src*="cdninstagram"]',
        'img[src*="instagram"]',
        'article img',
        '[role="presentation"] img',
        'div[role="dialog"] img'
      ],
      backgroundImageSelectors: [
        'div[style*="background-image"][role="button"]',
        'div._aagv',  // Instagram post images
      ]
    },
    pinterest: {
      hosts: ['pinterest.com', 'pinimg.com'],
      imageSelectors: [
        'img[src*="pinimg"]',
        'img[srcset*="pinimg"]',
        'div[data-test-id="pin"] img',
        '[data-test-id="pinrep-image"] img'
      ],
      backgroundImageSelectors: [
        'div[style*="background-image"][data-test-id="pin"]'
      ]
    },
    twitter: {
      hosts: ['twitter.com', 'x.com', 'twimg.com'],
      imageSelectors: [
        'img[src*="twimg"]',
        'img[src*="pbs.twimg.com"]',
        'article img',
        '[data-testid="tweetPhoto"] img',
        'div[aria-label*="Image"] img',
        'div[data-testid="tweetPhoto"] img'
      ]
    },
    facebook: {
      hosts: ['facebook.com', 'fbcdn.net'],
      imageSelectors: [
        'img[src*="fbcdn"]',
        'img[src*="scontent"]',
        '[role="img"]',
        'div[data-pagelet*="Photo"] img'
      ]
    },
    reddit: {
      hosts: ['reddit.com', 'redd.it', 'redditmedia.com'],
      imageSelectors: [
        'img[src*="redd.it"]',
        'img[src*="redditmedia"]',
        'img[src*="preview.redd"]',
        'div[data-test-id="post-content"] img',
        '[data-click-id="image"] img'
      ]
    },
    tiktok: {
      hosts: ['tiktok.com', 'tiktokcdn.com'],
      imageSelectors: [
        'img[src*="tiktokcdn"]',
        'img[mode="lazy"]'
      ]
    },
    threads: {
      hosts: ['threads.net'],
      imageSelectors: [
        'img[srcset*="cdninstagram"]',
        'article img'
      ]
    },
    linkedin: {
      hosts: ['linkedin.com', 'licdn.com'],
      imageSelectors: [
        'img[src*="licdn"]',
        '.feed-shared-image__container img'
      ]
    }
  }
};

// v8.3: Detect current social media platform
function detectSocialPlatform() {
  const host = window.location.hostname.toLowerCase();
  
  for (const [name, config] of Object.entries(CONFIG.socialMediaPlatforms)) {
    if (config.hosts.some(h => host.includes(h))) {
      return { name, config };
    }
  }
  
  return null;
}

// v8.3: Get all images including social media background images
function getAllScannableImages() {
  const platform = detectSocialPlatform();
  const images = [];
  
  // Standard images
  document.querySelectorAll('img').forEach(img => {
    if (isScannableImage(img)) {
      images.push(img);
    }
  });
  
  // Platform-specific images via background-image CSS
  if (platform && platform.config.backgroundImageSelectors) {
    platform.config.backgroundImageSelectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          // Convert background-image to img if needed
          const bgImage = window.getComputedStyle(el).backgroundImage;
          const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
          if (match && match[1]) {
            // Create a virtual img element for scanning
            const virtualImg = document.createElement('img');
            virtualImg.src = match[1];
            virtualImg.dataset.sourceElement = 'background-image';
            virtualImg._originalElement = el;
            
            // Check size from the element itself
            const rect = el.getBoundingClientRect();
            if (rect.width >= CONFIG.minImageSize && rect.height >= CONFIG.minImageSize) {
              images.push(virtualImg);
            }
          }
        });
      } catch (e) {
        console.warn('Selector error:', selector, e);
      }
    });
  }
  
  return images;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  scannedImages: new Set(),
  visibleImages: new WeakSet(),
  hoverTimeout: null,
  hideTimeout: null,
  videoHoverTimeout: null,
  videoHideTimeout: null,
  currentTarget: null,
  sensitivity: CONFIG.defaultSensitivity, // Will be loaded from settings
  showVideoWidget: true,
  
  // v8.1: New features
  scanMode: 'detective', // detective, quick, deep
  showResultPanel: true,  // Show animated panel instead of just badges
  
  // Stats tracking
  stats: {
    totalScanned: 0,
    aiDetected: 0,
    humanDetected: 0,
    currentStreak: 0,
  },
  
  // Achievements
  achievements: {
    firstCatch: false,
    sharpEye: false,      // 10 scans
    aiHunter: false,      // 50 AI detected
    masterDetective: false // 100 scans
  }
};

// Load sensitivity setting from storage
chrome.storage.local.get(['aiSensitivity', 'scanMode', 'showResultPanel', 'showVideoWidget', 'stats', 'achievements'], (result) => {
  if (result.aiSensitivity) {
    state.sensitivity = result.aiSensitivity;
    log(`🎯 AI Sensitivity: ${state.sensitivity} (${(CONFIG.thresholds[state.sensitivity] * 100)}%)`);
  }
  if (result.scanMode) state.scanMode = result.scanMode;
  if (result.showResultPanel !== undefined) state.showResultPanel = result.showResultPanel;
  if (result.showVideoWidget !== undefined) state.showVideoWidget = result.showVideoWidget;
  if (result.stats) state.stats = { ...state.stats, ...result.stats };
  if (result.achievements) state.achievements = { ...state.achievements, ...result.achievements };
  
  log('📊 v8.1 Stats:', state.stats);
  log('🏆 v8.1 Achievements:', state.achievements);
});

// Save stats and achievements
async function saveStats() {
  await chrome.storage.local.set({
    stats: state.stats,
    achievements: state.achievements
  });
}

// Update stats after each scan
function updateStats(result) {
  state.stats.totalScanned++;
  
  if (result.isAI) {
    state.stats.aiDetected++;
    state.stats.currentStreak++;
  } else {
    state.stats.humanDetected++;
  }
  
  saveStats();
  checkAchievements();
  
  // Notify popup if open
  chrome.runtime.sendMessage({ type: 'statsUpdated', stats: state.stats }).catch(() => {});
}

// Check and unlock achievements
function checkAchievements() {
  const newlyUnlocked = [];
  
  if (!state.achievements.firstCatch && state.stats.aiDetected >= 1) {
    state.achievements.firstCatch = true;
    newlyUnlocked.push({ name: 'First Catch', icon: '🥇', desc: 'Detected your first AI image!' });
  }
  
  if (!state.achievements.sharpEye && state.stats.totalScanned >= 10) {
    state.achievements.sharpEye = true;
    newlyUnlocked.push({ name: 'Sharp Eye', icon: '👁️', desc: 'Scanned 10 images!' });
  }
  
  if (!state.achievements.aiHunter && state.stats.aiDetected >= 50) {
    state.achievements.aiHunter = true;
    newlyUnlocked.push({ name: 'AI Hunter', icon: '🎯', desc: 'Detected 50 AI images!' });
  }
  
  if (!state.achievements.masterDetective && state.stats.totalScanned >= 100) {
    state.achievements.masterDetective = true;
    newlyUnlocked.push({ name: 'Master Detective', icon: '🕵️', desc: 'Scanned 100 images!' });
  }
  
  // Show notifications for newly unlocked
  newlyUnlocked.forEach((achievement, index) => {
    setTimeout(() => {
      showAchievementToast(achievement);
    }, index * 1000);
  });
  
  if (newlyUnlocked.length > 0) {
    saveStats();
  }
}

// Show achievement toast notification
function showAchievementToast(achievement) {
  const toast = document.createElement('div');
  toast.className = 'ai-achievement-toast';
  toast.innerHTML = `
    <div class="ai-achievement-icon">${achievement.icon}</div>
    <div class="ai-achievement-text">
      <div class="ai-achievement-title">🏆 Achievement Unlocked!</div>
      <div class="ai-achievement-name">${achievement.name}</div>
      <div class="ai-achievement-desc">${achievement.desc}</div>
    </div>
  `;
  
  toast.style.cssText = `
    position: fixed !important;
    bottom: 24px !important;
    right: 24px !important;
    display: flex !important;
    align-items: center !important;
    gap: 16px !important;
    padding: 20px 24px !important;
    background: linear-gradient(135deg, #fbbf24, #f59e0b) !important;
    color: white !important;
    border-radius: 12px !important;
    box-shadow: 0 8px 24px rgba(251, 191, 36, 0.4) !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    min-width: 320px !important;
    animation: aiToastSlideIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'aiToastSlideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================================
// AI CONFIDENCE LEVELS
// ============================================================================

// v1.3: Get human-readable method label
function getMethodLabel(method) {
  switch (method) {
    case 'sightengine_api':
      return '✓ Sightengine AI';
    case 'hive_api':
      return '✓ Hive AI';
    case 'c2pa_verified':
      return '🏛️ C2PA Verified';
    case 'heuristic':
      return '⚠ Heuristic Fallback';
    case 'cached':
      return '📦 Cached Result';
    case 'error':
    case 'no_api':
      return '⚠ Detection Failed';
    default:
      return method || 'Unknown';
  }
}

function getConfidenceLevel(aiProbability, result) {
  // v1.7: Handle 5-category Pro verdicts AND legacy 3-category fallback
  // The backend now returns a 'category' field for the new system

  // C2PA: image has cryptographic camera provenance — highest confidence real
  if (result?.method === 'c2pa_verified') {
    return {
      level: 'c2pa-verified',
      label: result.verdictLabel || 'Camera Verified',
      icon: '🏛️',
      color: 'c2pa-verified',
      description: result.c2pa?.signerName
        ? `Signed by ${result.c2pa.signerName}`
        : 'Cryptographic provenance confirmed'
    };
  }

  // If backend returned a category (new system), use it
  if (result?.category) {
    switch (result.category) {
      case 'real':
        return {
          level: aiProbability < 0.20 ? 'very-low' : 'low',
          label: result.verdictLabel || 'No AI Detected',
          icon: '✅',
          color: 'human-very-low',
          description: 'No AI generation detected'
        };

      case 'manipulated':
        return {
          level: 'manipulated',
          label: result.verdictLabel || 'Possible Manipulation',
          icon: '⚠️',
          color: 'inconclusive',
          description: 'Real photo but possible face/body manipulation detected'
        };
        
      case 'digital_art':
        return {
          level: 'digital-art',
          label: result.verdictLabel || 'Digital Art',
          icon: '🎨',
          color: 'digital-art',
          description: 'Human-made digital art (painting, render, illustration)'
        };
        
      case 'inconclusive':
        return {
          level: 'inconclusive',
          label: result.verdictLabel || 'Inconclusive',
          icon: '❓',
          color: 'inconclusive',
          description: 'Filters or editing may be affecting detection'
        };
        
      case 'ai_art':
        return {
          level: 'ai-art',
          label: result.verdictLabel || 'AI Art',
          icon: '🤖',
          color: 'ai-art',
          description: 'AI-generated stylized art (Midjourney style)'
        };
        
      case 'ai_photo':
      case 'ai':
        return {
          level: aiProbability >= 0.85 ? 'very-high' : 'high',
          label: result.verdictLabel || 'AI Photo',
          icon: '🚨',
          color: 'ai-very-high',
          description: 'Photorealistic AI generation'
        };
        
      case 'insufficient_data':
        return {
          level: 'insufficient',
          label: 'Image Too Small',
          icon: '📏',
          color: 'inconclusive',
          description: 'Not enough data to analyze'
        };
    }
  }
  
  // Legacy fallback: percentage-based (for old responses without category field)
  const percentage = aiProbability * 100;
  
  if (percentage >= 85) {
    return { level: 'very-high', label: 'Definitely Faux', icon: '🚨', color: 'ai-very-high', description: 'Caught red-handed — this is AI-generated' };
  } else if (percentage >= 65) {
    return { level: 'high', label: 'Likely Faux', icon: '⚠️', color: 'ai-high', description: 'Strong evidence of AI generation' };
  } else if (percentage >= 40) {
    return { level: 'inconclusive', label: 'Inconclusive', icon: '❓', color: 'inconclusive', description: 'Filters or editing may be affecting detection' };
  } else if (percentage >= 20) {
    return { level: 'low', label: 'No AI Detected', icon: '✅', color: 'human-low', description: 'No AI generation detected' };
  } else {
    return { level: 'very-low', label: 'No AI Detected', icon: '✅', color: 'human-very-low', description: 'No AI generation signals found' };
  }
}

function isAIGenerated(aiProbability, result) {
  // v1.7: Check category instead of just probability
  // AI Photo or AI Art = "AI generated"
  // Digital Art = NOT AI (human-made)
  // Real = NOT AI
  // Inconclusive = NOT AI (don't accuse)
  if (result?.category) {
    return result.category === 'ai_photo' || result.category === 'ai_art' || result.category === 'ai';
  }
  
  // Legacy fallback
  return aiProbability >= 0.65;
}

// ============================================================================
// WIDGET POOL (Reuse single widget)
// ============================================================================

const WidgetPool = {
  widget: null,
  isVisible: false,
  currentImage: null,
  _pendingImage: null,  // immune to hide() — persists until scan starts
  cleanupFns: [],

  init() {
    if (this.widget) return this.widget;
    
    this.widget = document.createElement('div');
    this.widget.className = 'ai-detector-widget';
    this.widget.innerHTML = `
      <button class="ai-widget-btn" type="button" aria-label="Check if AI-generated" id="ai-check-btn">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 3.5a4 4 0 11-5 0 4 4 0 015 0zM9 11a6 6 0 100-12 6 6 0 000 12zm-1-5a1 1 0 112 0v4a1 1 0 11-2 0V6z"/>
        </svg>
        <span>🕵️ Investigate</span>
      </button>
    `;
    
    const button = this.widget.querySelector('.ai-widget-btn');

    // Dedup flag prevents both pointerdown+click from firing the scan twice
    let _scanFired = false;
    const handleClick = (e) => {
      if (_scanFired) return;
      _scanFired = true;
      setTimeout(() => { _scanFired = false; }, 600);

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      log('🖱️ Investigate clicked via:', e.type);

      // _pendingImage is set in show() and NOT cleared by hide() — race-condition safe
      const imgToScan = WidgetPool._pendingImage || WidgetPool.currentImage;
      WidgetPool._pendingImage = null;
      if (imgToScan) {
        log('🎯 Scanning:', imgToScan.src?.substring(0, 60));
        WidgetPool.hide();
        scanImage(imgToScan);
      } else {
        console.warn('⚠️ No image to scan — widget shown without setting _pendingImage');
      }
    };

    // Two handlers: pointerdown fires before click (covers sites that block click)
    // dedup flag ensures only one scan runs per user gesture
    button.addEventListener('pointerdown', handleClick, true);
    button.addEventListener('click', handleClick, true);
    
    // Cancel the hide timer when mouse enters the button widget itself
    this.widget.addEventListener('mouseenter', () => {
      clearTimeout(state.hideTimeout);
    }, true);

    log('✅ Widget initialized with 6 click handlers');
    return this.widget;
  },

  show(img) {
    if (!this.widget) this.init();
    this._pendingImage = img;  // always update, even on early return
    if (this.currentImage === img && this.isVisible) return;

    this.currentImage = img;
    this.isVisible = true;
    this.position(img);
    
    if (!this.widget.parentNode) {
      document.body.appendChild(this.widget);
    }
    
    this.widget.classList.add('visible');
  },

  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.currentImage = null;
    
    if (this.widget) {
      this.widget.classList.remove('visible');
    }
  },

  position(img) {
    if (!this.widget || !img) return;
    
    requestAnimationFrame(() => {
      const rect = img.getBoundingClientRect();
      this.widget.style.cssText = `
        position: fixed;
        top: ${rect.top + 8}px;
        left: ${rect.left + 8}px;
        z-index: 2147483647;
      `;
    });
  },

  cleanup() {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    if (this.widget?.parentNode) {
      this.widget.remove();
    }
  }
};

// ============================================================================
// UTILITIES
// ============================================================================

function getImageId(img) {
  if (!img) return '';
  return img.src || img.currentSrc || '';
}

// Returns the highest-quality URL available for an image.
// Social media CDNs serve thumbnails in feeds — we upgrade before sending to the API
// so detection accuracy matches what you'd get scanning the full-size image directly.
function getBestImageUrl(img) {
  if (!img) return '';

  // srcset contains multiple sizes — pick the widest one (works for Instagram, most sites)
  if (img.srcset) {
    const best = img.srcset
      .split(',')
      .map(s => {
        const parts = s.trim().split(/\s+/);
        return { url: parts[0], width: parseInt(parts[1]) || 0 };
      })
      .filter(e => e.url && !e.url.startsWith('data:') && e.width > 0)
      .sort((a, b) => b.width - a.width)[0];
    // Only use srcset if it's meaningfully larger than a thumbnail
    if (best && best.width >= 400) return best.url;
  }

  let url = img.src || img.currentSrc || '';
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return '';

  try {
    // X / Twitter: pbs.twimg.com/media/HASH?format=jpg&name=small → name=large
    if (url.includes('pbs.twimg.com/media/')) {
      const u = new URL(url);
      const name = u.searchParams.get('name') || '';
      if (name !== 'large' && name !== 'orig') {
        u.searchParams.set('name', 'large');
        return u.toString();
      }
    }

    // Pinterest: /236x/ or /474x/ → /736x/
    if (url.includes('pinimg.com/')) {
      return url.replace(/\/(60x60_RS|60x|74x|136x136|170x|236x|474x)\//, '/736x/');
    }
  } catch (e) {
    // URL parse failed — fall through to original
  }

  return url;
}

function isScannableImage(img) {
  if (!img || img.nodeName !== 'IMG') return false;
  
  const rect = img.getBoundingClientRect();
  const width = rect.width || img.naturalWidth || img.width;
  const height = rect.height || img.naturalHeight || img.height;
  
  // v1.1: Better social media + lazy loading support
  const src = img.src || img.currentSrc || '';
  
  // Skip data URLs and empty src
  if (!src || src.startsWith('data:')) return false;
  
  // Skip blob URLs in most cases (often profile pics, icons)
  if (src.startsWith('blob:') && width < 200) return false;
  
  // v1.1: Skip lazy-loading placeholders (Instagram common pattern)
  // These are 1x1 transparent or very tiny placeholder images
  if (img.naturalWidth > 0 && img.naturalWidth <= 10) return false;
  if (img.naturalHeight > 0 && img.naturalHeight <= 10) return false;
  
  // v1.1: Wait for actual image data to load
  // Instagram often has <img> with no src yet, or src that hasn't loaded
  if (!img.complete && img.naturalWidth === 0) return false;
  
  // Skip tiny images (likely icons, avatars in feeds)
  if (width < CONFIG.minImageSize || height < CONFIG.minImageSize) return false;
  
  // Skip if not visible
  if (rect.width <= 0 || rect.height <= 0) return false;
  
  // v1.1: Skip if image is far off-screen (lazy loading buffer)
  const viewportHeight = window.innerHeight;
  const viewportBuffer = viewportHeight * 2; // 2 viewports
  if (rect.bottom < -viewportBuffer || rect.top > viewportHeight + viewportBuffer) {
    return false;
  }
  
  // v8.3: Skip common UI elements on social media
  const skipPatterns = [
    /\/avatar/i,
    /\/profile_pic/i,
    /\/emoji/i,
    /\/icon/i,
    /\/logo/i,
    /\/spinner/i,
    /\/loading/i,
    /\/static\//i,        // Static UI assets
    /\/rsrc\.php/i,       // Facebook UI sprites
    /placeholder/i        // Placeholder images
  ];
  
  // Only skip very small avatars - large profile pics can still be AI
  if (width < 200 && skipPatterns.some(p => p.test(src))) return false;
  
  return true;
}

function throttleRAF(fn) {
  let ticking = false;
  return function(...args) {
    if (!ticking) {
      requestAnimationFrame(() => {
        fn.apply(this, args);
        ticking = false;
      });
      ticking = true;
    }
  };
}

// ============================================================================
// IMAGE SCANNING
// ============================================================================

async function scanImage(img) {
  if (!img) {
    console.warn('⚠️ Scan called with null/undefined image');
    return;
  }

  const imageId = getImageId(img);
  // Upgrade to full-res URL before dedup check and API call.
  // X feeds serve ?name=small, Pinterest /236x/, etc. — the low-res thumbnail
  // causes false "Real" results. Using the large URL fixes detection accuracy.
  const bestUrl = getBestImageUrl(img) || imageId;

  if (!bestUrl) {
    console.warn('⚠️ Image has no src/currentSrc');
    return;
  }

  if (state.scannedImages.has(bestUrl)) {
    log('✓ Already scanned:', bestUrl);
    return;
  }

  log('🔍 Starting scan for:', bestUrl);
  state.scannedImages.add(bestUrl);
  showLoadingBadge(img);

  try {
    const usageCheck = await checkUsageLimit();

    if (!usageCheck.allowed) {
      log('⚠️ Usage limit reached');
      removeLoadingBadge(img);
      showUpgradePrompt(img, usageCheck);
      return;
    }

    const imageData = {
      src: bestUrl,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      alt: img.alt || '',
      pageUrl: window.location.href,
      pageHost: window.location.hostname,
      pageTitle: document.title
    };
    
    log('📤 Sending to background script:', imageData);
    
    const result = await chrome.runtime.sendMessage({
      action: 'analyzeImage',
      imageData
    });
    
    log('📥 Received result:', result);
    
    removeLoadingBadge(img);
    
    if (result && !result.error) {
      applyHighlight(img, result);
      await incrementDailyScans();
      updateSessionStats(result);
      
      // v8.1: Update stats and check achievements
      updateStats(result);

      // Save to Case Files (Pro users only)
      saveToCaseFiles(img, result);

      // v8.1: Show animated result panel if enabled
      if (state.showResultPanel && state.scanMode === 'detective') {
        showAnimatedResultPanel(img, result);
      }
      
      log('✅ Scan complete!');
    } else if (result?.error === 'DAILY_LIMIT_REACHED') {
      log('🚫 Daily limit reached (server-enforced)');
      removeLoadingBadge(img);
      showUpgradePrompt(img, {
        message: result.indicators?.[0] || '🔒 Daily limit reached',
        upgradeUrl: result.upgradeUrl || 'https://www.fauxspy.com/pro'
      });
    } else if (result?.error === 'TOKENS_EXHAUSTED') {
      log('🚫 Token balance exhausted');
      state.scannedImages.delete(bestUrl);
      removeLoadingBadge(img);
      showUpgradePrompt(img, {
        message: '🔒 Token balance exhausted',
        upgradeUrl: result.buyUrl || 'https://www.fauxspy.com/buy-tokens',
        upgradeLabel: 'Buy More Tokens'
      });
    } else {
      state.scannedImages.delete(bestUrl); // allow retry on error
      console.error('❌ Scan failed:', result);
      showError(img, result?.error || 'Analysis failed');
    }
  } catch (error) {
    state.scannedImages.delete(bestUrl); // allow retry on exception
    console.error('❌ Scan error:', error);
    removeLoadingBadge(img);
    showError(img, error.message);
  }
}

async function checkUsageLimit() {
  const { license, dailyScans, lastResetDate } = await chrome.storage.local.get([
    'license', 'dailyScans', 'lastResetDate'
  ]);

  if (license?.isPro) {
    // Token system active: check local cache before server round-trip
    if (license.tokenBalance !== undefined) {
      const total = (license.tokenBalance || 0) + (license.topupBalance || 0);
      if (total <= 0) {
        return {
          allowed: false,
          remaining: 0,
          isPro: true,
          tokensExhausted: true,
          message: '🔒 Token balance exhausted',
          upgradeUrl: 'https://www.fauxspy.com/buy-tokens',
          upgradeLabel: 'Buy More Tokens'
        };
      }
    }
    return { allowed: true, remaining: (license.tokenBalance || 0) + (license.topupBalance || 0), isPro: true };
  }
  
  const today = new Date().toDateString();
  let scans = (lastResetDate === today) ? (dailyScans || 0) : 0;
  
  if (lastResetDate !== today) {
    await chrome.storage.local.set({ dailyScans: 0, lastResetDate: today });
  }
  
  const limit = license?.limits?.scansPerDay || 10;
  return {
    allowed: scans < limit,
    remaining: Math.max(0, limit - scans),
    isPro: false,
    limit,
    scans
  };
}

async function incrementDailyScans() {
  const { license, dailyScans } = await chrome.storage.local.get(['license', 'dailyScans']);
  if (!license?.isPro) {
    await chrome.storage.local.set({ dailyScans: (dailyScans || 0) + 1 });
  }
}

async function updateSessionStats(result) {
  let { sessionStats } = await chrome.storage.local.get('sessionStats');
  
  if (!sessionStats) {
    sessionStats = { total: 0, ai: 0, human: 0 };
  }
  
  sessionStats.total++;
  
  // Use our improved detection logic
  const isAI = isAIGenerated(result.aiProbability, result);
  
  if (isAI) {
    sessionStats.ai++;
  } else {
    sessionStats.human++;
  }
  
  await chrome.storage.local.set({ sessionStats });
}

// ============================================================================
// UI HELPERS - IMPROVED WITH CONFIDENCE LEVELS
// ============================================================================

function showLoadingBadge(img) {
  // Virtual images (background-image clicks) - skip badge, show panel only
  if (img._isVirtual) {
    log('💡 Virtual image - skipping inline badge');
    return;
  }
  
  // Check if image is in DOM
  if (!img.parentNode) {
    log('💡 Image not in DOM - skipping badge');
    return;
  }
  
  try {
    const wrapper = getOrCreateWrapper(img);
    const badge = document.createElement('div');
    badge.className = 'ai-badge ai-badge-loading';
    badge.innerHTML = '<span class="ai-badge-spinner"></span><span>Scanning...</span>';
    wrapper.appendChild(badge);
  } catch (e) {
    console.warn('Could not show loading badge:', e);
  }
}

function removeLoadingBadge(img) {
  if (!img || img._isVirtual) return;
  
  // v1.1: Check both wrapper (regular sites) and overlay (social media)
  // Try overlay first
  const overlay = imageOverlays.get(img);
  if (overlay) {
    const badge = overlay.querySelector('.ai-badge-loading');
    if (badge) badge.remove();
    return;
  }
  
  // Fallback to wrapper
  if (img.closest) {
    const wrapper = img.closest('.ai-wrapper');
    if (wrapper) {
      const badge = wrapper.querySelector('.ai-badge-loading');
      if (badge) badge.remove();
    }
  }
}

function applyHighlight(img, result) {
  // Virtual images don't have parents - skip inline badge
  if (img._isVirtual || !img.parentNode) {
    log('💡 Virtual image - showing result panel only');
    return;
  }
  
  try {
    const wrapper = getOrCreateWrapper(img);
    const confidence = getConfidenceLevel(result.aiProbability, result);
    const percentage = Math.round(result.aiProbability * 100);
    
    log(`🎨 Creating badge: ${confidence.label} ${percentage}% (color: ${confidence.color})`);
    log('📊 Full result:', result);
    
    const badge = document.createElement('div');
    badge.className = `ai-badge ai-badge-${confidence.color}`;
    
    // Create text with VERY explicit styling to ensure visibility
    const textSpan = document.createElement('span');
    const badgeLabel = result.method === 'c2pa_verified'
      ? confidence.label
      : `${confidence.label} ${percentage}%`;
    textSpan.textContent = badgeLabel;
    textSpan.style.cssText = 'color: white !important; font-size: 11px !important; font-weight: 700 !important; display: inline-block !important; opacity: 1 !important; visibility: visible !important;';
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'ai-badge-icon';
    iconSpan.textContent = confidence.icon;
    iconSpan.style.cssText = 'font-size: 14px !important; display: inline-block !important;';
    
    badge.appendChild(iconSpan);
    badge.appendChild(textSpan);
    
    badge.title = `${confidence.description}\n\nAI Probability: ${percentage}%\nSensitivity: ${state.sensitivity}\nThreshold: ${CONFIG.thresholds[state.sensitivity] * 100}%\nMethod: ${result.method || 'unknown'}\nClick for details`;
    
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      showResultDetails(result, confidence);
    });
    
    wrapper.appendChild(badge);
  } catch (e) {
    console.warn('Could not apply highlight:', e);
  }
}

function showError(img, message) {
  if (!img || img._isVirtual || !img.parentNode) {
    console.warn('Error:', message);
    return;
  }

  try {
    const wrapper = getOrCreateWrapper(img);
    const badge = document.createElement('div');
    badge.className = 'ai-badge ai-badge-error';
    badge.title = message;
    badge.innerHTML = `
      <span>⚠️</span>
      <span>Error</span>
      <a class="ai-badge-report" href="https://www.fauxspy.com/contact" target="_blank" rel="noopener" title="Report this issue to Faux Spy">↗</a>
    `;
    wrapper.appendChild(badge);

    setTimeout(() => badge.remove(), 8000);
  } catch (e) {
    console.warn('Could not show error:', e);
  }
}

function showUpgradePrompt(img, usageCheck) {
  const wrapper = getOrCreateWrapper(img);
  const badge = document.createElement('div');
  badge.className = 'ai-badge ai-badge-upgrade';
  const labelText = usageCheck.upgradeLabel || 'Upgrade';
  badge.innerHTML = `<span>⭐</span><span>${labelText}</span>`;
  badge.title = `${usageCheck.message}\nClick for details`;
  badge.style.cursor = 'pointer';

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({
      action: 'openUpgrade',
      url: usageCheck.upgradeUrl || null
    });
  });

  wrapper.appendChild(badge);
}

// ============================================================================
// v1.1: NON-INVASIVE OVERLAY SYSTEM
// Replaces the old wrapper system that broke Instagram/Pinterest layouts
// Uses position: fixed overlays that follow images without modifying DOM
// ============================================================================

// Map of image -> overlay element
const imageOverlays = new WeakMap();

// Detect if we're on a social media site (use overlays to avoid layout breakage)
function isSocialMediaSite() {
  const host = window.location.hostname.toLowerCase();
  const socialSites = [
    'instagram.com', 'pinterest.com', 'twitter.com', 'x.com',
    'facebook.com', 'reddit.com', 'tiktok.com', 'threads.net',
    'linkedin.com', 'cdninstagram.com', 'pinimg.com', 'twimg.com',
    'fbcdn.net', 'redditmedia.com', 'tiktokcdn.com', 'licdn.com'
  ];
  return socialSites.some(site => host.includes(site));
}

// Get or create a non-invasive overlay for an image
function getOrCreateOverlay(img) {
  // Don't create overlay for virtual images
  if (img._isVirtual) {
    throw new Error('Cannot create overlay for virtual image');
  }
  
  // Check if already exists
  if (imageOverlays.has(img)) {
    return imageOverlays.get(img);
  }
  
  // Create overlay container - positioned absolutely to body
  const overlay = document.createElement('div');
  overlay.className = 'fauxspy-overlay';
  overlay.style.cssText = `
    position: absolute !important;
    pointer-events: none !important;
    z-index: 999999 !important;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
  `;
  
  document.body.appendChild(overlay);
  imageOverlays.set(img, overlay);
  
  // Position overlay over image
  updateOverlayPosition(img, overlay);
  
  // Update position on scroll/resize
  const updatePos = throttleRAF(() => updateOverlayPosition(img, overlay));
  window.addEventListener('scroll', updatePos, { passive: true, capture: true });
  window.addEventListener('resize', updatePos, { passive: true });
  
  // Watch for image position changes (Instagram dynamically repositions)
  if (window.ResizeObserver) {
    if (overlay._resizeObserver) overlay._resizeObserver.disconnect();
    const resizeObs = new ResizeObserver(updatePos);
    resizeObs.observe(img);
    overlay._resizeObserver = resizeObs;
  }
  
  return overlay;
}

// Update overlay position to match image
function updateOverlayPosition(img, overlay) {
  if (!img || !overlay || !document.body.contains(img)) {
    if (overlay && overlay.parentNode) {
      overlay.remove();
    }
    return;
  }
  
  const rect = img.getBoundingClientRect();
  
  // Hide if image not visible
  if (rect.width === 0 || rect.height === 0) {
    overlay.style.display = 'none';
    return;
  }
  
  overlay.style.display = 'block';
  overlay.style.top = (rect.top + window.scrollY) + 'px';
  overlay.style.left = (rect.left + window.scrollX) + 'px';
  overlay.style.width = rect.width + 'px';
  overlay.style.height = rect.height + 'px';
}

// Remove overlay and cleanup
function removeOverlay(img) {
  const overlay = imageOverlays.get(img);
  if (overlay) {
    if (overlay._resizeObserver) {
      overlay._resizeObserver.disconnect();
    }
    overlay.remove();
    imageOverlays.delete(img);
  }
}

// v1.7.1: ALWAYS use overlay system (never wrap images)
// Previous version wrapped images in a div for non-social sites which
// broke responsive grid layouts on sites like Lummi, Unsplash, ArtStation, etc.
// Overlay approach is non-invasive and works everywhere.
function getOrCreateWrapper(img) {
  // Don't wrap virtual images
  if (img._isVirtual) {
    throw new Error('Cannot wrap virtual image');
  }
  
  if (!img.parentNode) {
    throw new Error('Image has no parent node');
  }
  
  // ALWAYS use overlay system - safe for any layout (grid, flex, etc.)
  return getOrCreateOverlay(img);
}

function showResultDetails(result, confidence) {
  // Use the new animated panel instead of alert!
  // Find the image associated with this result if possible
  const images = document.querySelectorAll('.ai-wrapper img');
  let targetImg = null;
  
  // Try to find the image with matching result
  for (const img of images) {
    if (img.dataset.lastResult && JSON.parse(img.dataset.lastResult).aiProbability === result.aiProbability) {
      targetImg = img;
      break;
    }
  }
  
  // If we can't find it, just show panel in center of screen
  if (!targetImg) {
    showAnimatedResultPanel(null, result);
  } else {
    showAnimatedResultPanel(targetImg, result);
  }
}

function clearAllHighlights() {
  // Clear traditional wrappers (non-social sites)
  document.querySelectorAll('.ai-wrapper').forEach(wrapper => {
    const img = wrapper.querySelector('img');
    if (img && wrapper.parentNode) {
      wrapper.parentNode.insertBefore(img, wrapper);
      
      // Restore original image styles
      img.style.width = '';
      img.style.height = '';
      img.style.display = '';
      img.style.margin = '';
      
      wrapper.remove();
    }
  });
  
  // v1.1: Clear overlays (social media sites)
  document.querySelectorAll('.fauxspy-overlay').forEach(overlay => {
    if (overlay._resizeObserver) {
      overlay._resizeObserver.disconnect();
    }
    overlay.remove();
  });
  
  // Clear the WeakMap by recreating it (WeakMaps don't have clear())
  // Instead, individual entries get GC'd when overlay is removed
  
  state.scannedImages.clear();
  log('✨ All evidence cleared');
}

// ============================================================================
// EVENT DELEGATION
// ============================================================================

const updateWidgetPosition = throttleRAF(() => {
  if (WidgetPool.isVisible && WidgetPool.currentImage) {
    WidgetPool.position(WidgetPool.currentImage);
  }
});

// Walk up from an img to find a nearby <video> (covers X, YouTube, TikTok, Instagram, Facebook poster overlays)
function findNearbyVideo(img, clientX, clientY) {
  const imgRect = img.getBoundingClientRect();

  // Walk up the DOM. Apply AABB overlap check at each level so feed containers
  // that span multiple posts (Instagram, Facebook) don't match videos from other posts.
  let el = img.parentElement;
  for (let i = 0; i < 10 && el; i++) {
    const v = el.querySelector('video');
    if (v) {
      const vRect = v.getBoundingClientRect();
      const overlaps = imgRect.right > vRect.left && imgRect.left < vRect.right &&
                       imgRect.bottom > vRect.top && imgRect.top < vRect.bottom;
      if (overlaps) return v;
    }
    el = el.parentElement;
  }
  // elementsFromPoint fallback — catches videos layered behind the img element
  if (clientX && clientY) {
    const els = document.elementsFromPoint(clientX, clientY);
    const v = els.find(e => e.tagName === 'VIDEO');
    if (v) {
      const vRect = v.getBoundingClientRect();
      const overlaps = imgRect.right > vRect.left && imgRect.left < vRect.right &&
                       imgRect.bottom > vRect.top && imgRect.top < vRect.bottom;
      if (overlaps) return v;
    }
  }
  return null;
}

document.addEventListener('mouseenter', (e) => {
  const img = e.target;
  if (img.nodeName !== 'IMG') return;

  // If the img is overlaying a video (poster/thumbnail), route to video widget
  const nearbyVideo = findNearbyVideo(img, e.clientX, e.clientY);
  if (nearbyVideo && isScannableVideo(nearbyVideo)) {
    clearTimeout(state.hoverTimeout);
    clearTimeout(state.videoHoverTimeout);
    state.videoHoverTimeout = setTimeout(() => {
      VideoWidgetPool.show(nearbyVideo);
    }, CONFIG.hoverDelay);
    return;
  }

  if (!isScannableImage(img)) return;
  if (state.scannedImages.has(getBestImageUrl(img) || getImageId(img))) return;

  clearTimeout(state.hoverTimeout);

  state.hoverTimeout = setTimeout(() => {
    WidgetPool.show(img);
  }, CONFIG.hoverDelay);
}, true);

document.addEventListener('mouseleave', (e) => {
  if (e.target.nodeName === 'IMG') {
    clearTimeout(state.hoverTimeout);

    // Use state.hideTimeout so the widget's mouseenter can cancel it
    state.hideTimeout = setTimeout(() => {
      if (!WidgetPool.widget?.matches(':hover')) {
        WidgetPool.hide();
      }
    }, 400); // 400ms — room for slow cursors to reach the button
  }
}, true);

// ============================================================================
// VIDEO DETECTION
// ============================================================================

function isScannableVideo(video) {
  if (!video || video.tagName !== 'VIDEO') return false;
  if (video.readyState < 2) return false; // not enough data loaded
  const rect = video.getBoundingClientRect();
  if (rect.width < 100 || rect.height < 100) return false;
  if (rect.width <= 0 || rect.height <= 0) return false;
  return true;
}

function getVideoSrc(video) {
  const src = video.currentSrc || video.src
    || video.querySelector?.('source')?.src || '';
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return null;
  return src;
}

// Pre-cache license so the click handler can check it synchronously
let cachedLicense = null;
chrome.storage.local.get('license').then(r => { cachedLicense = r.license || null; });
chrome.storage.onChanged.addListener((changes) => {
  if (changes.license) cachedLicense = changes.license.newValue || null;
});

const VideoWidgetPool = {
  widget: null,
  isVisible: false,
  currentVideo: null,
  _pendingVideo: null,
  _observer: null,
  dismissedVideos: new Set(),

  init() {
    if (this.widget) return this.widget;
    this.widget = document.createElement('div');
    this.widget.className = 'ai-video-widget';
    this.widget.innerHTML = `
      <div class="ai-video-widget-inner">
        <button class="ai-video-widget-btn" type="button" aria-label="Check if AI-generated video">
          <span>🎬 Analyze Video</span>
        </button>
        <button class="ai-video-widget-close" type="button" aria-label="Dismiss">×</button>
      </div>
    `;

    const closeBtn = this.widget.querySelector('.ai-video-widget-close');
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const video = this.currentVideo;
      if (video) {
        const src = video.src || video.currentSrc || video.dataset.src || '';
        if (src) this.dismissedVideos.add(src);
      }
      this.hide();
    }, true);

    const button = this.widget.querySelector('.ai-video-widget-btn');
    let _scanFired = false;
    const handleClick = (e) => {
      if (_scanFired) return;
      _scanFired = true;
      setTimeout(() => { _scanFired = false; }, 600);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Free plan check before anything else — show prompt directly on widget
      if (!cachedLicense?.features?.videoDetection) {
        VideoWidgetPool._showUpgradePrompt();
        return;
      }

      const videoToScan = VideoWidgetPool._pendingVideo || VideoWidgetPool.currentVideo;
      VideoWidgetPool._pendingVideo = null;
      if (videoToScan) {
        VideoWidgetPool.hide();
        scanVideo(videoToScan);
      }
    };
    button.addEventListener('pointerdown', handleClick, true);
    button.addEventListener('click', handleClick, true);
    this.widget.addEventListener('mouseenter', () => {
      clearTimeout(state.videoHideTimeout);
    }, true);
    return this.widget;
  },

  show(video) {
    if (!state.showVideoWidget) return;
    if (!this.widget) this.init();
    this._pendingVideo = video;
    if (this.currentVideo === video && this.isVisible) return;

    // Skip dismissed videos
    const src = video.src || video.currentSrc || video.dataset.src || '';
    if (src && this.dismissedVideos.has(src)) return;
    this.currentVideo = video;
    this.isVisible = true;
    this.position(video);
    if (!this.widget.parentNode) document.body.appendChild(this.widget);
    this.widget.classList.add('visible');

    // Hide when video scrolls out of view
    if (this._observer) this._observer.disconnect();
    this._observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) this.hide();
    }, { threshold: 0.1 });
    this._observer.observe(video);

    // Hide 1.5s after video starts playing — button isn't useful mid-playback
    const onPlay = () => {
      video.removeEventListener('play', onPlay);
      setTimeout(() => { if (this.currentVideo === video) this.hide(); }, 1500);
    };
    video.addEventListener('play', onPlay);
  },

  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.currentVideo = null;
    if (this.widget) {
      this.widget.classList.remove('visible');
      this._clearUpgradePrompt();
    }
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  },

  _clearUpgradePrompt() {
    if (!this.widget) return;
    const btn = this.widget.querySelector('.ai-video-widget-btn');
    const tip = this.widget.querySelector('.ai-video-upgrade-tip');
    if (tip) tip.remove();
    if (btn) {
      btn.style.display = '';
      btn.disabled = false;
    }
  },

  _showUpgradePrompt() {
    if (!this.widget) return;
    const btn = this.widget.querySelector('.ai-video-widget-btn');
    if (btn) btn.style.display = 'none';

    const existing = this.widget.querySelector('.ai-video-upgrade-tip');
    if (existing) return;

    const tip = document.createElement('div');
    tip.className = 'ai-video-upgrade-tip';
    tip.innerHTML = `
      <span class="ai-upgrade-icon">🔒</span>
      <span class="ai-upgrade-text">Video analysis requires <strong>Pro + Video</strong></span>
      <a class="ai-upgrade-link" href="https://www.fauxspy.com/pro" target="_blank" rel="noopener">Upgrade →</a>
    `;
    this.widget.appendChild(tip);

    // Auto-dismiss after 4s or on click-outside
    const dismiss = (e) => {
      if (tip.contains(e?.target)) return;
      this._clearUpgradePrompt();
      document.removeEventListener('pointerdown', dismiss, true);
    };
    setTimeout(() => dismiss(), 4000);
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 100);
  },

  position(video) {
    if (!this.widget || !video) return;
    requestAnimationFrame(() => {
      const rect = video.getBoundingClientRect();
      this.widget.style.cssText = `
        position: fixed;
        top: ${rect.top + 8}px;
        left: ${rect.left + rect.width / 2}px;
        transform: translateX(-50%);
        z-index: 2147483647;
      `;
    });
  }
};

const scannedVideos = new Set();

function captureVideoFrame(video) {
  try {
    const w = video.videoWidth || video.offsetWidth;
    const h = video.videoHeight || video.offsetHeight;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85); // throws SecurityError if CORS-tainted
  } catch (e) {
    return null; // CORS taint — caller falls back to error message
  }
}

function showBlobStreamError(video) {
  const host = window.location.hostname;
  let platform = 'This site';
  let hint = 'Try hovering the video thumbnail before it plays to scan the preview image instead.';

  if (host.includes('youtube.com')) {
    platform = 'YouTube';
    hint = 'YouTube uses encrypted streams. Hover the video thumbnail on the home page or sidebar to scan it as an image.';
  } else if (host.includes('instagram.com')) {
    platform = 'Instagram';
    hint = 'Instagram uses encrypted streams. Hover the post thumbnail before the video plays to scan it.';
  } else if (host.includes('facebook.com')) {
    platform = 'Facebook';
    hint = 'Facebook uses encrypted streams. Hover the video preview image to scan it.';
  } else if (host.includes('tiktok.com')) {
    platform = 'TikTok';
    hint = 'TikTok uses encrypted streams. Try scanning the cover image thumbnail instead.';
  }

  showVideoMessage(video, {
    icon: '🔒',
    title: `${platform} Uses Encrypted Streaming`,
    body: hint,
    color: 'grey'
  });
}

async function scanVideo(video) {
  if (!video) return;

  // Check Pro + Video license first — show upgrade prompt regardless of video URL type
  const { license } = await chrome.storage.local.get('license');
  if (!license?.features?.videoDetection) {
    showVideoMessage(video, {
      icon: '🎬',
      title: 'Pro + Video Required',
      body: 'AI video detection requires the Pro + Video plan. Upgrade to analyze videos on any site.',
      linkUrl: 'https://www.fauxspy.com/pro',
      linkLabel: 'Upgrade to Pro + Video →',
      color: 'blue'
    });
    return;
  }

  const src = getVideoSrc(video);

  // Blob URL — try canvas frame capture before giving up
  if (!src) {
    const frameDataUrl = captureVideoFrame(video);
    if (frameDataUrl) {
      showVideoLoading(video);
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'analyzeImage',
          imageData: { src: frameDataUrl, pageUrl: window.location.href, pageHost: window.location.hostname, isVideoFrame: true }
        });
        hideVideoLoading();
        if (result && !result.error) {
          // Image result uses different field names — translate to video panel format
          showVideoResultPanel(video, {
            isAIVideo: result.isAI,
            aiScore: result.aiProbability,
            verdict: result.verdict,
            verdictLabel: result.verdictLabel,
            framesAnalyzed: 1,
            tokensUsed: 1,
            tokenBalance: result.tokenBalance,
            topupBalance: result.topupBalance,
            topGenerator: null
          });
        } else if (result?.error === 'TOKENS_EXHAUSTED') {
          showVideoMessage(video, {
            icon: '🔒',
            title: 'Tokens Exhausted',
            body: 'Buy more tokens to continue scanning.',
            linkUrl: result.buyUrl || 'https://www.fauxspy.com/buy-tokens',
            linkLabel: 'Buy Tokens →',
            color: 'orange'
          });
        } else if (result?.error === 'DAILY_LIMIT_REACHED') {
          showVideoMessage(video, {
            icon: '🔒',
            title: 'Daily Limit Reached',
            body: 'Upgrade to Pro for unlimited scans.',
            linkUrl: 'https://www.fauxspy.com/pro',
            linkLabel: 'Upgrade to Pro →',
            color: 'orange'
          });
        } else {
          showVideoMessage(video, {
            icon: '❌',
            title: 'Analysis Failed',
            body: result?.message || 'Could not analyze this video frame.',
            color: 'grey'
          });
        }
      } catch (err) {
        hideVideoLoading();
        showVideoMessage(video, {
          icon: '❌',
          title: 'Analysis Failed',
          body: 'Could not analyze this video frame.',
          color: 'grey'
        });
      }
    } else {
      showBlobStreamError(video);
    }
    return;
  }

  if (scannedVideos.has(src)) return;
  scannedVideos.add(src);

  showVideoLoading(video);

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'analyzeVideo',
      videoData: { src, pageUrl: window.location.href, pageHost: window.location.hostname }
    });

    hideVideoLoading();

    if (!result || result.error) {
      scannedVideos.delete(src);
      if (result?.error === 'TOKENS_EXHAUSTED') {
        showVideoMessage(video, {
          icon: '🔒',
          title: 'Tokens Exhausted',
          body: `Video scans cost 10 tokens. Buy more to continue.`,
          linkUrl: result.buyUrl || 'https://www.fauxspy.com/buy-tokens',
          linkLabel: 'Buy Tokens →',
          color: 'orange'
        });
      } else if (result?.error === 'DETECTION_TIMEOUT') {
        showVideoMessage(video, {
          icon: '⏱️',
          title: 'Analysis Timed Out',
          body: 'The video took too long to process. Try a shorter clip.',
          color: 'grey'
        });
      } else {
        showVideoMessage(video, {
          icon: '❌',
          title: 'Analysis Failed',
          body: result?.message || 'Could not analyze this video.',
          color: 'grey'
        });
      }
      return;
    }

    showVideoResultPanel(video, result);
  } catch (err) {
    scannedVideos.delete(src);
    hideVideoLoading();
    console.error('❌ scanVideo error:', err);
  }
}

function showVideoLoading(video) {
  const existing = document.querySelector('.ai-video-loading-overlay');
  if (existing) existing.remove();

  const rect = video.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'ai-video-loading-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    z-index: 2147483646;
  `;
  overlay.innerHTML = `
    <div class="ai-video-loading-inner">
      <div class="ai-video-spinner"></div>
      <div class="ai-video-loading-text">Analyzing video…</div>
      <div class="ai-video-loading-sub">This may take up to 30 seconds</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay._targetVideo = video;
}

function hideVideoLoading() {
  document.querySelector('.ai-video-loading-overlay')?.remove();
}

function showVideoMessage(video, { icon, title, body, linkUrl, linkLabel, color }) {
  hideVideoLoading();
  const existing = document.querySelector('.ai-video-message-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.className = `ai-video-message-panel ai-video-msg-${color || 'grey'}`;
  panel.innerHTML = `
    <button class="ai-panel-close" type="button" style="float:right;background:none;border:none;font-size:18px;cursor:pointer;color:inherit;">×</button>
    <div style="font-size:1.5rem;margin-bottom:6px;">${icon}</div>
    <div style="font-weight:700;margin-bottom:4px;">${escapeHtml(title)}</div>
    <div style="font-size:0.85rem;opacity:0.85;">${escapeHtml(body)}</div>
    ${linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:10px;font-size:0.85rem;font-weight:600;color:inherit;">${escapeHtml(linkLabel || 'Learn more')}</a>` : ''}
  `;
  panel.querySelector('.ai-panel-close').addEventListener('click', () => panel.remove());
  positionVideoPanel(panel, video);
  document.body.appendChild(panel);
}

function showVideoResultPanel(video, result) {
  const existing = document.querySelector('.ai-video-result-panel');
  if (existing) existing.remove();

  const isAI = result.isAIVideo;
  const scorePercent = Math.round((result.aiScore || 0) * 100);
  const generatorLine = (isAI && result.topGenerator)
    ? `<div class="ai-detail-row"><span>Generator:</span><span style="font-weight:700;text-transform:capitalize;">${escapeHtml(result.topGenerator)} — ${Math.round((result.topGeneratorScore || 0) * 100)}% confidence</span></div>`
    : '';
  const color = isAI ? 'red' : (result.verdict === 'inconclusive' ? 'yellow' : 'green');
  const icon  = isAI ? '🚨' : (result.verdict === 'inconclusive' ? '❓' : '✅');

  const panel = document.createElement('div');
  panel.className = 'ai-video-result-panel';
  panel.innerHTML = `
    <div class="ai-panel-header">
      <h3>🎬 Faux Spy Video Analysis</h3>
      <button class="ai-panel-close" type="button">×</button>
    </div>
    <div class="ai-panel-body">
      <div class="ai-verdict ai-verdict-${color}" style="margin-bottom:12px;">
        <span class="ai-verdict-icon">${icon}</span>
        <span class="ai-verdict-label">${escapeHtml(result.verdictLabel)}</span>
      </div>
      <div class="ai-panel-details">
        <div class="ai-detail-row"><span>AI Score:</span><span>${scorePercent}%</span></div>
        <div class="ai-detail-row"><span>Frames analyzed:</span><span>${result.framesAnalyzed || '—'}</span></div>
        ${generatorLine}
        <div class="ai-detail-row"><span>Tokens used:</span><span>${result.tokensUsed || 10} · Balance: ${result.tokenBalance ?? '—'}</span></div>
      </div>
    </div>
  `;

  panel.querySelector('.ai-panel-close').addEventListener('click', () => panel.remove());
  positionVideoPanel(panel, video);
  document.body.appendChild(panel);
}

function positionVideoPanel(panel, video) {
  requestAnimationFrame(() => {
    const rect = video.getBoundingClientRect();
    const panelW = 300;
    let left = rect.left + rect.width / 2 - panelW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
    let top = rect.bottom + 8;
    if (top + 200 > window.innerHeight) top = rect.top - 210;
    panel.style.cssText = `
      position: fixed;
      top: ${top}px;
      left: ${left}px;
      width: ${panelW}px;
      z-index: 2147483647;
    `;
  });
}

// Video hover event handlers
document.addEventListener('mouseenter', (e) => {
  const video = e.target;
  if (video.tagName !== 'VIDEO' || !isScannableVideo(video)) return;
  if (scannedVideos.has(getVideoSrc(video))) return;

  clearTimeout(state.videoHoverTimeout);
  state.videoHoverTimeout = setTimeout(() => {
    VideoWidgetPool.show(video);
  }, CONFIG.hoverDelay);
}, true);

document.addEventListener('mouseleave', (e) => {
  if (e.target.tagName !== 'VIDEO') return;
  clearTimeout(state.videoHoverTimeout);
  state.videoHideTimeout = setTimeout(() => {
    if (!VideoWidgetPool.widget?.matches(':hover')) {
      VideoWidgetPool.hide();
    }
  }, 400);
}, true);

// ============================================================================
// v8.3.1: BULLETPROOF CTRL+CLICK (Works on Instagram, Pinterest, etc.)
// ============================================================================

// Helper to find image even when wrapped in social media containers
function findImageFromTarget(target) {
  if (!target) return null;
  
  // Method 1: Direct img tag
  if (target.tagName === 'IMG') return target;
  
  // Method 2: Parent contains img
  let img = target.closest('img');
  if (img) return img;
  
  // Method 3: Check if target is a wrapper containing an img (Instagram/Pinterest)
  if (target.querySelector) {
    img = target.querySelector('img');
    if (img && isScannableImage(img)) return img;
  }
  
  // Method 4: Check siblings (for overlay clicks)
  if (target.parentElement) {
    img = target.parentElement.querySelector('img');
    if (img && isScannableImage(img)) return img;
  }
  
  // Method 5: Check 3 levels up for img
  let parent = target.parentElement;
  for (let i = 0; i < 3 && parent; i++) {
    img = parent.querySelector('img');
    if (img && isScannableImage(img)) return img;
    parent = parent.parentElement;
  }
  
  // Method 6: Background-image element (Pinterest)
  if (target.style && target.style.backgroundImage) {
    const match = target.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (match) {
      const virtualImg = document.createElement('img');
      virtualImg.src = match[1];
      virtualImg._isVirtual = true;
      virtualImg._sourceElement = target;
      const rect = target.getBoundingClientRect();
      Object.defineProperty(virtualImg, 'naturalWidth', { value: rect.width });
      Object.defineProperty(virtualImg, 'naturalHeight', { value: rect.height });
      return virtualImg;
    }
  }
  
  return null;
}

// Multiple event handlers for maximum reliability
function setupCtrlClickHandlers() {
  log('🎯 Setting up bulletproof Ctrl+Click handlers');
  
  // The handler function
  const ctrlClickHandler = (e) => {
    // Check for Ctrl/Cmd key
    if (!e.ctrlKey && !e.metaKey) return;
    
    log(`🖱️ ${e.type} with Ctrl/Cmd detected`);
    
    // Find image using comprehensive search
    const img = findImageFromTarget(e.target);
    
    if (img) {
      log('🎯 Found image:', img.src?.substring(0, 60));
      
      // STOP everything - prevent Instagram modal, etc.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Scan the image
      scanImage(img);
      
      return false;
    } else {
      log('⚠️ No image found at click target');
    }
  };
  
  // Method 1: Click event in CAPTURE phase (fires BEFORE Instagram's handlers)
  document.addEventListener('click', ctrlClickHandler, true);
  
  // Method 2: Mousedown in capture phase (even earlier than click)
  document.addEventListener('mousedown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    
    const img = findImageFromTarget(e.target);
    if (img) {
      log('🖱️ mousedown with Ctrl detected on image');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Schedule scan after this event
      setTimeout(() => scanImage(img), 0);
      return false;
    }
  }, true);
  
  // Method 3: Pointerdown (modern, fires earliest)
  document.addEventListener('pointerdown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    
    const img = findImageFromTarget(e.target);
    if (img) {
      log('🖱️ pointerdown with Ctrl detected on image');
      e.preventDefault();
      e.stopPropagation();
      // Don't stopImmediatePropagation here - let click handler also fire
    }
  }, true);
  
  // Method 4: Auxclick (middle/right click backup)
  document.addEventListener('auxclick', ctrlClickHandler, true);
  
  // Method 5: Special handler for Instagram modal/overlay
  // Instagram uses divs with high z-index to intercept clicks
  document.addEventListener('click', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    
    // Get element under the cursor at this exact position
    const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
    
    for (const el of elementsAtPoint) {
      if (el.tagName === 'IMG' && isScannableImage(el)) {
        log('🎯 Found image via elementsFromPoint:', el.src?.substring(0, 60));
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        scanImage(el);
        return false;
      }
      
      // Check for background image
      const style = window.getComputedStyle(el);
      if (style.backgroundImage && style.backgroundImage !== 'none') {
        const match = style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (match) {
          const virtualImg = document.createElement('img');
          virtualImg.src = match[1];
          virtualImg._isVirtual = true;
          const rect = el.getBoundingClientRect();
          Object.defineProperty(virtualImg, 'naturalWidth', { value: rect.width });
          Object.defineProperty(virtualImg, 'naturalHeight', { value: rect.height });
          
          if (rect.width >= 100 && rect.height >= 100) {
            log('🎯 Found background-image element');
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            scanImage(virtualImg);
            return false;
          }
        }
      }
    }
  }, true);
  
  log('✅ Ctrl+Click handlers setup complete (5 methods)');
}

// Setup handlers immediately
setupCtrlClickHandlers();

// Also re-setup after DOM mutations (Instagram dynamically loads content)
const ctrlClickObserver = new MutationObserver(() => {
  // Throttle - don't run too often
  if (window._ctrlClickSetupTimer) return;
  window._ctrlClickSetupTimer = setTimeout(() => {
    window._ctrlClickSetupTimer = null;
  }, 1000);
});

ctrlClickObserver.observe(document.body || document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('scroll', updateWidgetPosition, { passive: true });
window.addEventListener('resize', updateWidgetPosition, { passive: true });

// ============================================================================
// INTERSECTION OBSERVER
// ============================================================================

const imageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      state.visibleImages.add(entry.target);
      imageObserver.unobserve(entry.target);
    }
  });
}, {
  rootMargin: CONFIG.intersectionMargin,
  threshold: 0.01
});

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeDetector() {
  log('🚀 AI Detector v7.2 - Improved AI Detection');
  log(`🎯 Sensitivity: ${state.sensitivity} (${(CONFIG.thresholds[state.sensitivity] * 100)}% threshold)`);
  log('💡 Hover, Ctrl+Click, or Right-Click to scan');
  
  const images = document.querySelectorAll('img');
  log(`📊 Found ${images.length} images - observing visible ones`);
  
  images.forEach(img => {
    if (isScannableImage(img)) {
      imageObserver.observe(img);
    }
  });
  
  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeName === 'IMG' && isScannableImage(node)) {
          imageObserver.observe(node);
        } else if (node.querySelectorAll) {
          node.querySelectorAll('img').forEach(img => {
            if (isScannableImage(img)) {
              imageObserver.observe(img);
            }
          });
        }
      });
    });
  });
  
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  WidgetPool.init();
  log('✅ Initialized - Ready to scan!');
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanVisible') {
    const platform = detectSocialPlatform();
    let images;

    if (platform) {
      log(`🌐 Detected social media platform: ${platform.name}`);
      images = getAllScannableImages()
        .filter(img => !state.scannedImages.has(getBestImageUrl(img) || getImageId(img)));
    } else {
      images = Array.from(document.querySelectorAll('img'))
        .filter(img => isScannableImage(img))
        .filter(img => !state.scannedImages.has(getBestImageUrl(img) || getImageId(img)));
    }

    // Deep Dive (Pro): scan every image on the page including off-screen/hidden ones
    if (state.scanMode === 'deep') {
      // For hidden images, check natural dimensions instead of rendered rect
      const deepImages = Array.from(document.querySelectorAll('img')).filter(img => {
        const src = img.src || img.currentSrc || '';
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return false;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        return w >= CONFIG.minImageSize && h >= CONFIG.minImageSize;
      }).filter(img => !state.scannedImages.has(getBestImageUrl(img) || getImageId(img)));

      const toScan = deepImages.slice(0, CONFIG.maxBatchSize * 5);
      log(`🔬 [DEEP] Scanning ${toScan.length} images (including off-screen)`);

      if (toScan.length === 0) {
        sendResponse({ scanned: 0, total: 0, message: 'No unscanned images found', mode: 'deep' });
        return true;
      }

      Promise.all(toScan.map(img => scanImage(img)))
        .then(() => sendResponse({ scanned: toScan.length, total: toScan.length, mode: 'deep', platform: platform?.name }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }

    // Detective / Quick: only scan viewport images
    const viewportHeight = window.innerHeight;
    const inViewportImages = images.filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.top < viewportHeight + 100 && rect.bottom > -100;
    });

    const toScan = inViewportImages.slice(0, CONFIG.maxBatchSize);

    if (toScan.length === 0) {
      sendResponse({
        scanned: 0,
        total: 0,
        message: images.length > 0 ? 'Scroll to load more images' : 'No images found'
      });
      return true;
    }

    log(`🔍 Investigating ${toScan.length} of ${inViewportImages.length} visible images`);

    Promise.all(toScan.map(img => scanImage(img)))
      .then(() => sendResponse({
        scanned: toScan.length,
        total: toScan.length,
        platform: platform?.name
      }))
      .catch(err => sendResponse({ error: err.message }));

    return true;
  }
  
  if (request.action === 'clearHighlights') {
    clearAllHighlights();
    sendResponse({ success: true });
  }

  if (request.action === 'showContextResult') {
    removeLoadingBadge(null);
    if (request.result && !request.result.error) {
      showAnimatedResultPanel(null, request.result);
    } else {
      console.warn('Context scan failed:', request.result?.error);
    }
    sendResponse({ success: true });
    return true;
  }

  // Handle sensitivity change from settings
  if (request.action === 'sensitivityChanged') {
    state.sensitivity = request.sensitivity;
    log(`🎯 Sensitivity updated: ${state.sensitivity}`);
    sendResponse({ success: true });
  }
  
  return true;
});

// ============================================================================
// CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
  WidgetPool.cleanup();
  imageObserver.disconnect();
});

// ============================================================================
// START
// ============================================================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDetector);
} else {
  initializeDetector();
}

// ============================================================================
// v8.1: ANIMATED RESULT PANEL
// ============================================================================

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function showAnimatedResultPanel(img, result) {
  // Remove any existing panel
  const existing = document.querySelector('.ai-result-panel-v8');
  if (existing) existing.remove();
  
  const aiPercent = Math.round((result.aiProbability || 0) * 100);
  const humanPercent = 100 - aiPercent;
  const confidence = getConfidenceLevel(result.aiProbability || 0, result);
  
  // Get image URL for sharing
  const imageUrl = img ? (img.src || img.currentSrc || '') : '';
  const imageName = imageUrl ? imageUrl.split('/').pop().split('?')[0].substring(0, 50) : 'Unknown image';
  
  // Create panel
  const panel = document.createElement('div');
  panel.className = 'ai-result-panel-v8';
  panel.innerHTML = `
    <div class="ai-panel-header">
      <h3>🕵️ Faux Spy Investigation</h3>
      <button class="ai-panel-close" type="button">×</button>
    </div>
    
    <div class="ai-panel-body">
      ${imageUrl ? `
        <div class="ai-panel-preview">
          <img src="${imageUrl.replace(/"/g, '%22')}" alt="Scanned image" />
          <div class="ai-panel-preview-name">${escapeHtml(imageName)}</div>
        </div>
      ` : ''}
      
      <div class="ai-bar-container">
        <div class="ai-bar-labels">
          <span>👤 Real</span>
          <span>🤖 Faux</span>
        </div>
        <div class="ai-bar-track">
          <div class="ai-bar-fill ai-bar-human" data-percent="${humanPercent}"></div>
          <div class="ai-bar-fill ai-bar-ai" data-percent="${aiPercent}"></div>
        </div>
        <div class="ai-bar-percentages">
          <span class="ai-percent-human">0%</span>
          <span class="ai-percent-ai">0%</span>
        </div>
        ${(result.category === 'real' || result.category === 'manipulated') ? `
        <div style="margin-top:8px;padding:6px 10px;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.4);border-radius:6px;font-size:11px;color:#fbbf24;text-align:center;">
          ⚠️ May still be manipulated via Photoshop, face swap, or compositing
        </div>` : ''}
      </div>

      <div class="ai-verdict ai-verdict-${confidence.color}">
        <span class="ai-verdict-icon">${confidence.icon}</span>
        <span class="ai-verdict-label">${confidence.label}</span>
      </div>
      
      <div class="ai-panel-details">
        <div class="ai-detail-row">
          <span>Confidence:</span>
          <span>${confidence.description}</span>
        </div>
        <div class="ai-detail-row">
          <span>Method:</span>
          <span class="ai-method-${result.method === 'heuristic' ? 'heuristic' : 'api'}">
            ${getMethodLabel(result.method)}
          </span>
        </div>
        <div class="ai-detail-row">
          <span>Sensitivity:</span>
          <span>${state.sensitivity}</span>
        </div>
        ${result.method === 'heuristic' ? `
          <div class="ai-warning">
            ⚠️ Heuristic-only detection (limited accuracy).
            Configure Sightengine in HQ Settings for accurate results.
          </div>
        ` : ''}
      </div>
      
      ${result.indicators && result.indicators.length > 0 ? `
        <div class="ai-panel-indicators">
          <div class="ai-indicators-title">Investigation Notes:</div>
          ${result.indicators.map(ind => `<div class="ai-indicator-item">${escapeHtml(String(ind))}</div>`).join('')}
        </div>
      ` : ''}
      
      ${result.proHint ? `
        <div class="ai-panel-pro-hint">
          <span class="ai-pro-hint-icon">💎</span>
          <span class="ai-pro-hint-text">${result.proHint}</span>
          <a href="https://www.fauxspy.com/pro" target="_blank" class="ai-pro-hint-link">Upgrade →</a>
        </div>
      ` : ''}

      ${result.method === 'c2pa_verified' && result.c2pa ? `
        <div class="ai-c2pa-badge">
          <div class="ai-c2pa-header">🏛️ Content Credentials Verified</div>
          ${result.c2pa.signerName ? `<div class="ai-c2pa-row"><span>Signed by</span><span>${escapeHtml(result.c2pa.signerName)}</span></div>` : ''}
          ${result.c2pa.claimGenerator ? `<div class="ai-c2pa-row"><span>Device</span><span>${escapeHtml(result.c2pa.claimGenerator)}</span></div>` : ''}
          ${result.c2pa.signingTime ? `<div class="ai-c2pa-row"><span>Signed</span><span>${escapeHtml(result.c2pa.signingTime)}</span></div>` : ''}
          <div class="ai-c2pa-footer">Content Authenticity Initiative</div>
        </div>
      ` : ''}
      
      <div class="ai-panel-actions">
        <button class="ai-action-btn ai-action-share" type="button">📤 Share Result</button>
        <button class="ai-action-btn ai-action-close" type="button">Done</button>
      </div>
    </div>
  `;
  
  // Position panel - center if no image, near image otherwise
  let left, top;
  
  if (img) {
    const rect = img.getBoundingClientRect();
    left = rect.left + rect.width / 2 - 220;
    top = rect.top + rect.height + 20;
    
    // Adjust if off-screen
    if (left < 20) left = 20;
    if (left + 440 > window.innerWidth - 20) left = window.innerWidth - 460;
    if (top + 500 > window.innerHeight - 20) top = rect.top - 520;
    if (top < 20) top = 20;
  } else {
    // Center on screen
    left = (window.innerWidth - 440) / 2;
    top = (window.innerHeight - 500) / 2;
  }
  
  panel.style.cssText = `
    position: fixed !important;
    left: ${left}px !important;
    top: ${top}px !important;
    width: 440px !important;
    max-height: 90vh !important;
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%) !important;
    border-radius: 16px !important;
    z-index: 2147483647 !important;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6) !important;
    color: white !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    animation: aiPanelSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
    overflow-y: auto !important;
  `;
  
  document.body.appendChild(panel);
  
  // v8.4: Make panel draggable
  makeDraggable(panel);
  
  // Animate bar graph after a tiny delay
  setTimeout(() => {
    const humanBar = panel.querySelector('.ai-bar-human');
    const aiBar = panel.querySelector('.ai-bar-ai');
    const humanText = panel.querySelector('.ai-percent-human');
    const aiText = panel.querySelector('.ai-percent-ai');
    
    if (humanBar) humanBar.style.width = `${humanPercent}%`;
    if (aiBar) aiBar.style.width = `${aiPercent}%`;
    
    // Animate numbers
    animateNumberV8(humanText, 0, humanPercent, 1000);
    setTimeout(() => animateNumberV8(aiText, 0, aiPercent, 1000), 200);
  }, 100);
  
  // Close button
  panel.querySelector('.ai-panel-close').onclick = () => panel.remove();
  panel.querySelector('.ai-action-close').onclick = () => panel.remove();
  
  // Share button - pass image URL too
  panel.querySelector('.ai-action-share').onclick = () => {
    shareResultV8(result, confidence, imageUrl);
  };
  
  // v8.4: Don't auto-close - let user dismiss when ready
  // Auto-close removed since panel can now be dragged
}

// Animate number counter
function animateNumberV8(element, start, end, duration) {
  if (!element) return;
  
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.floor(start + (end - start) * progress);
    element.textContent = `${current}%`;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

// Share result with multiple options and image URL
function shareResultV8(result, confidence, imageUrl) {
  const percent = Math.round((result.aiProbability || 0) * 100);
  const humanPercent = 100 - percent;
  const method = getMethodLabel(result.method).replace(/[✓⚠📦]/g, '').trim();
  
  // Build comprehensive share text with image URL
  const shareText = `🕵️ Faux Spy Investigation Report

${confidence.icon} Verdict: ${confidence.label}
📊 Faux Probability: ${percent}%
👤 Real Probability: ${humanPercent}%
🔬 Detection Method: ${method}
${imageUrl ? `\n🖼️ Evidence: ${imageUrl}` : ''}

🔍 Investigated with Faux Spy
🌐 fauxspy.com
#FauxSpy #AIDetection #DeepFake`;
  
  // Show share menu with multiple options
  showShareMenu(shareText, imageUrl, result, confidence);
}

// Show share menu
function showShareMenu(shareText, imageUrl, result, confidence) {
  // Remove existing share menu
  const existing = document.querySelector('.ai-share-menu');
  if (existing) existing.remove();
  
  const menu = document.createElement('div');
  menu.className = 'ai-share-menu';
  menu.innerHTML = `
    <div class="ai-share-header">
      <h3>📤 Share Detection Result</h3>
      <button class="ai-share-close" type="button">×</button>
    </div>
    
    <div class="ai-share-preview">
      <pre id="ai-share-text-content"></pre>
    </div>
    
    <div class="ai-share-options">
      <button class="ai-share-option" data-platform="copy">
        <span class="ai-share-icon">📋</span>
        <span>Copy to Clipboard</span>
      </button>
      
      <button class="ai-share-option" data-platform="twitter">
        <span class="ai-share-icon">𝕏</span>
        <span>Share on X (Twitter)</span>
      </button>
      
      <button class="ai-share-option" data-platform="facebook">
        <span class="ai-share-icon">f</span>
        <span>Share on Facebook</span>
      </button>
      
      <button class="ai-share-option" data-platform="reddit">
        <span class="ai-share-icon">🔻</span>
        <span>Share on Reddit</span>
      </button>
      
      ${imageUrl ? `
        <button class="ai-share-option" data-platform="copyimage">
          <span class="ai-share-icon">🔗</span>
          <span>Copy Image URL Only</span>
        </button>
      ` : ''}
    </div>
  `;
  
  menu.style.cssText = `
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    width: 480px !important;
    max-width: 90vw !important;
    max-height: 90vh !important;
    background: linear-gradient(135deg, #1f2937 0%, #111827 100%) !important;
    border-radius: 16px !important;
    z-index: 2147483647 !important;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8) !important;
    color: white !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    animation: aiPanelSlideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
    overflow-y: auto !important;
  `;
  
  document.body.appendChild(menu);
  menu.querySelector('#ai-share-text-content').textContent = shareText;

  // Close handlers
  const closeMenu = () => menu.remove();
  menu.querySelector('.ai-share-close').onclick = closeMenu;
  
  // Click outside to close
  const outsideClickHandler = (e) => {
    if (!menu.contains(e.target)) {
      closeMenu();
      document.removeEventListener('click', outsideClickHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', outsideClickHandler), 100);
  
  // Share option handlers
  menu.querySelectorAll('.ai-share-option').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const platform = btn.dataset.platform;
      const encodedText = encodeURIComponent(shareText);
      const encodedUrl = imageUrl ? encodeURIComponent(imageUrl) : '';
      
      switch (platform) {
        case 'copy':
          navigator.clipboard.writeText(shareText).then(() => {
            showShareFeedback('✓ Copied to clipboard!');
            closeMenu();
          });
          break;
        
        case 'twitter':
          window.open(`https://twitter.com/intent/tweet?text=${encodedText}`, '_blank', 'width=600,height=400');
          closeMenu();
          break;
        
        case 'facebook':
          if (imageUrl) {
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`, '_blank', 'width=600,height=400');
          } else {
            window.open(`https://www.facebook.com/sharer/sharer.php?quote=${encodedText}`, '_blank', 'width=600,height=400');
          }
          closeMenu();
          break;
        
        case 'reddit':
          window.open(`https://www.reddit.com/submit?title=${encodedText}${imageUrl ? `&url=${encodedUrl}` : ''}`, '_blank', 'width=600,height=400');
          closeMenu();
          break;
        
        case 'copyimage':
          if (imageUrl) {
            navigator.clipboard.writeText(imageUrl).then(() => {
              showShareFeedback('✓ Image URL copied!');
              closeMenu();
            });
          }
          break;
      }
    };
  });
}

// Show feedback toast for share actions
function showShareFeedback(message) {
  const feedback = document.createElement('div');
  feedback.textContent = message;
  feedback.style.cssText = `
    position: fixed !important;
    bottom: 30px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    padding: 14px 28px !important;
    background: linear-gradient(135deg, #10b981, #059669) !important;
    color: white !important;
    border-radius: 10px !important;
    z-index: 2147483648 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    font-weight: 600 !important;
    font-size: 14px !important;
    box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4) !important;
    animation: aiToastSlideIn 0.3s ease-out !important;
  `;
  document.body.appendChild(feedback);
  setTimeout(() => {
    feedback.style.animation = 'aiToastSlideOut 0.3s ease-out';
    setTimeout(() => feedback.remove(), 300);
  }, 2500);
}

// Listen for messages from popup (mode changes, etc.)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStats') {
    sendResponse({ stats: state.stats, achievements: state.achievements });
    return true;
  }
  
  if (message.type === 'setScanMode') {
    state.scanMode = message.mode;
    chrome.storage.local.set({ scanMode: message.mode });
    log('🎯 Scan mode changed to:', message.mode);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'toggleResultPanel') {
    state.showResultPanel = message.enabled;
    chrome.storage.local.set({ showResultPanel: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'toggleVideoWidget') {
    state.showVideoWidget = message.enabled;
    if (!message.enabled) VideoWidgetPool.hide();
    chrome.storage.local.set({ showVideoWidget: message.enabled });
    sendResponse({ success: true });
    return true;
  }
});

log('✅ AI Detector v8.1 - All features loaded');

// ── Universal SPA navigation reset ──────────────────────────────────────────
// YouTube, X/Twitter, Instagram, and Pinterest all use pushState navigation.
// DOMContentLoaded never re-fires between pages, so stale hover timeouts and
// _pendingImage references from the previous page must be cleared on URL change.

let _spaLastPath = location.pathname;

function onSPANavigate() {
  const newPath = location.pathname;
  if (newPath === _spaLastPath) return; // hash/query-param-only change — ignore
  _spaLastPath = newPath;

  clearTimeout(state.hoverTimeout);
  clearTimeout(state.videoHoverTimeout);
  clearTimeout(state.hideTimeout);
  clearTimeout(state.videoHideTimeout);
  WidgetPool.hide();
  WidgetPool._pendingImage = null;
  WidgetPool.currentImage = null;
  VideoWidgetPool.hide();
  VideoWidgetPool._pendingVideo = null;
  VideoWidgetPool.currentVideo = null;
  log('🔄 SPA navigation detected — widget state reset');
}

// popstate fires on browser back/forward on all platforms
window.addEventListener('popstate', onSPANavigate);

// Interval poll catches pushState navigations on X, Instagram, Pinterest.
// history.pushState patching is not possible in MV3 isolated worlds.
setInterval(onSPANavigate, 1000);

// YouTube fires this custom event after page content loads — faster than the poll
document.addEventListener('yt-navigate-finish', onSPANavigate);

// ============================================================================
// CAROUSEL NAVIGATION: close result panel when user slides to next/prev image
// Instagram carousels don't change the pathname so onSPANavigate never fires.
// ============================================================================

function closeOpenPanels() {
  document.querySelectorAll('.ai-result-panel-v8').forEach(p => p.remove());
  WidgetPool.hide();
  WidgetPool._pendingImage = null;
  WidgetPool.currentImage = null;
}

// Click-based detection: carousel arrow buttons inside post/dialog containers
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (!btn.closest('article, [role="dialog"], [role="presentation"]')) return;

  const label = (btn.getAttribute('aria-label') || '').toLowerCase();
  const isCarouselNav = /next|prev|forward|back/.test(label);
  // Icon-only SVG buttons with no label inside post containers are carousel arrows
  const isIconOnly = !label && btn.querySelector('svg') && btn.textContent.trim().length === 0;

  if (isCarouselNav || isIconOnly) {
    setTimeout(closeOpenPanels, 80);
  }
}, true);

// Keyboard-based detection: left/right arrow keys also navigate Instagram carousels
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!document.querySelector('article, [role="dialog"]')) return;
  if (!document.querySelector('.ai-result-panel-v8')) return;
  setTimeout(closeOpenPanels, 80);
});

// ============================================================================
// v8.4: DRAG FUNCTIONALITY FOR RESULT PANEL
// ============================================================================

function makeDraggable(panel) {
  const header = panel.querySelector('.ai-panel-header');
  if (!header) return;
  
  // Add visual indicator that header is draggable
  header.style.cursor = 'move';
  header.style.userSelect = 'none';
  header.title = 'Drag to move';
  
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  
  // Get current position from style
  function getCurrentPosition() {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }
  
  // Mouse down on header - start dragging
  const handleMouseDown = (e) => {
    // Don't drag if clicking close button
    if (e.target.closest('.ai-panel-close')) return;
    
    isDragging = true;
    
    const pos = getCurrentPosition();
    initialLeft = pos.left;
    initialTop = pos.top;
    startX = e.clientX;
    startY = e.clientY;
    
    panel.style.transition = 'none';
    panel.style.cursor = 'grabbing';
    header.style.cursor = 'grabbing';
    
    // Add visual feedback
    panel.style.opacity = '0.95';
    panel.style.boxShadow = '0 30px 80px rgba(0, 0, 0, 0.7)';
    
    e.preventDefault();
    e.stopPropagation();
    
    log('🖱️ Started dragging panel');
  };
  
  // Mouse move - update position
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;
    
    // Keep within viewport
    const panelRect = panel.getBoundingClientRect();
    const minLeft = 0;
    const maxLeft = window.innerWidth - panelRect.width;
    const minTop = 0;
    const maxTop = window.innerHeight - panelRect.height;
    
    newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
    newTop = Math.max(minTop, Math.min(maxTop, newTop));
    
    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
    
    e.preventDefault();
  };
  
  // Mouse up - stop dragging
  const handleMouseUp = (e) => {
    if (!isDragging) return;
    
    isDragging = false;
    panel.style.transition = '';
    panel.style.cursor = '';
    header.style.cursor = 'move';
    
    // Reset visual feedback
    panel.style.opacity = '';
    panel.style.boxShadow = '';
    
    // Save position for next time
    const pos = getCurrentPosition();
    chrome.storage.local.set({
      lastPanelPosition: { left: pos.left, top: pos.top }
    });
    
    log('🖱️ Stopped dragging panel');
  };
  
  // Attach handlers
  header.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  
  // Touch support for mobile
  const handleTouchStart = (e) => {
    if (e.target.closest('.ai-panel-close')) return;
    
    const touch = e.touches[0];
    isDragging = true;
    
    const pos = getCurrentPosition();
    initialLeft = pos.left;
    initialTop = pos.top;
    startX = touch.clientX;
    startY = touch.clientY;
    
    panel.style.transition = 'none';
    e.preventDefault();
  };
  
  const handleTouchMove = (e) => {
    if (!isDragging) return;
    
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    
    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;
    
    const panelRect = panel.getBoundingClientRect();
    newLeft = Math.max(0, Math.min(window.innerWidth - panelRect.width, newLeft));
    newTop = Math.max(0, Math.min(window.innerHeight - panelRect.height, newTop));
    
    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
    
    e.preventDefault();
  };
  
  const handleTouchEnd = () => {
    isDragging = false;
    panel.style.transition = '';
  };
  
  header.addEventListener('touchstart', handleTouchStart, { passive: false });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  document.addEventListener('touchend', handleTouchEnd);
  
  // Cleanup when panel removed
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.removedNodes.forEach(node => {
        if (node === panel) {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
          observer.disconnect();
        }
      });
    });
  });
  
  observer.observe(panel.parentNode || document.body, { childList: true });
  
  // Restore last position if available
  chrome.storage.local.get(['lastPanelPosition'], (data) => {
    if (data.lastPanelPosition) {
      const { left, top } = data.lastPanelPosition;
      // Only restore if position is still in viewport
      if (left >= 0 && left < window.innerWidth - 100 && 
          top >= 0 && top < window.innerHeight - 100) {
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      }
    }
  });
  
  log('✅ Panel is now draggable');
}

// ============================================================================
// v1.1: LAZY-LOADING IMAGE OBSERVER
// Watches for images that load late (Instagram CDN rewrites)
// ============================================================================

// Track images we're waiting on
const pendingImages = new Set();

// Wait for an image to fully load before scanning
function waitForImageLoad(img, timeout = 5000) {
  return new Promise((resolve) => {
    // Already loaded
    if (img.complete && img.naturalWidth > 10) {
      return resolve(true);
    }
    
    let resolved = false;
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
    
    const onLoad = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      // Wait one frame for naturalWidth to update
      requestAnimationFrame(() => resolve(img.naturalWidth > 10));
    };
    
    const onError = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    };
    
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
    
    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(img.naturalWidth > 10);
      }
    }, timeout);
  });
}

// Watch for src changes on Instagram images (CDN rewrites)
function watchImageSrcChanges(img, callback) {
  if (!window.MutationObserver) return;
  
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && 
          (mutation.attributeName === 'src' || mutation.attributeName === 'srcset')) {
        const newSrc = img.src || img.currentSrc;
        if (newSrc && !newSrc.startsWith('data:') && img.naturalWidth > 10) {
          callback(newSrc);
          observer.disconnect();
          return;
        }
      }
    }
  });
  
  observer.observe(img, {
    attributes: true,
    attributeFilter: ['src', 'srcset']
  });
  
  // Auto-disconnect after 10 seconds
  setTimeout(() => observer.disconnect(), 10000);
  
  return observer;
}

// Improved scan that waits for lazy-loaded images
async function scanImageWhenReady(img) {
  // Check if image is ready
  if (!img.complete || img.naturalWidth <= 10) {
    log('⏳ Waiting for image to load:', img.src?.substring(0, 60));
    
    // Wait for it to load (with timeout)
    const loaded = await waitForImageLoad(img, 3000);
    
    if (!loaded) {
      log('⚠️ Image did not load in time:', img.src?.substring(0, 60));
      return null;
    }
  }
  
  // Now actually scan it
  return scanImage(img);
}

// ============================================================================
// CASE FILES — Save scan history for Pro users
// ============================================================================

async function saveToCaseFiles(img, result) {
  const { license } = await chrome.storage.local.get('license');
  if (!license?.isPro) return;

  const confidence = getConfidenceLevel(result.aiProbability || 0, result);
  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    timestamp: Date.now(),
    imageUrl: getBestImageUrl(img) || getImageId(img),
    domain: window.location.hostname,
    pageTitle: document.title,
    label: confidence.label,
    icon: confidence.icon,
    isAI: isAIGenerated(result.aiProbability, result),
    confidence: Math.round((result.aiProbability || 0) * 100),
    method: result.method,
    category: result.category || 'unknown'
  };

  const { caseFiles } = await chrome.storage.local.get('caseFiles');
  const files = caseFiles || [];
  files.unshift(entry);
  if (files.length > 200) files.splice(200);
  await chrome.storage.local.set({ caseFiles: files });
}

log('🕵️ Faux Spy v1.1 ready - non-invasive overlay system active');
