importScripts('sentry-reporter.js');

// Background service worker

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };

// ============================================================================
// Local ONNX Pre-filter
// ============================================================================

try {
  importScripts('ort.min.js');
} catch (e) {
  console.warn('⚠️ [ONNX] Runtime failed to load:', e.message);
}

const ONNX_MODEL_URL = 'https://www.fauxspy.com/static/ai-detector.onnx';
const ONNX_CACHE_NAME = 'fauxspy-onnx-v1';
const ONNX_THRESHOLDS = { AI_CONFIDENT: 0.88, REAL_CONFIDENT: 0.12 };
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

let _onnxSession = null;
let _onnxInitPromise = null;

async function initOnnxSession() {
  if (_onnxSession) return _onnxSession;
  if (_onnxInitPromise) return _onnxInitPromise;
  _onnxInitPromise = (async () => {
    try {
      if (typeof ort === 'undefined') return null;
      ort.env.wasm.wasmPaths = chrome.runtime.getURL('');
      const cache = await caches.open(ONNX_CACHE_NAME);
      let modelResp = await cache.match(ONNX_MODEL_URL);
      if (!modelResp) {
        modelResp = await fetch(ONNX_MODEL_URL);
        if (!modelResp.ok) throw new Error(`Model fetch ${modelResp.status}`);
        await cache.put(ONNX_MODEL_URL, modelResp.clone());
        log('✅ [ONNX] Model downloaded and cached');
      }
      const modelBuf = await modelResp.arrayBuffer();
      _onnxSession = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] });
      log('✅ [ONNX] Session ready');
      return _onnxSession;
    } catch (err) {
      console.warn('⚠️ [ONNX] Init failed:', err.message);
      _onnxInitPromise = null;
      return null;
    }
  })();
  return _onnxInitPromise;
}

async function fetchImagePixels(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob, { resizeWidth: 224, resizeHeight: 224, resizeQuality: 'medium' });
    const canvas = new OffscreenCanvas(224, 224);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, 224, 224).data;
  } catch {
    return null;
  }
}

function preprocessPixels(pixels) {
  const float32 = new Float32Array(3 * 224 * 224);
  for (let i = 0; i < 224 * 224; i++) {
    float32[i]                 = (pixels[i * 4]     / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    float32[224 * 224 + i]     = (pixels[i * 4 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    float32[2 * 224 * 224 + i] = (pixels[i * 4 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return float32;
}

async function runLocalInference(url) {
  try {
    const session = await initOnnxSession();
    if (!session) return null;
    const pixels = await fetchImagePixels(url);
    if (!pixels) return null;
    const tensor = new ort.Tensor('float32', preprocessPixels(pixels), [1, 3, 224, 224]);
    const feeds = { [session.inputNames[0]]: tensor };
    const output = await session.run(feeds);
    const scores = output[session.outputNames[0]].data;
    let aiScore;
    if (scores.length === 2) {
      const expR = Math.exp(scores[0]), expA = Math.exp(scores[1]);
      aiScore = expA / (expR + expA);
    } else {
      aiScore = 1 / (1 + Math.exp(-scores[0]));
    }
    log(`⚡ [ONNX] ai=${(aiScore * 100).toFixed(1)}%`);
    return { aiScore };
  } catch (err) {
    console.warn('⚠️ [ONNX] Inference error:', err.message);
    return null;
  }
}

function buildLocalResult(aiScore, isAI) {
  const pct = Math.round(aiScore * 100);
  return {
    success: true,
    isAI,
    aiProbability: isAI ? aiScore : 1 - aiScore,
    confidence: Math.abs(aiScore - 0.5) * 2,
    verdict: isAI ? 'ai_photo' : 'real',
    verdictLabel: isAI ? 'AI Detected' : 'No AI Detected',
    method: 'local_onnx',
    indicators: [
      isAI ? `Local model: ${pct}% AI probability` : `Local model: ${100 - pct}% real probability`,
      '⚡ Fast local scan — no API call'
    ],
    localOnly: true,
    timestamp: Date.now()
  };
}

// v1.6.1: Import license management module
try {
  importScripts('license.js');
  log('✅ License module loaded');
} catch (e) {
  console.error('Failed to load license.js:', e);
}

// Rate limiting queue
let requestQueue = [];
let isProcessingQueue = false;
const MIN_REQUEST_INTERVAL = 500; // 500ms between requests
let lastRequestTime = 0;

// v1.6: Backend proxy URL - hides Sightengine API key from users
const BACKEND_URL = 'https://www.fauxspy.com';

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'checkAI',
    title: '🕵️ Investigate this image',
    contexts: ['image']
  });
  
  log('🕵️ Faux Spy installed - Context menu created');
  
  // v1.6.1: First-run initialization (no hardcoded credentials!)
  chrome.storage.local.get(['userId', 'license'], async (result) => {
    // Generate anonymous user ID if not exists
    if (!result.userId) {
      const userId = 'fs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
      await chrome.storage.local.set({ userId });
      log('🆔 Created user ID:', userId);
    }
    
    // Set default free license if not exists
    if (!result.license) {
      const defaultLicense = {
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
        license: defaultLicense,
        lastLicenseCheck: Date.now()
      });
      log('✅ Free tier initialized - 10 scans/day');
    }
  });
});

// v1.6.1: Listen for storage changes to sync license updates from settings
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.license) {
    const newLicense = changes.license.newValue;
    if (newLicense?.isPro) {
      log('✨ Pro license activated:', newLicense.plan);
    } else if (changes.license.oldValue?.isPro) {
      log('🔓 Pro license deactivated');
    }
  }
});

