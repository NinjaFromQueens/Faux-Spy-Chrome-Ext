# Firefox Add-ons (AMO) — submission text

Built from source by `node build-extension.js`; `npx web-ext lint` reports 0 errors.

# 1.11.0

Upload `faux-spy-firefox-v1.11.0.zip` once 1.10.0 is approved, then paste each section into the matching field.

## Release notes (Version → Release notes)

What's new in 1.11.0

Upgrading to Pro
- Buy Pro on fauxspy.com and it switches on in the extension by itself. No more copying and pasting a license key.
- Bought a top-up or just renewed? Faux Spy checks with our server before saying you're out of tokens, so new tokens work right away.
- Settings shows your tokens left, with "Refresh" and "Buy more" links, and a link to get a lost key by email.
- Every upgrade prompt now opens the same, current pricing page on fauxspy.com.

Fixes
- The "Upgrade" badge shown at the daily free limit no longer says "undefined" when you hover it.
- The welcome page has a link for people who already bought Pro.

## Notes to Reviewer (Version → Notes to Reviewer)

Changes since 1.10.0 are all in the upgrade flow. No new permissions, no new data collection, and no new hosts.

- License hand-off after checkout (content.js, listenForCheckoutHandoff): only on https://www.fauxspy.com/success (or fauxspy.com/success), the content script accepts a window.postMessage from that page carrying the license key the customer just bought. It checks event.source, event.origin and the message type. It passes the key to the background, which checks it with https://www.fauxspy.com/api/validate-license exactly as when the user pastes it in Settings. It does nothing on any other site.
- Token balance re-check (background.js, refreshLicense): when the cached balance is 0, the background calls validate-license once (at most once a minute) before showing "out of tokens". It's the same request the add-on already makes daily.
- The in-extension upgrade.html page was removed; upgrade prompts open https://www.fauxspy.com/pro in a new tab. Links to the token page get the user's license key added by the background, so the key is never written into a website's page.

How to test Pro (optional): paid features need a license key. [Optional: paste a test key here.]

---

# 1.10.0

Upload `faux-spy-firefox-v1.10.0.zip`, then paste each section into the matching field.

---

## Release notes (Version → Release notes)

What's new in 1.10.0

Fixes
- If a scan fails (you're offline, the server is busy, or you're out of scans), Faux Spy now says the image wasn't checked instead of showing a result.
- Fixed garbled symbols in the right-click menu and messages.
- Scans no longer hang. They time out after 25 seconds with a clear message.
- Pro: changes to your plan now take effect within a day, and video scans explain why they failed (for example, an expired plan or no tokens left).

New
- A short welcome page after installing, showing the three ways to check a photo.
- Press Escape to close any Faux Spy panel. Panels and buttons now work with screen readers.

Improvements
- Lighter on every page: removed background checks that ran every second.
- Photos someone else already checked don't use one of your 3 free daily scans.
- Error reports no longer include the website's domain, and are only sent if you allow technical data.
- Plan details updated: Pro includes 200 scans a month.

---

## Notes to Reviewer (Version → Notes to Reviewer)

What it does: Faux Spy checks whether an image on the current page (or, on the paid Pro + Video plan, a video) is AI-generated. The user right-clicks an image and chooses "Investigate this image", hovers it and clicks Investigate, or Ctrl+clicks it. A panel shows the verdict with a confidence score.

How to test (no account needed):
1. Install. A local welcome page (welcome.html) opens once.
2. Open https://www.fauxspy.com/try-it, right-click any sample photo and choose "Investigate this image".
3. The free tier allows 3 scans a day. Photos that were already checked don't count.
Paid features (Pro, video) need a license key. [Optional: paste a test key here.]

Network and data:
- Only when the user starts a scan, the extension sends the chosen image's address to our API (https://www.fauxspy.com/api/detect). For a streamed video on Pro + Video, it sends one captured frame instead. Each scan also includes the page's domain and a random anonymous ID used for the free daily limit. These are declared as websiteContent and browsingActivity (required).
- Error reports go to Sentry only if the user enables technicalAndInteraction (optional; checked with permissions.contains before every report). They contain the extension version, error type, anonymous ID and site type (e.g. "Instagram"), and never images or page addresses.
- For paid users, the license key is sent to https://www.fauxspy.com/api/validate-license to check the plan. It's a product key we issue, not a password or a credential for another service, so we haven't declared authenticationInfo. We're happy to add it if you think it's needed.
- No ads, no analytics in the add-on, no data sale. Privacy policy: https://www.fauxspy.com/privacy
- runtime.setUninstallURL opens https://www.fauxspy.com/goodbye, an optional anonymous survey.

Code:
- No minified, obfuscated or generated code: the package is the source as written, with no build step beyond zipping. The Chrome build includes onnxruntime-web for an optional local model. It's excluded from this Firefox package, and nothing loads it here (importScripts is a no-op in Firefox).
- No remote code, eval or new Function.
- background-ff-shim.js makes importScripts() a no-op, because Firefox loads the background scripts from the manifest.
- content-ff-keepalive.js holds a runtime port open so the event page doesn't stop between a user's click and the scan reply. It stops reconnecting once the add-on is updated or disabled.
- The 11 innerHTML linter warnings: the result and message panels (content.js) and Case Files cards (history.js) are built from templates where every server- or page-provided value goes through escapeHtml(), and links in panels are restricted to https://fauxspy.com. The share-button ones restore the button's own original markup.
