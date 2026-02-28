# PaletteLive — Full Feature List

## 1. Color Extraction

- Full DOM scan using `getComputedStyle` on every element (including `<html>`)
- Traverses open **Shadow DOM** trees via `ShadowWalker` (depth-limited, element-capped)
- Parses all `document.styleSheets` (including shadow root stylesheets) for raw color values
- Captures colors from pseudo-states (`:hover`, `:focus`, `:active`, `::selection`) and `@keyframes` rules that `getComputedStyle` would miss
- Detects and resolves **CSS custom properties** (`var()`) — records variable name, declared value, and usage count
- Extracts colors from all property types: `background-color`, `color`, `border-*-color`, `outline-color`, `text-decoration-color`, `fill`, `stroke`, `caret-color`, `column-rule-color`, `accent-color`
- Scan result is cached; subsequent requests return instantly without re-walking the DOM
- Color frequency counted per hex; results grouped by semantic category (background, text, border, etc.)

---

## 2. Real-Time Color Override System

- Overrides colors live on the page by patching `element.style` inline (no page reload)
- Falls back to injected CSS class rules when inline style is blocked or insufficient
- **Bulk override pipeline** (4-phase): builds lookup from `colorElementMap` → applies inline overrides → injects fallback CSS classes → writes all CSS rules in one batch `<style>` tag
- Tracks every override in `overrideMap` (WeakMap) and `overrideRefs` (WeakRef array) for precise rollback
- Periodic **WeakRef prune timer** (every 60 s) removes dead references and detached DOM entries
- **Override watchdog** — re-applies all active overrides on a timer to survive CSS re-renders
- **Scroll-based re-application** — re-applies overrides after scroll events for lazy-rendered content
- **Mutation Observer** watches for dynamically added nodes and instantly applies active overrides to new subtrees
- Smart **image-container guard** — rolls back background overrides when they would obscure a media element that fills its container

---

## 3. Color Dropper

- Click any element on the page to pick its computed color
- Full-screen crosshair overlay with a floating color preview swatch and hex label
- Inline floating editor opens at the picked element for immediate color change
- Cancel with Escape; suspends watchdog and mutation observer while active
- Secure custom-event channel (random token) prevents spoofed dropper events

---

## 4. Side Panel Editor

- Chrome side panel opens alongside any page for non-blocking color editing
- Native `<input type="color">` picker with **real-time preview** (RAF-throttled)
- Real-time toggle — live updates on every picker move, or commit only on release
- **WCAG contrast checker**: displays ratio (e.g. `4.52:1`), rating (AA / AAA / Fail), and pass/fail rows for AA Normal, AAA Normal, AA Large, AAA Large
- Shows which CSS variable(s) the selected color maps to
- **Batch apply** — apply the chosen color to all sources that share the same original hex
- Per-color **export toggle** (include or exclude a color from any export)
- Syncs picker state with popup via `chrome.storage.session` and `chrome.runtime` messages

---

## 5. Undo / Redo History

- Full per-source undo/redo stack for all color changes
- Batch history entries for bulk operations (palette apply, import apply)
- Undo/Redo buttons in popup with visual disabled state when stack is empty

---

## 6. Color Clustering

- Groups visually similar colors using **CIEDE2000** perceptual distance + alpha channel
- Two-pass algorithm: greedy assignment then global reassignment to fix order-sensitive mis-assignments
- Weighted centroid recalculation per cluster
- Adaptive threshold for near-neutral/transparent colors
- Cluster threshold **slider** (0–100) with live summary ("X colors merged into Y")
- Three palette render modes selectable from the popup:
    - **Normal** — all colors shown individually
    - **Clustered** — similar colors merged into one representative swatch
    - **Aggressive Merge** — HSL-based hard merge for highly similar hues

---

## 7. Color Palette Generator

Six built-in harmony generators produce ready-to-use palettes from a base color:

| Generator               | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| **Monochromatic**       | N shades of a single hue (count slider 2–12)                      |
| **60-30-10**            | Three-role palette: dominant (60%), secondary (30%), accent (10%) |
| **Analogous**           | Adjacent hues with configurable spread angle                      |
| **Complementary**       | Base hue + opposite hue                                           |
| **Split-Complementary** | Base hue + two hues flanking its complement (gap slider)          |
| **Triadic**             | Three equally-spaced hues (120° apart)                            |

---

## 8. Palette Analysis

Detects whether the current page palette matches a color harmony and shows a scored breakdown:

- 60-30-10 role analysis (dominant / secondary / accent classification)
- Monochromatic analysis (hue consistency, lightness spread)
- Analogous analysis (hue proximity, spread angle)
- Complementary analysis (opposite-hue detection)
- Split-complementary analysis
- Triadic analysis

---

## 9. Import Palette & Auto-Apply