/**
 * Legacy checkLicense function - kept as no-op for compatibility
 * Real license logic is in license.js (loaded via importScripts in service worker)
 */
async function checkLicense() {
  // No-op - license.js handles this now
  // Kept to prevent errors from old code paths
  const { license } = await chrome.storage.local.get('license');
  return license || { isPro: false, plan: 'free', limits: { scansPerDay: 10 } };
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeImage') {
    // Add to queue instead of processing immediately
    queueAnalysis(request, sendResponse);
    return true; // Keep channel open for async response
  }

  if (request.action === 'analyzeVideo') {
    analyzeVideo(request, sendResponse);
    return true; // Keep channel open for async response
  }
});

async function analyzeVideo(request, callback) {
  try {
    const { license, userId } = await chrome.storage.local.get(['license', 'userId']);

    // Gate: Pro + Video feature required
    if (!license?.features?.videoDetection) {
      return callback({ error: 'VIDEO_FEATURE_REQUIRED' });
    }

    // Optimistic local token pre-check
    const totalTokens = (license.tokenBalance || 0) + (license.topupBalance || 0);
    if (totalTokens < 10) {
      return callback({
        error: 'TOKENS_EXHAUSTED',
        tokenBalance: license.tokenBalance || 0,
        topupBalance: license.topupBalance || 0,
        required: 10,
        buyUrl: 'https://www.fauxspy.com/buy-tokens'
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    let result;
    try {
      const response = await fetch('https://www.fauxspy.com/api/detect-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: request.videoData.src,
          userId,
          licenseKey: license.key
        }),
        signal: controller.signal
      });
      result = await response.json();
    } finally {
      clearTimeout(timeoutId);
    }

    // Sync token balance from server response (authoritative)
    if (typeof result.tokenBalance === 'number') {
      const stored = await chrome.storage.local.get('license');
      if (stored.license?.isPro) {
        stored.license.tokenBalance = result.tokenBalance;
        stored.license.topupBalance = result.topupBalance ?? 0;
        await chrome.storage.local.set({ license: stored.license });
      }
    }

    callback(result);
  } catch (error) {
    if (error.name === 'AbortError') {
      callback({ error: 'DETECTION_TIMEOUT', message: 'Video analysis timed out. Try a shorter video.' });
    } else {
      console.error('❌ analyzeVideo error:', error);
      callback({ error: 'INTERNAL_ERROR', message: error.message });
    }
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'checkAI') {
    log('🖱️ Context menu clicked for:', info.srcUrl);
    
    // Analyze the image
    const result = await processAnalysis({ src: info.srcUrl });
    
    // Show notification in the page
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showContextResult',
        result: result,
        src: info.srcUrl
      }).catch(() => {});
    }
  }
});

