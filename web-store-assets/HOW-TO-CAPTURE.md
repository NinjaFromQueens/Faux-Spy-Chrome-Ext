# Chrome Web Store media

All store media is captured from the **real extension** scanning the sample
images from fauxspy.com/try-it against the **real backend**, so it always
matches the current UI and real verdicts.

```bash
npm install          # once: puppeteer (Chrome for Testing) + ffmpeg-static
npm run capture
```

Output goes to `web-store-assets/out/` (git-ignored):

| File | Size | Where it goes in the CWS dashboard |
|---|---|---|
| `screenshot-1.png` … `screenshot-5.png` | 1280×800 | Store listing → Screenshots (upload all 5, in order) |
| `small-tile-440x280.png` | 440×280 | Store listing → Small promo tile (required) |
| `marquee-1400x560.png` | 1400×560 | Store listing → Marquee promo tile (needed for marquee featuring) |
| `demo.mp4` | 1280×720, ~24s, silent | Upload to YouTube, paste the link under Store listing → Video |

The script prints the verdicts it got for each sample image. Check them, and
look at every image, before uploading. Re-run after any UI change. Once the
sample images are in the server's cache, re-runs cost nothing and don't count
against scan limits.

Where to edit:
- Captions, layout, the promo images and the demo sequence: `scripts/capture-store-media.js`
- The demo web page the scans run on: `tests/fixtures/profile.html` (a generic
  page, deliberately not styled after any real app)
