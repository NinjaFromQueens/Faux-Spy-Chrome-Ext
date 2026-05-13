// Background service worker

const DEBUG = false;
const log = (...a) => { if (DEBUG) console.log(...a); };

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
const BACKEND_URL = 'https://fauxspy.com';

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
      log('✅ Free tier initialized - 20 scans/day');
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
});

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

// v1.5: Backend proxy URL - hides Sightengine API key
const FAUXSPY_API_BASE = 'https://fauxspy.com';

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
  
  const { 
    sightengineApiUser, 
    sightengineApiSecret, 
    hiveApiKey, 
    hiveAccessId, 
    hiveSecretKey,
    license
  } = await chrome.storage.local.get([
    'sightengineApiUser', 'sightengineApiSecret',
    'hiveApiKey', 'hiveAccessId', 'hiveSecretKey',
    'license'
  ]);
  
  // STEP 1: Try Faux Spy proxy backend (the new way)
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
  
  console.warn('⚠️ [FAUXSPY] Proxy unavailable, trying user credentials...');
  
  // STEP 2: Fallback - User's own Sightengine credentials (if they added any)
  if (sightengineApiUser && sightengineApiSecret) {
    log('🎯 [SIGHTENGINE] Trying user-provided credentials...');
    const sightengineResult = await analyzeWithSightengine(imageData);
    
    if (sightengineResult.method === 'sightengine_api') {
      log('✅ [SIGHTENGINE] Detection succeeded with user creds');
      return sightengineResult;
    }
  }
  
  // STEP 3: Fallback - User's Hive credentials (legacy)
  if (hiveApiKey || (hiveAccessId && hiveSecretKey)) {
    const hiveResult = await analyzeImageData(imageData);
    if (hiveResult.method === 'hive_api') {
      return hiveResult;
    }
  }
  
  // STEP 4: Last resort - heuristic
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
  
  try {
    const response = await fetch(`${FAUXSPY_API_BASE}/api/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: imageData.src,
        userId,
        isPro,
        // v1.5.1: Pass dimensions for backend pre-checks
        width: imageData.width || 0,
        height: imageData.height || 0,
        // Light context for backend (URL-based hints)
        pageHost: imageData.pageHost || ''
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
        upgradeUrl: data.upgradeUrl || 'https://fauxspy.com/pro',
        dailyLimitInfo: {
          used: data.used,
          limit
        }
      };
    }

    // Other error responses
    if (!response.ok || !data.success) {
      console.warn('⚠️ Proxy returned error:', data);
      return {
        method: 'error',
        error: data.error || 'PROXY_ERROR',
        indicators: [data.message || 'Detection service unavailable']
      };
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
 * Sightengine AI Detection API - v1.3
 * Uses Sightengine's genai model to detect AI-generated images.
 * Free tier: 2,000 calls/month
 * Docs: https://sightengine.com/docs/ai-generated-image-detection
 */
async function analyzeWithSightengine({ src, width, height, pageUrl, pageHost, pageTitle }) {
  const { sightengineApiUser, sightengineApiSecret } = await chrome.storage.local.get([
    'sightengineApiUser', 
    'sightengineApiSecret'
  ]);
  
  if (!sightengineApiUser || !sightengineApiSecret) {
    return {
      isAI: false,
      aiProbability: 0,
      confidence: 0,
      indicators: ['Sightengine not configured'],
      method: 'no_api',
      error: 'NO_SIGHTENGINE_KEY'
    };
  }
  
  // Check cache first
  const cached = await checkCache('se_' + src);
  if (cached) {
    log('📦 [CACHE] Using cached Sightengine result for:', src.substring(0, 60));
    await incrementStat('cached');
    return cached;
  }
  
  try {
    log(`🔍 [SIGHTENGINE] Analyzing: ${src.substring(0, 80)}...`);
    
    // Build URL with query params (Sightengine uses GET with query string)
    const params = new URLSearchParams({
      url: src,
      models: 'genai',
      api_user: sightengineApiUser,
      api_secret: sightengineApiSecret
    });
    
    const apiUrl = `https://api.sightengine.com/1.0/check.json?${params.toString()}`;
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    log('📦 [SIGHTENGINE] Response:', JSON.stringify(data, null, 2));
    
    // Check for API errors
    if (data.status === 'failure') {
      console.error('❌ [SIGHTENGINE] API error:', data.error);
      
      const errorMessage = data.error?.message || 'Unknown error';
      const errorType = data.error?.type || 'unknown';
      
      return {
        isAI: false,
        aiProbability: 0,
        confidence: 0,
        indicators: [
          `Sightengine error: ${errorType}`,
          errorMessage,
          'Check your API credentials in HQ Settings'
        ],
        method: 'error',
        error: errorType.toUpperCase(),
        errorDetail: errorMessage
      };
    }
    
    // Extract AI detection result
    // v1.3.2 FIX: Sightengine returns ai_generated nested inside "type"
    // Real response format:
    // { "status": "success", "type": { "ai_generated": 0.95 }, "media": {...} }
    const aiProbability = data.type?.ai_generated ?? data.ai_generated;
    
    if (typeof aiProbability !== 'number') {
      console.error('❌ [SIGHTENGINE] No ai_generated score found in response:', data);
      throw new Error('AI score not found in Sightengine response — is the genai model enabled in your Sightengine dashboard?');
    }
    
    const isAI = aiProbability > 0.5;
    
    log(`
════════════════════════════════════════════════════════
🔍 SIGHTENGINE DETECTION RESULT
════════════════════════════════════════════════════════
📊 AI Probability: ${(aiProbability * 100).toFixed(2)}%
📊 Classification: ${isAI ? '🤖 AI-GENERATED' : '👤 HUMAN-MADE'}
📊 Image URL: ${src.substring(0, 100)}...
════════════════════════════════════════════════════════
    `);
    
    // Build indicators
    const indicators = [];
    if (isAI) {
      indicators.push(`Sightengine AI confidence: ${(aiProbability * 100).toFixed(1)}%`);
      if (aiProbability > 0.9) {
        indicators.push('Extremely likely AI-generated');
      } else if (aiProbability > 0.75) {
        indicators.push('Very likely AI-generated');
      } else {
        indicators.push('Likely AI-generated');
      }
    } else {
      indicators.push(`Sightengine real confidence: ${((1 - aiProbability) * 100).toFixed(1)}%`);
      if (aiProbability < 0.1) {
        indicators.push('Extremely likely human-made');
      } else if (aiProbability < 0.25) {
        indicators.push('Very likely human-made');
      } else {
        indicators.push('Likely human-made');
      }
    }
    
    // Add source info if available
    if (data.media?.id) {
      indicators.push(`Sightengine ID: ${data.media.id.substring(0, 12)}`);
    }
    
    const result = {
      isAI: isAI,
      aiProbability: aiProbability,
      confidence: aiProbability,
      indicators: indicators,
      method: 'sightengine_api',
      rawScore: aiProbability,
      rawData: data,
      timestamp: Date.now()
    };
    
    // Cache the result
    await cacheResult('se_' + src, result);
    
    // Track stats
    await incrementStat('apiCalls');
    await incrementStat('total');
    
    return result;
    
  } catch (error) {
    console.error('❌ [SIGHTENGINE] Error:', error);
    return {
      isAI: false,
      aiProbability: 0,
      confidence: 0,
      indicators: [
        `Sightengine request failed`,
        error.message,
        'Check internet connection or API credentials'
      ],
      method: 'error',
      error: 'REQUEST_FAILED',
      errorDetail: error.message
    };
  }
}

