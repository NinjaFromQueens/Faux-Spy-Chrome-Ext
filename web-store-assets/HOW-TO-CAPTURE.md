# Chrome Web Store Assets — How to Capture

All assets are HTML files. Open each in Chrome, set the exact window/viewport size, and screenshot.

## Tool: Chrome DevTools Device Emulation (Recommended)

1. Open the HTML file in Chrome
2. Open DevTools (`F12`)
3. Click the **Toggle Device Toolbar** icon (📱) — or press `Ctrl+Shift+M`
4. In the dimensions dropdown, set **Custom** and enter the exact width × height
5. Press `Ctrl+Shift+P` → type **"Capture screenshot"** → select **"Capture screenshot"**  
   (This saves a PNG at exactly those pixel dimensions — no cropping needed)

---

## Files & Dimensions

| File | Dimensions | Purpose |
|------|-----------|---------|
| `marquee-1400x560.html` | **1400 × 560** | Marquee banner (featured slot) |
| `small-tile-440x280.html` | **440 × 280** | Small promo tile (search results) |
| `screenshot-1-popup.html` | **1280 × 800** | Screenshot 1: Extension popup on Instagram |
| `screenshot-2-detection.html` | **1280 × 800** | Screenshot 2: Hover detection in action |
| `screenshot-3-deepdive.html` | **1280 × 800** | Screenshot 3: Deep Dive Pro mode |
| `screenshot-4-upgrade.html` | **1280 × 800** | Screenshot 4: Pro upgrade pricing |
| `screenshot-5-stats.html` | **1280 × 800** | Screenshot 5: Case Files & stats |

---

## Step-by-Step for Each File

1. Open Chrome → `File > Open File` → select the `.html` file
2. Press `F12` to open DevTools
3. Press `Ctrl+Shift+M` to enter Device Emulation mode
4. Set Custom dimensions (e.g. `1280` × `800`)
5. Refresh the page (`F5`) so the layout renders at those exact dimensions
6. Press `Ctrl+Shift+P`, type **capture screenshot**, press Enter
7. File saves to your Downloads folder as a PNG

---

## Chrome Web Store Requirements

- **Screenshots**: JPEG or 24-bit PNG (no alpha), 1280×800 or 640×400
- **Small promo tile**: JPEG or 24-bit PNG (no alpha), 440×280
- **Marquee promo tile**: JPEG or 24-bit PNG (no alpha), 1400×560

The captured PNGs meet all requirements. No additional editing needed.
