# Privacy Policy for PaletteLive

**Effective Date:** February 15, 2026
**Last Updated:** February 26, 2026

## Overview

PaletteLive is a browser extension developed by **Movva Chenna Kesav** (India). It allows users to extract, edit, and export color palettes from websites. This privacy policy explains how we handle data in our extension and applies equally to all supported browser platforms: **Google Chrome**, **Microsoft Edge**, **Opera**, and **Mozilla Firefox**.

> **Note:** The side panel feature (previously requiring the `sidePanel` permission) has been removed from the extension. The color editor is now accessible exclusively via the popup.

## Extension Purpose

PaletteLive has a **single, clearly defined purpose**: extracting CSS color values from webpages, allowing users to edit those colors with a live preview, and exporting the resulting palette in various formats. The extension does not include any hidden, secondary, or unrelated functionality.

## Data Collection

### What Data We Collect

PaletteLive **only** collects data that is directly necessary for its core color-extraction function:

- **CSS color values** extracted from webpages you visit (e.g., hex codes, RGB values)
- **CSS variable names** defined in website stylesheets
- **Website domain names** (used to organize saved palettes by site)

No other data is collected. Data collection is strictly limited to what is required for the extension to function.

### Local Data Access

We process the following data **locally on your device** to provide functionality:

- **Webpage Content**: To extract colors and styles from the active tab only.
- **Clipboard**: To allow you to copy/export color codes (write-only access, never read).
- **Screen Captures**: The "Before/After" comparison feature is implemented via **DOM/CSS rendering** (a cloned overlay layer using `clip-path`). No browser capture API (`chrome.tabCapture`, `chrome.desktopCapture`, or `navigator.mediaDevices.getDisplayMedia`) is used, and no screen capture manifest permission is required.

### What We Do NOT Collect

We do **not** collect, store, or transmit:

- Personal information (name, email, address, phone number, etc.)
- Browsing history or visited URLs beyond the active tab
- Login credentials or passwords
- Form data or user input from webpages
- IP addresses or geolocation data
- Device identifiers or hardware information
- Search terms or search engine queries
- Private browsing / incognito session data
- Any data unrelated to color extraction and palette management

## Data Storage

### Local Storage Only

All data collected by PaletteLive is stored **exclusively on your device** using the browser's built-in storage APIs:

- `chrome.storage.local` / `browser.storage.local` — For saved color palettes and user settings
- `chrome.storage.session` / `browser.storage.session` — For temporary data during active sessions (editor window state, heatmap analysis data, cluster maps)

### No External Transmission

**We do not transmit any data to external servers, third parties, or remote endpoints.** Your data never leaves your device:

- No cloud syncing
- No analytics or telemetry
- No third-party services or integrations
- No remote code execution
- No background network requests of any kind

### Data Retention

- Saved palettes persist until you manually delete them or uninstall the extension.
- Temporary session data (editor state, heatmap analysis) is automatically cleared when you close the browser.
- You can clear all data at any time through the extension's settings.

## Permissions

### Permissions Used and Why

| Permission | Purpose | Justification |
|---|---|---|
| `activeTab` | Access the currently active tab for color extraction | Scoped to user-initiated actions only; does not grant persistent access |
| `scripting` | Inject CSS overrides for live color-editing previews | Required to apply and remove color changes on the page in real time |
| `storage` | Save color palettes and settings locally | All data stays on-device; no remote writes |
| `host_permissions: <all_urls>` | Re-apply saved palettes when you revisit matching domains | Used solely to match saved domains to your local palette data; no crawling, no data collection, no browsing history access |
| *(no screen capture permission)* | Before/After comparison overlay | The comparison is implemented via DOM/CSS rendering (`clip-path` on a cloned layer); no `tabCapture`, `desktopCapture`, or `getDisplayMedia` API is used |

### Why `<all_urls>` Is Necessary

`activeTab` alone cannot re-apply saved palette overrides when a page loads automatically (e.g., on navigation). `<all_urls>` is required so the extension's content script can check whether the current domain has a saved palette and apply it — purely locally. No URL data is transmitted or stored beyond the domain name you explicitly saved.

## How We Use Your Data

The collected color data is used solely for:

1. Displaying extracted color palettes to you
2. Allowing you to edit and preview color changes locally within your browser
3. Exporting color codes in various formats (CSS, JSON, Tailwind)
4. Saving your favorite palettes for future reference on matching domains

## Prohibited Practices — Explicit Confirmation

PaletteLive does **not** engage in any of the following practices:

