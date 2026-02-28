# PaletteLive — Notes to Reviewer

Use the relevant section below when submitting to each store.

---

## Microsoft Edge — Notes for Certification

**Extension purpose:** PaletteLive has a single purpose — extracting, editing, and exporting color palettes from web pages in real time.

**Testing instructions:**
1. Install the extension and navigate to any website (e.g., https://github.com or https://news.ycombinator.com).
2. Click the PaletteLive icon in the toolbar — the popup shows all extracted colors.
3. Click any color swatch to open the side panel editor with a color picker and WCAG contrast checker.
4. Change a color — notice it updates on the page in real time.
5. Use the Export dropdown to export the palette in any of the 6 formats (CSS Vars, JSON, Tailwind, CMYK, LAB, OKLCH).
6. Try the Heatmap button to see a color frequency overlay on the page.
7. Try the Before/After toggle to see a split-screen comparison.
8. Try the Color Dropper (eyedropper icon) to pick any element's color by clicking directly on the page.

**No login or credentials required.** The extension works immediately on any webpage.

**Permission justifications:**

| Permission | Why it's needed |
|---|---|
| `activeTab` | Scoped to user-initiated actions only. Required to read computed styles from the active tab for color extraction. |
| `scripting` | Required to inject CSS overrides for live color editing previews on the page. |
| `storage` | Saves color palettes and user settings locally on the device. No data is transmitted externally. |
| `sidePanel` | Opens the color editor in the browser's side panel for a persistent, non-intrusive UI. |
| `host_permissions: <all_urls>` | Required so the content script can check whether the current domain has a saved palette and re-apply it on page navigation. Used purely for local domain matching — no URL data is transmitted. `activeTab` alone cannot auto-apply saved overrides on page load. |

**Privacy:** The extension makes zero network requests. All data is stored locally via `chrome.storage.local` and `chrome.storage.session`. No analytics, telemetry, or external services.

**Code:** All source code is unminified, human-readable JavaScript with no build step. The submitted ZIP is the exact code that runs in the browser.

---

## Firefox (AMO) — Notes to Reviewer

**Extension purpose:** PaletteLive extracts, edits, and exports color palettes from any website in real time. Single purpose — color palette tool.

**Testing instructions:**
1. Install and navigate to any website (e.g., https://github.com or https://developer.mozilla.org).
2. Click the PaletteLive toolbar icon — the popup displays all extracted colors.
3. Click any color swatch — an editor window opens with a color picker and live WCAG contrast checker.
4. Change a color — it updates on the page immediately (no reload).
5. Export using the Export dropdown (CSS Vars, JSON, Tailwind, CMYK, LAB, OKLCH).
6. Try the Heatmap, Before/After comparison, and Color Dropper features.

**No login or test credentials required.**

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Read computed styles from the current page for color extraction. Scoped to user-initiated actions only. |
| `scripting` | Inject CSS overrides for live color editing on the page. |
| `storage` | Save palettes and settings locally. No external transmission. |
| `host_permissions: <all_urls>` | Re-apply saved palette overrides on page load for matching domains. `activeTab` alone cannot trigger this automatically on navigation. No URL data is collected or transmitted — only matched against the locally saved domain name. |

**No remote code:** All JavaScript is bundled in the extension package. No CDN scripts, no dynamic `import()`, no `eval()`, no `new Function()`. The extension makes zero network requests of any kind.

**Source code:** The submitted extension IS the source code — no transpiler, no bundler, no minification. What you see is what runs. No separate build step is required.

**Privacy:** Zero data leaves the user's device. No analytics, no telemetry, no external connections. See the full privacy policy (pasted in the dashboard field).

---

## Opera Add-ons — Notes for Reviewer

**Extension purpose:** Single purpose — extract, edit, and export color palettes from websites in real time.

**Testing instructions:**
1. Install and visit any website (e.g., https://github.com or https://stackoverflow.com).
2. Click the PaletteLive icon — the popup shows all page colors as interactive swatches.
3. Click a swatch to open the editor with a color picker and WCAG contrast checker.
4. Edit a color — it changes on the page immediately.
5. Export from the Export menu in CSS Variables, JSON, Tailwind, CMYK, LAB, or OKLCH format.
6. Test Heatmap, Before/After comparison, Color Dropper, and Vision Simulation features.

**No login or test credentials needed.** Works instantly on any page.

**Permission justifications:**

| Permission | Why |
|---|---|
| `activeTab` | Read page styles for color extraction (user-initiated only). |
| `scripting` | Inject CSS overrides for live color preview on the page. |
| `storage` | Save palettes and settings locally on-device. |
| `sidePanel` | Persistent side panel editor UI. |
| `host_permissions: <all_urls>` | Auto-apply saved palettes on domain match during page load. No URLs are collected or transmitted. |

**Code quality:** All source code is standard, unminified, human-readable JavaScript. No obfuscation, no bundler output. No third-party runtime libraries — all code is original.

**No remote code:** The extension makes zero network requests. No CDN scripts, no external JavaScript loading, no fetch/XHR calls.

**Monetization:** The extension is free with no ads, no affiliate links, no referral tracking, and does not modify any browser monetization or referral parameters.

**Privacy:** All data stays on the user's device. No data is transmitted externally. Full privacy policy URL: https://palettelive.mckesav.in/privacypolicy

**Support page:** https://palettelive.mckesav.in/#contact