/**
 * Rate-limited request queue
 */
async function queueAnalysis(request, callback) {
  requestQueue.push({ request, callback });
  
  if (!isProcessingQueue) {
    processQueue();
  }
}

async function processQueue() {
  if (requestQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }
  
  isProcessingQueue = true;
  
  const { request, callback } = requestQueue.shift();
  
  // Enforce rate limiting
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    log(`⏱️ [RATE LIMIT] Waiting ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  lastRequestTime = Date.now();
  
  // Process the request
  try {
    const result = await processAnalysis(request);
    callback(result);
  } catch (error) {
    console.error('Queue processing error:', error);
    callback(null);
  }
  
  // Continue processing queue
  if (requestQueue.length > 0) {
    setTimeout(() => processQueue(), MIN_REQUEST_INTERVAL);
  } else {
    isProcessingQueue = false;
  }
}

function getPlatformDisplayName(host) {
  host = (host || '').toLowerCase();
  if (host.includes('instagram') || host.includes('cdninstagram')) return 'Instagram';
  if (host.includes('twitter') || host.includes('x.com') || host.includes('twimg')) return 'X (Twitter)';
  if (host.includes('facebook') || host.includes('fbcdn')) return 'Facebook';
  if (host.includes('pinterest') || host.includes('pinimg')) return 'Pinterest';
  if (host.includes('reddit') || host.includes('redd.it')) return 'Reddit';
  if (host.includes('tiktok')) return 'TikTok';
  if (host.includes('linkedin') || host.includes('licdn')) return 'LinkedIn';
  return null;
}

async function processAnalysis(request) {
  // Extract imageData from request
  const imageData = request.imageData || request;
  log('🔍 Processing analysis for:', imageData.src?.substring(0, 50));
  
  // v1.5: Try Faux Spy proxy backend FIRST (uses our Sightengine key)
  // Falls back to user's own Sightengine credentials if proxy fails
  // Final fallback: heuristic
  
  const { license } = await chrome.storage.local.get(['license']);

  // STEP 0: Local ONNX pre-filter (50-200ms, no token cost)
  const src = imageData.src || '';
  if (src.startsWith('https://') && !imageData.isVideoFrame) {
    const local = await runLocalInference(src);
    if (local) {
      if (local.aiScore >= ONNX_THRESHOLDS.AI_CONFIDENT) {
        log('⚡ [ONNX] High-confidence AI → skip API');
        return buildLocalResult(local.aiScore, true);
      }
      if (local.aiScore <= ONNX_THRESHOLDS.REAL_CONFIDENT) {
        log('⚡ [ONNX] High-confidence Real → skip API');
        return buildLocalResult(local.aiScore, false);
      }
      log('⚡ [ONNX] Uncertain → proceeding to API');
    }
  }

  // STEP 1: Try Faux Spy proxy backend
  log('🎯 [FAUXSPY] Calling backend proxy...');
  const proxyResult = await analyzeWithProxy(imageData, license);

  if (proxyResult.method === 'sightengine_api') {
    log('✅ [FAUXSPY] Backend detection succeeded');
    return proxyResult;
  }

  // If proxy hit daily limit, return that specific result (don't fall back)
  if (proxyResult.error === 'DAILY_LIMIT_REACHED') {
    log('🚫 [FAUXSPY] Daily limit reached');
    return proxyResult;
  }

  // STEP 2: Last resort - heuristic
  log('⚠️ Using heuristic fallback');
  const heuristicResult = await analyzeImageHeuristic(imageData);
  heuristicResult.fallback = true;
  const platformName = getPlatformDisplayName(imageData.pageHost || '');
  const unavailableMsg = platformName
    ? `⚠️ Detection service temporarily unavailable on ${platformName}`
    : '⚠️ Detection service temporarily unavailable';
  heuristicResult.indicators.unshift(unavailableMsg);
  return heuristicResult;
}

/**
 * v1.5: Call Faux Spy backend proxy
 * Uses YOUR Sightengine API key (hidden in env vars)
 * Tracks per-user usage with anonymous user ID
 */
async function analyzeWithProxy(imageData, license) {
  // Get or create anonymous user ID
  let { userId } = await chrome.storage.local.get('userId');
  if (!userId) {
    userId = 'fs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
    await chrome.storage.local.set({ userId });
    log('🆔 Created user ID:', userId);
  }
  
  const isPro = license?.isPro === true;
  const licenseKey = isPro ? (license?.key || null) : null;

  try {
    const src = imageData.src;
    if (!src || src.startsWith('blob:') ||
        (!src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://'))) {
      return {
        method: 'error',
        error: 'UNSCANNABLE_URL',
        verdict: 'error',
        indicators: ["This image can't be scanned — it has no direct URL"]
      };
    }

    const isFrameCapture = imageData.src?.startsWith('data:');
    const response = await fetch(`${BACKEND_URL}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Video frame captures send base64 data; normal images send a URL
        ...(isFrameCapture ? { imageData: imageData.src } : { imageUrl: imageData.src }),
        userId,
        isPro,
        // Pass license key so backend can check and deduct tokens
        ...(licenseKey ? { licenseKey } : {}),
        // v1.5.1: Pass dimensions for backend pre-checks
        width: imageData.width || 0,
        height: imageData.height || 0,
        // Light context for backend (URL-based hints)
        pageHost: imageData.pageHost || '',
        ...(imageData.isVideoFrame ? { isVideoFrame: true } : {})
      })
    });

    let data;
    try {
      data = await response.json();
    } catch {
      return {
        method: 'error',
        error: 'PARSE_ERROR',
        indicators: ['Invalid response from detection service']
      };
    }
    
    // Daily limit reached - special handling
    if (response.status === 429 || data.error === 'DAILY_LIMIT_REACHED') {
      const limit = data.limit || 5;
      return {
        isAI: false,
        aiProbability: 0,
        confidence: 0,
        indicators: [
          '🔒 Daily limit reached',
          `Used ${data.used || limit} of ${limit} free investigations today`,
          '👉 Upgrade to Pro for unlimited'
        ],
        method: 'error',
        error: 'DAILY_LIMIT_REACHED',
        upgradeUrl: data.upgradeUrl || 'https://www.fauxspy.com/pro',
        dailyLimitInfo: {
          used: data.used,
          limit
        }
      };
    }

    // Tokens exhausted (Pro users only)
    if (response.status === 402 || data.error === 'TOKENS_EXHAUSTED') {
      return {
        isAI: false,
        aiProbability: 0,
        confidence: 0,
        indicators: ['🔒 Token balance exhausted', 'Purchase more tokens to continue'],
        method: 'error',
        error: 'TOKENS_EXHAUSTED',
        buyUrl: data.buyUrl || 'https://www.fauxspy.com/buy-tokens',
        tokenBalance: 0,
        topupBalance: 0,
      };
    }

    // Other error responses
    if (!response.ok || !data.success) {
      console.warn('⚠️ Proxy returned error:', data);
      let userMessage;
      if (data.seCode === 1044 || data.error === 'UNSCANNABLE_URL') {
        userMessage = "This image doesn't have a direct URL — try opening the image in a new tab";
      } else if (data.seCode === 1201) {
        userMessage = "Image URL redirected and couldn't be resolved — try from the original source page";
      } else if (data.error === 'SERVER_NOT_CONFIGURED') {
        userMessage = 'Detection service is temporarily unavailable';
      } else if (data.error === 'SERVICE_BUSY') {
        userMessage = 'Detection service is busy — try again in a moment';
      } else {
        userMessage = data.message || 'Detection service unavailable';
      }
      sentryCapture(`Scan failed: ${data.error || 'PROXY_ERROR'}`, {
        tags: { error_type: data.error || 'PROXY_ERROR', se_code: String(data.seCode || ''), platform: imageData.pageHost || '' },
        extra: { message: data.message, seCode: data.seCode },
        userId
      });
      return {
        method: 'error',
        error: data.error || 'PROXY_ERROR',
        indicators: [userMessage]
      };
    }

    // Sync token balance into local storage if server returned updated values
    if (isPro && licenseKey && typeof data.tokenBalance === 'number') {
      chrome.storage.local.get('license', ({ license: storedLicense }) => {
        if (storedLicense?.isPro) {
          storedLicense.tokenBalance = data.tokenBalance;
          storedLicense.topupBalance = data.topupBalance ?? storedLicense.topupBalance ?? 0;
          chrome.storage.local.set({ license: storedLicense });
        }
      });
    }
    
    // Success! Return result
    // v1.5.1: Handle special verdicts from backend
    if (data.verdict === 'insufficient_data') {
      return {
        ...data,
        method: 'pre_check_failed',
        isAI: false,
        aiProbability: 0
      };
    }
    
    return {
      ...data,
      method: 'sightengine_api'
    };
    
  } catch (error) {
    console.error('❌ Proxy call failed:', error);
    sentryCapture(`Network error: ${error.message}`, {
      tags: { error_type: 'NETWORK_ERROR', platform: imageData.pageHost || '' },
      extra: { errorDetail: error.message },
      userId
    });
    const platform = getPlatformDisplayName(imageData.pageHost || '');
    return {
      method: 'error',
      error: 'NETWORK_ERROR',
      errorDetail: error.message,
      indicators: [
        platform
          ? `Could not reach Faux Spy on ${platform} — check your connection`
          : 'Backend unavailable — check your connection'
      ]
    };
  }
}

