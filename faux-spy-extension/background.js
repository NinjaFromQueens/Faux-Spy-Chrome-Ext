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
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, 224, 224).data;
  } catch (e) {
    log('⚡ [ONNX] Pixel fetch failed:', e.message);
    return null;
  }
}

async function generateShareCard({ imageUrl, label, icon, category, aiPercent }) {
  try {
    // Fetch logo
    const logoUrl = chrome.runtime.getURL('icons/icon512.png');
    const logoResp = await fetch(logoUrl);
    const logoBlob = await logoResp.blob();
    const logoBitmap = await createImageBitmap(logoBlob);

    // Try to fetch scanned image — may fail due to CORS restrictions on social CDNs
    let imgBitmap = null;
    if (imageUrl) {
      try {
        const imgController = new AbortController();
        const imgTimeout = setTimeout(() => imgController.abort(), 10000);
        const imgResp = await fetch(imageUrl, { mode: 'cors', credentials: 'omit', signal: imgController.signal });
        clearTimeout(imgTimeout);
        if (imgResp.ok) {
          imgBitmap = await createImageBitmap(await imgResp.blob());
        }
      } catch (_corsErr) {
        // CORS blocked or timed out — will use branded gradient background instead
      }
    }

    const W = 1080, H = 1080, IMG_H = 680, SEP = 3;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas context unavailable');

    if (imgBitmap) {
      // Draw scanned image (cover crop into top IMG_H px)
      const scale = Math.max(W / imgBitmap.width, IMG_H / imgBitmap.height);
      const drawW = imgBitmap.width * scale;
      const drawH = imgBitmap.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, IMG_H);
      ctx.clip();
      ctx.drawImage(imgBitmap, (W - drawW) / 2, (IMG_H - drawH) / 2, drawW, drawH);
      ctx.restore();
    } else {
      // Branded fallback background when image is CORS-blocked
      const grad = ctx.createLinearGradient(0, 0, W, IMG_H);
      grad.addColorStop(0, '#0d1117');
      grad.addColorStop(1, '#1a2332');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, IMG_H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '240px system-ui, -apple-system, sans-serif';
      ctx.globalAlpha = 0.18;
      ctx.fillText(icon, W / 2, IMG_H / 2);
      ctx.globalAlpha = 1;
    }

    // Gold separator
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(0, IMG_H, W, SEP);

    // Info strip background
    const stripY = IMG_H + SEP;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, stripY, W, H - stripY);

    // Logo (top-left of strip)
    const logoSize = 80;
    const logoX = 40, logoY = stripY + 22;
    ctx.drawImage(logoBitmap, logoX, logoY, logoSize, logoSize);

    // Brand text
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
    ctx.fillText('Faux Spy', logoX + logoSize + 18, logoY + 44);
    ctx.fillStyle = '#6b7280';
    ctx.font = '22px system-ui, -apple-system, sans-serif';
    ctx.fillText('fauxspy.com', logoX + logoSize + 18, logoY + 76);

    // Verdict color
    let verdictColor = '#f59e0b';
    if (category === 'real') verdictColor = '#22c55e';
    else if (category === 'ai_photo' || category === 'ai') verdictColor = '#ef4444';

    // Verdict label (large, centered)
    ctx.textAlign = 'center';
    ctx.fillStyle = verdictColor;
    ctx.font = `bold 76px system-ui, -apple-system, sans-serif`;
    ctx.fillText(`${icon}  ${label}`, W / 2, stripY + 155);

    // Confidence line
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 46px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${aiPercent}% Faux · ${100 - aiPercent}% Real`, W / 2, stripY + 235);

    // Tagline
    ctx.fillStyle = '#374151';
    ctx.font = 'italic 26px system-ui, -apple-system, sans-serif';
    ctx.fillText('Spy on the fakes.', W / 2, stripY + 360);

    // Convert to PNG data URL
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return { success: true, dataUrl: 'data:image/png;base64,' + btoa(binary) };
  } catch (e) {
    log('⚠️ [ShareCard] Failed:', e.message);
    return { success: false, reason: e.message };
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
      const expA = Math.exp(scores[0]), expR = Math.exp(scores[1]);
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
  const realPct = 100 - pct;
  return {
    success: true,
    isAI,
    aiProbability: aiScore,
    confidence: Math.abs(aiScore - 0.5) * 2,
    verdict: isAI ? 'ai_photo' : 'real',
    category: isAI ? 'ai_photo' : 'real',
    verdictLabel: isAI ? 'Very Likely AI' : 'No AI Detected',
    method: 'local_onnx',
    proHint: isAI ? 'Pro detects whether this is AI Photo or AI Art' : null,
    indicators: [
      isAI
        ? `AI confidence: ${pct}% — strong AI generation signals detected`
        : `Real confidence: ${realPct}% — no AI signals detected`,
      isAI
        ? 'ℹ️ Scanned by local model — upgrade to Pro for full API breakdown'
        : 'ℹ️ Note: Photo manipulation (face swaps, filters) can evade AI detectors — trust your instincts'
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
// Image scans normally finish in a few seconds; the backend itself gives up
// on slow providers well before this.
const DETECT_TIMEOUT_MS = 25000;

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'checkAI',
    title: '🕵️ Investigate this image',
    contexts: ['image']
  }, () => { void chrome.runtime.lastError; });

  chrome.contextMenus.create({
    id: 'checkVideo',
    title: '🎬 Analyze this video',
    contexts: ['video']
  }, () => { void chrome.runtime.lastError; });
  
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
          scansPerDay: 3,
          caching: false,
          batchScanning: false,
          maxBatchSize: 0
        }
      };
      await chrome.storage.local.set({
        license: defaultLicense,
        lastLicenseCheck: Date.now()
      });
      log('✅ Free tier initialized - 3 scans/day');
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

// License logic lives in license.js (loaded above). A browser restart is a
// natural point to re-check a stale Pro license.
chrome.runtime.onStartup.addListener(() => {
  getLicense().catch(() => {});
});

async function checkLicense() {
  return getLicense();
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

  if (request.type === 'GENERATE_SHARE_CARD') {
    generateShareCard(request).then(sendResponse).catch(() => sendResponse({ success: false }));
    return true;
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
      const response = await fetch(`${BACKEND_URL}/api/detect-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: request.videoData.src,
          userId,
          licenseKey: license.key
        }),
        signal: controller.signal
      });
      // Read the body even on 4xx: it carries the reason (TOKENS_EXHAUSTED,
      // LICENSE_EXPIRED, VIDEO_FEATURE_REQUIRED...) that the page shows.
      let body = null;
      try { body = await response.json(); } catch { /* non-JSON error page */ }
      result = response.ok || body?.error
        ? body
        : { error: 'INTERNAL_ERROR', message: `Video service error (HTTP ${response.status})` };
    } finally {
      clearTimeout(timeoutId);
    }

    // The server says the license itself is no longer valid — re-check so
    // the extension stops showing Pro.
    if (['INVALID_LICENSE', 'LICENSE_INACTIVE', 'LICENSE_EXPIRED'].includes(result?.error)) {
      revalidateLicense().catch(() => {});
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

  if (info.menuItemId === 'checkVideo') {
    log('🎬 Video context menu clicked for:', info.srcUrl);

    // Blob URLs (YouTube, Twitter, TikTok, etc.) can't be fetched by Sightengine
    if (!info.srcUrl || info.srcUrl.startsWith('blob:') || info.srcUrl.startsWith('data:')) {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showVideoContextResult',
          error: 'BLOB_URL'
        }).catch(() => {});
      }
      return;
    }

    // Reuse analyzeVideo — wrap in a promise since it uses callbacks
    const result = await new Promise(resolve => {
      analyzeVideo({ videoData: { src: info.srcUrl } }, resolve);
    });

    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'showVideoContextResult',
        result,
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
    processQueue().catch(err => log('Queue error:', err.message));
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
    callback({ success: false, error: 'INTERNAL_ERROR', isAI: false, aiProbability: 0 });
  }
  
  // Continue processing queue
  if (requestQueue.length > 0) {
    processQueue().catch(err => log('Queue error:', err.message));
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

  // Check cache before hitting API
  const cachedResult = await checkCache(imageData.src);
  if (cachedResult) {
    log('💾 [CACHE] Cache hit');
    incrementStat('total');
    incrementStat('cached');
    return cachedResult;
  }

  let license;
  try {
    // getLicense() re-checks a Pro license with the server once a day, so a
    // cancelled or refunded subscription stops showing as Pro.
    license = await getLicense();
  } catch (_ctxErr) {
    license = null; // extension context may be stale; proceed as free tier
  }

  // STEP 0: Local ONNX pre-filter (50-200ms, no token cost, free tier only)
  const isPro = license?.isPro === true;
  const src = imageData.src || '';
  if (!isPro && src.startsWith('https://') && !imageData.isVideoFrame) {
    const local = await runLocalInference(src);
    if (local) {
      if (local.aiScore >= ONNX_THRESHOLDS.AI_CONFIDENT) {
        log('⚡ [ONNX] High-confidence AI → skip API (free tier)');
        incrementStat('total');
        return buildLocalResult(local.aiScore, true);
      }
      if (local.aiScore <= ONNX_THRESHOLDS.REAL_CONFIDENT) {
        log('⚡ [ONNX] High-confidence Real → skip API (free tier)');
        incrementStat('total');
        return buildLocalResult(local.aiScore, false);
      }
      log('⚡ [ONNX] Uncertain → proceeding to API');
    }
  }

  // STEP 1: Faux Spy backend
  log('🎯 [FAUXSPY] Calling backend proxy...');
  const proxyResult = await analyzeWithProxy(imageData, license);

  if (!proxyResult.error) {
    incrementStat('total');
    if (proxyResult.method === 'sightengine_api') incrementStat('apiCalls');
  }

  // Failures go back to the page as errors (out of tokens, daily limit,
  // offline, timeout...) so it can say what happened. Never substitute a
  // guessed verdict: a "No AI Detected" badge on a photo nobody checked is
  // worse than no answer for someone deciding whether a profile is real.
  return proxyResult;
}