/**
 * Hive AI Detection API - v1.2 with multi-format auth fallback
 * Tries multiple authentication formats since Hive has different API patterns:
 * 1. Modern: Authorization: Token <key>
 * 2. Legacy: api_token: <accessId>:<secret>
 * 3. Bearer: Authorization: Bearer <key>
 * Whichever works first is used.
 */
async function analyzeImageData({ src, width, height, pageUrl, pageHost, pageTitle }) {
  // Get API credentials from storage
  const { hiveAccessId, hiveSecretKey, apiKeySet, hiveApiKey } = await chrome.storage.local.get(['hiveAccessId', 'hiveSecretKey', 'apiKeySet', 'hiveApiKey']);
  
  // v1.2: Support both single API key and access+secret formats
  const hasCredentials = (hiveApiKey) || (hiveAccessId && hiveSecretKey);
  
  if (!apiKeySet || !hasCredentials) {
    console.error('❌ [HIVE] Missing API credentials');
    return {
      isAI: false,
      aiProbability: 0,
      confidence: 0,
      indicators: [
        'Hive API not configured',
        'Add your API token in HQ Settings',
        'Get one free at thehive.ai'
      ],
      method: 'no_api',
      error: 'NO_API_KEY'
    };
  }
  
  // Check cache first
  const cached = await checkCache(src);
  if (cached) {
    log('📦 [CACHE] Using cached result for:', src.substring(0, 60));
    await incrementStat('cached');
    return cached;
  }
  
  // v1.2: Build list of auth strategies to try (in order of likelihood)
  const authStrategies = [];
  
  if (hiveApiKey) {
    // User provided a single API key - use modern format
    authStrategies.push({
      name: 'Token (single key)',
      headers: {
        'Authorization': `Token ${hiveApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    authStrategies.push({
      name: 'Bearer (single key)',
      headers: {
        'Authorization': `Bearer ${hiveApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }
  
  if (hiveAccessId && hiveSecretKey) {
    // Try modern format with just secret as token
    authStrategies.push({
      name: 'Token (secret as key)',
      headers: {
        'Authorization': `Token ${hiveSecretKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    // Try modern format with access ID as token
    authStrategies.push({
      name: 'Token (access ID as key)',
      headers: {
        'Authorization': `Token ${hiveAccessId}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    // Try lowercase authorization with combined credentials
    authStrategies.push({
      name: 'authorization: token combined',
      headers: {
        'authorization': `token ${hiveAccessId}:${hiveSecretKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    // Legacy format (what we had before)
    authStrategies.push({
      name: 'Legacy api_token combined',
      headers: {
        'api_token': `${hiveAccessId}:${hiveSecretKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }
  
  // Try each strategy until one works
  let lastError = null;
  let lastErrorText = null;
  let lastErrorStatus = null;
  
  for (const strategy of authStrategies) {
    try {
      log(`🔑 [HIVE] Trying auth strategy: ${strategy.name}`);
      
      const response = await fetch('https://api.thehive.ai/api/v2/task/sync', {
        method: 'POST',
        headers: strategy.headers,
        body: JSON.stringify({
          url: src,
          classes: ['ai_generated']
        })
      });

      if (response.ok) {
        log(`✅ [HIVE] Auth strategy worked: ${strategy.name}`);
        
        // Save which strategy worked so we use it first next time
        await chrome.storage.local.set({ workingHiveAuth: strategy.name });
        
        const data = await response.json();
        return await processHiveResponse(data, src);
      }
      
      // Auth failed, save error and try next
      lastError = `${strategy.name} failed`;
      lastErrorStatus = response.status;
      lastErrorText = await response.text();
      console.warn(`⚠️ [HIVE] ${strategy.name} returned ${response.status}: ${lastErrorText.substring(0, 200)}`);
      
      // If it's a server error (5xx), no point trying other auth methods
      if (response.status >= 500) {
        break;
      }
      
    } catch (fetchError) {
      lastError = fetchError.message;
      console.warn(`⚠️ [HIVE] ${strategy.name} threw error:`, fetchError.message);
    }
  }
  
  // All strategies failed - return clear error message
  console.error('❌ [HIVE] All auth strategies failed. Last error:', lastError);
  
  return {
    isAI: false,
    aiProbability: 0,
    confidence: 0,
    indicators: [
      `Hive API auth failed (${lastErrorStatus || 'unknown'})`,
      'Tried 5 different auth formats',
      lastErrorText ? `Hive said: ${lastErrorText.substring(0, 100)}` : 'Check your API credentials',
      'Get a Hive token at thehive.ai'
    ],
    method: 'error',
    error: 'AUTH_FAILED',
    errorDetail: lastErrorText
  };
}

/**
 * Process a successful Hive response and extract AI detection result
 */
async function processHiveResponse(data, src) {
  log('📦 [HIVE] Full API response:', JSON.stringify(data, null, 2));
  
  // Check for errors in response
  if (data.status && data.status[0] && data.status[0].response && data.status[0].response.status === 'error') {
    throw new Error(`Hive processing error: ${data.status[0].response.message}`);
  }
  
  // Extract AI detection result
  const output = data.status?.[0]?.response?.output?.[0];
  if (!output || !output.classes) {
    throw new Error('Unexpected Hive response format');
  }
  
  const aiClass = output.classes.find(c => c.class === 'ai_generated');
  if (!aiClass) {
    throw new Error('AI detection result not found in response');
  }
  
  const aiProbability = aiClass.score;
  const isAI = aiProbability > 0.5;
  
  log(`
════════════════════════════════════════════════════════
🔍 HIVE API DETECTION RESULT (v1.2)
════════════════════════════════════════════════════════
📊 AI Probability: ${(aiProbability * 100).toFixed(2)}%
📊 Classification: ${isAI ? '🤖 AI-GENERATED' : '👤 HUMAN-MADE'}
📊 Image URL: ${src.substring(0, 100)}...
════════════════════════════════════════════════════════
  `);
  
  // Create detailed indicators
  const indicators = [];
  if (isAI) {
    indicators.push(`Hive AI confidence: ${(aiProbability * 100).toFixed(1)}%`);
    if (aiProbability > 0.9) {
      indicators.push('Extremely likely AI-generated');
    } else if (aiProbability > 0.75) {
      indicators.push('Very likely AI-generated');
    } else {
      indicators.push('Likely AI-generated');
    }
  } else {
    indicators.push(`Human confidence: ${((1 - aiProbability) * 100).toFixed(1)}%`);
    if (aiProbability < 0.1) {
      indicators.push('Extremely likely human-made');
    } else if (aiProbability < 0.25) {
      indicators.push('Very likely human-made');
    } else {
      indicators.push('Likely human-made');
    }
  }
  
  const result = {
    isAI: isAI,
    aiProbability: aiProbability,
    confidence: aiProbability,
    indicators: indicators,
    method: 'hive_api',
    rawScore: aiProbability,
    rawData: output,
    timestamp: Date.now()
  };
  
  log(`✅ [HIVE] Final result:`, result);
  
  // Cache the result
  await cacheResult(src, result);
  
  // Increment stats
  await incrementStat('apiCalls');
  await incrementStat('total');
  
  return result;
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
    const { stats } = await chrome.storage.local.get('stats');
    const currentStats = stats || { total: 0, cached: 0, apiCalls: 0 };
    currentStats[statName] = (currentStats[statName] || 0) + 1;
    await chrome.storage.local.set({ stats: currentStats });
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

/**
 * Example integration with a real AI detection API
 * Uncomment and configure when you have an API key
 */
/*
async function analyzeWithAPI(imageUrl) {
  const API_KEY = 'your-api-key-here';
  const API_ENDPOINT = 'https://api.example.com/detect';
  
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_url: imageUrl
      })
    });
    
    const data = await response.json();
    
    return {
      isAI: data.is_ai_generated,
      confidence: data.confidence,
      indicators: data.detected_features || [],
      method: 'api'
    };
  } catch (error) {
    console.error('API analysis failed:', error);
    return null;
  }
}
*/

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
    chrome.tabs.create({ url: chrome.runtime.getURL('upgrade.html') });
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
