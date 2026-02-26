# PaletteLive — Full Architecture & Data Flow

> From browser load to final export — a complete technical walkthrough.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Boot Sequence — What Happens on Power-On](#2-boot-sequence--what-happens-on-power-on)
3. [The Three Execution Contexts](#3-the-three-execution-contexts)
4. [Content Script Internals](#4-content-script-internals)
   - [Script Load Order](#41-script-load-order)
   - [ShadowWalker](#42-shadowwalker)
   - [Extractor (Color Scan)](#43-extractor-color-scan)
   - [Injector (Live CSS Editing)](#44-injector-live-css-editing)
   - [Heatmap](#45-heatmap)
   - [Dropper](#46-dropper)
   - [content.js — The Orchestrator](#47-contentjs--the-orchestrator)
5. [Background Service Worker](#5-background-service-worker)
6. [Popup (popup.js)](#6-popup-popupjs)
7. [Side Panel / Editor Window (sidepanel.js)](#7-side-panel--editor-window-sidepaneljs)
8. [Utility Library Layer](#8-utility-library-layer)
   - [ColorUtils](#81-colorutils)
   - [ColorNames](#82-colornames)
   - [Contrast](#83-contrast)
   - [StorageUtils](#84-storageutils)
   - [ExporterUtils](#85-exporterutils)
   - [Constants](#86-constants)
9. [Message Bus (Full Message Type Reference)](#9-message-bus-full-message-type-reference)
10. [State Management & Storage](#10-state-management--storage)
11. [The Complete Scan → Edit → Export Flow](#11-the-complete-scan--edit--export-flow)
12. [Export Pipeline — Every Format Explained](#12-export-pipeline--every-format-explained)
13. [Advanced Features](#13-advanced-features)
    - [Color Clustering](#131-color-clustering)
    - [Color Dropper](#132-color-dropper)
    - [Heatmap](#133-heatmap)
    - [Before/After Comparison](#134-beforeafter-comparison)
    - [SPA / Infinite-Scroll Handling](#135-spa--infinite-scroll-handling)
    - [Shadow DOM Support](#136-shadow-dom-support)
    - [Vision Simulation](#137-vision-simulation)
    - [Palette Generator](#138-palette-generator)
14. [Security Model](#14-security-model)
15. [Error Recovery & Context Invalidation](#15-error-recovery--context-invalidation)

---

## 1. High-Level Overview

PaletteLive is a **Manifest V3 Chrome extension** that:

1. Injects a content script bundle into every web page.
2. On user request, walks the entire DOM (including open Shadow DOMs) and extracts every computed color.
3. Displays those colors in a popup with clustering, editing, and accessibility tools.
4. Applies color overrides live on the page via inline style mutations and a dynamic `<style>` tag.
5. Persists changes per domain and exports them in CSS, JSON, Tailwind, CMYK, CIE LAB, or OKLCH format.

```
┌────────────────────────────────────────────────────────────┐
│                      Chrome Browser                         │
│                                                            │
│  ┌──────────────┐   messages   ┌────────────────────────┐  │
│  │  background  │◄────────────►│  popup / sidepanel     │  │
│  │ (service     │              │  (extension pages)     │  │
│  │  worker)     │              └────────────────────────┘  │
│  └──────┬───────┘                                          │
│         │ chrome.tabs.sendMessage                          │
│         ▼                                                  │
│  ┌────────────────────────────────────────────────────┐    │
│  │                   Web Page Tab                      │    │
│  │  ┌──────────────────────────────────────────────┐  │    │
│  │  │          Content Script Bundle               │  │    │
│  │  │  constants → colorUtils → colorNames →       │  │    │
│  │  │  contrast → storage → shadowWalker →         │  │    │
│  │  │  extractor → injector → heatmap →            │  │    │
│  │  │  dropper → content.js                        │  │    │
│  │  └──────────────────────────────────────────────┘  │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Boot Sequence — What Happens on Power-On

### Step 1 — Browser installs the extension

`manifest.json` declares every entry point:

| Key | Value | Purpose |
|-----|-------|---------|
| `background.service_worker` | `background.js` | Service worker — always running (wakes on events) |
| `action.default_popup` | `popup/popup.html` | Popup shown when toolbar icon is clicked |
| `side_panel.default_path` | `sidepanel/sidepanel.html` | Color editor window |
| `content_scripts[].js` | (11 files, see below) | Injected into every `<all_urls>` page |
| `content_scripts[].run_at` | `document_idle` | Injected after the DOM is parsed and idle |
| `content_scripts[].all_frames` | `true` | Runs in iframes too |

### Step 2 — Background service worker wakes (`background.js`)

Runs `chrome.runtime.onInstalled` (logs install) and immediately tries to restore `activeEditorWindowId` from `chrome.storage.session`. This covers the case where the service worker was killed between activations — it verifies the stored window ID is still alive via `chrome.windows.get` before accepting it.

### Step 3 — Content script bundle injects into every page at `document_idle`

The scripts are loaded **in order** (Chrome guarantees sequential injection for content scripts declared in the manifest):

```
utils/constants.js       → PLConfig, MessageTypes, PLLog (shared config & message catalogue)
utils/colorUtils.js      → ColorUtils (universal CSS color parser)
utils/colorNames.js      → ColorNames (148 named colors + fuzzy naming)
utils/contrast.js        → getContrastRatio (WCAG luminance formula)
utils/storage.js         → StorageUtils (chrome.storage.local, LRU eviction)
content/shadowWalker.js  → ShadowWalker (open Shadow DOM traversal)
content/extractor.js     → Extractor (DOM scan → color list)
content/injector.js      → Injector (dynamic <style> tag management)
content/heatmap.js       → Heatmap (visual color map overlay)
content/dropper.js       → Dropper (crosshair color picker)
content/content.js       → main coordinator (message handler + runtime logic)
```

Each script is wrapped in a **re-injection guard** using a global version constant (e.g. `window._extractorVersion`, `globalThis._storageUtilsVersion`). If the same version is already loaded, the script body is skipped entirely — this prevents duplicate code when the extension reloads.

### Step 4 — `content.js` initialises the runtime

- Sets `window.__paletteLiveLoaded = 3` (version flag).
- Generates a **cryptographic dropper secret** (`crypto.getRandomValues`) to authenticate secure CustomEvents.
- Starts the `WeakRef` pruning interval (every 60 s) to garbage-collect dead element references.
- Attaches the `chrome.runtime.onMessage` listener that handles all incoming commands.
- Starts the **MutationObserver** (`startObserver`) to track SPA navigation.

---

## 3. The Three Execution Contexts

PaletteLive code runs in three isolated JavaScript contexts that can only talk to each other via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`:

| Context | Script(s) | Lifetime | DOM access |
|---------|-----------|----------|------------|
| **Service Worker** | `background.js` | Event-driven, can be killed and re-woken | None |
| **Extension Page** | `popup.js`, `sidepanel.js` | Alive only while the page is open | Own page only |
| **Content Script** | Everything in `content/` + `utils/` | Same as the tab | Full access to page DOM |

---

## 4. Content Script Internals

### 4.1 Script Load Order

Scripts load sequentially (manifest order). Each one exposes a single object on `window` / `globalThis` so the later scripts can reference them:

- `ColorUtils`, `ColorNames`, `getContrastRatio`, `StorageUtils`
- `ShadowWalker`, `Extractor`, `Injector`, `Heatmap`, `Dropper`
- `PLConfig`, `PLLog`, `MessageTypes` (from `constants.js`)

---

### 4.2 ShadowWalker

**File:** `content/shadowWalker.js`

The browser's standard `document.querySelectorAll` cannot reach inside Shadow DOM roots. `ShadowWalker` solves this:

```
ShadowWalker.getAllElements()
  → walks document.body with document.createTreeWalker
  → whenever it finds node.shadowRoot (mode === 'open') it recurses up to MAX_SHADOW_DEPTH (30) levels
  → returns a flat Array<Element> capped at MAX_ELEMENTS (50 000)
```

Closed shadow DOMs (mode `"closed"`) are counted in `closedShadowCount` but their internals cannot be accessed — this is a browser security boundary.

---

### 4.3 Extractor (Color Scan)

**File:** `content/extractor.js`

`Extractor.scan()` is the core color-discovery engine. It runs asynchronously and returns `{ colors: [], variables: [] }`.

#### Phase 1 — CSS Stylesheet scan
Iterates `document.styleSheets` (same-origin only — cross-origin are skipped with try/catch). For each rule:
- `_scanRuleForVariables` — records CSS custom property declarations (`--name: value`) into `variableMap`.
- `_scanRuleForColors` — records raw hex / function color values (from `color:`, `background:`, `border:`, etc.) into `colorMap`. This catches colors inside `:hover`, `:active`, `@keyframes` that `getComputedStyle` would miss in the current DOM state.

Also scans Shadow DOM `<style>` tags and `adoptedStyleSheets` from the list produced by `ShadowWalker`.

#### Phase 2 — `:root` inline style + computed variables
- Reads `document.documentElement.style` for inline custom properties.
- Calls `getComputedStyle` on `<html>` and `<body>` to resolve inherited variable values.

#### Phase 3 — Element computed style walkthrough
Iterates every element from `ShadowWalker.getAllElements()`. For each element:
- Calls `getComputedStyle(el)` and reads color-bearing properties: `color`, `background-color`, `border-color`, `outline-color`, `box-shadow`, `text-decoration-color`, `fill`, `stroke`, `caret-color`, `column-rule-color`, `accent-color`.
- Each value is parsed by `ColorUtils.rgbToHex()` → normalized to `#rrggbb`.
- The hex is added to `colorMap` with a count and a category tag (`text`, `background`, `border`, etc.).

#### Phase 4 — Deduplication & sorting
Colors are sorted by frequency (most-used first), then by category priority. The result is the palette list.

#### Scan Cache
`content.js` caches the last `Extractor.scan()` result in `_scanCache` for 2 minutes. Reopening the popup while on the same URL returns instantly from cache. The cache is invalidated on SPA navigation or explicit rescan.

---

### 4.4 Injector (Live CSS Editing)

**File:** `content/injector.js`

`Injector` owns a single `<style id="palettelive-overrides">` element appended to `<head>`. This is the mechanism for global CSS variable overrides and fallback class rules.

```
Injector.init()    → creates <style> if absent
Injector.apply({
  variables: { '--primary-color': '#ff0000' },      // :root { --primary-color: #ff0000 }
  selectors: { '.pl-bg-ff0000': { background-color: '#ff0000' } }
})
Injector.reset()   → empties state; removes all injected CSS
```

**Sanitization:** All inputs are sanitized before writing to the stylesheet:
- `_sanitizeVarName` — must match `^--[a-zA-Z0-9_-]+$`
- `_sanitizeCSSValue` — strips `{ } ; < > " \n \r \`
- `_sanitizeSelector` — strict allowlist: `.pl-[...]:hover/focus/active/before/after` only
- `_sanitizePropName` — must match `^[a-z-]+$`

---

### 4.5 Heatmap

**File:** `content/heatmap.js`

When activated, `Heatmap.show()` walks every element (via `ShadowWalker`) in batches of 200, yielding to the browser with `requestIdleCallback` between batches to keep the page responsive.

For each element it reads computed `color`, `background-color`, and `border-color`. It:
1. Tracks color frequency across the whole page.
2. Adds a colored CSS outline (`outline: 2px solid <hex>`) to every element.
3. Attaches a hover tooltip showing the color value and how many elements share it.

A single `<style id="palettelive-heatmap-style">` tag holds all outline rules. `Heatmap.hide()` removes the style tag and all tooltips.

---

### 4.6 Dropper

**File:** `content/dropper.js`

The color dropper lets users click any element to sample its color:

1. `Dropper.start()` — injects a full-screen transparent `div#pl-dropper-overlay` with `cursor: crosshair` (z-index 2147483646 — just below the maximum to stay below critical UI).
2. A floating preview bubble tracks `mousemove`, reads the element under the pointer via `document.elementFromPoint`, and calls `getComputedStyle(el).backgroundColor` → `ColorUtils.rgbToHex()` in real-time.
3. On **click**, the picked color and its element are stored. A `DROPPER_RESOLVE_CLUSTER` message is sent to the background worker, which looks up the `palettelive_clusterMap` (stored in session by the popup) to find all related source colors/elements.
4. An inline floating editor panel (`#pl-dropper-editor`) is shown near the click point with a color input, apply/cancel buttons, and contrast info.
5. When the user applies a new color, `content.js` receives `OPEN_EDITOR_WINDOW` → opens `sidepanel.html` as a popup window with pre-loaded data.
6. All dropper events (`pl-dropper-active`, `pl-dropper-picked`, etc.) are dispatched as `CustomEvent` on `window` and validated with the cryptographic secret in `detail._plSecret` to prevent spoofing by page scripts.

---

### 4.7 content.js — The Orchestrator

**File:** `content/content.js` (3 815 lines)

This is the main content script. It owns all runtime state and handles every message from the background/popup:

| State | Type | Description |
|-------|------|-------------|
| `colorElementMap` | `Map<hex, [{element, cssProp}]>` | Maps each extracted color to every DOM element using it |
| `overrideMap` | `WeakMap<Element, Map<cssProp, snapshot>>` | Tracks inline override snapshots for reverting |
| `overrideRefs` | `WeakRef[]` | Weak references to overridden elements (pruned every 60 s) |
| `rawOverrideState` | `Map<original, current>` | The currently active color substitutions |
| `_scanCache` | `{url, data, ts}` | In-memory scan result cache (2-minute TTL) |
| `__plPaused` | `boolean` | When `true`, all background activity suspends |
| `comparisonSnapshot` | DOM snapshot | Before-state for the split comparison overlay |

#### Key message handlers in `content.js`

- **`EXTRACT_PALETTE`** — serves scan from cache or triggers `Extractor.scan()`, then re-applies any persisted overrides from `StorageUtils`.
- **`APPLY_OVERRIDE` / `APPLY_OVERRIDE_BULK`** — mutates element inline styles; uses `overrideMap` to record original values so they can be reverted.
- **`APPLY_OVERRIDE_FAST`** — same but without building the element map (used during live scrubbing in the editor).
- **`REMOVE_RAW_OVERRIDE`** — restores original inline style from `overrideMap` snapshot.
- **`RESET_AND_RESCAN`** — resets all overrides → waits for style settle → rescans.
- **`HIGHLIGHT_COLOR`** — adds a CSS outline highlight to all elements using that color.
- **`TOGGLE_HEATMAP`** — delegates to `Heatmap.toggle()`.
- **`PICK_COLOR`** → `CANCEL_PICK`** — delegates to `Dropper.start()` / `Dropper.cancel()`.
- **`SUSPEND_FOR_COMPARISON` / `RESTORE_AFTER_COMPARISON`** — freezes / unfreezes the page state for the before/after comparison overlay.
- **`FIX_TEXT_CONTRAST`** — finds all text elements failing WCAG AA and injects corrected colors.
- **`PAUSE_EXTENSION` / `RESUME_EXTENSION`** — halts/resumes the observer and all background timers.

#### Image Container Guard
Before applying a `background-color` override, `content.js` calls `_isImageContainer(element)`. This skips any element that:
- Is `IMG`, `VIDEO`, `CANVAS`, `PICTURE`, `SOURCE`
- Has a CSS `background-image: url(...)` 
- Is a tight wrapper (≤2 levels deep) around a media element covering >50% of its area

This prevents invisible images caused by overriding their container's background.

#### SPA / Navigation Watch
A `MutationObserver` watches `document` for DOM mutations. When it detects a URL change (via `location.href` comparison), it waits for styles to settle (`requestAnimationFrame × 2` with 100 ms fallback), then re-applies all saved overrides and rebuilds the `colorElementMap`.

---

## 5. Background Service Worker

**File:** `background.js`

The service worker is the **message relay hub**. It never touches the page DOM; it just routes messages and persists data.

### Persistent State
Because MV3 service workers can be killed at any time, critical state is stored in `chrome.storage.session` (survives sleep/wake but not extension reload):
- `activeEditorWindowId` — the ID of the currently open editor popup window.
- `sidePanelColorData` — the color data payload passed to an opening editor window.
- `palettelive_clusterMap` — the cluster map built by the popup, used by the dropper.

### Message Handling Summary

| Message Type | Action |
|---|---|
| `OPEN_EDITOR_WINDOW` | Stores payload in session, then creates or focuses the editor popup window |
| `DROPPER_RESOLVE_CLUSTER` | Looks up a picked hex in `palettelive_clusterMap` → returns the full cluster sources |
| `SIDEPANEL_COLOR_CHANGED` | Relays fast/bulk overrides to the content script (no persist) |
| `SIDEPANEL_COLOR_COMMITTED` | Relays bulk override to content script AND persists to `chrome.storage.local` via `StorageUtils` |
| `SIDEPANEL_APPLY_OVERRIDE` | Relays a single override to content script |
| `SIDEPANEL_REMOVE_OVERRIDE` | Relays an override removal to content script |
| `SIDEPANEL_HIGHLIGHT` | Relays a highlight request to content script |

When the editor window is closed, `chrome.windows.onRemoved` fires and `activeEditorWindowId` is cleared.

---

## 6. Popup (popup.js)

**File:** `popup/popup.js` (4 823 lines)

The popup is the main user interface. It opens when the user clicks the toolbar icon.

### Initialization Flow

```
DOMContentLoaded
  │
  ├── Load saved theme (chrome.storage.local → 'palettelive_popup_theme')
  ├── Load extension pause state for current domain
  ├── Get active tab → query domain
  ├── Load persisted palette from StorageUtils.getPalette(domain)
  └── Send EXTRACT_PALETTE to content script (15 s timeout)
        │
        └── Response: { colors, variables, overrides, domain }
              │
              ├── Apply any saved raw overrides (APPLY_OVERRIDE_BULK)
              ├── Build clusterMap and save to chrome.storage.session
              └── Render palette list (renderPalette)
```

### Rendering

`renderPalette(colors)` builds the color swatch list. Each swatch shows:
- Color preview circle
- Hex value + optional CSS variable name
- Color name (from `ColorNames`)
- Usage count
- WCAG contrast badge
- Edit button (opens sidepanel editor)
- Highlight button (sends `HIGHLIGHT_COLOR`)

### Scan Button

Clicking **Rescan** sends `RESET_AND_RESCAN` to the content script, waits for the response, then re-renders the full palette.

### Palette Modes

Controlled by `#palette-mode-select`. Modes:
- **Extract** — colors scraped directly from the DOM (default)
- **Generate (Monochromatic / 60-30-10 / Analogous / Complementary / Split-Complementary / Triadic)** — mathematical color theory generators built into popup.js; no content script involvement

### Cluster Mode

When clustering is enabled, `clusterColors(colors, threshold)` in popup.js groups visually similar colors (within a configurable Lab ΔE threshold) into a representative "cluster head". The dropdown threshold slider controls sensitivity. The cluster map is saved to `chrome.storage.session` so the dropper can look up cluster membership.

---

## 7. Side Panel / Editor Window (sidepanel.js)

**File:** `sidepanel/sidepanel.js` (329 lines)

The editor opens as a `chrome.windows.create` popup (340 × 600) pointing at `sidepanel/sidepanel.html`. It loads its initial data from `chrome.storage.session['sidePanelColorData']`.

### State
- `selectedSources` — array of source hex values that the current edit applies to (supports editing merged clusters)
- `selectedColor` — the color being edited
- `currentTabId` — the tab ID the editor is targeting

### Live Editing Flow

```
User drags color picker
  → colorPicker 'input' event fires
  → sanitizePickerHex(value)
  → sendMessage SIDEPANEL_COLOR_CHANGED { newValue, sources, fast: true, tabId }
  → background relays APPLY_OVERRIDE_FAST to content script
  → content script mutates inline styles immediately (no DOM re-scan)
  → UI updates: contrast ratio, WCAG badges, color label
```

```
User releases / clicks Apply
  → sendMessage SIDEPANEL_COLOR_COMMITTED { finalValue, sources, tabId }
  → background relays APPLY_OVERRIDE_BULK to content script AND persists to storage
```

### Contrast Panel

Displays real-time WCAG 2.1 contrast ratio against white (`#ffffff`) using `getContrastRatio()` from `contrast.js`. Shows AA Normal / AAA Normal / AA Large / AAA Large pass/fail badges.

### Export Select Mode

`#export-select-toggle` lets the user select a subset of colors in the editor window to export. The selection is passed back to the popup's export pipeline.

---

## 8. Utility Library Layer

### 8.1 ColorUtils

**File:** `utils/colorUtils.js`

Universal CSS color parser. Strategy:

1. If input is already `#hex` → `_normalizeHex()`
2. If input starts with `rgb/rgba` → fast `_rgbStringToHex()` (most common case from `getComputedStyle`)
3. If `oklch` → `_oklchStringToHex()` (full mathematical conversion via OKLab LMS matrices)
4. If `oklab` → `_oklabStringToHex()`
5. Everything else (`hsl`, `hwb`, `lab`, `color()`, named colors) → `_resolveViaDom()`: assigns the value to a temporary `div.style.backgroundColor`, reads back the browser-resolved `rgb()` value, then parses it.

Also exposes:
- `hexToExportString(hex)` — returns `rgba()` only if alpha < 1, otherwise bare hex
- `hexToRgb(hex)` — `{ r, g, b, a }`
- `colorDistance(a, b)` — Euclidean RGB distance for clustering
- `lighten(hex, amount)` / `darken(hex, amount)`

### 8.2 ColorNames

**File:** `utils/colorNames.js`

A dictionary of human-readable color names. `ColorNames.getName(hex)` finds the closest named color using Euclidean RGB distance. Used in export labels, Tailwind key generation, and in the popup swatch display.

### 8.3 Contrast

**File:** `utils/contrast.js`

`getContrastRatio(hex1, hex2)` implements the WCAG 2.1 relative luminance formula:

$$L = 0.2126 \cdot R_{lin} + 0.7152 \cdot G_{lin} + 0.0722 \cdot B_{lin}$$

$$\text{Contrast} = \frac{L_{lighter} + 0.05}{L_{darker} + 0.05}$$

Where each channel is linearized: $c_{lin} = c \leq 0.04045 \; ? \; c/12.92 \; : \; ((c+0.055)/1.055)^{2.4}$

### 8.4 StorageUtils

**File:** `utils/storage.js`

Thin wrapper around `chrome.storage.local` keyed by domain (`window.location.hostname`).

Schema (one object per domain):
```json
{
  "_schemaVersion": 1,
  "_lastAccessed": 1700000000000,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "overrides": {
    "raw": { "#aabbcc": "#112233" }
  }
}
```

**LRU Eviction:** If `chrome.storage.local.set` fails with `QUOTA_EXCEEDED`, `_evictOldest()` deletes the 20% of domains with the oldest `_lastAccessed` timestamp, then retries. Caps at 200 stored domains.

**Schema migration:** `_migrateIfNeeded(data)` upgrades old data structures to current schema on read. Corrupt data is discarded and removed.

### 8.5 ExporterUtils

**File:** `utils/exporter.js`

Pure transformation functions. Each takes the same array input:
```js
[{ name: '--primary', value: '#ff0000', source: '#ff0000' }]
```

| Method | Output |
|---|---|
| `toCSS(colors)` | `:root { --primary: #ff0000; }` |
| `toJSON(colors)` | `{ "primary": { "value": "#ff0000", "name": "Red" } }` |
| `toTailwind(colors)` | `module.exports = { theme: { extend: { colors: { "primary": '#ff0000' } } } }` |
| `toCMYK(colors)` | `--primary: cmyk(0.0%, 100.0%, 100.0%, 0.0%)` |
| `toLAB(colors)` | `--primary: lab(53.23% 80.11 67.22)` (D65 illuminant) |
| `toOKLCH(colors)` | `--primary: oklch(62.8% 0.2577 29.23)` (perceptually uniform) |

Alpha channels are preserved: `ColorUtils.hexToExportString` emits `rgba(r, g, b, a)` if alpha < 1.

### 8.6 Constants

**File:** `utils/constants.js`

Exports three frozen objects to all scripts:

- **`MessageTypes`** — frozen object with every message string (e.g. `EXTRACT_PALETTE`, `APPLY_OVERRIDE_BULK`). Using this prevents typo-silent-failures.
- **`PLConfig`** — numeric tuning parameters: `WEAKREF_PRUNE_INTERVAL_MS`, `SCAN_CACHE_TTL_MS`, `MAX_ELEMENTS`, etc.
- **`PLLog`** — a thin logging facade (`PLLog.info`, `PLLog.debug`, `PLLog.warn`) that can be silenced in production.

---

## 9. Message Bus (Full Message Type Reference)

All messages use `chrome.runtime.sendMessage` (popup→background, sidepanel→background) or `chrome.tabs.sendMessage` (background→content).

```
Popup ──────────────────────────────────────────────────────────────► Content
        EXTRACT_PALETTE, RESET_AND_RESCAN, RESCAN_ONLY
        APPLY_OVERRIDE, APPLY_OVERRIDE_BULK, REMOVE_RAW_OVERRIDE
        HIGHLIGHT_ELEMENTS, UNHIGHLIGHT
        TOGGLE_HEATMAP
        PICK_COLOR, CANCEL_PICK
        FIX_TEXT_CONTRAST
        SUSPEND_FOR_COMPARISON, RESTORE_AFTER_COMPARISON
        SHOW_COMPARISON_OVERLAY, HIDE_COMPARISON_OVERLAY
        PAUSE_EXTENSION, RESUME_EXTENSION
        FORCE_REAPPLY

Popup ──────────────────────────────────────────────────────────────► Background
        OPEN_EDITOR_WINDOW

Dropper ────────────────────────────────────────────────────────────► Background
        DROPPER_RESOLVE_CLUSTER
        OPEN_EDITOR_WINDOW

SidePanel ──────────────────────────────────────────────────────────► Background
        SIDEPANEL_COLOR_CHANGED   (fast, no persist)
        SIDEPANEL_COLOR_COMMITTED (final, persists to storage)
        SIDEPANEL_APPLY_OVERRIDE
        SIDEPANEL_REMOVE_OVERRIDE
        SIDEPANEL_HIGHLIGHT

Background ────────────────────────────────────────────────────────► Content
        APPLY_OVERRIDE_FAST, APPLY_OVERRIDE_BULK
        HIGHLIGHT_COLOR
```

---

## 10. State Management & Storage

### Session Storage (`chrome.storage.session`)
Ephemeral — cleared when the browser closes.

| Key | Owner | Purpose |
|---|---|---|
| `activeEditorWindowId` | background.js | Tracks the open editor window so it can be focused instead of duplicated |
| `sidePanelColorData` | background.js | Payload handed to the editor window on open |
| `palettelive_clusterMap` | popup.js | Maps every member hex to its cluster entry so the dropper can resolve picks |

### Local Storage (`chrome.storage.local`)
Persistent across sessions. Keyed by domain.

| Key | Owner | Purpose |
|---|---|---|
| `<hostname>` | StorageUtils | Full palette object: overrides, timestamps, schema version |
| `palettelive_popup_theme` | popup.js | User's chosen popup theme (light/dark/auto) |

### In-Memory (content script)
Lost on page navigation or tab close.

| Variable | Purpose |
|---|---|
| `colorElementMap` | Source color → DOM elements map; rebuilt on every scan |
| `overrideMap` (WeakMap) | Per-element inline-style snapshots for revert |
| `rawOverrideState` | Active color substitutions |
| `_scanCache` | 2-minute TTL scan result cache |

---

## 11. The Complete Scan → Edit → Export Flow

```
1. USER clicks toolbar icon
   └── popup.html loads, popup.js runs DOMContentLoaded

2. popup.js queries chrome.tabs.query for active tab
   └── gets tab.id, tab.url → extracts domain

3. popup.js calls StorageUtils.getPalette(domain)
   └── if saved overrides exist, they are noted for re-application

4. popup.js sends EXTRACT_PALETTE to content script (15 s timeout)
   └── content.js receives message

5. content.js checks _scanCache (url match + TTL)
   ├── HIT: returns cached data immediately
   └── MISS: calls Extractor.scan()
         ├── Phase 1: walk all stylesheets → colorMap + variableMap
         ├── Phase 2: :root inline + computed variables
         └── Phase 3: getComputedStyle on every element (via ShadowWalker)
               → returns { colors: [...], variables: [...] }

6. content.js reapplies saved overrides from StorageUtils
   └── sends APPLY_OVERRIDE_BULK for each persisted raw override

7. popup.js receives scan result
   ├── clusterColors(colors, threshold) groups similar colors
   ├── Saves clusterMap to chrome.storage.session
   └── renderPalette() draws the swatch list

8. USER clicks edit swatch button (pencil icon)
   └── popup.js sends OPEN_EDITOR_WINDOW to background
         └── background saves sidePanelColorData to session
               └── chrome.windows.create → sidepanel.html

9. sidepanel.js loads chrome.storage.session['sidePanelColorData']
   └── displays color picker pre-set to current color

10. USER drags the color picker
    └── SIDEPANEL_COLOR_CHANGED → background → APPLY_OVERRIDE_FAST → content.js
          └── content.js directly mutates element.style[prop] for every
              element in colorElementMap[source] — real-time live preview

11. USER clicks Apply / releases picker
    └── SIDEPANEL_COLOR_COMMITTED → background:
          ├── Relays APPLY_OVERRIDE_BULK → content.js (persists in rawOverrideState)
          └── StorageUtils.savePalette(domain, updatedPalette)
                └── chrome.storage.local.set({ [domain]: paletteData })

12. USER clicks Export button in popup
    └── (see Section 12)
```

---

## 12. Export Pipeline — Every Format Explained

The export button opens a dropdown menu in the popup. The user chooses a format; the popup assembles the color array from the current palette and calls the appropriate `ExporterUtils` method. The resulting string is written to the clipboard via `navigator.clipboard.writeText()`.

### Input array preparation

```js
// popup.js builds this from the current palette + overrides
const colorsToExport = currentColors.map(c => ({
  name: c.variable ?? `--color-${c.value.replace('#','')}`,
  value: c.currentValue ?? c.value,   // currentValue = the override if one exists
  source: c.value                      // original extracted hex
}));
```

If **export select mode** is active (only some swatches are checked), the array is filtered to just those selected.

### CSS Variables

```css
:root {
  --primary-color: #ff0000; /* source: #ff0000 */
  --background: #1a1a2e;
}
```

Variable names come from the extracted CSS custom property name, or an auto-generated `--color-rrggbb` fallback.

### JSON Tokens

```json
{
  "primary-color": { "value": "#ff0000", "name": "Red", "source": "#ff0000" },
  "background": { "value": "#1a1a2e", "name": "Space Cadet" }
}
```

Duplicate keys are disambiguated by appending `_1`, `_2`, etc.

### Tailwind Config

```js
module.exports = {
  theme: { extend: { colors: {
    "primary-color": '#ff0000', /* source: #ff0000 */
  }}}
}
/* Arbitrary value usage:  bg-[#ff0000]  text-[#ff0000]  border-[#ff0000] */
```

If no semantic variable name exists, `ColorNames.getName(hex)` provides a friendly key (e.g. `"torch-red"`).

### CMYK

```
/* CMYK Color Palette */
--primary-color: cmyk(0.0%, 100.0%, 100.0%, 0.0%)
```

Converts sRGB → CMYK using the standard device-independent formula:
$$K = 1 - \max(R, G, B), \quad C = \frac{1-R-K}{1-K}$$

### CIE LAB (D65)

```
/* CIE LAB Color Palette (D65) */
--primary: lab(53.23% 80.11 67.22)
```

Conversion: sRGB → linear RGB → XYZ (D65) → CIE LAB using the standard cube-root formula.

### OKLCH

```
/* OKLCH Color Palette */
/* oklch(Lightness  Chroma  Hue) — modern CSS perceptual color */
--primary: oklch(62.8% 0.2577 29.23)
```

Conversion: sRGB → linear RGB → OKLab (via LMS cone space) → polar OKLCH.
$$L' = \sqrt[3]{0.4122 r + 0.5363 g + 0.0514 b} \quad (\text{etc.})$$

### Export History

The last 10 exports are stored in the in-memory `exportHistory` array and shown in the export dropdown as re-copy buttons. They are not persisted to disk.

---

## 13. Advanced Features

### 13.1 Color Clustering

Implemented entirely in `popup.js` via `clusterColors(colors, threshold)`.

Algorithm:
1. Computes pairwise Lab ΔE distance between all colors (using `ColorUtils.colorDistance()`).
2. Groups colors whose distance is ≤ `threshold` (0–30) into clusters using a greedy "union" approach.
3. The most-used color in each cluster becomes the representative.
4. The cluster map `{ memberHex → { sources, color, effectiveValues } }` is stored in `chrome.storage.session` for the dropper to look up.

When enabled, swatches show a "(N merged)" badge indicating how many colors are grouped.

### 13.2 Color Dropper

See [Section 4.6](#46-dropper). The dropper bridges content-script DOM access with the background's cluster knowledge and the sidepanel editor. The full flow:

```
Popup → PICK_COLOR → content → Dropper.start()
  → user clicks element on page
  → Dropper → DROPPER_RESOLVE_CLUSTER → background
  → background looks up clusterMap
  → returns sources to dropper
  → dropper → OPEN_EDITOR_WINDOW → background
  → editor opens with the picked color's full cluster
```

### 13.3 Heatmap

See [Section 4.5](#45-heatmap). Activated from the popup via `TOGGLE_HEATMAP`. Frequency-based: colors used on more elements get brighter/thicker outlines. Processes in 200-element idle-callback batches to prevent freezing large pages.

### 13.4 Before/After Comparison

The Compare button in the popup:
1. Sends `SUSPEND_FOR_COMPARISON` — content.js temporarily removes all PaletteLive override styles and captures a screenshot snapshot.
2. Sends `SHOW_COMPARISON_OVERLAY` — content.js creates a split-screen overlay div (`#palettelive-compare-overlay`) with the before-state on one side and live DOM on the other.
3. A draggable divider lets the user slide left/right.
4. `RESTORE_AFTER_COMPARISON` re-applies all overrides and removes the overlay.

The split is implemented with CSS `clip-path` on a cloned layer, updated via `pointermove`.

### 13.5 SPA / Infinite-Scroll Handling

`content.js` attaches a `MutationObserver` to `document` watching for `childList` and `subtree` changes. Two scenarios are handled:

1. **Route change** (URL changes): Detected by comparing `location.href` before/after a batch of mutations. Triggers a full re-scan after style settle.
2. **New elements added** (infinite scroll): `processAddedSubtree(node)` scans new nodes and applies existing raw overrides to any newly matched colors.

Dead element references are pruned from `colorElementMap` and `overrideRefs` during the 60-second `WeakRef` prune timer to prevent unbounded memory growth.

### 13.6 Shadow DOM Support

`ShadowWalker` traverses all open shadow roots recursively (up to depth 30). `Extractor.scan()` also scans `adoptedStyleSheets` and `<style>` tags inside shadow roots for CSS variable declarations. Closed shadow DOMs are counted but their internals are inaccessible (browser security boundary).

### 13.7 Vision Simulation

The `#vision-select` dropdown in the popup sends a scheme override to content.js which injects an SVG `<filter>` (using `feColorMatrix`) into the page's `<defs>` and applies it via a `<style>` tag (`palettelive-vision`). Supported simulations: Protanopia, Deuteranopia, Tritanopia, Achromatopsia.

### 13.8 Palette Generator

Six color theory algorithms built into popup.js (no DOM involvement):

| Mode | Description |
|---|---|
| Monochromatic | N tints/shades of a base color via HSL lightness steps |
| 60-30-10 | Three user-chosen colors in dominant/secondary/accent proportions |
| Analogous | Colors ±spread° around hue on the color wheel |
| Complementary | Base + opposite (180°) on the color wheel |
| Split-Complementary | Base + two colors ±gap° from its complement |
| Triadic | Three colors 120° apart |

Generated palettes can be applied to the page (sends `APPLY_OVERRIDE_BULK`) or exported in any format.

---

## 14. Security Model

| Threat | Mitigation |
|---|---|
| Page script spoofs dropper events | `CustomEvent` details validated against a per-session `crypto.getRandomValues` secret stored only in content script scope |
| CSS injection via color values | `Injector._sanitizeCSSValue` strips `{ } ; < > " \n \r \` before writing to `<style>` |
| XSS via color names in popup UI | All dynamic text uses `textContent` / `createTextNode`; `escapeHtml()` used wherever string concatenation was unavoidable |
| CSS selector injection | `_sanitizeSelector` strict regex allowlist: only `.pl-[a-zA-Z0-9-]+` with optional pseudo-class |
| Corrupt storage data crash | `StorageUtils._validatePaletteData` discards and removes invalid schemas on read |
| Extension context invalidation | `safeSendRuntimeMessage` catches `"Extension context invalidated"` errors, sets `_plContextInvalidated = true`, and cleanly shuts down all timers and observers |
| Runaway DOM walk | `ShadowWalker.MAX_ELEMENTS = 50000` hard cap; shadow recursion capped at depth 30 |

---

## 15. Error Recovery & Context Invalidation

When Chrome updates or reloads the extension while a tab is open, the content script's extension context becomes invalid. Any further `chrome.runtime.*` calls throw `"Extension context invalidated"`.

`content.js` handles this gracefully:
1. `safeSendRuntimeMessage` wraps every outbound message in a try/catch.
2. On first detection, sets `_plContextInvalidated = true`.
3. Calls `_handleContextInvalidation()` which:
   - Sets `__plPaused = true`  
   - Stops the `MutationObserver`
   - Stops the override watchdog timer
   - Clears all `setTimeout` / `setInterval` handles
   - Clears the `WeakRef` prune timer

The page remains in whatever state it was in (overrides are still applied via inline styles) but no further messages are processed. A page refresh restores the fresh content script.