/**
 * v1.5: Call Faux Spy backend proxy
 * Uses YOUR Sightengine API key (hidden in env vars)
 * Tracks per-user usage with anonymous user ID
 */
async function analyzeWithProxy(imageData, license) {
  // Get or create anonymous user ID
  let userId;
  try {
    const stored = await chrome.storage.local.get('userId');
    userId = stored.userId;
  } catch (_ctxErr) { /* stale context — userId will be generated below */ }
  if (!userId) {
    userId = 'fs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
    try { await chrome.storage.local.set({ userId }); } catch (_e) { /* best-effort */ }
    log('🆔 Created user ID:', userId);
  }
  
  const isPro = license?.isPro === true;
  const licenseKey = isPro ? (license?.key || null) : null;

  try {
    const src = imageData.src;
    if (!src || src.startsWith('blob:') ||
        (!src.startsWith('data:') && !src.startsWith('http://') && !src.startsWith('https://'))) {
      const message = "This image can't be scanned — it has no direct URL";
      return {
        method: 'error',
        error: 'UNSCANNABLE_URL',
        verdict: 'error',
        message,
        indicators: [message]
      };
    }

    const isFrameCapture = imageData.src?.startsWith('data:');
    const response = await fetch(`${BACKEND_URL}/api/detect`, {
      method: 'POST',
      // Scans run one at a time (processQueue), so a hung request would block
      // every later scan in every tab.
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
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
        message: 'Invalid response from detection service',
        indicators: ['Invalid response from detection service']
      };
    }

    // The server refused this license as Pro (cancelled, expired, unknown).
    // Re-check now so the extension drops to the free tier straight away.
    if (data.proDenied && typeof revalidateLicense === 'function') {
      revalidateLicense().catch(() => {});
    }

    // Daily limit reached - special handling
    if (response.status === 429 || data.error === 'DAILY_LIMIT_REACHED') {
      const limit = data.limit || 3;
      return {
        isAI: false,
        aiProbability: 0,
        confidence: 0,
        indicators: [
          '🔒 Daily limit reached',
          `Used ${data.used || limit} of ${limit} free investigations today`,
          '👉 Upgrade to Pro for 200 scans a month'
        ],
        message: `You've used all ${limit} free scans for today. Upgrade to Pro for 200 scans a month.`,
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
        message: "You've used all your scans. Buy more tokens to keep scanning.",
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
        message: userMessage,
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
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    console.error('❌ Proxy call failed:', error);
    sentryCapture(`${timedOut ? 'Timeout' : 'Network error'}: ${error.message}`, {
      tags: { error_type: timedOut ? 'DETECTION_TIMEOUT' : 'NETWORK_ERROR', platform: imageData.pageHost || '' },
      extra: { errorDetail: error.message },
      userId
    });
    if (timedOut) {
      const message = 'Detection took too long — try again';
      return { method: 'error', error: 'DETECTION_TIMEOUT', message, indicators: [message] };
    }
    const platform = getPlatformDisplayName(imageData.pageHost || '');
    const message = platform
      ? `Could not reach Faux Spy on ${platform} — check your connection`
      : 'Could not reach Faux Spy — check your connection';
    return {
      method: 'error',
      error: 'NETWORK_ERROR',
      errorDetail: error.message,
      message,
      indicators: [message]
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

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openUpgrade') {
    const fallback = chrome.runtime.getURL('upgrade.html');
    const url = (typeof request.url === 'string' &&
                (request.url.startsWith('https://fauxspy.com/') || request.url.startsWith('https://www.fauxspy.com/')))
      ? request.url
      : fallback;
    chrome.tabs.create({ url });
    sendResponse();
    return false;
  }

  if (request.action === 'openPortal') {
    openCustomerPortal();
    sendResponse();
    return false;
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
