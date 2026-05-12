# 🕵️ Faux Spy — Chrome Extension

> Spy on the fakes. Detect AI-generated images on any website.

Chrome extension that classifies images into 5 categories: Real Photo, Digital Art, Inconclusive, AI Art, and AI Photo.

**Current version:** 1.7.1  
**Website:** [fauxspy.com](https://fauxspy.com)

---

## 📂 Project Structure

```
faux-spy-extension/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker (detection routing, license)
├── content.js             # Content script (badges, hover, detection UI)
├── content.css            # Content script styles
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic
├── settings.html          # HQ Settings page
├── settings.js            # Settings logic (license activation)
├── license.js             # License management module
├── upgrade.html           # Pro upgrade page
├── upgrade.js             # Upgrade page logic
└── icons/                 # Extension icons (16, 48, 128px)
```

---

## 🚀 Local Development

### Loading in Chrome

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder
5. Done — extension appears in toolbar

### Making Changes

1. Edit any file
2. Go to `chrome://extensions/`
3. Click the **reload icon** on Faux Spy card
4. Refresh any page you're testing

For service worker changes (background.js), Chrome auto-reloads. For UI changes (popup, settings), click reload.

### Debugging

- **Popup:** Right-click extension icon → "Inspect popup"
- **Service worker:** `chrome://extensions/` → "Inspect views: service worker"
- **Content script:** F12 on any page → Console tab
- **Settings page:** F12 while settings page is open

---

## 🔧 Architecture

### Detection Flow

```
User hovers/clicks image
        ↓
content.js detects interaction
        ↓
Sends message to background.js
        ↓
background.js calls fauxspy.com/api/detect
        ↓
Backend uses Sightengine API
        ↓
Returns verdict (5 categories for Pro, 3 for Free)
        ↓
content.js renders result panel
```

### License Flow

```
User pastes license key in HQ Settings
        ↓
settings.js calls fauxspy.com/api/validate-license
        ↓
If valid: stores license in chrome.storage.local
        ↓
Pro features unlock (5-category, Deep Dive, etc.)
        ↓
Auto re-validates every 24 hours
```

---

## 🎯 Key Features

### Free Tier (3 categories)
- ✅ Real photo
- ❓ Inconclusive  
- 🚨 AI

### Pro Tier (5 categories)
- ✅ Real Photo (green)
- 🎨 Digital Art (purple) — Photoshop paintings, 3D renders, cartoons, game art
- ❓ Inconclusive (blue)
- 🤖 AI Art (orange) — Midjourney/Stable Diffusion style
- 🚨 AI Photo (red) — Photorealistic AI

### Detection Methods
- **Hover** any image → click "🕵️ Investigate" badge
- **Ctrl+Click** any image → instant analysis
- **Right-click** any image → context menu option

---

## 🔒 Privacy

- No browsing tracking
- No image storage (only URL sent to detection API)
- Anonymous user IDs (no email/login for free tier)
- Local storage only for settings and license

---

## 🌐 Backend Dependencies

The extension communicates with `https://fauxspy.com`:

| Endpoint | Purpose |
|----------|---------|
| `/api/detect` | Image classification |
| `/api/validate-license` | License activation/refresh |

Backend code lives in a separate repo: `fauxspy-website`.

---

## 📦 Building for Chrome Web Store

1. Make sure all files are committed
2. From the project root, create a zip:
   ```bash
   zip -r faux-spy-v1.7.1.zip . -x "*.git*" -x "*.DS_Store" -x "README.md"
   ```
3. Upload to Chrome Web Store Developer Console
4. Submit for review

---

## 📋 Version History

- **v1.7.1** — Layout fix: overlay system replaces wrapper (no more grid breakage on Lummi/Unsplash)
- **v1.7.0** — 5-category Pro detection (Real / Digital Art / Inconclusive / AI Art / AI Photo)
- **v1.6.1** — Critical security fix: removed hardcoded credentials; license.js properly loaded
- **v1.6.0** — License activation UI added to HQ Settings
- **v1.5.1** — Conservative thresholds, image dimension pre-check
- **v1.5.0** — Backend proxy (Sightengine key hidden from users)
- **v1.4.1** — Migration fix: old 5/day limit upgraded to 20/day
- **v1.4.0** — Free tier improvements
- **v1.3.x** — Sightengine integration
- **v1.0.0** — Initial release

---

## 🆘 Support

- **Website:** [fauxspy.com](https://fauxspy.com)
- **Contact:** [fauxspy.com/contact](https://fauxspy.com/contact)
- **FAQ:** [fauxspy.com/faq](https://fauxspy.com/faq)

---

🕵️ Spy on the fakes.