- **Import from file** (file picker, any text-based format)
- **Import from clipboard** (modal textarea with paste button)
- Format selector for parsing: CSS variables, JSON tokens, plain hex list, etc.
- **Auto-map mode** — maps imported palette onto page colors using contrast-relationship preservation:
    1. Clusters page colors
    2. 1:1 luminance-proximity assignment of anchor colors
    3. Detects broken contrast pairs post-mapping
    4. Repairs broken pairs by choosing the import color that best restores contrast
    5. Maps all remaining clusters to nearest palette color
- **Manual-map mode** — user provides an ordered hex list; extension assigns by role scoring (background / text / accent heuristics via HSL analysis)
- Preview chips shown before applying

---

## 10. Export

Six export formats, all accessible from the popup export menu:

| Format              | Output                                                            |
| ------------------- | ----------------------------------------------------------------- |
| **CSS Variables**   | `:root { --name: value; }` with source comments                   |
| **JSON Tokens**     | Design token JSON with `value`, `source`, and color name fields   |
| **Tailwind Config** | `module.exports` config block with arbitrary value usage examples |
| **CMYK**            | Device-independent CMYK approximation as CSS-comment palette      |
| **CIE LAB**         | `lab(L% a b)` values (D50 illuminant)                             |
| **OKLCH**           | `oklch(L% C H)` perceptually-uniform modern CSS values            |

> **Copy to clipboard** is a delivery method available for any format, not a separate format.

- **Export history** — last N exports saved with timestamp, format, and color count; reopenable from the export menu
- Per-color export checkbox to include/exclude individual swatches
- Alpha channel preserved in export values

---

## 11. Heatmap

- Overlays colored outlines on every element that has a non-default color
- Hover tooltip shows hex values for all color properties (bg, text, border, outline, etc.)
- Primary hue of each element determines outline color (perceptual heat visualization)
- Processed in async batches of 200 elements to keep the page responsive
- Bails out instantly if toggled off mid-render

---

## 12. Before / After Comparison

- Toggle captures a screenshot of the visible viewport before any overrides
- Splits the screen with an animated sliding divider: **left = original**, **right = current**
- Handles iframes, background images, and CSS gradient backgrounds
- Suspends active overrides during capture so the "before" screenshot is truly clean

---

## 13. Accessibility — Automatic Text Contrast Enforcement

- After any color override, schedules 3 contrast-enforcement passes (immediate, deferred, idle)
- Walks all text elements in the affected subtree
- Picks the best palette color as a text color replacement that satisfies WCAG AA (4.5:1 normal, 3:1 large)
- Accounts for alpha compositing and gradient backgrounds when computing effective background
- Shared `bgCache` (`WeakMap`) across passes to avoid redundant `getComputedStyle` calls

---

## 14. Vision Simulation (Color Blindness)

- Applies SVG filter overlays to simulate vision deficiencies:
    - Protanopia, Deuteranopia, Tritanopia (and more based on selector options)
- Toggle via the vision dropdown in the popup
- Injected as `<feColorMatrix>` SVG filter in a `<defs>` block applied to the page root

---

## 15. Color Scheme Override

- Force a page into **light mode** or **dark mode** via injected `color-scheme` CSS
- Useful for testing dark-mode palette behavior on pages that follow `prefers-color-scheme`

---

## 16. Persistence & Per-Domain State

- All overrides, palette data, and settings saved to `chrome.storage.local` keyed by domain
- **Auto-resume after reload** — re-applies saved palette automatically when the page reloads
- **SPA route detection** — patches `history.pushState` / `history.replaceState` (double-patch guarded) and listens to `popstate` to re-apply palette on route changes
- **BFCache restoration** — listens for `pageshow` events to re-apply after back/forward navigation restores a frozen page
- **Multi-tab sync** — storage change listener propagates updates across tabs of the same domain
- Per-domain **power toggle** — disable PaletteLive entirely for a specific domain without losing saved data

---

## 17. Popup UI Utilities

- **Dark / Light / Auto theme** toggle for the popup itself (three-state cycle)
- **Palette summary bar** — shows total colors found and active filter/mode
- **Footer notices** — transient status messages for scan, export, import, and error events
- **Disabled banner** — shown when the extension is powered off for the current domain
- **Force Re-apply button** — manually re-triggers all active overrides

---

## 18. Architecture & Infrastructure

- Chrome Extension **Manifest V3** with a background service worker, popup, side panel, and content scripts
- Content scripts injected at `document_idle` into all frames (`all_frames: true`)
- **Re-injection guard** — version-stamped globals prevent duplicate script execution after extension updates
- `ShadowWalker` — standalone module for depth-limited, element-capped open Shadow DOM traversal with early-exit callback support
- `ColorUtils` — shared utility module: hex ↔ RGB, hex8, transparency detection, `rgbToHex8` memoization cache
- `ColorNames` — maps hex values to human-readable color names
- `ContrastUtils` — WCAG contrast ratio calculations
- `ExporterUtils` — all export format converters
- `PLConfig` / `PLLog` — shared configuration constants and logging utility
- `MessageTypes` enum — typed constants for all cross-script messages (prevents typo bugs)
- **185 unit tests** across 10 test suites (Jest), ~82% statement coverage