/**
 * Cache management
 */
async function checkCache(imageUrl) {
  try {
    const { imageCache } = await chrome.storage.local.get('imageCache');
    if (!imageCache) return null;
    
    const cached = imageCache[imageUrl];
    if (!cached) return null;
    
    // Check if cache is still valid (7 days)
    const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    const age = Date.now() - (cached.timestamp || 0);
    
    if (age > CACHE_DURATION) {
      log('🗑️ [CACHE] Expired, will re-analyze');
      return null;
    }
    
    return cached;
  } catch (error) {
    console.error('Cache check error:', error);
    return null;
  }
}

async function cacheResult(imageUrl, result) {
  try {
    const { imageCache } = await chrome.storage.local.get('imageCache');
    const cache = imageCache || {};
    
    cache[imageUrl] = {
      ...result,
      timestamp: Date.now()
    };
    
    // Limit cache size to 1000 entries
    const keys = Object.keys(cache);
    if (keys.length > 1000) {
      // Remove oldest 100 entries
      const sorted = keys
        .map(k => ({ key: k, time: cache[k].timestamp || 0 }))
        .sort((a, b) => a.time - b.time);
      
      for (let i = 0; i < 100; i++) {
        delete cache[sorted[i].key];
      }
    }
    
    await chrome.storage.local.set({ imageCache: cache });
    log('💾 [CACHE] Result saved');
  } catch (error) {
    console.error('Cache save error:', error);
  }
}

