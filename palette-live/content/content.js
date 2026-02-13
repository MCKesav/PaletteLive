/**
 * PaletteLive - Content Script
 * Main entry point for the content script bundle.
 */

(function () {
    // Guard against duplicate injection (e.g. extension reload + programmatic inject)
    if (window.__paletteLiveLoaded) return;
    window.__paletteLiveLoaded = true;

    
    console.log('PaletteLive content script loaded');

    // Track which elements map to which original color (for reliable re-coloring)
    // Key: hex color, Value: Array of { element, cssProp }
    const colorElementMap = new Map();

    // Listen for messages from Popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        try {
            if (request.type === 'EXTRACT_PALETTE') {
                if (typeof window.Extractor === 'undefined') {
                    sendResponse({ success: false, error: 'Extractor not loaded' });
                    return;
                }
                window.Extractor.scan().then(data => {
                    buildColorMap();
                    sendResponse({ success: true, data });
                }).catch(err => {
                    sendResponse({ success: false, error: err.message });
                });
                return true; // async response
            }

            if (request.type === 'APPLY_OVERRIDE') {
                if (request.payload.raw) {
                    applyRawOverride(request.payload.raw);
                }
                if (request.payload.variables) {
                    window.Injector.apply({ variables: request.payload.variables });
                }
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'RESET_STYLES') {
                window.Injector.reset();
                document.querySelectorAll('[class*="pl-"]').forEach(el => {
                    const classes = [...el.classList].filter(c => c.startsWith('pl-'));
                    classes.forEach(c => el.classList.remove(c));
                });
                colorElementMap.forEach((entries) => {
                    entries.forEach(({ element, cssProp }) => {
                        try { element.style.removeProperty(cssProp); } catch (e) { }
                    });
                });
                colorElementMap.clear();
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'TOGGLE_HEATMAP') {
                window.Heatmap.toggle(request.payload.active);
                sendResponse({ success: true });
                return;
            }
        } catch (err) {
            console.error('PaletteLive error:', err);
            sendResponse({ success: false, error: err.message });
        }
    });

    /**
     * Build a mapping of color hex -> { elements, properties }
     * Done ONCE after extraction, before any overrides change computed styles.
     */
    function buildColorMap() {
        colorElementMap.clear();
        const props = [
            { js: 'backgroundColor', css: 'background-color' },
            { js: 'color', css: 'color' },
            { js: 'borderTopColor', css: 'border-top-color' },
            { js: 'borderRightColor', css: 'border-right-color' },
            { js: 'borderBottomColor', css: 'border-bottom-color' },
            { js: 'borderLeftColor', css: 'border-left-color' },
            { js: 'outlineColor', css: 'outline-color' },
            { js: 'textDecorationColor', css: 'text-decoration-color' },
            { js: 'caretColor', css: 'caret-color' },
            { js: 'columnRuleColor', css: 'column-rule-color' },
            { js: 'fill', css: 'fill' },
            { js: 'stroke', css: 'stroke' }
        ];
        const accentProp = { js: 'accentColor', css: 'accent-color' };

        window.ShadowWalker.walk(document.body, (el) => {
            try {
                const style = window.getComputedStyle(el);
                const addToMap = (val, cssPropName) => {
                    if (!val || window.ColorUtils.isTransparent(val)) return;
                    if (val === 'auto' || val === 'initial' || val === 'inherit' || val === 'currentcolor' || val === 'currentColor') return;
                    const hex = window.ColorUtils.rgbToHex(val).toLowerCase();
                    if (!hex || (hex === '#000000' && val === 'rgba(0, 0, 0, 0)')) return;
                    if (!colorElementMap.has(hex)) {
                        colorElementMap.set(hex, []);
                    }
                    colorElementMap.get(hex).push({ element: el, cssProp: cssPropName });
                };
                props.forEach(({ js, css }) => addToMap(style[js], css));
                // accent-color needs try/catch (not supported in all contexts)
                try { addToMap(style[accentProp.js], accentProp.css); } catch (e) { }
            } catch (e) { }
        });
        console.log(`PaletteLive: Mapped ${colorElementMap.size} unique colors to elements`);
    }

    /**
     * Apply raw color override using inline styles for maximum reliability.
     */
    function applyRawOverride(data) {
        const { original, current } = data;
        const originalHex = window.ColorUtils.rgbToHex(original).toLowerCase();

        const entries = colorElementMap.get(originalHex);
        if (entries && entries.length > 0) {
            entries.forEach(({ element, cssProp }) => {
                try {
                    element.style.setProperty(cssProp, current, 'important');
                } catch (e) { }
            });
            console.log(`PaletteLive: Applied ${current} to ${entries.length} element-properties for ${originalHex}`);
        } else {
            applyRawOverrideFallback(data);
        }
    }

    /**
     * Fallback: class-based override (for elements not in the map)
     */
    function applyRawOverrideFallback(data) {
        const { original, current } = data;
        const safeId = original.replace(/[^a-zA-Z0-9]/g, '');
        const classMap = {
            backgroundColor: `pl-bg-${safeId}`,
            color: `pl-text-${safeId}`,
            borderTopColor: `pl-bt-${safeId}`,
            borderRightColor: `pl-br-${safeId}`,
            borderBottomColor: `pl-bb-${safeId}`,
            borderLeftColor: `pl-bl-${safeId}`,
            outlineColor: `pl-outline-${safeId}`,
            textDecorationColor: `pl-decoration-${safeId}`,
            fill: `pl-fill-${safeId}`,
            stroke: `pl-stroke-${safeId}`
        };

        window.ShadowWalker.walk(document.body, (el) => {
            try {
                const style = window.getComputedStyle(el);
                const hasClass = Object.values(classMap).some(c => el.classList.contains(c));
                if (hasClass) return;

                if (checkMatch(style.backgroundColor, original)) el.classList.add(classMap.backgroundColor);
                if (checkMatch(style.color, original)) el.classList.add(classMap.color);
                if (checkMatch(style.borderTopColor, original)) el.classList.add(classMap.borderTopColor);
                if (checkMatch(style.borderRightColor, original)) el.classList.add(classMap.borderRightColor);
                if (checkMatch(style.borderBottomColor, original)) el.classList.add(classMap.borderBottomColor);
                if (checkMatch(style.borderLeftColor, original)) el.classList.add(classMap.borderLeftColor);
                if (checkMatch(style.outlineColor, original)) el.classList.add(classMap.outlineColor);
                if (checkMatch(style.textDecorationColor, original)) el.classList.add(classMap.textDecorationColor);
                if (checkMatch(style.fill, original)) el.classList.add(classMap.fill);
                if (checkMatch(style.stroke, original)) el.classList.add(classMap.stroke);
            } catch (e) { }
        });

        const selectors = {};
        selectors[`.${classMap.backgroundColor}`] = { 'background-color': current };
        selectors[`.${classMap.color}`] = { 'color': current };
        selectors[`.${classMap.borderTopColor}`] = { 'border-top-color': current };
        selectors[`.${classMap.borderRightColor}`] = { 'border-right-color': current };
        selectors[`.${classMap.borderBottomColor}`] = { 'border-bottom-color': current };
        selectors[`.${classMap.borderLeftColor}`] = { 'border-left-color': current };
        selectors[`.${classMap.outlineColor}`] = { 'outline-color': current };
        selectors[`.${classMap.textDecorationColor}`] = { 'text-decoration-color': current };
        selectors[`.${classMap.fill}`] = { 'fill': current };
        selectors[`.${classMap.stroke}`] = { 'stroke': current };
        window.Injector.apply({ selectors });
    }

    function checkMatch(computed, target) {
        if (!computed || !target) return false;
        if (window.ColorUtils.isTransparent(computed)) return false;
        const c1 = window.ColorUtils.rgbToHex(computed).toLowerCase();
        const c2 = window.ColorUtils.rgbToHex(target).toLowerCase();
        return c1 === c2;
    }

    // Check for saved palette on load
    const domain = window.location.hostname;
    if (window.StorageUtils) {
        window.StorageUtils.getPalette(domain).then(savedData => {
            if (savedData && savedData.overrides) {
                console.log('Applying saved palette for', domain);
                // Build element map first so inline-style overrides work
                buildColorMap();
                window.Injector.apply(savedData.overrides);
                // Replay saved raw overrides (non-variable color changes)
                if (savedData.overrides.raw) {
                    Object.entries(savedData.overrides.raw).forEach(([original, current]) => {
                        applyRawOverride({ original, current });
                    });
                }
            }
        }).catch(() => { });
    }

    // ── MutationObserver: rebuild color map when DOM changes significantly ──
    // This keeps inline-style overrides working after SPA navigation or AJAX updates.
    let _rebuildTimer = null;
    const observer = new MutationObserver((mutations) => {
        // Only react to added/removed nodes (not attribute changes from our own overrides)
        const dominated = mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0);
        if (!dominated) return;
        clearTimeout(_rebuildTimer);
        _rebuildTimer = setTimeout(() => {
            console.log('PaletteLive: DOM changed, rebuilding color map');
            buildColorMap();
        }, 800);
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
