/**
 * PaletteLive - Content Script
 * Main entry point for the content script bundle.
 */

(function () {
    // Guard against duplicate injection (e.g. extension reload + programmatic inject)
    // Use a version number to allow re-injection after updates
    const CONTENT_SCRIPT_VERSION = 3;
    if (window.__paletteLiveLoaded === CONTENT_SCRIPT_VERSION) return;
    window.__paletteLiveLoaded = CONTENT_SCRIPT_VERSION;
    window.__paletteLiveReady = false; // Will be set true after full initialization

    console.log('PaletteLive content script loaded (v' + CONTENT_SCRIPT_VERSION + ')');

    // Generate a secret token for secure dropper events (prevents spoofed DOM events)
    const _plDropperSecret = crypto.getRandomValues(new Uint32Array(4)).join('-');

    // Helper to validate dropper events
    function isValidDropperEvent(event) {
        // Note: CustomEvents dispatched programmatically have isTrusted=false,
        // so we rely solely on the secret token for validation.
        const detail = event.detail || {};
        return detail._plSecret === _plDropperSecret;
    }

    // Helper for Dropper to dispatch secure events
    function dispatchSecureDropperEvent(eventName, data) {
        window.dispatchEvent(new CustomEvent(eventName, {
            detail: { ...data, _plSecret: _plDropperSecret }
        }));
    }

    // Key: normalized source hex color, Value: Array of { element, cssProp }
    const colorElementMap = new Map();

    // WeakMap<Element, Map<cssProp, { hadInline, value, priority }>>
    const overrideMap = new WeakMap();
    let overrideRefs = [];

    // Track fallback classes that PaletteLive adds so reset removes only our classes.
    const addedFallbackClasses = new Set();

    // Highlight state
    const highlightedElements = new Set();
    const highlightStyleId = 'palettelive-highlight-style';

    // Color scheme override state
    const schemeStyleId = 'palettelive-scheme';
    const visionStyleId = 'palettelive-vision';
    const visionDefsId = 'palettelive-vision-defs';

    // Raw color override state (original -> current)
    const rawOverrideState = new Map();

    // Before/after comparison overlay state
    const comparisonOverlayId = 'palettelive-compare-overlay';
    const comparisonStyleId = 'palettelive-compare-style';
    let comparisonSnapshot = null;
    let comparisonPointerCleanup = null;

    // Rescanning guard prevents APPLY_OVERRIDE racing with RESET_AND_RESCAN
    let isRescanning = false;
    const pendingOverrides = [];

    // Paused state — when true, all background activity is suspended
    let __plPaused = false;

    // ── Image container detection ──────────────────────────────────
    // Media tag names that display images/video — background-color overrides
    // on these or their containers would hide their visual content.
    const _MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SOURCE']);

    /**
     * Returns true if the element is a media element or directly wraps one
     * (up to `depth` levels of descendants).  Used to skip background-color
     * overrides that would obscure the image/video content.
     */
    function _isImageContainer(element) {
        if (_MEDIA_TAGS.has(element.tagName)) return true;
        // Also skip if element has a background-image url (image set via CSS)
        try {
            const bgImg = window.getComputedStyle(element).backgroundImage;
            if (bgImg && bgImg !== 'none' && bgImg.includes('url(')) return true;
        } catch (e) { /* ignore */ }
        return _hasMediaDescendant(element, 3);
    }

    function _hasMediaDescendant(element, depth) {
        if (depth <= 0) return false;
        const children = element.children;
        if (!children) return false;
        for (let i = 0; i < children.length; i++) {
            if (_MEDIA_TAGS.has(children[i].tagName)) return true;
            if (_hasMediaDescendant(children[i], depth - 1)) return true;
        }
        return false;
    }

    /**
     * When a new media element (or subtree containing one) is added to the DOM,
     * walk up the ancestor chain and remove any PaletteLive background-color
     * overrides so the image/video is visible.
     */
    function _undoBgOverridesForMedia(mediaElement) {
        let parent = mediaElement.parentElement;
        for (let i = 0; i < 5 && parent && parent !== document.documentElement; i++) {
            // Revert inline background-color override
            const propMap = overrideMap.get(parent);
            if (propMap && propMap.has('background-color')) {
                const snapshot = propMap.get('background-color');
                restoreInlineSnapshot(parent, 'background-color', snapshot);
                propMap.delete('background-color');
                // Also restore background-image if we cleared it
                if (propMap.has('background-image')) {
                    const bgImgSnap = propMap.get('background-image');
                    restoreInlineSnapshot(parent, 'background-image', bgImgSnap);
                    propMap.delete('background-image');
                }
                if (propMap.size === 0) overrideMap.delete(parent);
            }
            // Remove fallback CSS classes (pl-bg-*)
            const toRemove = [];
            parent.classList.forEach(cls => {
                if (cls.startsWith('pl-bg-')) toRemove.push(cls);
            });
            toRemove.forEach(cls => parent.classList.remove(cls));
            parent = parent.parentElement;
        }
    }

    // SPA watcher
    let observer = null;
    let rebuildTimer = null;

    // CSS property name to JS camelCase converter
    function cssPropToJs(cssProp) {
        return cssProp.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }

    function waitForStyleSettle() {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });
    }

    function flushPendingOverrides() {
        while (pendingOverrides.length) {
            const { payload, respond } = pendingOverrides.shift();
            try {
                applyOverridePayload(payload || {});
                respond({ success: true });
            } catch (error) {
                respond({ success: false, error: error.message });
            }
        }
    }

    function ensureColorMap() {
        if (!colorElementMap.size) {
            buildColorMap();
        }
    }

    function ensureStyleElement(styleId) {
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            (document.head || document.documentElement).appendChild(style);
        }
        return style;
    }

    function setColorScheme(mode) {
        const safeMode = mode === 'dark' || mode === 'light' ? mode : 'auto';
        const style = ensureStyleElement(schemeStyleId);

        if (safeMode === 'auto') {
            style.textContent = '';
            document.documentElement.style.removeProperty('color-scheme');
            return 'auto';
        }

        style.textContent = `:root { color-scheme: ${safeMode} !important; }`;
        document.documentElement.style.setProperty('color-scheme', safeMode, 'important');
        return safeMode;
    }

    function ensureVisionDefs() {
        if (document.getElementById(visionDefsId)) return;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', visionDefsId);
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        svg.style.width = '0';
        svg.style.height = '0';
        svg.style.pointerEvents = 'none';

        svg.innerHTML = [
            '<defs>',
            '<filter id="pl-vision-protanopia"><feColorMatrix type="matrix" values="0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0"/></filter>',
            '<filter id="pl-vision-deuteranopia"><feColorMatrix type="matrix" values="0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0"/></filter>',
            '<filter id="pl-vision-tritanopia"><feColorMatrix type="matrix" values="0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0"/></filter>',
            '<filter id="pl-vision-achromatopsia"><feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"/></filter>',
            '</defs>'
        ].join('');

        document.documentElement.appendChild(svg);
    }

    function setVisionMode(mode) {
        const supportedModes = new Set(['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']);
        const safeMode = supportedModes.has(mode) ? mode : 'none';
        const style = ensureStyleElement(visionStyleId);

        if (safeMode === 'none') {
            style.textContent = '';
            document.documentElement.style.removeProperty('filter');
            return 'none';
        }

        ensureVisionDefs();
        style.textContent = `html { filter: url("#pl-vision-${safeMode}") !important; }`;
        document.documentElement.style.setProperty('filter', `url("#pl-vision-${safeMode}")`, 'important');
        return safeMode;
    }

    function removeVariableOverrides(variableNames) {
        if (!Array.isArray(variableNames) || !window.Injector || !window.Injector.state) return;

        let changed = false;
        variableNames.forEach(name => {
            if (Object.prototype.hasOwnProperty.call(window.Injector.state.variables, name)) {
                delete window.Injector.state.variables[name];
                changed = true;
            }
        });

        if (changed) {
            window.Injector.apply({});
        }
    }

    function applyOverridePayload(payload) {
        let totalApplied = 0;
        if (payload.raw) {
            // Handle batched overrides (array of raw overrides)
            if (Array.isArray(payload.raw)) {
                payload.raw.forEach(raw => {
                    totalApplied += applyRawOverride(raw) || 0;
                });
            } else {
                totalApplied += applyRawOverride(payload.raw) || 0;
            }
        }
        if (payload.variables) {
            if (window.Injector && typeof window.Injector.apply === 'function') {
                window.Injector.apply({ variables: payload.variables });
            } else {
                console.warn('PaletteLive: Injector not available, skipping variable apply');
            }
        }
        if (payload.removeVariables) {
            removeVariableOverrides(payload.removeVariables);
        }
        return totalApplied;
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        try {
            // Ping to check if content script is ready
            if (request.type === 'PING') {
                sendResponse({
                    success: true,
                    ready: window.__paletteLiveReady === true,
                    hasExtractor: typeof window.Extractor !== 'undefined',
                    hasShadowWalker: typeof window.ShadowWalker !== 'undefined',
                    hasEditorPanel: typeof window.EditorPanel !== 'undefined',
                    paused: __plPaused
                });
                return false;
            }

            // Pause extension — stop all background activity
            if (request.type === 'PAUSE_EXTENSION') {
                __plPaused = true;
                stopObserver();
                stopOverrideWatchdog();
                clearTimeout(rebuildTimer);
                clearTimeout(_plScrollReapplyTimer);
                clearTimeout(_plRouteTimer);
                console.log('PaletteLive: Extension paused on this page');
                sendResponse({ success: true });
                return;
            }

            // Resume extension — restart background activity
            if (request.type === 'RESUME_EXTENSION') {
                __plPaused = false;
                startObserver();
                if (rawOverrideState.size > 0) {
                    startOverrideWatchdog();
                }
                console.log('PaletteLive: Extension resumed on this page');
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'OPEN_EDITOR_PANEL') {
                if (!window.EditorPanel) {
                    sendResponse({ success: false, error: 'EditorPanel not loaded' });
                    return;
                }
                window.EditorPanel.show(request.payload || {});
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'EXTRACT_PALETTE') {
                if (typeof window.Extractor === 'undefined') {
                    console.warn('PaletteLive: Extractor not available yet');
                    sendResponse({ success: false, error: 'Extractor not loaded. Please try again.' });
                    return false;
                }
                if (typeof window.ShadowWalker === 'undefined') {
                    console.warn('PaletteLive: ShadowWalker not available yet');
                    sendResponse({ success: false, error: 'ShadowWalker not loaded. Please try again.' });
                    return false;
                }

                window.Extractor.scan()
                    .then(data => {
                        try {
                            buildColorMap();
                        } catch (mapError) {
                            console.error('PaletteLive: buildColorMap error:', mapError);
                        }
                        sendResponse({ success: true, data });
                    })
                    .catch(error => {
                        console.error('PaletteLive: Extraction failed:', error);
                        sendResponse({ success: false, error: error.message || 'Extraction failed' });
                    });
                return true;
            }

            if (request.type === 'APPLY_OVERRIDE') {
                if (isRescanning) {
                    pendingOverrides.push({ payload: request.payload, respond: sendResponse });
                    return true;
                }

                const appliedCount = applyOverridePayload(request.payload || {});
                sendResponse({ success: true, appliedCount });
                return;
            }

            // Bulk override path — applies many overrides in ONE DOM walk
            // instead of N separate walks. Used by Apply Palette feature.
            if (request.type === 'APPLY_OVERRIDE_BULK') {
                if (isRescanning) {
                    pendingOverrides.push({ payload: request.payload, respond: sendResponse });
                    return true;
                }
                const payload = request.payload || {};
                const rawArray = Array.isArray(payload.raw) ? payload.raw : [];
                // Set palette hexes BEFORE applying so the proactive
                // _fixChildTextContrast helper has access during override application
                if (Array.isArray(payload.paletteHexes) && payload.paletteHexes.length) {
                    _lastPaletteHexes = payload.paletteHexes;
                }
                const appliedCount = applyBulkRawOverrides(rawArray);

                // Apply variables in one go
                if (payload.variables && window.Injector && typeof window.Injector.apply === 'function') {
                    window.Injector.apply({ variables: payload.variables });
                }

                // Post-apply: enforce text readability against effective backgrounds
                if (Array.isArray(payload.paletteHexes) && payload.paletteHexes.length) {
                    // Store for re-runs after reapplyAllOverrides / scroll
                    _lastPaletteHexes = payload.paletteHexes;
                    // Reset tracking for fresh palette application
                    _textContrastFixed = new WeakSet();
                    _flushContrastCache();
                    // Three passes — each flushes the bg cache so post-override
                    // backgrounds are read fresh (not stale pre-override values).
                    // Pass 1 (150ms): after inline styles settle
                    // Pass 2 (500ms): after CSS transitions complete
                    // Pass 3 (idle):  after page fully idle
                    setTimeout(() => {
                        _bgCache = new WeakMap();
                        enforceTextContrast(payload.paletteHexes);
                    }, 150);
                    setTimeout(() => {
                        if (_lastPaletteHexes === payload.paletteHexes) {
                            _bgCache = new WeakMap();
                            enforceTextContrast(payload.paletteHexes);
                        }
                    }, 500);
                    // Idle pass — fires when the browser has no urgent work
                    const idleCb = typeof requestIdleCallback === 'function'
                        ? requestIdleCallback
                        : (fn) => setTimeout(fn, 2000);
                    idleCb(() => {
                        if (_lastPaletteHexes === payload.paletteHexes) {
                            _bgCache = new WeakMap();
                            enforceTextContrast(payload.paletteHexes);
                        }
                    }, { timeout: 3000 });
                }

                sendResponse({ success: true, appliedCount });
                return;
            }

            // Fast override path — lightweight setProperty only, no fallback CSS,
            // no colorMap rebuild. Used during real-time color picker drag.
            if (request.type === 'APPLY_OVERRIDE_FAST') {
                const data = request.payload || {};
                if (!data.original || !data.current) {
                    sendResponse({ success: false, appliedCount: 0 });
                    return;
                }
                let appliedCount = 0;
                performDOMChange(() => {
                    ensureColorMap();
                    const originalHex = window.ColorUtils.rgbToHex8(data.original).toLowerCase();
                    const currentHex = window.ColorUtils.rgbToHex8(data.current).toLowerCase();
                    const entries = colorElementMap.get(originalHex);
                    if (entries && entries.length) {
                        entries.forEach(({ element, cssProp }) => {
                            try {
                                // Skip bg-color on image containers — would hide the image
                                if (cssProp === 'background-color' && _isImageContainer(element)) return;
                                element.style.setProperty(cssProp, currentHex, 'important');
                                if (cssProp === 'background-color') {
                                    const origBgImg = window.getComputedStyle(element).backgroundImage;
                                    if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                        element.style.setProperty('background-image', 'none', 'important');
                                    }
                                }
                                appliedCount++;
                            } catch (e) { /* ignore */ }
                        });
                    }
                    // Update state so watchdog doesn't revert
                    rawOverrideState.set(originalHex, currentHex);

                    // Also update variable if provided
                    if (data.variableName) {
                        document.documentElement.style.setProperty(data.variableName, currentHex, 'important');
                    }
                });
                sendResponse({ success: true, appliedCount });
                return;
            }

            if (request.type === 'REMOVE_RAW_OVERRIDE') {
                const payload = request.payload || {};
                if (payload.original) {
                    removeRawOverride(payload.original);
                }
                if (payload.removeVariables) {
                    removeVariableOverrides(payload.removeVariables);
                }
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'RESET_STYLES') {
                resetAllOverrides({ preserveScheme: false });
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'RESET_AND_RESCAN') {
                const preserveScheme = !!(request.payload && request.payload.preserveScheme);
                const preserveVision = !!(request.payload && request.payload.preserveVision);
                isRescanning = true;
                resetAllOverrides({ preserveScheme, preserveVision });

                if (typeof window.Extractor === 'undefined') {
                    isRescanning = false;
                    flushPendingOverrides();
                    sendResponse({ success: false, error: 'Extractor not loaded' });
                    return;
                }

                waitForStyleSettle()
                    .then(() => window.Extractor.scan())
                    .then(data => {
                        try {
                            buildColorMap();
                        } catch (mapError) {
                            console.error('PaletteLive: buildColorMap error:', mapError);
                        }
                        isRescanning = false;
                        flushPendingOverrides();
                        sendResponse({ success: true, data });
                    })
                    .catch(error => {
                        isRescanning = false;
                        flushPendingOverrides();
                        sendResponse({ success: false, error: error.message || 'Reset+rescan failed' });
                    });
                return true;
            }

            // Rescan colors WITHOUT resetting any overrides
            if (request.type === 'RESCAN_ONLY') {
                if (typeof window.Extractor === 'undefined') {
                    sendResponse({ success: false, error: 'Extractor not loaded' });
                    return;
                }

                isRescanning = true;
                // Suspend watchdog & scroll reapply during heavy rescan work
                stopOverrideWatchdog();
                clearTimeout(_plScrollReapplyTimer);

                waitForStyleSettle()
                    .then(() => window.Extractor.scan())
                    .then(data => {
                        try {
                            // buildColorMap() already calls reapplyAllOverrides() internally,
                            // which handles inline style re-application for all mapped elements.
                            buildColorMap();
                            // Refresh fallback CSS rules in one batch — NO per-override DOM walk.
                            batchRefreshFallbackCSS();
                        } catch (mapError) {
                            console.error('PaletteLive: buildColorMap/fallback error:', mapError);
                        }
                        isRescanning = false;
                        flushPendingOverrides();
                        // Restart background monitors
                        if (rawOverrideState.size > 0) startOverrideWatchdog();
                        sendResponse({ success: true, data });
                    })
                    .catch(error => {
                        isRescanning = false;
                        flushPendingOverrides();
                        if (rawOverrideState.size > 0) startOverrideWatchdog();
                        sendResponse({ success: false, error: error.message || 'Rescan failed' });
                    });
                return true;
            }

            // Force-reapply all overrides:  rebuild the color map from scratch and
            // aggressively re-apply every saved override (inline + fallback CSS).
            if (request.type === 'FORCE_REAPPLY') {
                try {
                    let applied = 0;
                    performDOMChange(() => {
                        buildColorMap();
                        rawOverrideState.forEach((currentHex, originalHex) => {
                            const entries = colorElementMap.get(originalHex);
                            if (entries && entries.length) {
                                entries.forEach(({ element, cssProp }) => {
                                    try {
                                        if (cssProp === 'background-color' && _isImageContainer(element)) return;
                                        captureInlineSnapshot(element, cssProp);
                                        if (element.style.getPropertyPriority(cssProp) === 'important') {
                                            element.style.removeProperty(cssProp);
                                        }
                                        element.style.setProperty(cssProp, currentHex, 'important');
                                        if (cssProp === 'background-color') {
                                            const origBgImg = window.getComputedStyle(element).backgroundImage;
                                            if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                                captureInlineSnapshot(element, 'background-image');
                                                element.style.setProperty('background-image', 'none', 'important');
                                            }
                                        }
                                        applied++;
                                    } catch (e) { /* ignore */ }
                                });
                            }
                        });
                        // Refresh all fallback CSS rules in one batch — NO per-override DOM walk
                        batchRefreshFallbackCSS();
                    });
                    console.log(`PaletteLive: Force-reapplied ${applied} element-properties + fallback CSS`);
                    sendResponse({ success: true, applied });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
                return;
            }

            if (request.type === 'TOGGLE_HEATMAP') {
                if (isRescanning) {
                    sendResponse({ success: false, error: 'Rescan in progress, try again' });
                    return;
                }
                if (!window.Heatmap) {
                    sendResponse({ success: false, error: 'Heatmap not available' });
                    return;
                }
                window.Heatmap.toggle(!!(request.payload && request.payload.active));
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'HIGHLIGHT_ELEMENTS') {
                const color = request.payload && request.payload.color;
                highlightColor(color);
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'UNHIGHLIGHT') {
                clearHighlight();
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'SET_COLOR_SCHEME') {
                const mode = request.payload && request.payload.mode;
                const appliedMode = setColorScheme(mode);
                sendResponse({ success: true, mode: appliedMode });
                return;
            }

            if (request.type === 'SET_VISION_MODE') {
                const mode = request.payload && request.payload.mode;
                const appliedMode = setVisionMode(mode);
                sendResponse({ success: true, mode: appliedMode });
                return;
            }

            if (request.type === 'SUSPEND_FOR_COMPARISON') {
                suspendForComparison();
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'WAIT_FOR_PAINT') {
                // Use double requestAnimationFrame + a small timeout to guarantee
                // the browser has fully composited and painted the current state.
                // This is critical for comparison: after removing overrides, we need
                // the visual frame to update before capturing a screenshot.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            sendResponse({ success: true });
                        }, 50);
                    });
                });
                return true; // keep sendResponse alive (async)
            }

            if (request.type === 'RESTORE_AFTER_COMPARISON') {
                restoreAfterComparison();
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'SHOW_COMPARISON_OVERLAY') {
                showComparisonOverlay(request.payload || {});
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'HIDE_COMPARISON_OVERLAY') {
                hideComparisonOverlay();
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'PICK_COLOR') {
                if (!window.Dropper) {
                    sendResponse({ success: false, error: 'Dropper not loaded' });
                    return;
                }
                // Rebuild color map so dynamically loaded elements are captured
                buildColorMap();
                window.Dropper.start();
                sendResponse({ success: true });
                return;
            }

            if (request.type === 'CANCEL_PICK') {
                if (window.Dropper) window.Dropper.cancel();
                sendResponse({ success: true });
                return;
            }
        } catch (error) {
            console.error('PaletteLive error:', error);
            sendResponse({ success: false, error: error.message });
        }
    });

    function buildColorMap() {
        colorElementMap.clear();
        if (!document.body) return;

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

        // Also scan document.documentElement (<html>) because many pages set
        // their primary background color on <html>, and ShadowWalker starts
        // from document.body, which misses it.
        const scanDocumentElement = (addToMapFn) => {
            if (!document.documentElement) return;
            try {
                const style = window.getComputedStyle(document.documentElement);
                props.forEach(({ js, css }) => addToMapFn(style[js], css, document.documentElement));
                try {
                    addToMapFn(style[accentProp.js], accentProp.css, document.documentElement);
                } catch (e) { /* ignore */ }
            } catch (e) { /* ignore */ }
        };

        if (window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
            const addToMap = (value, cssPropName, el) => {
                if (!value || window.ColorUtils.isTransparent(value)) return;
                if (value === 'auto' || value === 'initial' || value === 'inherit' || value === 'currentcolor' || value === 'currentColor') return;

                // Skip reading 'color' from elements whose text was fixed by
                // enforceTextContrast — the computed value is the contrast-fixed
                // color (e.g. #ffffff), NOT the original page color.  Mapping it
                // would pollute colorElementMap with phantom associations that
                // cause wrong overrides on subsequent reapplyAllOverrides calls.
                if (cssPropName === 'color' && el && _textContrastFixed.has(el)) return;

                const hex = window.ColorUtils.rgbToHex8(value).toLowerCase();
                if (!hex || (hex === '#000000' && value === 'rgba(0, 0, 0, 0)')) return;

                if (!colorElementMap.has(hex)) {
                    colorElementMap.set(hex, []);
                }

                colorElementMap.get(hex).push({ element: el || document.body, cssProp: cssPropName });
            };

            // Scan <html> first
            scanDocumentElement(addToMap);

            // Cap total elements to avoid freezing on massive pages
            let _mapElCount = 0;
            const _MAP_EL_LIMIT = 5000;
            window.ShadowWalker.walk(document.body, (element) => {
                if (_mapElCount >= _MAP_EL_LIMIT) return;
                try {
                    // Skip invisible elements — they don't contribute visible colors
                    // and calling getComputedStyle on them is wasted work.
                    if (element.offsetWidth === 0 && element.offsetHeight === 0) return;

                    const style = window.getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden') return;

                    const addToMapEl = (value, cssPropName) => addToMap(value, cssPropName, element);

                    props.forEach(({ js, css }) => addToMapEl(style[js], css));
                    try {
                        addToMapEl(style[accentProp.js], accentProp.css);
                    } catch (error) {
                        // Ignore unsupported accent-color contexts.
                    }
                    _mapElCount++;
                } catch (error) {
                    // Ignore style read errors.
                }
            });
        }

        console.log(`PaletteLive: Mapped ${colorElementMap.size} unique colors to elements`);

        // Cross-reference active overrides: elements currently showing an overridden
        // currentHex need to also be mapped under their originalHex so that
        // reapplyAllOverrides() and FORCE_REAPPLY can find them.
        if (rawOverrideState.size > 0) {
            rawOverrideState.forEach((currentHex, originalHex) => {
                if (currentHex === originalHex) return;

                const currentEntries = colorElementMap.get(currentHex);
                if (!currentEntries || !currentEntries.length) return;

                if (!colorElementMap.has(originalHex)) {
                    colorElementMap.set(originalHex, []);
                }

                const originalEntries = colorElementMap.get(originalHex);
                currentEntries.forEach(entry => {
                    // Only remap elements that we actually overrode (checked via overrideMap)
                    const propMap = overrideMap.get(entry.element);
                    if (propMap && propMap.has(entry.cssProp)) {
                        const alreadyMapped = originalEntries.some(
                            e => e.element === entry.element && e.cssProp === entry.cssProp
                        );
                        if (!alreadyMapped) {
                            originalEntries.push(entry);
                        }
                    }
                });
            });
        }

        // Re-apply all active overrides to the freshly mapped elements
        reapplyAllOverrides();
    }

    /**
     * Re-apply all rawOverrideState overrides to elements currently in the colorElementMap.
     * Called after buildColorMap() and on scroll to catch dynamically loaded content.
     * Checks the COMPUTED style (not just inline) to detect when the page has overridden
     * PaletteLive's inline styles via its own CSS rules.
     */
    function reapplyAllOverrides() {
        if (rawOverrideState.size === 0) return;

        performDOMChange(() => {
            let applied = 0;
            rawOverrideState.forEach((currentHex, originalHex) => {
                const entries = colorElementMap.get(originalHex);
                if (!entries || !entries.length) return;

                entries.forEach(({ element, cssProp }) => {
                    try {
                        if (!element.isConnected) return;
                        // Skip invisible elements — no need to reapply overrides
                        if (element.offsetWidth === 0 && element.offsetHeight === 0) return;

                        // Don't overwrite text color on elements fixed by enforceTextContrast
                        if (cssProp === 'color' && _textContrastFixed.has(element)) return;

                        // Cache getComputedStyle — avoids calling it twice per element
                        const style = window.getComputedStyle(element);
                        const jsName = cssPropToJs(cssProp);
                        const computedValue = style[jsName];
                        if (computedValue) {
                            const computedHex = window.ColorUtils.rgbToHex8(computedValue).toLowerCase();
                            if (computedHex === currentHex) return;
                        }

                        if (cssProp === 'background-color' && _isImageContainer(element)) return;

                        // Contrast guard: never re-apply a text color that would be
                        // unreadable against the actual background (e.g. after a palette
                        // was applied and enforceTextContrast fixed the contrast — the
                        // watchdog / scroll-triggered reapply should not undo that fix).
                        if (cssProp === 'color') {
                            try {
                                const effBg = _getEffectiveBg(element);
                                if (_contrastRatio(currentHex, effBg) < 4.5) {
                                    // Schedule contrast enforcement rather than blindly applying
                                    _scheduleDeferredContrast();
                                    return;
                                }
                            } catch (e) { /* ignore — proceed with reapply */ }
                        }

                        captureInlineSnapshot(element, cssProp);
                        element.style.removeProperty(cssProp);
                        element.style.setProperty(cssProp, currentHex, 'important');

                        if (cssProp === 'background-color') {
                            // Reuse cached style object instead of calling getComputedStyle again
                            const origBgImg = style.backgroundImage;
                            if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                captureInlineSnapshot(element, 'background-image');
                                element.style.setProperty('background-image', 'none', 'important');
                            }
                        }
                        applied++;
                    } catch (error) {
                        // Ignore per-element apply errors.
                    }
                });
            });

            if (applied > 0) {
                console.log(`PaletteLive: Re-applied overrides to ${applied} element-properties`);
            }
            // Re-run text contrast enforcement after reapply — but debounced
            // to avoid cascading DOM walks.
            if (_lastPaletteHexes && _lastPaletteHexes.length && applied > 0) {
                clearTimeout(_textContrastRerunTimer);
                _textContrastRerunTimer = setTimeout(() => {
                    enforceTextContrast(_lastPaletteHexes);
                }, 600);
            }
        });
    }

    /**
     * Batch-refresh all fallback CSS rules in ONE shot without any DOM walk.
     * Existing fallback CSS classes (pl-bg-*, pl-text-*, etc.) remain on elements
     * from prior applyRawOverrideFallback() calls; this just updates the injected
     * <style> tag so the rules match the current override colors.
     */
    function batchRefreshFallbackCSS() {
        if (rawOverrideState.size === 0) return;
        if (!window.Injector) return;

        const allSelectors = {};
        rawOverrideState.forEach((currentHex, originalHex) => {
            const safeId = getSafeId(originalHex);
            const classMap = getFallbackClassMap(safeId);
            // Don't set background-image:none in the CSS rule — it would wipe
            // gradients/images on ALL elements with this class.  Per-element
            // inline guards are applied in applyRawOverrideFallback instead.
            allSelectors[`.${classMap.backgroundColor}`] = { 'background-color': currentHex };
            allSelectors[`.${classMap.color}`] = { color: currentHex };
            allSelectors[`.${classMap.borderTopColor}`] = { 'border-top-color': currentHex };
            allSelectors[`.${classMap.borderRightColor}`] = { 'border-right-color': currentHex };
            allSelectors[`.${classMap.borderBottomColor}`] = { 'border-bottom-color': currentHex };
            allSelectors[`.${classMap.borderLeftColor}`] = { 'border-left-color': currentHex };
            allSelectors[`.${classMap.outlineColor}`] = { 'outline-color': currentHex };
            allSelectors[`.${classMap.textDecorationColor}`] = { 'text-decoration-color': currentHex };
            allSelectors[`.${classMap.fill}`] = { fill: currentHex };
            allSelectors[`.${classMap.stroke}`] = { stroke: currentHex };
        });

        performDOMChange(() => {
            window.Injector.apply({ selectors: allSelectors });
        });
    }

    function captureInlineSnapshot(element, cssProp) {
        let propMap = overrideMap.get(element);
        if (!propMap) {
            propMap = new Map();
            overrideMap.set(element, propMap);
            overrideRefs.push(new WeakRef(element));
        }

        if (!propMap.has(cssProp)) {
            const value = element.style.getPropertyValue(cssProp);
            const priority = element.style.getPropertyPriority(cssProp);
            propMap.set(cssProp, {
                hadInline: value !== '' || priority !== '',
                value,
                priority
            });
        }

        return propMap;
    }

    function restoreInlineSnapshot(element, cssProp, snapshot) {
        if (snapshot && snapshot.hadInline) {
            element.style.setProperty(cssProp, snapshot.value, snapshot.priority || '');
            return;
        }

        element.style.removeProperty(cssProp);
        if (element.style.getPropertyValue(cssProp)) {
            element.style.setProperty(cssProp, '', '');
        }
    }

    function resetAllOverrides(options) {
        const config = options || {};

        stopOverrideWatchdog();
        stopObserver();

        if (window.Injector) {
            window.Injector.reset();
        }

        overrideRefs.forEach(ref => {
            const element = ref.deref();
            if (!element) return;

            const propMap = overrideMap.get(element);
            if (!propMap) return;

            propMap.forEach((snapshot, cssProp) => {
                try {
                    restoreInlineSnapshot(element, cssProp, snapshot);
                } catch (error) {
                    // Ignore per-element restoration failures.
                }
            });

            overrideMap.delete(element);
        });
        overrideRefs = [];

        if (addedFallbackClasses.size && document.body) {
            if (window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
                window.ShadowWalker.walk(document.body, (element) => {
                    if (!element.classList || !element.classList.length) return;
                    addedFallbackClasses.forEach(cls => {
                        element.classList.remove(cls);
                    });
                });
            }
            addedFallbackClasses.clear();
        }

        clearHighlight();
        hideComparisonOverlay();
        rawOverrideState.clear();

        // Clear text contrast tracking
        _textContrastFixed = new WeakSet();
        _lastPaletteHexes = null;
        clearTimeout(_textContrastRerunTimer);
        clearTimeout(_deferredContrastTimer);
        _flushContrastCache();

        if (!config.preserveScheme) {
            setColorScheme('auto');
        }
        if (!config.preserveVision) {
            setVisionMode('none');
        }

        colorElementMap.clear();

        if (!config.skipObserverReconnect) {
            startObserver();
        }

        console.log('PaletteLive: All overrides reset');
    }

    function getSafeId(value) {
        return String(value || '').replace(/[^a-zA-Z0-9]/g, '');
    }

    function getFallbackClassMap(safeId) {
        return {
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
    }

    function clearFallbackClassesForSafeId(safeId) {
        const classMap = getFallbackClassMap(safeId);
        const classNames = Object.values(classMap);

        if (document.body && window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
            window.ShadowWalker.walk(document.body, (element) => {
                if (!element.classList || !element.classList.length) return;
                classNames.forEach(className => {
                    element.classList.remove(className);
                });
            });
        }

        classNames.forEach(className => addedFallbackClasses.delete(className));

        if (window.Injector && window.Injector.state && window.Injector.state.selectors) {
            let changed = false;
            classNames.forEach(className => {
                const selector = `.${className}`;
                if (Object.prototype.hasOwnProperty.call(window.Injector.state.selectors, selector)) {
                    delete window.Injector.state.selectors[selector];
                    changed = true;
                }
            });
            if (changed) {
                window.Injector.apply({});
            }
        }
    }

    function removeRawOverride(original) {
        if (!original) return;

        ensureColorMap();
        const originalHex = window.ColorUtils.rgbToHex8(original).toLowerCase();

        const entries = colorElementMap.get(originalHex);
        if (entries && entries.length) {
            entries.forEach(({ element, cssProp }) => {
                try {
                    const propMap = overrideMap.get(element);
                    if (!propMap) return;

                    const snapshot = propMap.get(cssProp);
                    restoreInlineSnapshot(element, cssProp, snapshot);
                    propMap.delete(cssProp);

                    // Also restore background-image if we cleared it during override
                    if (cssProp === 'background-color') {
                        const bgImgSnapshot = propMap.get('background-image');
                        if (bgImgSnapshot !== undefined) {
                            restoreInlineSnapshot(element, 'background-image', bgImgSnapshot);
                            propMap.delete('background-image');
                        }
                    }

                    if (propMap.size === 0) {
                        overrideMap.delete(element);
                    }
                } catch (error) {
                    // Ignore per-element restore errors.
                }
            });
        }

        rawOverrideState.delete(originalHex);
        clearFallbackClassesForSafeId(getSafeId(original));
    }

    function applyRawOverride(data) {
        if (!data || !data.original || !data.current) return 0;

        let result = 0;
        performDOMChange(() => {
            ensureColorMap();
            const originalHex = window.ColorUtils.rgbToHex8(data.original).toLowerCase();
            const currentHex = window.ColorUtils.rgbToHex8(data.current).toLowerCase();

            let appliedCount = 0;
            let entries = colorElementMap.get(originalHex);

            // Fuzzy match fallback if exact match fails
            if (!entries || !entries.length) {
                // Try to find similar colors in the map
                const similarKeys = [];
                for (const key of colorElementMap.keys()) {
                    if (window.ColorUtils.areSimilar(key, originalHex, 10)) { // Tolerance of 10
                        similarKeys.push(key);
                    }
                }

                if (similarKeys.length > 0) {
                    entries = [];
                    similarKeys.forEach(key => {
                        const keyEntries = colorElementMap.get(key);
                        if (keyEntries) entries.push(...keyEntries);
                    });
                    console.log(`PaletteLive: Fuzzy matched ${similarKeys.length} colors for ${originalHex}`);
                }
            }

            // Debug logging and fallback rebuild
            if (!entries || !entries.length) {
                console.warn(`PaletteLive: No elements found in color map for ${originalHex} (even with fuzzy match). Map has ${colorElementMap.size} colors.`);

                // Try to rebuild the color map in case the DOM has changed
                console.log('PaletteLive: Rebuilding color map and retrying...');

                buildColorMap();
                entries = colorElementMap.get(originalHex);

                // Retry fuzzy match after rebuild
                if (!entries || !entries.length) {
                    const similarKeys = [];
                    for (const key of colorElementMap.keys()) {
                        if (window.ColorUtils.areSimilar(key, originalHex, 10)) {
                            similarKeys.push(key);
                        }
                    }
                    if (similarKeys.length > 0) {
                        entries = [];
                        similarKeys.forEach(key => {
                            const keyEntries = colorElementMap.get(key);
                            if (keyEntries) entries.push(...keyEntries);
                        });
                    }
                }

                if (entries && entries.length) {
                    console.log(`PaletteLive: Found ${entries.length} elements after rebuild`);
                }
            }

            if (entries && entries.length) {
                entries.forEach(({ element, cssProp }) => {
                    try {
                        if (cssProp === 'background-color' && _isImageContainer(element)) return;
                        captureInlineSnapshot(element, cssProp);
                        // !important war: strip existing inline !important before applying ours
                        if (element.style.getPropertyPriority(cssProp) === 'important') {
                            element.style.removeProperty(cssProp);
                        }
                        // Use the normalized hex value for consistency
                        element.style.setProperty(cssProp, currentHex, 'important');

                        // Only clear background-image if the original element had no background image
                        if (cssProp === 'background-color') {
                            const origBgImg = window.getComputedStyle(element).backgroundImage;
                            // Only clear gradients; skip 'none' (allows lazy-loaded images later) and url() (preserves images)
                            if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                captureInlineSnapshot(element, 'background-image');
                                element.style.setProperty('background-image', 'none', 'important');
                            }
                        }
                        appliedCount++;
                    } catch (error) {
                        // Ignore per-element apply errors.
                    }
                });
            }

            // Also directly target element if provided by dropper (catches elements not in map)
            if (data.targetElement && data.targetElement.isConnected) {
                const el = data.targetElement;
                try {
                    const cs = window.getComputedStyle(el);
                    const bgHex = window.ColorUtils.rgbToHex8(cs.backgroundColor).toLowerCase();
                    // Check if this element was already handled via the map above
                    const propMap = overrideMap.get(el);
                    const alreadyDone = propMap && propMap.has('background-color');

                    // Allow if exact match OR fuzzy match
                    const isMatch = bgHex === originalHex || window.ColorUtils.areSimilar(bgHex, originalHex, 10);

                    if (!alreadyDone && (isMatch || appliedCount === 0)) {
                        if (_isImageContainer(el)) return;
                        captureInlineSnapshot(el, 'background-color');
                        captureInlineSnapshot(el, 'background-image');
                        if (el.style.getPropertyPriority('background-color') === 'important') {
                            el.style.removeProperty('background-color');
                        }
                        el.style.setProperty('background-color', currentHex, 'important');
                        const elBgImg = window.getComputedStyle(el).backgroundImage;
                        // Only clear gradients; skip 'none' (allows lazy-loaded images later) and url() (preserves images)
                        if (elBgImg && elBgImg !== 'none' && !elBgImg.includes('url(')) {
                            el.style.setProperty('background-image', 'none', 'important');
                        }

                        // Add to colorElementMap for future reference
                        if (!colorElementMap.has(originalHex)) {
                            colorElementMap.set(originalHex, []);
                        }
                        // Avoid duplicates
                        const alreadyInMap = colorElementMap.get(originalHex).some(e => e.element === el && e.cssProp === 'background-color');
                        if (!alreadyInMap) {
                            colorElementMap.get(originalHex).push({ element: el, cssProp: 'background-color' });
                        }
                        appliedCount++;
                    }
                } catch (e) { /* ignore */ }
            }

            rawOverrideState.set(originalHex, currentHex);

            // Ensure the watchdog is running when we have active overrides
            startOverrideWatchdog();

            // Update fallback CSS rules without walking the DOM.
            // applyRawOverrideFallback does a full DOM walk per override — too expensive.
            // Fallback classes were already applied during initial scan/bulk apply.
            batchRefreshFallbackCSS();

            if (appliedCount > 0) {
                console.log(`PaletteLive: Applied ${currentHex} to ${appliedCount} element-properties for ${originalHex}`);
                result = appliedCount;
            } else {
                // If no elements were found, the fallback CSS (applied above) is our only hope
                console.warn(`PaletteLive: No inline overrides applied for ${originalHex}, relying on fallback CSS`);
                result = 0;
            }
        });
        return result;
    }

    function applyRawOverrideFallback(data) {
        const safeId = getSafeId(data.original);
        const classMap = getFallbackClassMap(safeId);
        const currentHex = window.ColorUtils.rgbToHex8(data.current).toLowerCase();
        let matchedCount = 0;

        performDOMChange(() => {
            if (document.body && window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
                window.ShadowWalker.walk(document.body, (element) => {
                    try {
                        // Skip invisible elements — no need to apply fallback classes
                        if (element.offsetWidth === 0 && element.offsetHeight === 0) return;

                        const style = window.getComputedStyle(element);
                        if (style.display === 'none' || style.visibility === 'hidden') return;

                        const hasClass = Object.values(classMap).some(className => element.classList.contains(className));
                        if (hasClass) return;

                        if (checkMatch(style.backgroundColor, data.original)) {
                            if (!_isImageContainer(element)) {
                                element.classList.add(classMap.backgroundColor);
                                addedFallbackClasses.add(classMap.backgroundColor);
                                const origBgImg = style.backgroundImage;
                                if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                    element.style.setProperty('background-image', 'none', 'important');
                                }
                                matchedCount++;
                            }
                        }
                        if (checkMatch(style.color, data.original)) {
                            element.classList.add(classMap.color);
                            addedFallbackClasses.add(classMap.color);
                            matchedCount++;
                        }
                        if (checkMatch(style.borderTopColor, data.original)) {
                            element.classList.add(classMap.borderTopColor);
                            addedFallbackClasses.add(classMap.borderTopColor);
                            matchedCount++;
                        }
                        if (checkMatch(style.borderRightColor, data.original)) {
                            element.classList.add(classMap.borderRightColor);
                            addedFallbackClasses.add(classMap.borderRightColor);
                            matchedCount++;
                        }
                        if (checkMatch(style.borderBottomColor, data.original)) {
                            element.classList.add(classMap.borderBottomColor);
                            addedFallbackClasses.add(classMap.borderBottomColor);
                            matchedCount++;
                        }
                        if (checkMatch(style.borderLeftColor, data.original)) {
                            element.classList.add(classMap.borderLeftColor);
                            addedFallbackClasses.add(classMap.borderLeftColor);
                            matchedCount++;
                        }
                        if (checkMatch(style.outlineColor, data.original)) {
                            element.classList.add(classMap.outlineColor);
                            addedFallbackClasses.add(classMap.outlineColor);
                            matchedCount++;
                        }
                        if (checkMatch(style.textDecorationColor, data.original)) {
                            element.classList.add(classMap.textDecorationColor);
                            addedFallbackClasses.add(classMap.textDecorationColor);
                            matchedCount++;
                        }
                        if (checkMatch(style.fill, data.original)) {
                            element.classList.add(classMap.fill);
                            addedFallbackClasses.add(classMap.fill);
                            matchedCount++;
                        }
                        if (checkMatch(style.stroke, data.original)) {
                            element.classList.add(classMap.stroke);
                            addedFallbackClasses.add(classMap.stroke);
                            matchedCount++;
                        }
                    } catch (error) {
                        // Ignore per-element fallback errors.
                    }
                });
            }

            const selectors = {};
            // Same guard as batchRefreshFallbackCSS — don't clear
            // background-image in stylesheet rules; per-element inline
            // guard handles it below during the walk.
            selectors[`.${classMap.backgroundColor}`] = { 'background-color': currentHex };
            selectors[`.${classMap.color}`] = { color: currentHex };
            selectors[`.${classMap.borderTopColor}`] = { 'border-top-color': currentHex };
            selectors[`.${classMap.borderRightColor}`] = { 'border-right-color': currentHex };
            selectors[`.${classMap.borderBottomColor}`] = { 'border-bottom-color': currentHex };
            selectors[`.${classMap.borderLeftColor}`] = { 'border-left-color': currentHex };
            selectors[`.${classMap.outlineColor}`] = { 'outline-color': currentHex };
            selectors[`.${classMap.textDecorationColor}`] = { 'text-decoration-color': currentHex };
            selectors[`.${classMap.fill}`] = { fill: currentHex };
            selectors[`.${classMap.stroke}`] = { stroke: currentHex };

            // Injector application also creates style tags, which trigger mutation observer
            if (window.Injector) {
                window.Injector.apply({ selectors });
            }

            if (matchedCount > 0) {
                console.log(`PaletteLive: Fallback applied ${currentHex} to ${matchedCount} elements for ${data.original}`);
            }
        });
        return matchedCount;
    }

    // ════════════════════════════════════════════════
    //  Proactive text-contrast helper (inline during override apply)
    // ════════════════════════════════════════════════
    /**
     * When a background-color is changed on an element, immediately check all
     * direct text children for contrast and fix any that fall below WCAG AA.
     * This catches invisible text AT THE SOURCE rather than relying on the
     * delayed reactive sweep.
     */
    function _fixChildTextContrast(parentEl, newBgHex) {
        if (!_lastPaletteHexes || !_lastPaletteHexes.length) return;
        const MIN_CR = 4.5;
        const bwHexes = ['#ffffff', '#000000'];
        const palette = _lastPaletteHexes.map(h => {
            let hex = h.toLowerCase();
            if (hex.length === 9 && hex.endsWith('ff')) hex = hex.substring(0, 7);
            return hex;
        });

        const fixEl = (el) => {
            try {
                // Only fix elements with actual text content
                let hasText = false;
                for (let i = 0; i < el.childNodes.length; i++) {
                    if (el.childNodes[i].nodeType === Node.TEXT_NODE && el.childNodes[i].textContent.trim()) {
                        hasText = true; break;
                    }
                }
                if (!hasText && !(el.textContent && el.textContent.trim())) return;

                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden') return;
                const textColor = style.color;
                if (!textColor || window.ColorUtils.isTransparent(textColor)) return;

                const textHex = window.ColorUtils.rgbToHex8(textColor).toLowerCase();
                const currentCR = _contrastRatio(textHex, newBgHex);
                if (currentCR >= MIN_CR) return; // already readable

                // Find best replacement: palette color first, then black/white
                let bestHex = null, bestCR = 0;
                for (const c of palette) {
                    const cr = _contrastRatio(c, newBgHex);
                    if (cr >= MIN_CR && cr > bestCR) { bestCR = cr; bestHex = c; }
                }
                if (!bestHex) {
                    for (const c of bwHexes) {
                        const cr = _contrastRatio(c, newBgHex);
                        if (cr > bestCR) { bestCR = cr; bestHex = c; }
                    }
                }
                if (bestHex && bestCR > currentCR) {
                    el.style.setProperty('color', bestHex, 'important');
                    // Track this fix so reapplyAllOverrides / watchdog won't undo it
                    _textContrastFixed.add(el);
                }
            } catch (e) { /* ignore */ }
        };

        // Fix the parent itself if it has text
        fixEl(parentEl);
        // Fix immediate children (1 level deep for performance)
        try {
            const children = Array.from(parentEl.children);
            const limit = Math.min(children.length, 50); // cap for perf
            for (let i = 0; i < limit; i++) fixEl(children[i]);
        } catch (e) { /* ignore */ }
    }

    // ════════════════════════════════════════════════
    //  Bulk override — single DOM walk for many overrides
    // ════════════════════════════════════════════════
    // Cooldown flag: after bulk apply, suppress observer/scroll/watchdog
    // to prevent cascading DOM walks from causing lag.
    let _plBulkApplyCooldown = false;
    let _plBulkApplyCooldownTimer = null;

    // Track elements whose text color was fixed by enforceTextContrast.
    // reapplyAllOverrides & watchdog must respect these to avoid undoing fixes.
    let _textContrastFixed = new WeakSet();
    let _lastPaletteHexes = null;
    let _textContrastRerunTimer = null;

    // Shared deferred contrast timer — all processAddedSubtree calls funnel
    // mutations into this single debounced 800ms pass instead of spawning one
    // timer per added node.  Eliminates timer explosions on high-churn pages
    // (Reddit virtual scroller, Pinterest masonry, etc.).
    let _deferredContrastTimer = null;
    function _scheduleDeferredContrast() {
        clearTimeout(_deferredContrastTimer);
        _deferredContrastTimer = setTimeout(() => {
            if (_lastPaletteHexes && _lastPaletteHexes.length && rawOverrideState.size > 0) {
                // Evict stale bg-cache entries before the sweep so background
                // changes caused by class toggles are picked up correctly.
                _bgCache = new WeakMap();
                enforceTextContrast(_lastPaletteHexes);
            }
        }, 800);
    }

    function startBulkApplyCooldown(ms) {
        _plBulkApplyCooldown = true;
        clearTimeout(_plBulkApplyCooldownTimer);
        _plBulkApplyCooldownTimer = setTimeout(() => {
            _plBulkApplyCooldown = false;
        }, ms || 2000);
    }

    function applyBulkRawOverrides(overridesArray) {
        if (!overridesArray || !overridesArray.length) return 0;
        let totalApplied = 0;

        // Suppress cascading reprocessing for 2s after bulk apply
        startBulkApplyCooldown(2000);

        performDOMChange(() => {
            ensureColorMap();

            // ── Phase 1: Build all lookup data up front ──
            const overrideEntries = []; // { originalHex, currentHex, safeId, classMap }
            const originalToCurrentMap = new Map(); // originalHex → currentHex

            for (const data of overridesArray) {
                if (!data || !data.original || !data.current) continue;
                const originalHex = window.ColorUtils.rgbToHex8(data.original).toLowerCase();
                const currentHex = window.ColorUtils.rgbToHex8(data.current).toLowerCase();
                if (originalHex === currentHex) continue;

                const safeId = getSafeId(data.original);
                const classMap = getFallbackClassMap(safeId);
                overrideEntries.push({ originalHex, currentHex, safeId, classMap, data });
                originalToCurrentMap.set(originalHex, currentHex);
            }

            if (!overrideEntries.length) return;

            // ── Phase 2: Inline overrides from colorElementMap (no DOM walk needed) ──
            // Track elements already handled so Phase 3 can skip them.
            const handledElements = new WeakSet();
            let mapRebuilt = false;
            for (const entry of overrideEntries) {
                let entries = colorElementMap.get(entry.originalHex);
                if (!entries || !entries.length) {
                    // Try rebuild once (only on first miss)
                    if (!mapRebuilt) {
                        buildColorMap();
                        mapRebuilt = true;
                        entries = colorElementMap.get(entry.originalHex);
                    }
                }
                if (entries && entries.length) {
                    entries.forEach(({ element, cssProp }) => {
                        try {
                            if (cssProp === 'background-color' && _isImageContainer(element)) return;
                            captureInlineSnapshot(element, cssProp);
                            if (element.style.getPropertyPriority(cssProp) === 'important') {
                                element.style.removeProperty(cssProp);
                            }
                            element.style.setProperty(cssProp, entry.currentHex, 'important');
                            if (cssProp === 'background-color') {
                                const origBgImg = window.getComputedStyle(element).backgroundImage;
                                // Only clear gradients; skip 'none' (allows lazy-loaded images later) and url() (preserves images)
                                if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                    captureInlineSnapshot(element, 'background-image');
                                    element.style.setProperty('background-image', 'none', 'important');
                                }
                                // Proactive contrast fix: immediately fix text children
                                _fixChildTextContrast(element, entry.currentHex);
                            }
                            handledElements.add(element);
                            totalApplied++;
                        } catch (e) { /* ignore */ }
                    });
                }
                rawOverrideState.set(entry.originalHex, entry.currentHex);
            }

            // ── Phase 3: Fallback — inject CSS classes + rules (NO full DOM walk) ──
            // Instead of walking the entire DOM (expensive), we rely on CSS-class
            // based fallback rules that apply via specificity.  The Phase 2 inline
            // overrides already cover all elements in colorElementMap.  For elements
            // NOT in the map (lazy-loaded, pseudo-elements, shadow DOM etc.), the
            // fallback CSS classes were already added during previous scans/applies.
            // A lightweight targeted walk only processes elements NOT already handled.
            const fallbackLookup = new Map();
            for (const entry of overrideEntries) {
                fallbackLookup.set(entry.originalHex, entry);
            }

            const propChecks = [
                { js: 'backgroundColor', key: 'backgroundColor' },
                { js: 'color', key: 'color' },
                { js: 'borderTopColor', key: 'borderTopColor' },
                { js: 'borderRightColor', key: 'borderRightColor' },
                { js: 'borderBottomColor', key: 'borderBottomColor' },
                { js: 'borderLeftColor', key: 'borderLeftColor' },
                { js: 'outlineColor', key: 'outlineColor' },
                { js: 'textDecorationColor', key: 'textDecorationColor' },
                { js: 'fill', key: 'fill' },
                { js: 'stroke', key: 'stroke' }
            ];

            // Walk only if Phase 2 didn't handle many elements (< 80% of expected).
            // This avoids the expensive full DOM walk on pages where the colorElementMap
            // already covers all visible elements.
            const expectedCoverage = overrideEntries.reduce((sum, e) => {
                const ents = colorElementMap.get(e.originalHex);
                return sum + (ents ? ents.length : 0);
            }, 0);
            const needsFallbackWalk = totalApplied < expectedCoverage * 0.5 || expectedCoverage === 0;

            if (needsFallbackWalk && document.body && window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
                let _fbCount = 0;
                const _FB_LIMIT = 3000; // cap fallback walk to prevent freezes
                window.ShadowWalker.walk(document.body, (element) => {
                    if (_fbCount >= _FB_LIMIT) return;
                    if (handledElements.has(element)) return; // skip already-handled
                    try {
                        // Skip invisible elements
                        if (element.offsetWidth === 0 && element.offsetHeight === 0) return;

                        const style = window.getComputedStyle(element);
                        if (style.display === 'none' || style.visibility === 'hidden') return;

                        for (const { js, key } of propChecks) {
                            const computed = style[js];
                            if (!computed || window.ColorUtils.isTransparent(computed)) continue;
                            if (computed === 'auto' || computed === 'initial' || computed === 'inherit') continue;
                            const hex = window.ColorUtils.rgbToHex8(computed).toLowerCase();
                            const entry = fallbackLookup.get(hex);
                            if (!entry) continue;
                            const className = entry.classMap[key];
                            if (!element.classList.contains(className)) {
                                // Skip bg-color on image containers
                                if (key === 'backgroundColor' && _isImageContainer(element)) continue;
                                element.classList.add(className);
                                addedFallbackClasses.add(className);
                                // Only clear gradients; skip 'none' (allows lazy-loaded images later) and url() (preserves images)
                                if (key === 'backgroundColor') {
                                    const origBgImg = style.backgroundImage;
                                    if (origBgImg && origBgImg !== 'none' && !origBgImg.includes('url(')) {
                                        element.style.setProperty('background-image', 'none', 'important');
                                    }
                                }
                            }
                        }
                        _fbCount++;
                    } catch (e) { /* ignore */ }
                });
            }

            // ── Phase 4: Build ALL fallback CSS rules in one batch ──
            const allSelectors = {};
            for (const entry of overrideEntries) {
                const c = entry.currentHex;
                const cm = entry.classMap;
                // Don't set background-image:none in stylesheet rule — per-element inline guards handle it.
                allSelectors[`.${cm.backgroundColor}`] = { 'background-color': c };
                allSelectors[`.${cm.color}`] = { color: c };
                allSelectors[`.${cm.borderTopColor}`] = { 'border-top-color': c };
                allSelectors[`.${cm.borderRightColor}`] = { 'border-right-color': c };
                allSelectors[`.${cm.borderBottomColor}`] = { 'border-bottom-color': c };
                allSelectors[`.${cm.borderLeftColor}`] = { 'border-left-color': c };
                allSelectors[`.${cm.outlineColor}`] = { 'outline-color': c };
                allSelectors[`.${cm.textDecorationColor}`] = { 'text-decoration-color': c };
                allSelectors[`.${cm.fill}`] = { fill: c };
                allSelectors[`.${cm.stroke}`] = { stroke: c };
            }
            if (window.Injector) {
                window.Injector.apply({ selectors: allSelectors });
            }

            startOverrideWatchdog();
            console.log(`PaletteLive: Bulk applied ${overrideEntries.length} overrides, ${totalApplied} inline changes`);
        });

        return totalApplied;
    }

    // ════════════════════════════════════════════════
    //  Post-Apply Text Contrast Enforcement
    // ════════════════════════════════════════════════
    // After palette application, walk every text-bearing element and check its
    // computed `color` against its effective background.  If contrast falls below
    // WCAG AA (4.5:1) we dynamically override the text color to the best palette
    // color that restores readability (or plain white/black as fallback).

    /** WCAG relative luminance for an {r,g,b} object (0..255) → 0..1 */
    function _relLum(rgb) {
        const s = [rgb.r, rgb.g, rgb.b].map(c => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    }

    // ── Contrast-ratio LUT cache ──────────────────────────────────
    // Memoize relative-luminance and contrast-ratio computations so that
    // the thousands of identical calls during a DOM walk become O(1) lookups.
    const _lumCache = new Map();   // hex → luminance (0..1)
    const _crCache = new Map();   // "hex1|hex2" → ratio (1..21)

    // Per-element effective-background cache — avoids re-walking ancestor
    // chains on repeated enforceTextContrast passes within the same palette
    // session.  WeakMap has no .clear(), so we re-assign to evict entries.
    // Flushed on palette apply/reset and before each scheduled sweep.
    let _bgCache = new WeakMap();

    /** Cached luminance for a hex string */
    function _cachedLum(hex) {
        let v = _lumCache.get(hex);
        if (v !== undefined) return v;
        const rgb = window.ColorUtils.hexToRgb(hex);
        v = rgb ? _relLum(rgb) : 0;
        _lumCache.set(hex, v);
        return v;
    }

    /** Contrast ratio between two hex strings (1..21) — cached */
    function _contrastRatio(hex1, hex2) {
        const key = hex1 < hex2 ? hex1 + '|' + hex2 : hex2 + '|' + hex1;
        let v = _crCache.get(key);
        if (v !== undefined) return v;
        const l1 = _cachedLum(hex1);
        const l2 = _cachedLum(hex2);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        v = (lighter + 0.05) / (darker + 0.05);
        _crCache.set(key, v);
        return v;
    }

    /** Flush the LUT caches (call after palette changes) */
    function _flushContrastCache() {
        _lumCache.clear();
        _crCache.clear();
        _bgCache = new WeakMap(); // WeakMap has no .clear() — reassign to evict all entries
    }

    // ── Alpha-compositing helper ──────────────────────────────────
    /**
     * Composite a foreground RGBA over a background RGB.
     * Returns { r, g, b } (all 0..255, opaque result).
     */
    function _alphaComposite(fgRgba, bgRgb) {
        const a = fgRgba.a;
        return {
            r: Math.round(fgRgba.r * a + bgRgb.r * (1 - a)),
            g: Math.round(fgRgba.g * a + bgRgb.g * (1 - a)),
            b: Math.round(fgRgba.b * a + bgRgb.b * (1 - a))
        };
    }

    /**
     * Resolve the effective background color of an element by walking up the
     * ancestor chain.  Semi-transparent layers are alpha-composited onto whatever
     * lies behind them so the result accurately reflects the visual background.
     * Returns a 6-digit hex string or '#ffffff' as ultimate fallback.
     */
    function _getEffectiveBg(el) {
        // Fast path: return cached result from this palette session
        const _cached = _bgCache.get(el);
        if (_cached !== undefined) return _cached;

        // Collect layers bottom-up (element → root)
        const layers = []; // { r, g, b, a } from element upward
        let current = el;
        // MAX_DEPTH 20: modern SPAs/React pages can have 10+ nesting levels
        // between a text node and the section that sets the background color.
        // A depth of 5 was too shallow — causing the fallback #ffffff to be
        // used instead of the real dark background, which made enforceTextContrast
        // think text was fine when it wasn't.
        const MAX_DEPTH = 20;
        let depth = 0;
        let hitOpaque = false;

        while (current && depth < MAX_DEPTH) {
            try {
                const bg = window.getComputedStyle(current).backgroundColor;
                if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                    const rgba = window.ColorUtils.hexToRgb(
                        window.ColorUtils.rgbToHex8(bg)
                    );
                    if (rgba && rgba.a > 0) {
                        layers.push(rgba);
                        if (rgba.a >= 1) { hitOpaque = true; break; }
                    }
                }
            } catch (e) { /* ignore */ }
            current = current.parentElement;
            depth++;
        }

        // Final fallback: if we exhausted MAX_DEPTH without hitting an opaque layer,
        // explicitly check body and documentElement before giving up on #ffffff.
        if (!hitOpaque && current) {
            for (const root of [current, document.body, document.documentElement]) {
                if (!root) continue;
                try {
                    const bg = window.getComputedStyle(root).backgroundColor;
                    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                        const rgba = window.ColorUtils.hexToRgb(window.ColorUtils.rgbToHex8(bg));
                        if (rgba && rgba.a > 0) {
                            layers.push(rgba);
                            if (rgba.a >= 1) { hitOpaque = true; break; }
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        }

        if (!layers.length) {
            _bgCache.set(el, '#ffffff');
            return '#ffffff';
        }

        // Composite from back (deepest solid) to front (element itself)
        // Start with page-default white if we never hit an opaque layer
        let composite = hitOpaque
            ? { r: layers[layers.length - 1].r, g: layers[layers.length - 1].g, b: layers[layers.length - 1].b }
            : { r: 255, g: 255, b: 255 };

        // Walk from the layer just above the opaque base toward the element
        const startIdx = hitOpaque ? layers.length - 2 : layers.length - 1;
        for (let i = startIdx; i >= 0; i--) {
            composite = _alphaComposite(layers[i], composite);
        }

        // Convert to hex, cache and return
        const toHex2 = n => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
        const _bgResult = '#' + toHex2(composite.r) + toHex2(composite.g) + toHex2(composite.b);
        _bgCache.set(el, _bgResult);
        return _bgResult;
    }

    /**
     * Walk every text-bearing element and ensure its rendered text color has
     * sufficient contrast (≥ MIN_CR) against its effective background.
     *
     * @param {string[]} paletteHexes — imported palette colors to choose from
     */
    function enforceTextContrast(paletteHexes, subtreeRoot) {
        if (!document.body) return 0;
        const MIN_CR = 4.5; // WCAG AA normal text
        const MIN_CR_LARGE = 3.0; // WCAG AA large text (≥18px bold or ≥24px)

        // Build candidate pool: palette colors + pure white & black
        const bwHexes = ['#ffffff', '#000000'];
        const paletteSet = new Set();
        if (paletteHexes && paletteHexes.length) {
            paletteHexes.forEach(h => {
                let hex = h.toLowerCase();
                if (hex.length === 9 && hex.endsWith('ff')) hex = hex.substring(0, 7);
                paletteSet.add(hex);
            });
        }
        // Remove b/w duplicates from palette set so we can distinguish them
        bwHexes.forEach(h => paletteSet.delete(h));
        const paletteCandidates = [...paletteSet]; // user's palette colors only
        const allCandidates = [...paletteCandidates, ...bwHexes]; // palette first, b/w last

        let fixedCount = 0;

        /** Check if element or its immediate children contain visible text */
        function hasVisibleText(el) {
            for (let i = 0; i < el.childNodes.length; i++) {
                const node = el.childNodes[i];
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
            }
            return false;
        }

        // ── Expanded text-element detection ────────────────────────
        const TEXT_TAGS = /^(H[1-6]|P|SPAN|A|LI|LABEL|TD|TH|CAPTION|FIGCAPTION|BLOCKQUOTE|CITE|Q|ABBR|EM|STRONG|B|I|U|S|SMALL|SUB|SUP|MARK|CODE|PRE|SUMMARY|DT|DD|BUTTON|LEGEND|INPUT|TEXTAREA|SELECT|OPTION|OUTPUT|METER|PROGRESS|TIME|DATA|VAR|SAMP|KBD|ADDRESS|DIV|SECTION|ARTICLE|MAIN|ASIDE|HEADER|FOOTER|NAV)$/;
        const TEXT_ROLES = /^(heading|button|link|menuitem|option|tab|treeitem|cell|gridcell|columnheader|rowheader|tooltip|status|alert|log|marquee|timer|note)$/;

        /** Check if element is likely a text-display element */
        function isTextElement(el) {
            const tag = el.tagName;
            if (!tag) return false;
            // Standard text tags (expanded to include form & semantic elements)
            if (TEXT_TAGS.test(tag.toUpperCase())) return true;
            // SVG text
            if (tag.toLowerCase() === 'text' && el.namespaceURI === 'http://www.w3.org/2000/svg') return true;
            // ARIA roles that imply text content
            const role = el.getAttribute && el.getAttribute('role');
            if (role && TEXT_ROLES.test(role.toLowerCase())) return true;
            // Contenteditable elements
            if (el.isContentEditable) return true;
            return false;
        }

        /** Determine if text is "large" for WCAG (>=18px bold or >=24px) */
        function isLargeText(style) {
            const size = parseFloat(style.fontSize) || 16;
            const weight = parseInt(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
            return size >= 24 || (size >= 18.66 && weight >= 700);
        }

        /**
         * Aesthetic-aware candidate selection.
         * Priority: palette colors that pass AA > b/w that pass AA > highest-CR fallback.
         * Among passing palette colors, prefer the one closest in luminance to the
         * original text color (preserves the palette's visual character).
         */
        function pickBestCandidate(bgHex, origTextHex, threshold) {
            const origLum = _cachedLum(origTextHex);
            let bestPalette = null, bestPaletteCR = 0, bestPaletteLumDist = Infinity;
            let bestBW = null, bestBWCR = 0;
            let fallbackHex = null, fallbackCR = 0;

            for (const c of paletteCandidates) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= threshold) {
                    const dist = Math.abs(_cachedLum(c) - origLum);
                    // Prefer palette candidate with passing CR closest to original luminance
                    if (!bestPalette || dist < bestPaletteLumDist ||
                        (dist === bestPaletteLumDist && cr > bestPaletteCR)) {
                        bestPalette = c;
                        bestPaletteCR = cr;
                        bestPaletteLumDist = dist;
                    }
                }
                if (cr > fallbackCR) { fallbackCR = cr; fallbackHex = c; }
            }

            for (const c of bwHexes) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= threshold && cr > bestBWCR) {
                    bestBWCR = cr;
                    bestBW = c;
                }
                if (cr > fallbackCR) { fallbackCR = cr; fallbackHex = c; }
            }

            // Prefer palette color over b/w when both pass
            if (bestPalette) return { hex: bestPalette, cr: bestPaletteCR };
            if (bestBW) return { hex: bestBW, cr: bestBWCR };
            // Nothing passes — return highest-contrast regardless
            return fallbackHex ? { hex: fallbackHex, cr: fallbackCR } : null;
        }

        const processElement = (el) => {
            try {
                const directText = hasVisibleText(el);
                const isTextTag = isTextElement(el);

                if (!directText && !isTextTag) return;

                // For text tags without direct text, check if they contain text at all
                if (!directText && isTextTag) {
                    if (!el.textContent || !el.textContent.trim()) return;
                }

                const style = window.getComputedStyle(el);

                // Skip hidden elements
                if (style.display === 'none' || style.visibility === 'hidden' ||
                    parseFloat(style.opacity) < 0.1) return;
                // Skip zero-size elements (collapsed, overflow:hidden wrappers)
                if (el.offsetWidth === 0 && el.offsetHeight === 0) return;

                const textColor = style.color;
                if (!textColor || window.ColorUtils.isTransparent(textColor)) return;

                const textHex = window.ColorUtils.rgbToHex8(textColor).toLowerCase();
                const bgHex = _getEffectiveBg(el);
                const currentCR = _contrastRatio(textHex, bgHex);

                // Use relaxed threshold for large text
                const threshold = isLargeText(style) ? MIN_CR_LARGE : MIN_CR;

                if (currentCR >= threshold) return; // already fine

                const best = pickBestCandidate(bgHex, textHex, threshold);
                if (best && best.cr > currentCR) {
                    el.style.setProperty('color', best.hex, 'important');
                    _textContrastFixed.add(el);
                    fixedCount++;
                }
            } catch (e) { /* ignore */ }
        };

        // ── Subtree path: small bounded scope, always synchronous ──────────
        if (subtreeRoot) {
            performDOMChange(() => {
                processElement(subtreeRoot);
                if (window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
                    window.ShadowWalker.walk(subtreeRoot, processElement);
                }
            });
            if (fixedCount > 0) {
                console.log(`PaletteLive: Text contrast enforced on ${fixedCount} elements (subtree)`);
            }
            return fixedCount;
        }

        // ── Full-DOM path: chunked async to prevent main-thread freeze ───────
        // Use querySelectorAll instead of ShadowWalker.walk — Chrome's native
        // selector engine collects only matching nodes and is ~50× faster than
        // a JS callback visiting every element.  Results are then processed in
        // CHUNK_SIZE batches separated by setTimeout(0) so the browser can
        // handle input/rendering between chunks and the page never freezes.
        const _tagSel =
            'h1,h2,h3,h4,h5,h6,p,span,a,li,label,td,th,caption,' +
            'figcaption,blockquote,cite,q,abbr,em,strong,b,i,u,s,small,sub,sup,' +
            'mark,code,pre,summary,dt,dd,button,legend,input,textarea,select,option,' +
            'time,address,var,samp,kbd,' +
            'div,section,article,main,aside,header,footer,nav,' +
            '[role="heading"],[role="button"],[role="link"],[role="menuitem"],' +
            '[contenteditable="true"]';
        const _candidates = [];
        try {
            document.querySelectorAll(_tagSel).forEach(el => _candidates.push(el));
        } catch (e) { /* ignore */ }
        [document.documentElement, document.body].forEach(root => {
            if (root) _candidates.unshift(root);
        });

        // Hard cap: elements beyond MAX_ELEMENTS are likely off-screen on
        // high-churn pages (Reddit, Twitter). They will be caught by the next
        // scroll/mutation-triggered pass once they scroll into view.
        const _MAX_EL = 3000;
        if (_candidates.length > _MAX_EL) _candidates.length = _MAX_EL;

        const _CHUNK = 60;
        let _ci = 0;
        const _runChunk = () => {
            performDOMChange(() => {
                const end = Math.min(_ci + _CHUNK, _candidates.length);
                while (_ci < end) processElement(_candidates[_ci++]);
            });
            if (_ci < _candidates.length) {
                setTimeout(_runChunk, 0);
            } else if (fixedCount > 0) {
                console.log(`PaletteLive: Text contrast enforced on ${fixedCount} elements`);
            }
        };
        _runChunk();
        return 0; // async — count is not available synchronously
    }

    function checkMatch(computed, target) {
        if (!computed || !target) return false;
        if (window.ColorUtils.isTransparent(computed)) return false;

        const computedHex = window.ColorUtils.rgbToHex8(computed).toLowerCase();
        const targetHex = window.ColorUtils.rgbToHex8(target).toLowerCase();

        if (computedHex === targetHex) return true;

        // Use fuzzy matching for fallbacks
        return window.ColorUtils.areSimilar(computedHex, targetHex, 10);
    }

    function toRgba(hex, alpha) {
        const rgb = window.ColorUtils.hexToRgb(hex);
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    }

    function ensureHighlightStyle() {
        return ensureStyleElement(highlightStyleId);
    }

    function clearHighlight() {
        highlightedElements.forEach(element => {
            try {
                element.removeAttribute('data-pl-highlight');
            } catch (error) {
                // Ignore element cleanup failures.
            }
        });
        highlightedElements.clear();

        const style = document.getElementById(highlightStyleId);
        if (style) {
            style.textContent = '';
        }
    }

    function highlightColor(colorValue) {
        clearHighlight();
        if (!colorValue) return;

        ensureColorMap();

        const hex = window.ColorUtils.rgbToHex8(colorValue).toLowerCase();
        const entries = colorElementMap.get(hex);
        if (!entries || !entries.length) return;

        entries.forEach(({ element }) => {
            if (highlightedElements.has(element)) return;
            try {
                element.setAttribute('data-pl-highlight', '');
                highlightedElements.add(element);
            } catch (error) {
                // Ignore attribute assignment failures.
            }
        });

        updateHighlightStyle(hex);
    }

    function highlightElement(element, colorValue) {
        clearHighlight();
        if (!element || !colorValue) return;

        try {
            element.setAttribute('data-pl-highlight', '');
            highlightedElements.add(element);

            const hex = window.ColorUtils.rgbToHex8(colorValue).toLowerCase();
            updateHighlightStyle(hex);
        } catch (error) {
            // Ignore
        }
    }

    function toRgba(hex, alpha) {
        const { r, g, b } = window.ColorUtils.hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function updateHighlightStyle(hex) {
        const style = ensureHighlightStyle();
        const glow = toRgba(hex, 0.35);
        style.textContent = [
            '[data-pl-highlight] {',
            `  outline: 2px solid ${hex} !important;`,
            '  outline-offset: 2px !important;',
            `  box-shadow: 0 0 0 2px ${glow} !important;`,
            '  transition: outline-color 200ms ease, box-shadow 200ms ease;',
            '}'
        ].join('\n');
    }

    // Expose helpers for dropper.js
    window.__plHighlightColor = highlightColor;
    window.__plHighlightElement = highlightElement;
    window.__plClearHighlight = clearHighlight;

    function clonePlainObject(value) {
        return JSON.parse(JSON.stringify(value || {}));
    }

    function ensureComparisonStyle() {
        const style = ensureStyleElement(comparisonStyleId);
        style.textContent = [
            `#${comparisonOverlayId} { position: fixed; inset: 0; z-index: 2147483646; pointer-events: auto; --pl-divider: 50%; cursor: ew-resize; user-select: none; }`,
            `#${comparisonOverlayId} .pl-compare-before, #${comparisonOverlayId} .pl-compare-after { position: absolute; inset: 0; background-repeat: no-repeat; background-size: 100% auto; background-position: top left; }`,
            `#${comparisonOverlayId} .pl-compare-before { clip-path: inset(0 calc(100% - var(--pl-divider)) 0 0); }`,
            `#${comparisonOverlayId} .pl-compare-after { clip-path: inset(0 0 0 var(--pl-divider)); }`,
            `#${comparisonOverlayId} .pl-compare-divider { position: absolute; top: 0; bottom: 0; left: var(--pl-divider); width: 2px; transform: translateX(-1px); background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35); }`,
            `#${comparisonOverlayId} .pl-compare-badge { position: absolute; left: 12px; top: 12px; padding: 4px 8px; border-radius: 6px; font: 600 12px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; color: #fff; background: rgba(0, 0, 0, 0.55); pointer-events: none; }`,
            `#${comparisonOverlayId} .pl-compare-close { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border: none; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #fff; font: 700 16px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; cursor: pointer; }`,
            `#${comparisonOverlayId} .pl-compare-close:hover { background: rgba(0, 0, 0, 0.7); }`
        ].join('\n');
    }

    function hideComparisonOverlay() {
        if (comparisonPointerCleanup) {
            try {
                comparisonPointerCleanup();
            } catch (error) {
                // Ignore cleanup failures.
            }
            comparisonPointerCleanup = null;
        }

        const overlay = document.getElementById(comparisonOverlayId);
        if (overlay) {
            overlay.remove();
        }

        const style = document.getElementById(comparisonStyleId);
        if (style) {
            style.textContent = '';
        }
    }

    function isSafeCssImageUrl(url) {
        if (typeof url !== 'string') return false;
        if (url.startsWith('data:image/')) return true;
        if (url.startsWith('https://')) return true;
        return false;
    }

    function sanitizeCssUrl(url) {
        return url.replace(/["\\()]/g, '');
    }

    function showComparisonOverlay(payload) {
        const beforeImage = payload.beforeImage;
        const afterImage = payload.afterImage;
        if (!beforeImage || !afterImage) {
            throw new Error('Missing comparison images');
        }
        if (!isSafeCssImageUrl(beforeImage) || !isSafeCssImageUrl(afterImage)) {
            throw new Error('Invalid comparison image URL: only data:image/ and https:// are allowed');
        }

        hideComparisonOverlay();
        ensureComparisonStyle();

        const overlay = document.createElement('div');
        overlay.id = comparisonOverlayId;
        overlay.innerHTML = [
            '<div class="pl-compare-before"></div>',
            '<div class="pl-compare-after"></div>',
            '<div class="pl-compare-divider" role="separator" aria-label="Comparison divider"></div>',
            '<div class="pl-compare-badge">Before | After</div>',
            '<button type="button" class="pl-compare-close" aria-label="Close comparison">x</button>'
        ].join('');

        const beforePane = overlay.querySelector('.pl-compare-before');
        const afterPane = overlay.querySelector('.pl-compare-after');
        const closeBtn = overlay.querySelector('.pl-compare-close');

        beforePane.style.backgroundImage = `url("${sanitizeCssUrl(beforeImage)}")`;
        afterPane.style.backgroundImage = `url("${sanitizeCssUrl(afterImage)}")`;
        let divider = Number(payload.divider);
        if (!Number.isFinite(divider)) divider = 50;

        const setDivider = (value) => {
            const safe = Math.max(0, Math.min(100, value));
            overlay.style.setProperty('--pl-divider', `${safe}%`);
        };

        const toDivider = (event) => {
            const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
            return (event.clientX / width) * 100;
        };

        setDivider(divider);

        let dragging = false;
        const onPointerDown = (event) => {
            dragging = true;
            setDivider(toDivider(event));
            event.preventDefault();
        };
        const onPointerMove = (event) => {
            if (!dragging) return;
            setDivider(toDivider(event));
            event.preventDefault();
        };
        const onPointerUp = () => {
            dragging = false;
        };

        overlay.addEventListener('pointerdown', onPointerDown);
        overlay.addEventListener('pointermove', onPointerMove);
        overlay.addEventListener('pointerup', onPointerUp);
        overlay.addEventListener('pointercancel', onPointerUp);

        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            hideComparisonOverlay();
            try {
                chrome.runtime.sendMessage({ type: 'PL_COMPARISON_OVERLAY_CLOSED' });
            } catch (error) {
                // Ignore popup-messaging failures when popup is closed.
            }
        });

        comparisonPointerCleanup = () => {
            overlay.removeEventListener('pointerdown', onPointerDown);
            overlay.removeEventListener('pointermove', onPointerMove);
            overlay.removeEventListener('pointerup', onPointerUp);
            overlay.removeEventListener('pointercancel', onPointerUp);
        };

        document.documentElement.appendChild(overlay);
    }

    function suspendForComparison() {
        if (comparisonSnapshot) return;

        const injectorState = (window.Injector && window.Injector.state)
            ? {
                variables: clonePlainObject(window.Injector.state.variables),
                selectors: clonePlainObject(window.Injector.state.selectors)
            }
            : { variables: {}, selectors: {} };

        comparisonSnapshot = {
            raw: Array.from(rawOverrideState.entries()).map(([original, current]) => ({ original, current })),
            injectorState,
            heatmapActive: !!(window.Heatmap && window.Heatmap.isActive)
        };

        if (comparisonSnapshot.heatmapActive && window.Heatmap) {
            window.Heatmap.toggle(false);
        }

        // Pause the observer and watchdog during comparison to prevent them from
        // rebuilding the color map or re-applying overrides before the 'before'
        // screenshot is captured.
        if (observer) {
            observer.disconnect();
        }
        stopOverrideWatchdog();

        resetAllOverrides({ preserveScheme: true, preserveVision: true, skipObserverReconnect: true });
    }

    function restoreAfterComparison() {
        if (!comparisonSnapshot) return;

        const snapshot = comparisonSnapshot;
        comparisonSnapshot = null;

        if (window.Injector) {
            window.Injector.reset();
            window.Injector.apply(snapshot.injectorState || {});
        }

        if (Array.isArray(snapshot.raw)) {
            snapshot.raw.forEach(entry => {
                if (!entry || !entry.original || !entry.current) return;
                applyRawOverride({ original: entry.original, current: entry.current });
            });
        }

        if (snapshot.heatmapActive && window.Heatmap) {
            window.Heatmap.toggle(true);
        }

        buildColorMap();

        // Re-initialize the observer and watchdog that were paused during comparison
        if (observer && document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        }
        if (rawOverrideState.size > 0) {
            startOverrideWatchdog();
        }
    }

    function applySavedPalette(savedData) {
        if (!savedData || !savedData.overrides) return;

        buildColorMap();

        if (window.Injector && typeof window.Injector.apply === 'function') {
            window.Injector.apply(savedData.overrides);
        } else {
            console.warn('PaletteLive: Injector not available, skipping apply');
        }

        if (savedData.overrides.raw) {
            Object.entries(savedData.overrides.raw).forEach(([original, current]) => {
                applyRawOverride({ original, current });
            });
        }

        if (savedData.settings && savedData.settings.scheme) {
            setColorScheme(savedData.settings.scheme);
        }
        if (savedData.settings && savedData.settings.vision) {
            setVisionMode(savedData.settings.vision);
        }

        // Re-run text contrast enforcement with the saved palette hexes
        const paletteHexes = Array.isArray(savedData.appliedPaletteHexes)
            ? savedData.appliedPaletteHexes
            : null;
        if (paletteHexes && paletteHexes.length) {
            _lastPaletteHexes = paletteHexes;
            _textContrastFixed = new WeakSet();
            _flushContrastCache();
            // Three passes — same strategy as APPLY_OVERRIDE_BULK
            setTimeout(() => {
                enforceTextContrast(paletteHexes);
                setTimeout(() => {
                    enforceTextContrast(paletteHexes);
                }, 300);
            }, 150);
            const idleCb = typeof requestIdleCallback === 'function'
                ? requestIdleCallback
                : (fn) => setTimeout(fn, 1000);
            idleCb(() => {
                if (_lastPaletteHexes === paletteHexes) {
                    enforceTextContrast(paletteHexes);
                }
            }, { timeout: 2000 });
        }
    }

    // Observer rate-limiting state
    let observerRescanCount = 0;
    let observerRescanWindow = Date.now();
    const OBSERVER_MAX_RESCANS_PER_MINUTE = 30;
    let observerPaused = false;

    function processAddedSubtree(node) {
        if (!node || node.nodeType !== 1) return;

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

        const processElement = (element) => {
            // When a media element enters the DOM (lazy-loaded image/video),
            // remove bg-color overrides from its ancestor containers so it's visible.
            if (_MEDIA_TAGS.has(element.tagName) && rawOverrideState.size > 0) {
                _undoBgOverridesForMedia(element);
            }

            try {
                const style = window.getComputedStyle(element);
                props.forEach(({ js, css }) => {
                    const value = style[js];
                    if (!value || window.ColorUtils.isTransparent(value)) return;
                    if (value === 'auto' || value === 'initial' || value === 'inherit' || value === 'currentcolor' || value === 'currentColor') return;

                    const hex = window.ColorUtils.rgbToHex8(value).toLowerCase();
                    if (!hex || (hex === '#000000' && value === 'rgba(0, 0, 0, 0)')) return;

                    if (!colorElementMap.has(hex)) {
                        colorElementMap.set(hex, []);
                    }
                    colorElementMap.get(hex).push({ element, cssProp: css });

                    // Auto-apply existing overrides to new elements
                    if (rawOverrideState.has(hex)) {
                        // Skip bg-color on image containers
                        if (css === 'background-color' && _isImageContainer(element)) return;
                        // Never re-apply a color override on an element whose text
                        // was already fixed by enforceTextContrast — would undo the
                        // fix and make text invisible again.
                        if (css === 'color' && _textContrastFixed.has(element)) return;
                        const current = rawOverrideState.get(hex);
                        // Pre-visibility check: if applying this text-color override
                        // would produce unreadable text (CR < 4.5 against the
                        // effective background), skip the override entirely.  The
                        // post-subtree enforceTextContrast call will assign
                        // the best readable colour instead.
                        if (css === 'color') {
                            try {
                                const effBg = _getEffectiveBg(element);
                                if (_contrastRatio(current, effBg) < 4.5) return;
                            } catch (e) { /* ignore — proceed with override */ }
                        }
                        try {
                            captureInlineSnapshot(element, css);
                            if (element.style.getPropertyPriority(css) === 'important') {
                                element.style.removeProperty(css);
                            }
                            element.style.setProperty(css, current, 'important');
                        } catch (error) {
                            // Ignore per-element apply errors.
                        }
                    }
                });

                try {
                    const accent = style.accentColor;
                    if (accent && accent !== 'auto' && accent !== 'initial') {
                        const hex = window.ColorUtils.rgbToHex8(accent).toLowerCase();
                        if (hex) {
                            if (!colorElementMap.has(hex)) colorElementMap.set(hex, []);
                            colorElementMap.get(hex).push({ element, cssProp: 'accent-color' });
                        }
                    }
                } catch (error) { /* ignore */ }
            } catch (error) {
                // Ignore per-element failures.
            }
        };

        if (window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
            window.ShadowWalker.walk(node, processElement);
        }
        // Also process the node itself if it's an element
        processElement(node);

        // Enforce text contrast immediately on the newly processed subtree.
        // We call per-subtree (not global) so it's fast even on React pages
        // where dozens of nodes are added per second. A debounced global pass
        // would keep getting pushed back and never fire during initial render.
        if (_lastPaletteHexes && _lastPaletteHexes.length && rawOverrideState.size > 0) {
            enforceTextContrast(_lastPaletteHexes, node);
            // Deferred single debounced full-document pass: newly injected elements
            // may not have been laid out yet when the immediate call above runs, so
            // they get skipped by the offsetWidth/offsetHeight guard.  Instead of
            // spawning one timer per node (causes timer explosions on Reddit, Pinterest)
            // we funnel ALL pending additions into ONE shared debounced 400ms sweep.
            // By 400ms the browser has completed layout for all injected nodes.
            _scheduleDeferredContrast();
        }
    }

    // ── Mutation Observer ─────────────────────────────────────────

    const observerConfig = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
    };

    function createObserver() {
        if (observer) return; // already created

        observer = new MutationObserver((mutations) => {
            // Check if extension is paused
            if (__plPaused) return;
            // Check if we are currently applying overrides (should be caught by performDOMChange, but safely check)
            if (window.__plIsApplyingOverrides) return;

            // Rate-limit: reset counter every 60 seconds
            const now = Date.now();
            if (now - observerRescanWindow > 60000) {
                observerRescanCount = 0;
                observerRescanWindow = now;
                if (observerPaused) {
                    observerPaused = false;
                    console.log('PaletteLive: Observer auto-sync resumed');
                }
            }

            if (observerPaused) return;

            const hasStructureChanges = mutations.some(mutation => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0);
            const hasAttributeChanges = mutations.some(mutation => mutation.type === 'attributes');

            if (!hasStructureChanges && !hasAttributeChanges) return;

            // Check if attribute changes are ONLY from our own highlights or styles
            // This is a backup check in case performDOMChange wasn't used
            if (hasAttributeChanges && !hasStructureChanges) {
                const innerMutations = mutations.every(m => {
                    // Ignore mutations to our own elements
                    if (m.target.id && (m.target.id.startsWith('palettelive') || m.target.id.startsWith('pl-'))) return true;
                    // We can't easily distinguish style changes on elements, so we rely on debouncing
                    return false;
                });
                if (innerMutations) return;
            }

            // Check rate limit
            observerRescanCount++;
            if (observerRescanCount > OBSERVER_MAX_RESCANS_PER_MINUTE) {
                observerPaused = true;
                console.warn('PaletteLive: High DOM activity detected. Auto-sync paused for 60s.');
                return;
            }

            if (hasStructureChanges) {
                // Incremental: process only newly added nodes
                const addedNodes = [];
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) addedNodes.push(node);
                    });
                });

                if (addedNodes.length > 0 && addedNodes.length <= 50) {
                    // Small batch: process incrementally (200ms debounce)
                    clearTimeout(rebuildTimer);
                    rebuildTimer = setTimeout(() => {
                        if (isRescanning) return;
                        if (_plBulkApplyCooldown) {
                            // During the post-apply cooldown we must NOT re-run
                            // processAddedSubtree (it would create override feedback
                            // loops), but we MUST still enforce text contrast on
                            // any freshly added elements (e.g. React re-renders
                            // happening while the cooldown is active).  Contrast
                            // enforcement only sets 'color' — never unsafe overrides.
                            if (_lastPaletteHexes && _lastPaletteHexes.length) {
                                addedNodes.forEach(node => enforceTextContrast(_lastPaletteHexes, node));
                            }
                            return;
                        }
                        addedNodes.forEach(node => processAddedSubtree(node));
                    }, 200);
                } else if (addedNodes.length > 50) {
                    // Large batch: full rebuild (400ms debounce, includes reapplyAllOverrides)
                    clearTimeout(rebuildTimer);
                    rebuildTimer = setTimeout(() => {
                        if (isRescanning) return;
                        if (_plBulkApplyCooldown) {
                            // Same cooldown policy: skip the expensive rebuild but
                            // still enforce contrast on the full document.
                            if (_lastPaletteHexes && _lastPaletteHexes.length) {
                                enforceTextContrast(_lastPaletteHexes);
                            }
                            return;
                        }
                        console.log('PaletteLive: DOM changed significantly, full rebuild');
                        buildColorMap();
                    }, 400);
                }
            }

            if (hasAttributeChanges && !hasStructureChanges) {
                // Attribute-only changes (class/style toggling) — debounced rebuild + reapply (500ms)
                clearTimeout(rebuildTimer);
                rebuildTimer = setTimeout(() => {
                    if (isRescanning) return;
                    if (_plBulkApplyCooldown) {
                        // Attribute changes can flip background colours (class
                        // toggles on frameworks) — re-check contrast even during
                        // cooldown so text doesn't go invisible.
                        if (_lastPaletteHexes && _lastPaletteHexes.length) {
                            enforceTextContrast(_lastPaletteHexes);
                        }
                        return;
                    }
                    buildColorMap();
                }, 500);
            }
        });
    }

    function startObserver() {
        if (!observer) createObserver();
        if (observer && document.body) {
            observer.observe(document.body, observerConfig);
        } else if (!document.body) {
            setTimeout(startObserver, 100);
        }
    }

    function stopObserver() {
        if (observer) {
            observer.disconnect();
        }
    }

    /**
     * Execute a DOM modification while pausing the MutationObserver.
     * Prevents infinite loops where our own style applications trigger a re-scan.
     * Supports nested calls via reference counting.
     */
    window.__plPerformDOMChangeDepth = 0;

    function performDOMChange(callback) {
        if (window.__plPerformDOMChangeDepth === 0) {
            window.__plIsApplyingOverrides = true;
            stopObserver();
        }
        window.__plPerformDOMChangeDepth++;

        try {
            callback();
        } finally {
            window.__plPerformDOMChangeDepth--;
            if (window.__plPerformDOMChangeDepth === 0) {
                window.__plIsApplyingOverrides = false;
                startObserver();
            }
        }
    }

    // Replace original initObserver with startObserver
    // initObserver(); -> removed, call startObserver() instead

    // ── Scroll-based Override Re-application ───────────────────────
    // Catches dynamically loaded content on scroll (virtual scrollers, lazy-load,
    // IntersectionObserver-driven rendering) that may not trigger MutationObserver.
    let _plScrollReapplyTimer = null;
    let _plLastScrollReapply = 0;

    window.addEventListener('scroll', () => {
        if (__plPaused) return;
        if (isRescanning) return; // never compete with an in-flight rescan
        if (_plBulkApplyCooldown) return; // suppress during post-apply cooldown
        if (rawOverrideState.size === 0) return; // nothing to re-apply

        clearTimeout(_plScrollReapplyTimer);
        _plScrollReapplyTimer = setTimeout(() => {
            if (isRescanning) return; // double-check after debounce
            const now = Date.now();
            // Throttle to at most once per 1500ms
            if (now - _plLastScrollReapply < 1500) return;
            _plLastScrollReapply = now;
            // Lightweight re-apply — only touches elements already in the map.
            // Avoids the expensive full DOM walk that buildColorMap() does.
            reapplyAllOverrides();
        }, 500);
    }, { passive: true });

    // ── Periodic Override Watchdog ─────────────────────────────────
    // Detects when the page silently reverts overrides (React reconciliation,
    // CSS animations, framework re-renders) and forces re-application.
    let _plWatchdogTimer = null;
    let _plWatchdogNoDriftCount = 0; // adaptive: count consecutive no-drift ticks
    const _WATCHDOG_FAST_MS = 5000;  // default interval
    const _WATCHDOG_SLOW_MS = 10000; // slow interval after 3 consecutive no-drift ticks

    function startOverrideWatchdog() {
        if (_plWatchdogTimer) return;
        _plWatchdogNoDriftCount = 0;

        const _runWatchdogTick = () => {
            if (__plPaused) return;
            if (isRescanning) return; // never compete with an in-flight rescan
            if (_plBulkApplyCooldown) return; // suppress during post-apply cooldown
            if (rawOverrideState.size === 0) return;

            let drifted = 0;
            const sampleLimit = 100; // reduced from 200 to lower per-tick cost
            let checked = 0;

            rawOverrideState.forEach((currentHex, originalHex) => {
                if (checked >= sampleLimit) return;
                const entries = colorElementMap.get(originalHex);
                if (!entries || !entries.length) return;

                for (const { element, cssProp } of entries) {
                    if (checked >= sampleLimit) break;
                    if (!element.isConnected) continue;
                    // Skip text color on elements fixed by enforceTextContrast
                    if (cssProp === 'color' && _textContrastFixed.has(element)) {
                        checked++;
                        continue;
                    }
                    try {
                        const jsName = cssPropToJs(cssProp);
                        const computed = window.getComputedStyle(element)[jsName];
                        if (!computed) continue;
                        const computedHex = window.ColorUtils.rgbToHex8(computed).toLowerCase();
                        if (computedHex !== currentHex) {
                            drifted++;
                        }
                        checked++;
                    } catch (e) { /* ignore */ }
                }
            });

            if (drifted > 0) {
                _plWatchdogNoDriftCount = 0;
                console.log(`PaletteLive Watchdog: ${drifted}/${checked} overrides drifted, re-applying...`);
                reapplyAllOverrides();
            } else {
                _plWatchdogNoDriftCount++;
            }

            // Adaptive interval: slow down after 3 consecutive no-drift ticks
            const nextMs = _plWatchdogNoDriftCount >= 3 ? _WATCHDOG_SLOW_MS : _WATCHDOG_FAST_MS;
            _plWatchdogTimer = setTimeout(_runWatchdogTick, nextMs);
        };

        _plWatchdogTimer = setTimeout(_runWatchdogTick, _WATCHDOG_FAST_MS);
    }

    function stopOverrideWatchdog() {
        if (_plWatchdogTimer) {
            clearTimeout(_plWatchdogTimer);
            _plWatchdogTimer = null;
        }
    }

    // Auto-apply saved palette on page load.
    // Check if extension is paused for this domain first.
    const domain = window.location.hostname;

    function __plStartBackgroundWork() {
        startObserver();
        startOverrideWatchdog();
    }

    if (window.StorageUtils && domain) {
        // Check paused state first
        const pausedKey = `palettelive_paused_${domain}`;
        chrome.storage.local.get(pausedKey, (result) => {
            if (result[pausedKey]) {
                __plPaused = true;
                console.log('PaletteLive: Extension is paused for', domain);
                return; // Don't start observers or apply saved palette
            }

            // Not paused — proceed normally
            window.StorageUtils.getPalette(domain)
                .then(savedData => {
                    if (savedData && savedData.overrides) {
                        console.log('Applying saved palette for', domain);
                        applySavedPalette(savedData);
                    } else if (savedData && savedData.settings) {
                        if (savedData.settings.scheme) {
                            setColorScheme(savedData.settings.scheme);
                        }
                        if (savedData.settings.vision) {
                            setVisionMode(savedData.settings.vision);
                        }
                    }
                })
                .catch(() => {
                    // Ignore load failures.
                });

            __plStartBackgroundWork();
        });
    } else {
        __plStartBackgroundWork();
    }

    // ── SPA Route Detection ──────────────────────────────────────
    // Hook into History API to detect client-side navigation (React Router, Vue Router, etc.)
    let _plLastUrl = location.href;
    let _plRouteTimer = null;

    function onRouteChange() {
        if (__plPaused) return;
        const newUrl = location.href;
        if (newUrl === _plLastUrl) return;
        _plLastUrl = newUrl;

        clearTimeout(_plRouteTimer);
        _plRouteTimer = setTimeout(() => {
            console.log('PaletteLive: SPA route change detected, rebuilding color map');
            buildColorMap();
        }, 600);
    }

    // Intercept pushState / replaceState
    const _origPushState = history.pushState;
    const _origReplaceState = history.replaceState;

    history.pushState = function () {
        _origPushState.apply(this, arguments);
        onRouteChange();
    };

    history.replaceState = function () {
        _origReplaceState.apply(this, arguments);
        onRouteChange();
    };

    window.addEventListener('popstate', onRouteChange);

    // ── Multi-tab Sync ──────────────────────────────────────────
    // When another tab modifies storage for the same domain, sync overrides.
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (__plPaused) return;
        if (areaName !== 'local') return;
        const domain = window.location.hostname;
        const key = `palette_${domain}`;
        if (!changes[key]) return;

        const newData = changes[key].newValue;
        if (!newData) {
            // Data was deleted — reset all overrides
            resetAllOverrides();
            console.log('PaletteLive: multi-tab sync — overrides cleared by another tab');
            return;
        }

        // Sync raw overrides from storage
        const storedRaw = (newData.overrides && newData.overrides.raw) || {};
        const currentKeys = new Set(rawOverrideState.keys());
        const storedKeys = new Set();

        for (const [original, current] of Object.entries(storedRaw)) {
            const origHex = window.ColorUtils.rgbToHex8(original).toLowerCase();
            const currHex = window.ColorUtils.rgbToHex8(current).toLowerCase();
            storedKeys.add(origHex);

            if (rawOverrideState.get(origHex) !== currHex) {
                applyRawOverride({ original: origHex, current: currHex });
            }
        }

        // Remove overrides that no longer exist in storage
        for (const origHex of currentKeys) {
            if (!storedKeys.has(origHex)) {
                removeRawOverride(origHex);
            }
        }

        console.log('PaletteLive: multi-tab sync — overrides updated from another tab');
    });

    // Patch Dropper to use secure event dispatching (prevents page-spoofed events)
    if (window.Dropper) {
        window.Dropper.__dispatchSecure = dispatchSecureDropperEvent;
    }

    // Expose highlight functions for the dropper to call during pick mode
    window.__plHighlightColor = highlightColor;
    window.__plClearHighlight = clearHighlight;

    // Dropper integration events (with security validation).
    window.addEventListener('pl-dropper-override', (event) => {
        try {
            // Validate event is trusted and has correct secret
            if (!isValidDropperEvent(event)) {
                console.warn('PaletteLive: rejected untrusted pl-dropper-override event');
                return;
            }

            const detail = event.detail || {};
            if (!detail.original || !detail.current) return;

            const originalHex = window.ColorUtils.rgbToHex8(detail.original).toLowerCase();
            const currentHex = window.ColorUtils.rgbToHex8(detail.current).toLowerCase();

            if (originalHex === currentHex) {
                removeRawOverride(originalHex);
            } else {
                applyRawOverride({ original: originalHex, current: currentHex, targetElement: detail.targetElement });
            }
        } catch (error) {
            console.warn('PaletteLive: dropper override error', error);
        }
    });

    window.addEventListener('pl-dropper-save', (event) => {
        try {
            // Validate event is trusted and has correct secret
            if (!isValidDropperEvent(event)) {
                console.warn('PaletteLive: rejected untrusted pl-dropper-save event');
                return;
            }

            const detail = event.detail || {};
            if (!detail.original || !detail.current) return;

            const originalHex = window.ColorUtils.rgbToHex8(detail.original).toLowerCase();
            const currentHex = window.ColorUtils.rgbToHex8(detail.current).toLowerCase();

            if (originalHex === currentHex) {
                removeRawOverride(originalHex);
            } else {
                applyRawOverride({ original: originalHex, current: currentHex, targetElement: detail.targetElement });
            }

            const currentDomain = window.location.hostname;
            if (!window.StorageUtils || !currentDomain) return;

            window.StorageUtils.getPalette(currentDomain)
                .then(data => {
                    const newData = data || {};
                    if (!newData.overrides) newData.overrides = {};
                    if (!newData.overrides.variables) newData.overrides.variables = {};
                    if (!newData.overrides.raw) newData.overrides.raw = {};
                    if (!newData.settings) newData.settings = {};

                    if (originalHex === currentHex) {
                        delete newData.overrides.raw[originalHex];
                    } else {
                        newData.overrides.raw[originalHex] = currentHex;
                    }
                    newData.timestamp = new Date().toISOString();

                    return window.StorageUtils.savePalette(currentDomain, newData);
                })
                .then(() => {
                    console.log(`PaletteLive: Saved dropper override ${detail.original} -> ${detail.current}`);
                })
                .catch(error => {
                    console.warn('PaletteLive: dropper save error', error);
                });
        } catch (error) {
            console.warn('PaletteLive: dropper save error', error);
        }
    });

    // Mark content script as fully initialized
    window.__paletteLiveReady = true;
    console.log('PaletteLive content script ready');

})();