- **Selling user data** to any party
- **Licensing or transferring user data** to third parties
- **Acting as a data broker** or aggregating user information
- **Intercepting search terms** or monitoring search engine queries
- **Storing private browsing / incognito session data**
- **Collecting data unrelated** to the core color-extraction function
- **Transmitting data via XHR, fetch, WebSocket, or any network request**
- **Loading external JavaScript files** at runtime
- **Using obfuscated or minified code** beyond what is readable for review
- **Modifying browser monetization or referral parameters** (including Opera's)
- **Including hidden features** or undisclosed functionality of any kind

## Code & Technical Transparency

PaletteLive is built to be fully transparent and reviewable:

- **No obfuscation**: All extension code is human-readable. No minification or obfuscation is applied.
- **No remote scripts**: The extension does not load JavaScript from any external URL. All code is bundled and packaged locally within the extension.
- **No external dependencies at runtime**: No CDN-loaded libraries, no dynamic `import()` from remote sources.
- **No build tools producing unreadable output**: The source code submitted is the same code that runs in the browser.
- **Official library versions only**: Any third-party libraries used are from their official sources and are included verbatim in the package.
- **Fully auditable**: The complete source code is available for review without any additional build steps.

## Monetization Transparency

This extension is **not monetized** and does **not** display advertisements.

- No ads are shown to users
- No affiliate links or referral tracking
- No sponsored content
- The extension does not interfere with, modify, or replace browser monetization systems (including Opera's built-in monetization or referral parameters)
- No revenue is generated from user data or extension usage

## AI / Machine Learning Disclosure

PaletteLive does **not** use any artificial intelligence, machine learning models, or large language models (LLMs).

- No user data is used for AI/ML training
- No data is sent to AI service providers (e.g., OpenAI, Google AI, Anthropic, etc.)
- All color processing uses deterministic algorithms (CSS parsing, color space math, contrast calculations) with no inference models

## Browser-Specific Declarations

### Mozilla Firefox (AMO)

- **`browser_specific_settings.gecko.data_collection_permissions`** (in `manifest.json`): declared as an object with a `required` array listing `"none"` — e.g. `{ "required": ["none"] }` — confirming that PaletteLive collects no user data that is transmitted off-device. Use the object-with-required-array form rather than a plain string value.
- The extension uses `browser.storage` APIs (compatible via WebExtensions API).
- No external connections are established at any point.

### Google Chrome (Chrome Web Store)

- The **Privacy Practices** tab on the Chrome Web Store dashboard is filled to match this policy exactly.
- **Limited Use compliance**: Data accessed via Chrome APIs is used solely to provide the extension's color-extraction feature and is not transferred, sold, or used for any secondary purpose.
- Every data category declared in the dashboard has a corresponding explanation in this policy.

### Microsoft Edge (Edge Add-ons Store)

- This privacy policy URL is provided in the Edge Add-ons submission.
- Each requested manifest permission is individually justified in the submission notes.
- The extension complies with Microsoft Edge Add-ons Store policies.

### Opera (Opera Add-ons)

- This privacy policy URL is provided in the Opera Add-ons submission.
- The extension does **not** modify Opera's monetization or referral parameters.
- Each permission is independently justified and minimal.

## Compliance & Children's Privacy

### Legal Compliance

We comply with the developer program policies of all supported browser stores:

- Google Chrome Web Store Developer Program Policies
- Microsoft Edge Add-ons Store Policies
- Opera Add-ons Policies
- Mozilla Firefox Add-on Policies (AMO)

We do **not** sell, trade, license, or otherwise transfer user data to any outside party.

### Children's Privacy

PaletteLive is **not** intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, please contact us immediately to have it removed.

## Your Rights

You have full control over your data:

- **View**: See all saved palettes in the extension popup
- **Export**: Download your palettes in multiple formats
- **Delete**: Clear individual palettes or all data at any time via the extension's settings
- **Uninstall**: Removing the extension deletes all associated data from your device

## Security

We implement the following security measures:

- All data processing happens locally in your browser
- No network requests are made by the extension
- Input sanitization to prevent XSS attacks
- Proper error handling for cross-origin content
- Content Security Policy (CSP) compliance — no `unsafe-eval` or inline script execution outside of extension-controlled contexts

## Changes to This Policy

We may update this privacy policy from time to time. Any material changes will be posted here with an updated effective date. Users will be notified of significant changes via extension update notes or an in-app notification. The effective date at the top of this page always reflects when the policy was last revised.

## Contact

If you have any questions about this privacy policy or our data practices, please contact us directly:

**Movva Chenna Kesav**
Email: `movva.chenna.kesav@gmail.com`

## Summary

PaletteLive is designed with privacy as a core principle:

- ✅ All data stays on your device — nothing is transmitted externally
- ✅ No personal information is collected
- ✅ No external servers, analytics, or third-party services
- ✅ No obfuscated code — fully readable and auditable
- ✅ No hidden features or secondary functionality
- ✅ Not monetized — no ads, no data sales
- ✅ No AI/ML — no data sent to AI providers
- ✅ You have full control over your data at all times
