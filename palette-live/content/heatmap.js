/**
 * PaletteLive - Heatmap
 * Visualizes color usage on the page by highlighting elements with
 * colored outlines and hover tooltips for all color types.
 */

// Guard against re-injection - use version to allow updates
const _HEATMAP_VERSION = 4;
if (window._heatmapVersion === _HEATMAP_VERSION) {
  // Already loaded with same version
} else {
  window._heatmapVersion = _HEATMAP_VERSION;

const Heatmap = {
    isActive: false,
    styleId: 'palettelive-heatmap-style',
    _elements: [],

    toggle: (active) => {
        Heatmap.isActive = active;
        if (active) {
            // show() is async; fire-and-forget is intentional here
            Heatmap.show().catch(err => console.warn('PaletteLive Heatmap: show() failed', err));
        } else {
            Heatmap.hide();
        }
    },

    // Helper: yield to the browser so it can process events between batches
    _yield: () => new Promise(resolve => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(resolve, { timeout: 100 });
        } else {
            setTimeout(resolve, 0);
        }
    }),

    show: async () => {
        if (!window.ShadowWalker || !window.ColorUtils) {
            console.warn('PaletteLive Heatmap: Missing dependencies (ShadowWalker or ColorUtils)');
            return;
        }

        let style = document.getElementById(Heatmap.styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = Heatmap.styleId;
            document.head.appendChild(style);
        }

        Heatmap._cleanup();

        let elements;
        try {
            elements = window.ShadowWalker.getAllElements();
        } catch (error) {
            console.warn('PaletteLive Heatmap: Could not walk DOM', error);
            return;
        }

        const candidates = [];
        const colorFrequency = new Map();

        // Process elements in batches so the page stays responsive
        const BATCH_SIZE = 200;
        for (let i = 0; i < elements.length; i += BATCH_SIZE) {
            // Yield before every batch (including the first)
            await Heatmap._yield();

            // If heatmap was toggled off while we were processing, bail out
            if (!Heatmap.isActive) return;

            const batch = elements.slice(i, i + BATCH_SIZE);
            for (const el of batch) {
                try {
                    const cs = window.getComputedStyle(el);
                    const labels = [];
                    let primaryHex = null;

                    const bg = cs.backgroundColor;
                    if (bg && !window.ColorUtils.isTransparent(bg)) {
                        const hex = window.ColorUtils.rgbToHex8(bg).toLowerCase();
                        if (hex !== '#ffffff' && hex !== '#fefefe' && hex !== '#fdfdfd') {
                            labels.push('bg: ' + hex);
                            if (!primaryHex) primaryHex = hex;
                        }
                    }

                    const text = cs.color;
                    if (text && !window.ColorUtils.isTransparent(text)) {
                        const hex = window.ColorUtils.rgbToHex8(text).toLowerCase();
                        if (hex !== '#000000') {
                            labels.push('text: ' + hex);
                            if (!primaryHex) primaryHex = hex;
                        }
                    }

                    const borderProps = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
                    const seenBorders = new Set();
                    for (const border of borderProps) {
                        if (!border || window.ColorUtils.isTransparent(border)) continue;
                        const hex = window.ColorUtils.rgbToHex8(border).toLowerCase();
                        if (seenBorders.has(hex)) continue;
                        seenBorders.add(hex);
                        labels.push('border: ' + hex);
                        if (!primaryHex) primaryHex = hex;
                    }

                    const outline = cs.outlineColor;
                    if (outline && !window.ColorUtils.isTransparent(outline)) {
                        const hex = window.ColorUtils.rgbToHex8(outline).toLowerCase();
                        if (hex !== '#000000') {
                            labels.push('outline: ' + hex);
                            if (!primaryHex) primaryHex = hex;
                        }
                    }

                    if (el instanceof SVGElement) {
                        const fill = cs.fill;
                        if (fill && !window.ColorUtils.isTransparent(fill) && fill !== 'none') {
                            const hex = window.ColorUtils.rgbToHex8(fill).toLowerCase();
                            labels.push('fill: ' + hex);
                            if (!primaryHex) primaryHex = hex;
                        }

                        const stroke = cs.stroke;
                        if (stroke && !window.ColorUtils.isTransparent(stroke) && stroke !== 'none') {
                            const hex = window.ColorUtils.rgbToHex8(stroke).toLowerCase();
                            labels.push('stroke: ' + hex);
                            if (!primaryHex) primaryHex = hex;
                        }
                    }

                    if (!labels.length) continue;

                    const safeHex = primaryHex || '#6366f1';
                    colorFrequency.set(safeHex, (colorFrequency.get(safeHex) || 0) + 1);
                    candidates.push({ el, primaryHex: safeHex, labels });
                } catch (error) {
                    // Ignore per-element failures.
                }
            }
        }

        // Bail out if deactivated during element scanning
        if (!Heatmap.isActive) return;

        const frequencies = Array.from(colorFrequency.values());
        const minFrequency = frequencies.length ? Math.min(...frequencies) : 1;
        const maxFrequency = frequencies.length ? Math.max(...frequencies) : 1;

        for (const candidate of candidates) {
            const { el, primaryHex } = candidate;
            const frequency = colorFrequency.get(primaryHex) || 1;
            const normalized = maxFrequency === minFrequency
                ? 1
                : ((frequency - minFrequency) / Math.max(1, maxFrequency - minFrequency));

            const alpha = 0.22 + (normalized * 0.56); // 0.22..0.78
            const spread = 1.5 + (normalized * 4.5); // 1.5px..6px
            const rgb = window.ColorUtils.hexToRgb(primaryHex);
            const overlay = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(3)})`;

            el.setAttribute('data-pl-heat', '');
            el.style.setProperty('--pl-heat-color', primaryHex);
            el.style.setProperty('--pl-heat-overlay', overlay);
            el.style.setProperty('--pl-heat-spread', `${spread.toFixed(1)}px`);

            const origTitle = el.getAttribute('title');
            if (origTitle !== null) {
                el.setAttribute('data-pl-orig-title', origTitle);
            }
            el.setAttribute('title', [`freq: ${frequency}`, ...candidate.labels].join(' | '));

            Heatmap._elements.push(el);
        }

        style.textContent = [
            '[data-pl-heat] {',
            '  outline: 2px solid var(--pl-heat-color, #6366f1) !important;',
            '  outline-offset: -1px !important;',
            '  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 var(--pl-heat-spread, 2px) var(--pl-heat-overlay, rgba(99,102,241,0.3)) !important;',
            '}'
        ].join('\n');

        console.log(`PaletteLive Heatmap: ${candidates.length} elements highlighted across ${colorFrequency.size} colors`);
    },

    hide: () => {
        const style = document.getElementById(Heatmap.styleId);
        if (style) style.textContent = '';
        Heatmap._cleanup();
    },

    _cleanup: () => {
        for (const el of Heatmap._elements) {
            try {
                el.removeAttribute('data-pl-heat');
                el.style.removeProperty('--pl-heat-color');
                el.style.removeProperty('--pl-heat-overlay');
                el.style.removeProperty('--pl-heat-spread');

                if (el.hasAttribute('data-pl-orig-title')) {
                    el.setAttribute('title', el.getAttribute('data-pl-orig-title'));
                    el.removeAttribute('data-pl-orig-title');
                } else {
                    el.removeAttribute('title');
                }
            } catch (error) {
                // Ignore per-element cleanup failures.
            }
        }

        try {
            document.querySelectorAll('[data-pl-heat]').forEach(el => {
                try {
                    el.removeAttribute('data-pl-heat');
                    el.style.removeProperty('--pl-heat-color');
                    el.style.removeProperty('--pl-heat-overlay');
                    el.style.removeProperty('--pl-heat-spread');

                    if (el.hasAttribute('data-pl-orig-title')) {
                        el.setAttribute('title', el.getAttribute('data-pl-orig-title'));
                        el.removeAttribute('data-pl-orig-title');
                    } else {
                        el.removeAttribute('title');
                    }
                } catch (error) {
                    // Ignore cleanup failures for detached nodes.
                }
            });
        } catch (error) {
            // Ignore query failures.
        }

        Heatmap._elements = [];
    }
};

window.Heatmap = Heatmap;

} // end re-injection guard
