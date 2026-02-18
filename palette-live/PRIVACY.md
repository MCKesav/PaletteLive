# Privacy Policy for PaletteLive

**Effective Date:** February 15, 2026

## Overview

PaletteLive is a browser extension developed by **Movva Chenna Kesav** (India). It allows users to extract, edit, and export color palettes from websites. This privacy policy explains how we handle data in our extension.

## Data Collection

### What Data We Collect

PaletteLive **only** collects the following data:
- **CSS color values** extracted from webpages you visit (e.g., hex codes, RGB values)
- **CSS variable names** defined in website stylesheets
- **Website domain names** (used to organize saved palettes by site)

### Local Data Access

We process the following data **locally on your device** to provide functionality:
- **Webpage Content**: To extract colors and styles.
- **Clipboard**: To allow you to copy/export color codes (write-only access).
- **Screen Captures**: Temporarily used *only* for the "Before/After" comparison feature. These images are processed in memory and never saved or transmitted.

### What We Do NOT Collect

We do **not** transmit or store on external servers:
- Personal information (name, email, address, etc.)
- Browsing history
- Login credentials or passwords
- Form data
- IP addresses or location data
- Device information

## Data Storage

### Local Storage Only

All data collected by PaletteLive is stored **locally on your device** using Chrome's built-in storage APIs:
- `chrome.storage.local` - For saved color palettes and settings
- `chrome.storage.session` - For temporary editor data during active sessions

### No External Transmission

**We do not transmit any data to external servers.** Your data never leaves your device:
- No cloud syncing
- No analytics or telemetry
- No third-party services
- No remote code execution

### Data Retention

- Saved palettes persist until you manually delete them or uninstall the extension
- Temporary session data is automatically cleared when you close the editor
- You can clear all data at any time through the extension's settings

## Permissions

PaletteLive requires the following permissions:

| Permission | Purpose |
|------------|---------|
| `activeTab` | To access the current webpage for color extraction |
| `scripting` | To inject CSS for live color editing previews |
| `storage` | To save color palettes locally on your device |
| `sidePanel` | To open the color editor in Chrome's side panel |
| `host_permissions: <all_urls>` | To automatically re-apply your saved color palettes. **Note:** This permission is used *only* to match your saved domains and apply your local changes. We do NOT perform background crawling or collect browsing history. |

## How We Use Your Data

The collected color data is used solely for:
1. Displaying extracted color palettes to you
2. Allowing you to edit and preview color changes locally
3. Exporting color codes in various formats (CSS, JSON, Tailwind)
4. Saving your favorite palettes for future reference

## Compliance & Children's Privacy

### Legal Compliance
We comply with the Google Chrome Web Store Developer Program Policies. We do **not** sell, trade, or otherwise transfer your data to outside parties.

### Children’s Privacy
PaletteLive is **not** intended for use by children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, please contact us immediately to have it removed.

## Your Rights

You have full control over your data:
- **View**: See all saved palettes in the extension popup
- **Export**: Download your palettes in multiple formats
- **Delete**: Clear individual palettes or all data at any time
- **Uninstall**: Removing the extension deletes all associated data

## Security

We implement the following security measures:
- All data processing happens locally in your browser
- No network requests are made by the extension
- Input sanitization to prevent XSS attacks
- Proper error handling for cross-origin content

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be posted here with an updated effective date.

## Contact

If you have any questions about this privacy policy or our data practices, please contact us directly:

**Movva Chenna Kesav**  
Email: `movva.chenna.kesav@gmail.com`

## Summary

PaletteLive is designed with privacy in mind. We believe your data belongs to you, which is why:
- ✅ All data stays on your device
- ✅ No personal information is collected
- ✅ No external servers are contacted
- ✅ You have full control over your data

C:\Users\Asus\.gemini\antigravity\brain\d5ec80ef-94c5-4913-8b46-f3eb0cf5a19e\GOOGLE_FORM_ANSWERS.md.resolved