async function incrementStat(statName) {
  try {
    const { apiStats } = await chrome.storage.local.get('apiStats');
    const currentStats = apiStats || { total: 0, cached: 0, apiCalls: 0 };
    currentStats[statName] = (currentStats[statName] || 0) + 1;
    await chrome.storage.local.set({ apiStats: currentStats });
  } catch (error) {
    console.error('Stats update error:', error);
  }
}

/**
 * Fallback heuristic detection (used if Hive API fails)
 */
async function analyzeImageHeuristic({ src, width, height, pageUrl, pageHost, pageTitle }) {
  try {
    const indicators = [];
    let aiScore = 0;
    
    // Check 0: Page context (NEW!) - is the page itself AI-related?
    if (pageHost) {
      const aiPageHosts = [
        'cgdream.ai', 'postcrest.com', 'midjourney.com', 'stability.ai',
        'lexica.art', 'civitai.com', 'leonardo.ai', 'playgroundai.com',
        'nightcafe.studio', 'starryai.com', 'novelai.net', 'waifulabs.com',
        'thispersondoesnotexist.com', 'generated.photos', 'replicate.com',
        'huggingface.co', 'tensor.art', 'mage.space', 'dreamstudio.ai',
        'runwayml.com', 'getimg.ai', 'flux.ai', 'recraft.ai', 'krea.ai',
        'magnific.ai', 'ideogram.ai', 'imagine.art', 'imagine.ai',
        'dezgo.com', 'gencraft.com', 'instantart.io', 'dreamlike.art',
        'firefly.adobe.com', 'pngtree.com'
      ];
      
      for (const host of aiPageHosts) {
        if (pageHost.includes(host)) {
          indicators.push(`AI website: ${host}`);
          aiScore += 0.7; // Big boost for being on AI site
          break;
        }
      }
      
      // Check page title for AI keywords
      if (pageTitle) {
        const titleLower = pageTitle.toLowerCase();
        if (titleLower.includes('ai-generated') || titleLower.includes('ai generated') ||
            titleLower.includes('ai art') || titleLower.includes('ai image') ||
            titleLower.includes('midjourney') || titleLower.includes('stable diffusion') ||
            titleLower.includes('dall-e') || titleLower.includes('dalle')) {
          indicators.push('AI keywords in page title');
          aiScore += 0.4;
        }
      }
      
      // Check URL path
      if (pageUrl) {
        const urlLower = pageUrl.toLowerCase();
        if (urlLower.includes('/ai/') || urlLower.includes('/ai-') ||
            urlLower.includes('-ai-') || urlLower.includes('?ai=') ||
            urlLower.includes('=ai&') || urlLower.includes('=ai/')) {
          indicators.push('AI keywords in page URL');
          aiScore += 0.3;
        }
      }
    }
    
    // Check 1: Known AI generator domains (EXPANDED LIST)
    const aiDomains = [
      // Major AI image platforms
      'midjourney', 'stability.ai', 'stablediffusion', 'dreamstudio',
      'dalle', 'openai', 'lexica.art', 'civitai', 'nightcafe',
      'artbreeder', 'craiyon', 'bluewillow', 'leonardo.ai',
      'playground.ai', 'playgroundai', 'tensor.art', 'mage.space',
      // More AI sites
      'cgdream.ai', 'cgdream', 'postcrest', 'novelai', 'waifulabs',
      'thispersondoesnotexist', 'generated.photos', 'gencraft',
      'prodia.com', 'starryai', 'jasper.ai', 'runwayml', 'runway.ml',
      'firefly.adobe', 'picsart.com', 'fotor.com', 'deepai.org',
      'pixray', 'wombo.art', 'dream.ai', 'replicate.com',
      'hotpot.ai', 'imgcreator.zmo.ai', 'imgcreator', 'getimg.ai',
      'getimg', 'kreator.ai', 'pebblely', 'drawanyone',
      'tome.app', 'nightbot', 'kapwing.com/ai', 'easy-peasy.ai',
      'photoroom.com/tools/background-generator', 'ideogram.ai',
      'flux.ai', 'recraft.ai', 'krea.ai', 'magnific.ai',
      // Stock with AI categories
      'shutterstock.com/ai', 'gettyimages.com/ai', 'adobe.com/firefly',
      // AI training data sources
      'huggingface.co', 'kaggle.com/datasets',
      // More specific AI sites
      'aiimagegenerator', 'ai-image', 'ai-generator', 'aiphotostock',
      'pngtree.com/free-png-vectors/ai', 'dreamlike.art', 'dreamlike',
      'instantart.io', 'starnyx.ai', 'mageai', 'gencraft.com',
      'aiartshop', 'aiart', 'dezgo.com', 'imagine.art', 'imagine.ai'
    ];
    
    const urlLower = src.toLowerCase();
    let matchedDomain = null;
    for (const domain of aiDomains) {
      if (urlLower.includes(domain)) {
        matchedDomain = domain;
        indicators.push(`Known AI platform: ${domain}`);
        aiScore += 0.85; // Very high confidence
        break;
      }
    }
    
    // Check 2: AI-related URL/path patterns (EXPANDED)
    const aiPatterns = [
      /seed[_-]?\d+/i,
      /prompt[_-]/i,
      /(txt|img)2(img|txt)/i,
      /stable[_-]?diffusion/i,
      /midjourney/i,
      /ai[_-]?(art|generated|gen|image)/i,
      /generated[_-]?image/i,
      /\d{10,}_\d+\.png/i,           // AI timestamp format
      /\/ai\//i,                       // /ai/ path
      /\/generated\//i,                // /generated/ path
      /\/dalle/i,
      /\/stable[_-]?diffusion/i,
      /\/flux/i,
      /\/midjourney/i,
      /[?&]model=(stable|flux|dall|midjourney|sdxl)/i,
      /[?&]prompt=/i,
      /-ai-/i,                         // -ai- in URL
      /[_-]flux[_-]/i,
      /[_-]sd[_-]/i,                   // SD = Stable Diffusion
      /[_-]sdxl[_-]/i,
      /artificial[_-]?intelligence/i,
      /neural[_-]?network/i,
      /machine[_-]?learning/i,
      /diffusion[_-]?model/i
    ];
    
    let patternMatches = 0;
    for (const pattern of aiPatterns) {
      if (pattern.test(src)) {
        patternMatches++;
        indicators.push('AI URL pattern detected');
        aiScore += 0.3;
        if (patternMatches >= 2) break; // Cap at 2 patterns
      }
    }
    
    // Check 3: Exact AI generation dimensions (more dimensions)
    if (width && height) {
      const commonAIDimensions = [
        [512, 512], [768, 768], [1024, 1024], [2048, 2048],
        [512, 768], [768, 512], [832, 1216], [1216, 832],
        [512, 1024], [1024, 512],
        [768, 1024], [1024, 768], [1280, 1280],
        [1152, 896], [896, 1152],
        [1216, 1216], [1408, 1408],
        [1344, 768], [768, 1344], [1536, 640], [640, 1536],
        [832, 1248], [1248, 832] // CGDream/Flux dimensions
      ];
      
      const isAIDimension = commonAIDimensions.some(
        ([w, h]) => (width === w && height === h) || (width === h && height === w)
      );
      
      if (isAIDimension) {
        indicators.push(`AI generation size (${width}x${height})`);
        aiScore += 0.4;
      }
      
      // Square images are MORE likely AI
      if (width === height && width >= 512) {
        if (!isAIDimension) {
          indicators.push('Square AI-typical dimensions');
          aiScore += 0.2;
        }
      }
    }
    
    // Check 4: AI-related keywords in URL parameters
    const aiKeywords = ['ai', 'gpt', 'gan', 'vae', 'diffusion', 'generated', 'synthesis'];
    const urlPath = urlLower.split('?')[0];
    let keywordMatches = 0;
    for (const keyword of aiKeywords) {
      if (urlPath.includes(`/${keyword}/`) || urlPath.includes(`-${keyword}-`)) {
        keywordMatches++;
      }
    }
    if (keywordMatches > 0) {
      indicators.push(`AI keywords in URL`);
      aiScore += 0.2 * keywordMatches;
    }
    
    // Check 5: Page context - is current page likely AI-related?
    // We do this in content script via referrer
    
    // Calculate final confidence
    let confidence = Math.min(aiScore, 0.95); // Cap at 95% for heuristic
    
    // v1.2: HONEST heuristic confidence calibration
    // Heuristic should NEVER claim AI without strong proof
    // Default to "Likely Real" when uncertain
    
    if (indicators.length === 0) {
      // No AI markers found at all - this is likely a real image
      indicators.push('No AI markers detected');
      indicators.push('Heuristic-only analysis (limited accuracy)');
      // Stay well under "Possibly AI" threshold (40%)
      // 25% = "Likely Real" verdict
      confidence = 0.25;
    } else if (matchedDomain) {
      // STRONG signal: image is hosted on a known AI generator domain
      // This is one of the few cases where heuristic can be confident
      confidence = Math.max(confidence, 0.85);
    } else if (aiScore >= 0.5 && indicators.length >= 2) {
      // Multiple AI indicators present - moderate confidence
      // Cap at 60% even with multiple signals (only API can be more confident)
      confidence = Math.min(confidence, 0.60);
    } else if (indicators.length === 1) {
      // Single weak signal - very uncertain
      // Cap at "Inconclusive" (40-45%)
      confidence = Math.min(confidence, 0.40);
    } else {
      // Some signals but not strong - be conservative
      // Heuristic shouldn't claim AI without strong evidence
      confidence = Math.min(confidence, 0.50);
    }
    
    // v1.2: HARD CAP at 0.85 for heuristic (never claim "Definitely AI")
    // Only API-verified results can score higher
    confidence = Math.min(confidence, 0.85);
    
    // Determine if AI - using new thresholds
    // Below 0.40 = Real
    // 0.40 - 0.60 = Inconclusive (NOT AI)
    // Above 0.60 = AI (only with strong heuristic signals)
    const isAI = confidence >= 0.60;
    
    // Add transparency note about heuristic uncertainty
    if (confidence >= 0.40 && confidence < 0.60) {
      indicators.push('⚠️ Inconclusive - configure Hive AI for accurate detection');
    } else if (confidence < 0.40) {
      indicators.push('Heuristic-only analysis - configure Hive AI for verification');
    }
    
    log(`🔍 [HEURISTIC] Final score: ${(confidence * 100).toFixed(1)}%`);
    log(`🔍 [HEURISTIC] Verdict: ${isAI ? 'AI' : (confidence >= 0.40 ? 'Inconclusive' : 'Real')}`);
    log(`🔍 [HEURISTIC] Indicators:`, indicators);
    
    return {
      isAI: isAI,
      aiProbability: confidence,
      confidence: confidence,
      indicators: indicators,
      method: 'heuristic',
      // v1.2: Always warn about heuristic limitations
      warning: 'Heuristic-only detection (limited accuracy). Configure Hive AI in HQ Settings for industry-leading accuracy.'
    };
    
  } catch (error) {
    console.error('Error analyzing image:', error);
    return {
      isAI: false,
      aiProbability: 0,
      confidence: 0,
      indicators: ['Analysis failed'],
      error: error.message
    };
  }
}

// Helper function to fetch image and analyze locally
async function fetchAndAnalyzeImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Convert to base64 for analysis
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return null;
  }
}

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openUpgrade') {
    const fallback = chrome.runtime.getURL('upgrade.html');
    const url = (typeof request.url === 'string' &&
                (request.url.startsWith('https://fauxspy.com/') || request.url.startsWith('https://www.fauxspy.com/')))
      ? request.url
      : fallback;
    chrome.tabs.create({ url });
    return true;
  }
  
  if (request.action === 'openPortal') {
    openCustomerPortal();
    return true;
  }
  
  if (request.action === 'checkLicense') {
    checkLicense().then(license => {
      sendResponse({ license });
    });
    return true; // Async response
  }
});

// Open customer portal for Pro users
async function openCustomerPortal() {
  // v1.6.1: Just open the /account page where user enters email
  // Stripe billing portal redirect happens server-side
  chrome.tabs.create({ url: `${BACKEND_URL}/account` });
}
