# Faux Spy — Microsoft Edge Add-ons Store Listing

## Submission Package
Use: `faux-spy-v1.9.5.zip` — no code or manifest changes needed. Edge is Chromium-based; the Chrome zip is directly compatible.

---

## Extension Name
`Faux Spy - AI Image Detector`

---

## Short Description (150 chars max)
`Detect AI-generated photos and videos anywhere in Edge. Right-click any image for a 2-second verdict — Real, AI Photo, or AI Art. Free, no account needed.`

---

## Categories
- **Primary:** AI Tools
- **Secondary:** Productivity

---

## Detailed Description (paste into Edge Partner Center)

```
Faux Spy is an AI image and video detector built into your browser. Right-click any photo or video anywhere in Edge and get a verdict in seconds — no uploading, no switching tabs.

HOW IT WORKS

Right-click any image → select "Investigate this image" → get an instant AI vs. Real verdict with a confidence score. Works on any website you can visit in Edge.

Right-click any video → select "Analyze this video" → get an AI vs. Real verdict with frame-by-frame analysis (Pro + Video plan).

WHAT IT DETECTS

Images:
• Real Photo — an authentic photograph
• AI Photo — photorealistic AI-generated image
• AI Art — stylized AI-generated artwork
• Digital Art — CGI, renders, heavily edited photos
• Inconclusive — ambiguous or too small to analyze

Videos (Pro + Video):
• AI-generated video from tools like Sora, Runway, Pika, and Veo
• Frame-by-frame confidence score across the full clip
• Top generator identification when detected

PERFECT FOR

Verifying dating app profile photos before you match. Spotting AI-generated accounts on social media. Checking whether news images are authentic. Identifying AI-generated video clips being shared as real. Anywhere you need to know if a photo or video is real.

AI-generated faces cannot be caught by reverse image search — they are synthetic originals. Faux Spy uses pixel-level machine learning analysis to find what your eyes miss.

PRIVACY

Only the URL of the image or video you actively click to check is sent for analysis. No images or videos are stored. No browsing history is collected. Your scan results stay on your device.

FREE & PRO PLANS

Free (no account required):
• 3 scans per day
• Real Photo, AI Photo, and Inconclusive verdicts

Pro ($9.99/month or $99/year):
• 200 scans/month (no daily cap)
• All 5 detection categories including AI Art and Digital Art
• Case Files — full history of every image scanned
• Priority support

Pro + Video ($29.99/month or $299/year):
• Everything in Pro
• AI video detection — right-click any video to analyze it
• 500 tokens/month (10 tokens per video scan)
• Identifies Sora, Runway, Pika, Veo, and more
```

---

## URLs
- **Privacy policy:** `https://www.fauxspy.com/privacy`
- **Support / website:** `https://www.fauxspy.com`

---

## Store Icon
Upload `icons/icon512.png` as the store tile icon.

## Screenshots
Use the same 1280×800 screenshots from the Chrome Web Store submission.

---

## Pricing
Free (with in-extension Pro upgrade via fauxspy.com — handled through our website, not Edge's payment system).

---

## Privacy Practices Form

Fill in the Edge Partner Center "Privacy practices" section as follows:

| Question | Answer |
|---|---|
| Does your extension collect personal data? | **No** |
| Does your extension collect browsing data? | **No** |
| Does your extension collect website content? | **Yes** |
| Does your extension send data to third parties? | **Yes** |
| Is collected data used for advertising? | **No** |
| Is collected data sold? | **No** |

**Free-text notes — paste exactly:**
```
The extension only sends an image or video URL to our backend (https://www.fauxspy.com/api/detect) when the user explicitly right-clicks and selects "Investigate this image" or "Analyze this video." No passive collection occurs. URLs are not stored after analysis. The extension stores locally only: (1) Pro license key in local browser storage, (2) scan history (Pro users only, never transmitted to our servers). No personal identifiers are collected.

Image URLs are sent to our AI detection API, which internally uses Sightengine and HiveModeration for analysis. Video URLs (Pro + Video plan only) are sent to Sightengine's video analysis API. These are third-party AI analysis services. No other third-party data sharing occurs.
```

---

## Submission Steps

1. Sign in at https://partner.microsoft.com/dashboard (any Microsoft account — free)
2. Accept the Edge Add-ons developer agreement (one-time, if not already done)
3. Left sidebar → **Microsoft Edge** → **Extensions** → find Faux Spy → **Update**
4. Upload `faux-spy-v1.9.5.zip`
5. Update Store Listing description with video detection copy above
6. Submit → automated review (hours) + manual review (3–7 business days)

---

## If Reviewers Ask About…

**ONNX/WASM files (`ort.min.js`, `ort-wasm.wasm`):**
> ONNX Runtime Web is an open-source ML inference library created by Microsoft. It is used to run a local AI image classification model inside the extension's service worker. The WASM files are the standard unmodified binaries from the published npm package `onnxruntime-web`. This enables fast local pre-filtering before any API call is made.

**`<all_urls>` in content scripts:**
> Required to enable the right-click context menu and result panel on any website the user visits. No data is collected passively — the content script only activates when the user explicitly right-clicks an image or video.

**Minified `ort.min.js`:**
> This is the unmodified published build of ONNX Runtime Web from npmjs.com/package/onnxruntime-web. It is not our code; it is a Microsoft open-source library. No custom obfuscation has been applied.

**Video detection / `detect-video` API call:**
> Video analysis is a paid Pro + Video feature. When triggered by the user, the video's URL is sent to our backend which calls Sightengine's video analysis API. Blob URLs (used by YouTube, Netflix, etc.) are explicitly rejected — only publicly accessible video URLs can be analyzed. No video data is stored.

---

## After Approval — Website Updates

Once the Edge listing is live:
1. Update `index.html` browser strip: add Edge badge alongside Chrome and Firefox
2. Create `pages/edge.html` SEO landing page
3. Add `/edge` rewrite to `vercel.json`
