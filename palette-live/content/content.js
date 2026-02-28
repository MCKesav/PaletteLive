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

    PLLog.info('Content script loaded (v' + CONTENT_SCRIPT_VERSION + ')');

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
        window.dispatchEvent(
            new CustomEvent(eventName, {
                detail: { ...data, _plSecret: _plDropperSecret },
            })
        );
    }

    // Key: normalized source hex color, Value: Array of { element, cssProp }
    const colorElementMap = new Map();

    // WeakMap<Element, Map<cssProp, { hadInline, value, priority }>>
    const overrideMap = new WeakMap();
    let overrideRefs = [];

    // Periodically prune dead WeakRefs to prevent unbounded array growth.
    // Runs every 60s — lightweight O(n) scan that removes dereferenced entries.
    const _WEAKREF_PRUNE_INTERVAL_MS = PLConfig.WEAKREF_PRUNE_INTERVAL_MS;
    let _weakRefPruneTimer = null;

    function startWeakRefPruneTimer() {
        if (_weakRefPruneTimer) clearInterval(_weakRefPruneTimer);
        _weakRefPruneTimer = setInterval(() => {
            const before = overrideRefs.length;
            overrideRefs = overrideRefs.filter((ref) => ref.deref() !== undefined);
            if (before !== overrideRefs.length) {
                PLLog.debug(
                    `PaletteLive: Pruned ${before - overrideRefs.length} dead WeakRefs (${overrideRefs.length} remaining)`
                );
            }

            // Prune colorElementMap — remove entries referencing detached DOM nodes.
            // On infinite-scroll / SPA pages, elements are added via processAddedSubtree
            // but never removed, causing unbounded Map growth.
            let prunedEntries = 0;
            for (const [hex, entries] of colorElementMap) {
                const beforeLen = entries.length;
                const filtered = entries.filter((e) => e.element && e.element.isConnected);
                if (filtered.length !== beforeLen) {
                    prunedEntries += beforeLen - filtered.length;
                    if (filtered.length === 0) {
                        colorElementMap.delete(hex);
                    } else {
                        colorElementMap.set(hex, filtered);
                    }
                }
            }
            if (prunedEntries > 0) {
                PLLog.debug(
                    `PaletteLive: Pruned ${prunedEntries} detached element refs from colorElementMap (${colorElementMap.size} colors remaining)`
                );
            }
        }, _WEAKREF_PRUNE_INTERVAL_MS);
    }
    startWeakRefPruneTimer();

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

    // Scan-in-progress guard — prevents concurrent Extractor.scan() calls
    // (e.g. when the user spams the popup open/close or rescan button).
    let _scanInProgress = false;

    // ── Scan result cache ──────────────────────────────────────────
    // Caches the last Extractor.scan() result in memory so reopening the
    // popup on the same page is instant (no DOM re-walk).
    // Invalidated on SPA navigation or when the user explicitly rescans.
    const _SCAN_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
    let _scanCache = null; // { url: string, data: object, ts: number } | null

    // Paused state — when true, all background activity is suspended
    let __plPaused = false;

    // ── Extension context invalidation detection ───────────────────
    // When the extension is updated/reloaded, the content script's context
    // becomes invalid and all chrome.runtime.* calls will throw.
    let _plContextInvalidated = false;

    /**
     * Safely send a message via chrome.runtime.sendMessage.
     * Detects context invalidation and gracefully degrades.
     */
    function safeSendRuntimeMessage(message, callback) {
        if (_plContextInvalidated) return;
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    // "message port closed" just means the popup was closed while
                    // we were sending — this is normal after dropper/compare use.
                    // Only a true "Extension context invalidated" error means our
                    // own execution context is gone and we should stop all activity.
                    if (msg.includes('Extension context invalidated')) {
                        _plContextInvalidated = true;
                        _handleContextInvalidation();
                        return;
                    }
                    // Silently swallow other transient errors (receiving end gone, etc.)
                    return;
                }
                if (typeof callback === 'function') callback(response);
            });
        } catch (error) {
            if (error.message && error.message.includes('Extension context invalidated')) {
                _plContextInvalidated = true;
                _handleContextInvalidation();
            }
        }
    }

    /**
     * Clean up when extension context is invalidated.
     * Stops all timers, observers, and background activity.
     */
    function _handleContextInvalidation() {
        PLLog.info('Extension context invalidated (extension was updated or reloaded). Gracefully stopping activity.');
        __plPaused = true;
        stopObserver();
        stopOverrideWatchdog();
        clearTimeout(rebuildTimer);
        clearTimeout(_plScrollReapplyTimer);
        clearTimeout(_plRouteTimer);
        clearInterval(_weakRefPruneTimer);
        _weakRefPruneTimer = null;
    }

    // ── Image container detection ──────────────────────────────────
    // Media tag names that display images/video — background-color overrides
    // on these or their containers would hide their visual content.
    const _MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'PICTURE', 'SOURCE']);

    /**
     * Returns true if the element is a media element or tightly wraps one.
     * Used to skip background-color overrides that would obscure images/videos.
     *
     * Hybrid approach:
     *  1. Element IS a media tag → skip
     *  2. Element has background-image url() → skip
     *  3. Element is a TIGHT wrapper around a media descendant (within 2 levels,
     *     media covers >50% of container area) → skip
     *  4. Otherwise (large layout containers like <body>, <main>) → allow override
     */
    function _isImageContainer(element) {
        if (_MEDIA_TAGS.has(element.tagName)) return true;
        // Skip if element has a background-image url (image set via CSS)
        try {
            const bgImg = window.getComputedStyle(element).backgroundImage;
            if (bgImg && bgImg !== 'none' && bgImg.includes('url(')) return true;
        } catch (e) {
            /* ignore */
        }
        return _isTightMediaWrapper(element);
    }

    /**
     * Checks up to 2 levels of descendants for media elements. Returns true only
     * if a media child occupies a significant portion (>50%) of the container's
     * area — i.e. the element is a tight image/video wrapper, not a large layout
     * container that happens to contain images somewhere in its subtree.
     */
    function _isTightMediaWrapper(element) {
        let containerRect = null;
        const getContainerRect = () => {
            if (!containerRect) {
                try {
                    containerRect = element.getBoundingClientRect();
                } catch (e) {
                    return null;
                }
            }
            return containerRect;
        };

        const children = element.children;
        if (!children || !children.length) return false;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (_MEDIA_TAGS.has(child.tagName) && _mediaFillsContainer(child, getContainerRect)) return true;
            // Check one more level (grandchildren)
            const grandchildren = child.children;
            if (grandchildren) {
                for (let j = 0; j < grandchildren.length; j++) {
                    if (
                        _MEDIA_TAGS.has(grandchildren[j].tagName) &&
                        _mediaFillsContainer(grandchildren[j], getContainerRect)
                    )
                        return true;
                }
            }
        }
        return false;
    }

    /** Returns true if the media element covers >50% of the container's width AND height */
    function _mediaFillsContainer(mediaEl, getContainerRect) {
        try {
            const cRect = getContainerRect();
            if (!cRect || cRect.width === 0 || cRect.height === 0) return false;
            const mRect = mediaEl.getBoundingClientRect();
            if (mRect.width === 0 && mRect.height === 0) return false;
            return mRect.width / cRect.width > 0.5 && mRect.height / cRect.height > 0.5;
        } catch (e) {
            return false;
        }
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
            parent.classList.forEach((cls) => {
                if (cls.startsWith('pl-bg-')) toRemove.push(cls);
            });
            toRemove.forEach((cls) => parent.classList.remove(cls));
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
        return new Promise((resolve) => {
            let settled = false;
            const done = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            requestAnimationFrame(() => {
                requestAnimationFrame(done);
            });
            // Fallback: if rAF is throttled (background tab), settle after 100ms
            setTimeout(done, 100);
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

        // Build SVG filter defs using DOM API instead of innerHTML to prevent XSS
        const NS = 'http://www.w3.org/2000/svg';
        const defs = document.createElementNS(NS, 'defs');

        const filters = [
            { id: 'pl-vision-protanopia', values: '0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0' },
            { id: 'pl-vision-deuteranopia', values: '0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0' },
            { id: 'pl-vision-tritanopia', values: '0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0' },
            {
                id: 'pl-vision-achromatopsia',
                values: '0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0',
            },
        ];

        filters.forEach(({ id, values }) => {
            const filter = document.createElementNS(NS, 'filter');
            filter.setAttribute('id', id);
            const matrix = document.createElementNS(NS, 'feColorMatrix');
            matrix.setAttribute('type', 'matrix');
            matrix.setAttribute('values', values);
            filter.appendChild(matrix);
            defs.appendChild(filter);
        });

        svg.appendChild(defs);

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
        variableNames.forEach((name) => {
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
                payload.raw.forEach((raw) => {
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
                PLLog.warn(' Injector not available, skipping variable apply');
            }
        }
        if (payload.removeVariables) {
            removeVariableOverrides(payload.removeVariables);
        }
        return totalApplied;
    }

    /**
     * Validate incoming message structure. Ensures request is an object with a
     * string type and optional payload of the expected shape. Prevents corrupted
     * or malicious payloads from modifying DOM state.
     */
    function _validateMessagePayload(request) {
        if (!request || typeof request !== 'object') return false;
        if (typeof request.type !== 'string') return false;
        // If a payload exists, it must be a plain object
        if (request.payload !== undefined && (typeof request.payload !== 'object' || request.payload === null || Array.isArray(request.payload))) {
            // Allow payload to be absent for many message types
            // Only reject array payloads (object is expected)
            if (Array.isArray(request.payload)) return false;
        }
        // Validate payload sub-fields for override messages
        if (request.type === 'APPLY_OVERRIDE' || request.type === 'APPLY_OVERRIDE_FAST') {
            const p = request.payload;
            if (p) {
                if (p.raw !== undefined && typeof p.raw !== 'object') return false;
                if (p.variables !== undefined && typeof p.variables !== 'object') return false;
            }
        }
        if (request.type === 'APPLY_OVERRIDE_BULK') {
            const p = request.payload;
            if (p) {
                if (p.raw !== undefined && !Array.isArray(p.raw)) return false;
                if (p.variables !== undefined && typeof p.variables !== 'object') return false;
            }
        }
        return true;
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // If context is invalidated, reject all messages
        if (_plContextInvalidated) {
            sendResponse({ success: false, error: 'Extension context invalidated. Please refresh the page.' });
            return false;
        }
        // Deep payload validation — reject malformed messages early
        if (!_validateMessagePayload(request)) {
            PLLog.warn('Rejected malformed message:', request && request.type);
            sendResponse({ success: false, error: 'Invalid message payload' });
            return false;
        }
        try {
            // Ping to check if content script is ready
            if (request.type === 'PING') {
                sendResponse({
                    success: true,
                    ready: window.__paletteLiveReady === true,
                    hasExtractor: typeof window.Extractor !== 'undefined',
                    hasShadowWalker: typeof window.ShadowWalker !== 'undefined',
                    hasEditorPanel: typeof window.EditorPanel !== 'undefined',
                    paused: __plPaused,
                });
                return false;
            }

            // Pause extension — stop all background activity
            if (request.type === 'PAUSE_EXTENSION') {
                __plPaused = true;
                try {
                    sessionStorage.setItem('__plWasActiveBeforeReload', '0');
                } catch (e) {
                    /* ignore */
                }
                stopObserver();
                stopOverrideWatchdog();
                clearTimeout(rebuildTimer);
                clearTimeout(_plScrollReapplyTimer);
                clearTimeout(_plRouteTimer);
                clearInterval(_weakRefPruneTimer);
                _weakRefPruneTimer = null;
                PLLog.info(' Extension paused on this page');
                sendResponse({ success: true });
                return;
            }

            // Resume extension — restart background activity and re-apply saved palette
            if (request.type === 'RESUME_EXTENSION') {
                __plPaused = false;
                try {
                    sessionStorage.setItem('__plWasActiveBeforeReload', '1');
                } catch (e) {
                    /* ignore */
                }
                startObserver();
                startWeakRefPruneTimer();
                if (rawOverrideState.size > 0) {
                    startOverrideWatchdog();
                }
                // Re-apply previously saved palette data for this domain so the
                // user's changes are active as soon as they turn the extension on.
                const _resumeDomain = window.location.hostname;
                if (window.StorageUtils && _resumeDomain) {
                    window.StorageUtils.getPalette(_resumeDomain)
                        .then((savedData) => {
                            if (savedData && savedData.overrides) {
                                PLLog.info(' Re-applying saved palette for', _resumeDomain);
                                applySavedPalette(savedData);
                            } else if (savedData && savedData.settings) {
                                if (savedData.settings.scheme) setColorScheme(savedData.settings.scheme);
                                if (savedData.settings.vision) setVisionMode(savedData.settings.vision);
                            }
                        })
                        .catch(() => {
                            /* ignore */
                        });
                }
                PLLog.info(' Extension resumed on this page');
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
                    PLLog.warn(' Extractor not available yet');
                    sendResponse({ success: false, error: 'Extractor not loaded. Please try again.' });
                    return false;
                }
                if (typeof window.ShadowWalker === 'undefined') {
                    PLLog.warn(' ShadowWalker not available yet');
                    sendResponse({ success: false, error: 'ShadowWalker not loaded. Please try again.' });
                    return false;
                }

                // ── Fast path: return cached scan result ──────────────
                // If the popup is reopened on the same URL within the TTL window,
                // skip the full DOM scan and respond instantly from memory.
                const _nowTs = Date.now();
                if (
                    _scanCache &&
                    _scanCache.url === location.href &&
                    _nowTs - _scanCache.ts < _SCAN_CACHE_TTL_MS
                ) {
                    PLLog.debug('PaletteLive: EXTRACT_PALETTE served from cache');
                    sendResponse({ success: true, data: _scanCache.data });
                    // Ensure colorElementMap is ready for override operations
                    // without blocking the response.
                    if (!colorElementMap.size) setTimeout(buildColorMap, 0);
                    return false;
                }

                // ── Slow path: full DOM scan ───────────────────────────
                // Guard against concurrent scans (user spamming rescan)
                if (_scanInProgress) {
                    PLLog.debug('PaletteLive: Scan already in progress, waiting...');
                    sendResponse({ success: false, error: 'Scan already in progress. Please wait.' });
                    return false;
                }
                _scanInProgress = true;
                window.Extractor.scan()
                    .then((data) => {
                        _scanInProgress = false;
                        // Cache the result for subsequent popup opens on this URL.
                        _scanCache = { url: location.href, data, ts: Date.now() };
                        // Respond to the popup immediately with the scanned colors.
                        // buildColorMap() is a separate full DOM-walk that populates the
                        // element-to-color index used by override operations — it does NOT
                        // affect the color list shown in the popup, so we run it AFTER
                        // sending the response to avoid blocking the popup UI.
                        sendResponse({ success: true, data });
                        try {
                            buildColorMap();
                        } catch (mapError) {
                            PLLog.error(' buildColorMap error:', mapError);
                        }
                    })
                    .catch((error) => {
                        _scanInProgress = false;
                        PLLog.error(' Extraction failed:', error);
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
                    // Three progressive passes discover elements whose effective
                    // backgrounds change as CSS transitions and deferred paints settle.
                    // The bgCache was already flushed by _flushContrastCache() above;
                    // subsequent passes reuse the cache so ancestor walks are O(1).
                    // Pass 1 (150ms): after inline styles settle
                    // Pass 2 (500ms): after CSS transitions complete — flush
                    //                 to pick up transition-induced bg changes
                    // Pass 3 (idle):  after page fully idle — final sweep
                    setTimeout(() => {
                        enforceTextContrast(payload.paletteHexes);
                    }, 150);
                    setTimeout(() => {
                        if (_lastPaletteHexes === payload.paletteHexes) {
                            _flushContrastCache(); // pick up transition-induced bg changes
                            enforceTextContrast(payload.paletteHexes);
                        }
                    }, 500);
                    // Idle pass — fires when the browser has no urgent work
                    const idleCb =
                        typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 2000);
                    idleCb(
                        () => {
                            if (_lastPaletteHexes === payload.paletteHexes) {
                                enforceTextContrast(payload.paletteHexes);
                            }
                        },
                        { timeout: 3000 }
                    );
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
                            } catch (e) {
                                /* ignore */
                            }
                        });
                    }
                    // Update state so watchdog doesn't revert
                    rawOverrideState.set(originalHex, currentHex);

                    // Fast update the fallback CSS variable (instant for elements using fallback classes)
                    const safeId = getSafeId(data.original);
                    if (safeId) {
                        document.documentElement.style.setProperty(`--pl-override-${safeId}`, currentHex, 'important');
                    }

                    // Also update Theme variable if provided
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
                // Always bypass cache — user explicitly requested a fresh scan.
                _scanCache = null;
                resetAllOverrides({ preserveScheme, preserveVision });

                if (typeof window.Extractor === 'undefined') {
                    isRescanning = false;
                    flushPendingOverrides();
                    sendResponse({ success: false, error: 'Extractor not loaded' });
                    return;
                }

                waitForStyleSettle()
                    .then(() => window.Extractor.scan())
                    .then((data) => {
                        // Cache fresh result for next popup open.
                        _scanCache = { url: location.href, data, ts: Date.now() };
                        // Respond immediately — buildColorMap() is post-processing that
                        // does not affect the color list sent to the popup.
                        isRescanning = false;
                        flushPendingOverrides();
                        sendResponse({ success: true, data });
                        try {
                            buildColorMap();
                        } catch (mapError) {
                            PLLog.error(' buildColorMap error:', mapError);
                        }
                    })
                    .catch((error) => {
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
                // Always bypass cache — user explicitly clicked Rescan.
                _scanCache = null;
                // Suspend watchdog & scroll reapply during heavy rescan work
                stopOverrideWatchdog();
                clearTimeout(_plScrollReapplyTimer);

                waitForStyleSettle()
                    .then(() => window.Extractor.scan())
                    .then((data) => {
                        // Cache fresh result for next popup open.
                        _scanCache = { url: location.href, data, ts: Date.now() };
                        // Respond immediately with the scan data so the popup is never
                        // blocked by the heavy post-scan DOM work below (buildColorMap
                        // calls reapplyAllOverrides on all mapped elements, which calls
                        // getComputedStyle per element and can take several seconds when
                        // overrides are active — easily exceeding the 20s message timeout).
                        isRescanning = false;
                        flushPendingOverrides();
                        // Restart background monitors before responding so watchdog is
                        // active before the popup processes the result.
                        if (rawOverrideState.size > 0) startOverrideWatchdog();
                        sendResponse({ success: true, data });
                        // Post-processing runs after the channel closes — no timeout risk.
                        try {
                            // buildColorMap() already calls reapplyAllOverrides() internally.
                            buildColorMap();
                            // Refresh fallback CSS rules in one batch.
                            batchRefreshFallbackCSS();
                        } catch (mapError) {
                            PLLog.error(' buildColorMap/fallback error:', mapError);
                        }
                    })
                    .catch((error) => {
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
                                    } catch (e) {
                                        /* ignore */
                                    }
                                });
                            }
                        });
                        // Refresh all fallback CSS rules in one batch — NO per-override DOM walk
                        batchRefreshFallbackCSS();
                    });
                    PLLog.info(`Force-reapplied ${applied} element-properties + fallback CSS`);
                    sendResponse({ success: true, applied });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
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

            if (request.type === 'FIX_TEXT_CONTRAST') {
                // Re-run full-page text contrast enforcement (async chunked)
                const paletteHexes = (request.payload && request.payload.paletteHexes) || _lastPaletteHexes || [];
                _flushContrastCache();
                _textContrastFixed = new WeakSet();
                if (!document.body) {
                    sendResponse({ success: true, fixed: 0 });
                    return false;
                }
                enforceTextContrast(paletteHexes, null, (fixedCount) => {
                    sendResponse({ success: true, fixed: fixedCount });
                });
                return true; // keep sendResponse alive (async)
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
                // Use triple requestAnimationFrame + a longer timeout to guarantee
                // the browser has fully composited and painted the current state.
                // This is critical for comparison: after removing/re-applying many
                // overrides the browser needs more time for layout + paint to settle.
                // 200 ms covers even heavy pages where Injector CSS + inline style
                // changes across many elements cause multiple layout passes.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            setTimeout(() => {
                                sendResponse({ success: true });
                            }, 200);
                        });
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
                // Suspend background work (watchdog, observer debounce, scroll
                // reapply) while the dropper is active so getComputedStyle calls
                // from those systems don't compete with the dropper's RAF loop.
                _plSetDropperActive(true);
                window.Dropper.start();
                // Respond immediately so the popup can close without delay.
                sendResponse({ success: true });
                // Ensure the color map is populated for later override operations.
                // Deferred with setTimeout so it never blocks dropper startup —
                // the dropper's _colorAtPoint uses getComputedStyle directly and
                // does not rely on colorElementMap.
                setTimeout(ensureColorMap, 0);
                return;
            }

            if (request.type === 'CANCEL_PICK') {
                if (window.Dropper) window.Dropper.cancel();
                _plSetDropperActive(false);
                sendResponse({ success: true });
                return;
            }
        } catch (error) {
            PLLog.error('', error);
            sendResponse({ success: false, error: error.message });
        }
    });

    // ── Dropper-active flag ───────────────────────────────────────
    // While the dropper is running, suspend all background work
    // (watchdog, MutationObserver callbacks, scroll reapply) so they
    // don't compete with the dropper's per-frame getComputedStyle calls.
    let _plDropperActive = false;
    let _plDropperResumeTimer = null;

    function _plSetDropperActive(active) {
        _plDropperActive = active;
        clearTimeout(_plDropperResumeTimer);
        if (active) {
            // Safety net: always resume after 30s even if dropper never finishes cleanly
            _plDropperResumeTimer = setTimeout(() => {
                _plDropperActive = false;
                if (rawOverrideState.size > 0) startOverrideWatchdog();
            }, 30000);
        } else {
            // Resume watchdog if we have active overrides
            if (rawOverrideState.size > 0) startOverrideWatchdog();
        }
    }

    // Listen for secure dropper-active events (validated by secret token)
    window.addEventListener('pl-dropper-active', (event) => {
        if (!isValidDropperEvent(event)) return;
        const active = !!(event.detail && event.detail.active);
        _plSetDropperActive(active);
    });

    // Shared CSS property list for DOM color scanning — used by both
    // buildColorMap and processAddedSubtree to avoid duplicating the array.
    const _COLOR_SCAN_PROPS = Object.freeze([
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
        { js: 'stroke', css: 'stroke' },
    ]);
    const _ACCENT_PROP = Object.freeze({ js: 'accentColor', css: 'accent-color' });

    // Concurrency guard — prevents overlapping buildColorMap calls from
    // scroll, observer, and watchdog producing inconsistent state.
    let _isBuildingColorMap = false;

    function buildColorMap() {
        if (_isBuildingColorMap) {
            PLLog.debug('PaletteLive: buildColorMap already in progress, skipping');
            return;
        }
        _isBuildingColorMap = true;
        try {
            colorElementMap.clear();
            if (!document.body) return;

            const props = _COLOR_SCAN_PROPS;
            const accentProp = _ACCENT_PROP;

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
                    } catch (e) {
                        /* ignore */
                    }
                } catch (e) {
                    /* ignore */
                }
            };

            if (window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
                const addToMap = (value, cssPropName, el) => {
                    if (!value || window.ColorUtils.isTransparent(value)) return;
                    if (
                        value === 'auto' ||
                        value === 'initial' ||
                        value === 'inherit' ||
                        value === 'currentcolor' ||
                        value === 'currentColor'
                    )
                        return;

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
                const _MAP_EL_LIMIT = PLConfig.MAP_ELEMENT_LIMIT;
                window.ShadowWalker.walk(document.body, (element) => {
                    if (_mapElCount >= _MAP_EL_LIMIT) return false; // stop walk
                    try {
                        // Skip invisible elements cheaply using only CSS properties —
                        // NEVER use offsetWidth/offsetHeight here as they force a full
                        // layout reflow on every element, causing page freezes on large DOMs.
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

            PLLog.info(`Mapped ${colorElementMap.size} unique colors to elements`);

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
                    currentEntries.forEach((entry) => {
                        // Only remap elements that we actually overrode (checked via overrideMap)
                        const propMap = overrideMap.get(entry.element);
                        if (propMap && propMap.has(entry.cssProp)) {
                            const alreadyMapped = originalEntries.some(
                                (e) => e.element === entry.element && e.cssProp === entry.cssProp
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
        } finally {
            _isBuildingColorMap = false;
        }
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

                        // Don't overwrite text color on elements fixed by enforceTextContrast
                        if (cssProp === 'color' && _textContrastFixed.has(element)) return;

                        // Read computed style once and use CSS-only visibility check —
                        // NEVER use offsetWidth/offsetHeight as they force a full layout
                        // reflow per element, causing freezes/timeouts on large pages.
                        const style = window.getComputedStyle(element);
                        if (style.display === 'none' || style.visibility === 'hidden') return;
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
                            } catch (e) {
                                /* ignore — proceed with reapply */
                            }
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
                PLLog.info(`Re-applied overrides to ${applied} element-properties`);
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
                priority,
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

        overrideRefs.forEach((ref) => {
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
                    addedFallbackClasses.forEach((cls) => {
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

        PLLog.info(' All overrides reset');
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
            stroke: `pl-stroke-${safeId}`,
        };
    }

    function clearFallbackClassesForSafeId(safeId) {
        const classMap = getFallbackClassMap(safeId);
        const classNames = Object.values(classMap);

        if (document.body && window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
            window.ShadowWalker.walk(document.body, (element) => {
                if (!element.classList || !element.classList.length) return;
                classNames.forEach((className) => {
                    element.classList.remove(className);
                });
            });
        }

        classNames.forEach((className) => addedFallbackClasses.delete(className));

        if (window.Injector && window.Injector.state && window.Injector.state.selectors) {
            let changed = false;
            classNames.forEach((className) => {
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
                    if (window.ColorUtils.areSimilar(key, originalHex, 10)) {
                        // Tolerance of 10
                        similarKeys.push(key);
                    }
                }

                if (similarKeys.length > 0) {
                    entries = [];
                    similarKeys.forEach((key) => {
                        const keyEntries = colorElementMap.get(key);
                        if (keyEntries) entries.push(...keyEntries);
                    });
                    PLLog.debug(`Fuzzy matched ${similarKeys.length} colors for ${originalHex}`);
                }
            }

            // Debug logging — color simply isn't present on the page (common on
            // dynamic pages like YouTube where saved colors may reference elements
            // that no longer exist).  The fallback CSS path below will still cover
            // any future elements that appear with this color.
            if (!entries || !entries.length) {
                PLLog.debug(
                    `PaletteLive: No elements found in color map for ${originalHex} (even with fuzzy match). Map has ${colorElementMap.size} colors.`
                );
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
                        // Reuse the cached computed style — backgroundImage is
                        // independent of background-color and the live
                        // CSSStyleDeclaration auto-reflects any changes.
                        const elBgImg = cs.backgroundImage;
                        // Only clear gradients; skip 'none' (allows lazy-loaded images later) and url() (preserves images)
                        if (elBgImg && elBgImg !== 'none' && !elBgImg.includes('url(')) {
                            el.style.setProperty('background-image', 'none', 'important');
                        }

                        // Add to colorElementMap for future reference
                        if (!colorElementMap.has(originalHex)) {
                            colorElementMap.set(originalHex, []);
                        }
                        // Avoid duplicates
                        const alreadyInMap = colorElementMap
                            .get(originalHex)
                            .some((e) => e.element === el && e.cssProp === 'background-color');
                        if (!alreadyInMap) {
                            colorElementMap.get(originalHex).push({ element: el, cssProp: 'background-color' });
                        }
                        appliedCount++;
                    }
                } catch (e) {
                    /* ignore */
                }
            }

            rawOverrideState.set(originalHex, currentHex);

            // Ensure the watchdog is running when we have active overrides
            startOverrideWatchdog();

            // Update fallback CSS rules without walking the DOM.
            // applyRawOverrideFallback does a full DOM walk per override — too expensive.
            // Fallback classes were already applied during initial scan/bulk apply.
            batchRefreshFallbackCSS();

            if (appliedCount > 0) {
                PLLog.info(`Applied ${currentHex} to ${appliedCount} element-properties for ${originalHex}`);
                result = appliedCount;
            } else {
                // If no elements were found, the fallback CSS (applied above) is our only hope
                PLLog.debug(`PaletteLive: No inline overrides applied for ${originalHex}, relying on fallback CSS`);
                result = 0;
            }
        });
        return result;
    }

    function _applyRawOverrideFallback(data) {
        const safeId = getSafeId(data.original);
        const classMap = getFallbackClassMap(safeId);
        const currentHex = window.ColorUtils.rgbToHex8(data.current).toLowerCase();
        let matchedCount = 0;

        performDOMChange(() => {
            if (document.body && window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
                window.ShadowWalker.walk(document.body, (element) => {
                    try {
                        // CSS-only visibility check — NEVER use offsetWidth/offsetHeight
                        // as they force a full layout reflow per element.
                        const style = window.getComputedStyle(element);
                        if (style.display === 'none' || style.visibility === 'hidden') return;

                        const hasClass = Object.values(classMap).some((className) =>
                            element.classList.contains(className)
                        );
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
                PLLog.info(`Fallback applied ${currentHex} to ${matchedCount} elements for ${data.original}`);
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
        const palette = _lastPaletteHexes.map((h) => {
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
                        hasText = true;
                        break;
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
                let bestHex = null,
                    bestCR = 0;
                for (const c of palette) {
                    const cr = _contrastRatio(c, newBgHex);
                    if (cr >= MIN_CR && cr > bestCR) {
                        bestCR = cr;
                        bestHex = c;
                    }
                }
                if (!bestHex) {
                    for (const c of bwHexes) {
                        const cr = _contrastRatio(c, newBgHex);
                        if (cr > bestCR) {
                            bestCR = cr;
                            bestHex = c;
                        }
                    }
                }
                if (bestHex && bestCR > currentCR) {
                    el.style.setProperty('color', bestHex, 'important');
                    // Track this fix so reapplyAllOverrides / watchdog won't undo it
                    _textContrastFixed.add(el);
                }
            } catch (e) {
                /* ignore */
            }
        };

        // Fix the parent itself if it has text
        fixEl(parentEl);
        // Fix immediate children (1 level deep for performance)
        try {
            const children = Array.from(parentEl.children);
            const limit = Math.min(children.length, 50); // cap for perf
            for (let i = 0; i < limit; i++) fixEl(children[i]);
        } catch (e) {
            /* ignore */
        }
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
        }, ms || PLConfig.BULK_APPLY_COOLDOWN_MS);
    }

    function applyBulkRawOverrides(overridesArray) {
        if (!overridesArray || !overridesArray.length) return 0;
        let totalApplied = 0;

        // Suppress cascading reprocessing for 2s after bulk apply
        startBulkApplyCooldown(PLConfig.BULK_APPLY_COOLDOWN_MS);

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
                        } catch (e) {
                            /* ignore */
                        }
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
                { js: 'stroke', key: 'stroke' },
            ];

            // Walk only if Phase 2 didn't handle many elements (< 80% of expected).
            // This avoids the expensive full DOM walk on pages where the colorElementMap
            // already covers all visible elements.
            const expectedCoverage = overrideEntries.reduce((sum, e) => {
                const ents = colorElementMap.get(e.originalHex);
                return sum + (ents ? ents.length : 0);
            }, 0);
            const needsFallbackWalk = totalApplied < expectedCoverage * 0.5 || expectedCoverage === 0;

            if (
                needsFallbackWalk &&
                document.body &&
                window.ShadowWalker &&
                typeof window.ShadowWalker.walk === 'function'
            ) {
                let _fbCount = 0;
                const _FB_LIMIT = PLConfig.FALLBACK_WALK_LIMIT; // cap fallback walk to prevent freezes
                window.ShadowWalker.walk(document.body, (element) => {
                    if (_fbCount >= _FB_LIMIT) return;
                    if (handledElements.has(element)) return; // skip already-handled
                    try {
                        // CSS-only visibility check — do NOT use offsetWidth/offsetHeight
                        // as those force layout reflow on every element.
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
                    } catch (e) {
                        /* ignore */
                    }
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
            PLLog.info(`Bulk applied ${overrideEntries.length} overrides, ${totalApplied} inline changes`);
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
        const s = [rgb.r, rgb.g, rgb.b].map((c) => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    }

    // ── Contrast-ratio LUT cache ──────────────────────────────────
    // Memoize relative-luminance and contrast-ratio computations so that
    // the thousands of identical calls during a DOM walk become O(1) lookups.
    const _lumCache = new Map(); // hex → luminance (0..1)
    const _crCache = new Map(); // "hex1|hex2" → ratio (1..21)
    const _CONTRAST_CACHE_MAX = 2000; // Max entries before eviction

    // Per-element effective-background cache — avoids re-walking ancestor
    // chains on repeated enforceTextContrast passes within the same palette
    // session.  WeakMap has no .clear(), so we re-assign to evict entries.
    // Flushed on palette apply/reset and before each scheduled sweep.
    let _bgCache = new WeakMap();

    /** Cached luminance for a hex string */
    function _cachedLum(hex) {
        let v = _lumCache.get(hex);
        if (v !== undefined) return v;
        if (_lumCache.size >= _CONTRAST_CACHE_MAX) {
            // Evict the oldest half so hot entries survive the trim
            const _evictCount = Math.ceil(_lumCache.size / 2);
            let _n = 0;
            for (const k of _lumCache.keys()) {
                if (_n++ >= _evictCount) break;
                _lumCache.delete(k);
            }
        }
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
        if (_crCache.size >= _CONTRAST_CACHE_MAX) {
            // Evict the oldest half so hot entries survive the trim
            const _evictCount = Math.ceil(_crCache.size / 2);
            let _n = 0;
            for (const k of _crCache.keys()) {
                if (_n++ >= _evictCount) break;
                _crCache.delete(k);
            }
        }
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
            b: Math.round(fgRgba.b * a + bgRgb.b * (1 - a)),
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
                    const rgba = window.ColorUtils.hexToRgb(window.ColorUtils.rgbToHex8(bg));
                    if (rgba && rgba.a > 0) {
                        layers.push(rgba);
                        if (rgba.a >= 1) {
                            hitOpaque = true;
                            break;
                        }
                    }
                }
            } catch (e) {
                /* ignore */
            }
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
                            if (rgba.a >= 1) {
                                hitOpaque = true;
                                break;
                            }
                        }
                    }
                } catch (e) {
                    /* ignore */
                }
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
        const toHex2 = (n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0');
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
    function enforceTextContrast(paletteHexes, subtreeRoot, onComplete) {
        if (!document.body) return 0;

        // ═══════════════════════════════════════════════════════════════
        //  DEEP TEXT CONTRAST — ensures 100% text visibility
        //  Uses WCAG AAA as primary target (7:1 normal, 4.5:1 large),
        //  falls back to WCAG AA (4.5:1 / 3.0:1), and as an absolute
        //  minimum guarantees ≥ 3:1 on every text element.
        //  Only modifies the `color` CSS property — never touches
        //  backgrounds, borders, or any other style.
        // ═══════════════════════════════════════════════════════════════
        const TARGET_CR = 7.0; // WCAG AAA normal text (ideal)
        const TARGET_CR_LG = 4.5; // WCAG AAA large text (ideal)
        const MIN_CR = 4.5; // WCAG AA normal text (minimum acceptable)
        const MIN_CR_LARGE = 3.0; // WCAG AA large text (minimum acceptable)
        const ABSOLUTE_MIN = 3.0; // Hard floor — never leave text below this

        // ── Build candidate pool ──────────────────────────────────────
        const bwHexes = ['#ffffff', '#000000'];
        const grayRamp = [
            '#111111',
            '#222222',
            '#333333',
            '#444444',
            '#555555',
            '#666666',
            '#777777',
            '#888888',
            '#999999',
            '#aaaaaa',
            '#bbbbbb',
            '#cccccc',
            '#dddddd',
            '#eeeeee',
        ];
        const paletteSet = new Set();
        if (paletteHexes && paletteHexes.length) {
            paletteHexes.forEach((h) => {
                let hex = h.toLowerCase();
                if (hex.length === 9 && hex.endsWith('ff')) hex = hex.substring(0, 7);
                paletteSet.add(hex);
            });
        }
        bwHexes.forEach((h) => paletteSet.delete(h));
        const paletteCandidates = [...paletteSet];

        // Generate tinted variants of each palette color at different
        // lightness levels to give the algorithm more options that
        // preserve the palette's hue character.
        const tintedCandidates = [];
        for (const hex of paletteCandidates) {
            const rgb = window.ColorUtils.hexToRgb(hex);
            if (!rgb) continue;
            // Extract approximate HSL
            const r = rgb.r / 255,
                g = rgb.g / 255,
                b = rgb.b / 255;
            const max = Math.max(r, g, b),
                min = Math.min(r, g, b);
            let h = 0,
                s = 0;
            const l = (max + min) / 2;
            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                else if (max === g) h = ((b - r) / d + 2) / 6;
                else h = ((r - g) / d + 4) / 6;
            }
            // Generate variants at 10%, 20%, 30%, 70%, 80%, 90% lightness
            for (const tl of [0.08, 0.15, 0.25, 0.35, 0.65, 0.75, 0.85, 0.92]) {
                const ts = Math.max(s * 0.6, 0.05); // reduce saturation slightly
                const _h2r = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };
                const q = tl < 0.5 ? tl * (1 + ts) : tl + ts - tl * ts;
                const p = 2 * tl - q;
                const tr = Math.round(_h2r(p, q, h + 1 / 3) * 255);
                const tg2 = Math.round(_h2r(p, q, h) * 255);
                const tb = Math.round(_h2r(p, q, h - 1 / 3) * 255);
                const _hex2 = (c) => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0');
                const variant = '#' + _hex2(tr) + _hex2(tg2) + _hex2(tb);
                if (!paletteSet.has(variant)) tintedCandidates.push(variant);
            }
        }

        let fixedCount = 0;

        /** Check if element or its immediate children contain visible text */
        function hasVisibleText(el) {
            for (let i = 0; i < el.childNodes.length; i++) {
                const node = el.childNodes[i];
                if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true;
            }
            return false;
        }

        // ── Universal text-element detection ──────────────────────────
        // Instead of a fixed tag list, detect ANY element that carries
        // visible text — including custom elements, web components, etc.
        const SKIP_TAGS =
            /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|IMG|VIDEO|AUDIO|CANVAS|BR|HR|WBR|META|LINK|BASE|COL|SOURCE|TRACK|PARAM|AREA|MAP)$/i;

        function shouldProcess(el) {
            const tag = el.tagName;
            if (!tag) return false;
            if (SKIP_TAGS.test(tag)) return false;

            // Always process SVG <text> elements
            if (tag.toLowerCase() === 'text' && el.namespaceURI === 'http://www.w3.org/2000/svg') return true;

            // Has direct text nodes with content
            if (hasVisibleText(el)) return true;

            // Has contenteditable
            if (el.isContentEditable) return true;

            // ARIA roles that imply text content
            const role = el.getAttribute && el.getAttribute('role');
            if (role && /^(heading|button|link|menuitem|tab|tooltip|status|alert|note|label)$/i.test(role)) {
                return !!(el.textContent && el.textContent.trim());
            }

            // Form elements with value text
            if (/^(INPUT|TEXTAREA|SELECT)$/i.test(tag)) return true;

            return false;
        }

        /** Determine if text is "large" for WCAG (>=18px bold or >=24px) */
        function isLargeText(style) {
            const size = parseFloat(style.fontSize) || 16;
            const weight = parseInt(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
            return size >= 24 || (size >= 18.66 && weight >= 700);
        }

        /**
         * Detect if an element has a CSS gradient background that we should
         * parse for color extraction. Returns the first gradient color stop's
         * hex, or null.
         */
        function _extractGradientColor(el) {
            try {
                const bgImage = window.getComputedStyle(el).backgroundImage;
                if (!bgImage || bgImage === 'none') return null;

                let start = bgImage.toLowerCase().indexOf('gradient(');
                if (start === -1) return null;

                start += 9;
                let depth = 1;
                let end = start;
                while (end < bgImage.length && depth > 0) {
                    if (bgImage[end] === '(') depth++;
                    else if (bgImage[end] === ')') depth--;
                    end++;
                }

                if (depth !== 0) return null;
                const contents = bgImage.substring(start, end - 1);

                // Extract rgb/rgba/hex color values from gradient stops
                const rgbMatch = contents.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                if (rgbMatch) {
                    const _h2 = (c) =>
                        Math.min(255, Math.max(0, parseInt(c)))
                            .toString(16)
                            .padStart(2, '0');
                    return '#' + _h2(rgbMatch[1]) + _h2(rgbMatch[2]) + _h2(rgbMatch[3]);
                }
                const hexMatch = contents.match(/#([0-9a-f]{3,8})\b/i);
                if (hexMatch) {
                    let h = hexMatch[1].toLowerCase();
                    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
                    if (h.length >= 6) return '#' + h.substring(0, 6);
                }
            } catch (_) {}
            return null;
        }

        /**
         * Enhanced effective background: considers CSS gradients, overlay
         * elements, and walks deeper into the ancestor chain.
         */
        function _getDeepEffectiveBg(el, textColorHex = null) {
            // First try the standard bg detection
            const standardBg = _getEffectiveBg(el);

            // Additionally check if any ancestor has a gradient — use the
            // gradient's dominant color for contrast (usually the darkest
            // or lightest stop).
            let current = el;
            let depth = 0;
            while (current && depth < 15) {
                const gradColor = _extractGradientColor(current);
                if (gradColor) {
                    // Use the gradient color if it's darker or lighter than
                    // the standard bg (pick the one that's harder to contrast
                    // against, i.e., worst-case for text readability).
                    const gradLum = _cachedLum(gradColor);
                    const stdLum = _cachedLum(standardBg);

                    if (textColorHex) {
                        const stdCR = _contrastRatio(textColorHex, standardBg);
                        const gradCR = _contrastRatio(textColorHex, gradColor);
                        return gradCR < stdCR ? gradColor : standardBg;
                    }

                    // If the gradient color is between the text and bg luminance,
                    // it could obscure text — use it for a more conservative check
                    return gradLum < stdLum ? gradColor : standardBg;
                }
                current = current.parentElement;
                depth++;
            }

            return standardBg;
        }

        /**
         * Deep candidate selection — guarantees the best possible text color.
         *
         * Strategy (in priority order):
         *  1. Palette color that meets AAA target → pick highest CR
         *  2. Tinted palette variant that meets AAA target → highest CR
         *  3. Palette color that meets AA minimum → highest CR
         *  4. Tinted variant that meets AA minimum → highest CR
         *  5. Black or white that meets AA minimum → higher CR
         *  6. Synthesized optimal-contrast color on the original hue
         *  7. Gray ramp scan for the highest-CR gray
         *  8. Pure black or white (whichever has higher CR) — always ≥ ABSOLUTE_MIN
         */
        function pickBestCandidate(bgHex, origTextHex, targetCR, minCR) {
            const bgLum = _cachedLum(bgHex);
            const origLum = _cachedLum(origTextHex);

            // ─ Helper: score a candidate (higher = better) ─
            // Balances contrast ratio (60%) with hue/luminance proximity to
            // the original text color (40%) so we don't gratuitously shift
            // the color far from the design intent.
            const scoreFn = (hex, cr) => {
                const proximity = 1 - Math.abs(_cachedLum(hex) - origLum);
                return cr * 0.6 + proximity * 0.4 * 21; // normalized to ~21 scale
            };

            let best = null;

            // ─ Pass 1: Palette colors ─────────────────────────────────
            for (const c of paletteCandidates) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= targetCR) {
                    const sc = scoreFn(c, cr);
                    if (!best || sc > best.score || (sc === best.score && cr > best.cr)) {
                        best = { hex: c, cr, score: sc, tier: 1 };
                    }
                }
            }
            if (best) return best;

            // ─ Pass 2: Tinted palette variants (AAA target) ───────────
            for (const c of tintedCandidates) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= targetCR) {
                    const sc = scoreFn(c, cr);
                    if (!best || sc > best.score) {
                        best = { hex: c, cr, score: sc, tier: 2 };
                    }
                }
            }
            if (best) return best;

            // ─ Pass 3: Palette colors at AA minimum ───────────────────
            for (const c of paletteCandidates) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= minCR) {
                    const sc = scoreFn(c, cr);
                    if (!best || sc > best.score) {
                        best = { hex: c, cr, score: sc, tier: 3 };
                    }
                }
            }
            if (best) return best;

            // ─ Pass 4: Tinted variants at AA minimum ──────────────────
            for (const c of tintedCandidates) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= minCR) {
                    const sc = scoreFn(c, cr);
                    if (!best || sc > best.score) {
                        best = { hex: c, cr, score: sc, tier: 4 };
                    }
                }
            }
            if (best) return best;

            // ─ Pass 5: Black/White ────────────────────────────────────
            for (const c of bwHexes) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= minCR) {
                    if (!best || cr > best.cr) {
                        best = { hex: c, cr, score: cr, tier: 5 };
                    }
                }
            }
            if (best) return best;

            // ─ Pass 6: Synthesized hue-preserving color ───────────────
            // Extract the hue from the original text color and binary-search
            // for the lightness that maximizes contrast against the bg.
            try {
                const origRgb = window.ColorUtils.hexToRgb(origTextHex);
                if (origRgb) {
                    const r = origRgb.r / 255,
                        g = origRgb.g / 255,
                        bl = origRgb.b / 255;
                    const mx = Math.max(r, g, bl),
                        mn = Math.min(r, g, bl);
                    let hue = 0,
                        sat = 0;
                    if (mx !== mn) {
                        const d = mx - mn;
                        sat = Math.min(d / (1 - Math.abs(mx + mn - 1) + 1e-9), 1);
                        if (mx === r) hue = ((g - bl) / d + (g < bl ? 6 : 0)) / 6;
                        else if (mx === g) hue = ((bl - r) / d + 2) / 6;
                        else hue = ((r - g) / d + 4) / 6;
                    }
                    // Determine direction: if bg is dark, push text light; if bg is light, push text dark
                    const targetL = bgLum < 0.5 ? 0.95 : 0.05;
                    const _hsl2hex = (h, s, ll) => {
                        const q2 = ll < 0.5 ? ll * (1 + s) : ll + s - ll * s;
                        const p2 = 2 * ll - q2;
                        const _h2r2 = (pp, qq, t) => {
                            if (t < 0) t += 1;
                            if (t > 1) t -= 1;
                            if (t < 1 / 6) return pp + (qq - pp) * 6 * t;
                            if (t < 1 / 2) return qq;
                            if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6;
                            return pp;
                        };
                        const rr = Math.round(_h2r2(p2, q2, h + 1 / 3) * 255);
                        const gg = Math.round(_h2r2(p2, q2, h) * 255);
                        const bb = Math.round(_h2r2(p2, q2, h - 1 / 3) * 255);
                        const _hx = (c) => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0');
                        return '#' + _hx(rr) + _hx(gg) + _hx(bb);
                    };
                    // Binary search for optimal lightness
                    let lo = bgLum < 0.5 ? 0.5 : 0.0;
                    let hi = bgLum < 0.5 ? 1.0 : 0.5;
                    let bestSynth = null;
                    for (let iter = 0; iter < 12; iter++) {
                        const mid = (lo + hi) / 2;
                        const candidate = _hsl2hex(hue, sat * 0.4, mid);
                        const cr = _contrastRatio(candidate, bgHex);
                        if (cr >= minCR) {
                            if (!bestSynth || Math.abs(mid - targetL) < Math.abs(bestSynth.l - targetL)) {
                                bestSynth = { hex: candidate, cr, l: mid };
                            }
                            // Move toward target lightness
                            if (mid < targetL) lo = mid;
                            else hi = mid;
                        } else {
                            // Need more contrast — move away from bg
                            if (bgLum < 0.5) lo = mid;
                            else hi = mid;
                        }
                    }
                    if (bestSynth && bestSynth.cr >= minCR) {
                        return { hex: bestSynth.hex, cr: bestSynth.cr, score: bestSynth.cr, tier: 6 };
                    }
                }
            } catch (_) {}

            // ─ Pass 7: Gray ramp — find highest-contrast neutral ──────
            let bestGray = null;
            for (const c of grayRamp) {
                const cr = _contrastRatio(c, bgHex);
                if (cr >= ABSOLUTE_MIN && (!bestGray || cr > bestGray.cr)) {
                    bestGray = { hex: c, cr, score: cr, tier: 7 };
                }
            }
            if (bestGray) return bestGray;

            // ─ Pass 8: Absolute fallback — black or white ─────────────
            // One of them is always ≥ ~1.05:1; pick the better one
            const wCR = _contrastRatio('#ffffff', bgHex);
            const bCR = _contrastRatio('#000000', bgHex);
            return wCR >= bCR
                ? { hex: '#ffffff', cr: wCR, score: wCR, tier: 8 }
                : { hex: '#000000', cr: bCR, score: bCR, tier: 8 };
        }

        // ── Element processor (only touches `color`) ──────────────────
        const processElement = (el) => {
            try {
                if (!shouldProcess(el)) return;

                const style = window.getComputedStyle(el);

                // Skip hidden elements — use CSS-only checks to avoid layout-forcing
                // properties like offsetWidth/offsetHeight which cause reflow per element.
                if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
                    return;
                const opacity = parseFloat(style.opacity);
                if (opacity < 0.05) return;
                // Skip elements clipped out of view
                const clip = style.clip;
                if (clip && clip !== 'auto' && clip.includes('rect(0') && clip.includes('0px, 0px)')) return;
                // Skip elements with text-indent pushing text off-screen (common a11y hack)
                const textIndent = parseFloat(style.textIndent);
                if (textIndent < -900) return;

                const textColor = style.color;
                if (!textColor || window.ColorUtils.isTransparent(textColor)) return;

                const textHex = window.ColorUtils.rgbToHex8(textColor).toLowerCase();
                const bgHex = _getDeepEffectiveBg(el);
                const currentCR = _contrastRatio(textHex, bgHex);

                // Determine thresholds based on text size
                const large = isLargeText(style);
                const targetCR = large ? TARGET_CR_LG : TARGET_CR;
                const minCR = large ? MIN_CR_LARGE : MIN_CR;

                // Factor in accumulated opacity from ancestors — text may be
                // semi-transparent itself, reducing effective contrast.
                let effectiveCR = currentCR;
                if (opacity < 1 && opacity > 0.05) {
                    // Semi-transparent text has reduced effective contrast.
                    // Approximate: CR_effective ≈ 1 + (CR_actual - 1) * opacity
                    effectiveCR = 1 + (currentCR - 1) * opacity;
                }

                // Already meets the target? No fix needed.
                if (effectiveCR >= targetCR) return;

                const best = pickBestCandidate(bgHex, textHex, targetCR, minCR);
                if (best && best.cr > effectiveCR) {
                    el.style.setProperty('color', best.hex, 'important');
                    _textContrastFixed.add(el);
                    fixedCount++;
                }
            } catch (e) {
                /* ignore */
            }
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
                PLLog.info(`Text contrast enforced on ${fixedCount} elements (subtree)`);
            }
            return fixedCount;
        }

        // ── Full-DOM path: chunked async to prevent main-thread freeze ───────
        // Use a universal selector (*) filtered by shouldProcess to catch ALL
        // text-bearing elements including custom elements, web components, and
        // any tag with direct text nodes.  Processed in CHUNK_SIZE batches
        // separated by setTimeout(0) so the browser stays responsive.
        const _candidates = [];
        try {
            // Broad selector that catches everything including custom elements
            const allEls = document.body.querySelectorAll('*');
            for (let i = 0; i < allEls.length; i++) {
                _candidates.push(allEls[i]);
            }
        } catch (e) {
            /* ignore */
        }
        // Also include html and body themselves
        [document.documentElement, document.body].forEach((root) => {
            if (root) _candidates.unshift(root);
        });

        // Hard cap to prevent freezing on massive pages
        const _MAX_EL = PLConfig.CONTRAST_MAX_ELEMENTS;
        if (_candidates.length > _MAX_EL) _candidates.length = _MAX_EL;

        const _CHUNK = 80;
        let _ci = 0;
        const _runChunk = () => {
            performDOMChange(() => {
                const end = Math.min(_ci + _CHUNK, _candidates.length);
                while (_ci < end) processElement(_candidates[_ci++]);
            });
            if (_ci < _candidates.length) {
                setTimeout(_runChunk, 0);
            } else {
                if (fixedCount > 0) {
                    PLLog.info(`Text contrast enforced on ${fixedCount} elements (deep scan)`);
                }
                if (typeof onComplete === 'function') onComplete(fixedCount);
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
        highlightedElements.forEach((element) => {
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

    // NOTE: duplicate toRgba() removed — single definition above is used.

    function updateHighlightStyle(hex) {
        const style = ensureHighlightStyle();
        const glow = toRgba(hex, 0.35);
        style.textContent = [
            '[data-pl-highlight] {',
            `  outline: 2px solid ${hex} !important;`,
            '  outline-offset: 2px !important;',
            `  box-shadow: 0 0 0 2px ${glow} !important;`,
            '  transition: outline-color 200ms ease, box-shadow 200ms ease;',
            '}',
        ].join('\n');
    }

    // Expose helpers for dropper.js
    window.__plHighlightColor = highlightColor;
    window.__plHighlightElement = highlightElement;
    window.__plClearHighlight = clearHighlight;
    Object.defineProperty(window, 'dispatchSecureDropperEvent', {
        value: dispatchSecureDropperEvent,
        enumerable: false,
        writable: false,
        configurable: true,
    });

    function clonePlainObject(value) {
        return JSON.parse(JSON.stringify(value || {}));
    }

    function ensureComparisonStyle() {
        const style = ensureStyleElement(comparisonStyleId);
        style.textContent = [
            // Full-screen overlay. pointer-events is NONE by default so scrolling
            // and clicking on the live page (right half) works normally. The
            // overlay temporarily switches to 'auto' only while the divider is
            // being dragged.
            `#${comparisonOverlayId} { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; --pl-divider: 50%; user-select: none; overflow: hidden; }`,
            // Before pane (original screenshot) — clipped to the left portion.
            // background-position-y is updated via JS as the page scrolls so the
            // screenshot tracks the visible viewport.
            `#${comparisonOverlayId} .pl-compare-before { position: absolute; inset: 0; background-repeat: no-repeat; background-size: 100% 100%; background-position: 0 0; clip-path: inset(0 calc(100% - var(--pl-divider)) 0 0); pointer-events: none; }`,
            // After pane — screenshot of the page WITH PaletteLive changes applied,
            // captured at the same scroll position as the before screenshot.
            `#${comparisonOverlayId} .pl-compare-after { position: absolute; inset: 0; background-repeat: no-repeat; background-size: 100% 100%; background-position: 0 0; clip-path: inset(0 0 0 var(--pl-divider)); pointer-events: none; }`,
            // Thin visual divider line.
            `#${comparisonOverlayId} .pl-compare-divider { position: absolute; top: 0; bottom: 0; left: var(--pl-divider); width: 3px; transform: translateX(-1px); background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.4); pointer-events: none; }`,
            // Drag handle — visible grab target on the divider line. This is the
            // only interactive zone on the before side; pointer-events: auto allows
            // pointerdown here to start a drag.
            `#${comparisonOverlayId} .pl-compare-handle { position: absolute; top: 50%; left: var(--pl-divider); transform: translate(-50%, -50%); width: 36px; height: 36px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; font: 700 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; color: #555; cursor: ew-resize; pointer-events: auto; }`,
            // "Before" label — bottom-left.
            `#${comparisonOverlayId} .pl-compare-badge-before { position: absolute; bottom: 12px; left: 12px; padding: 4px 8px; border-radius: 6px; font: 600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; color: #fff; background: rgba(0,0,0,.55); pointer-events: none; }`,
            // "After" label — positioned just right of the divider.
            `#${comparisonOverlayId} .pl-compare-badge-after { position: absolute; bottom: 12px; padding: 4px 8px; border-radius: 6px; font: 600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; color: #fff; background: rgba(0,0,0,.55); pointer-events: none; left: calc(var(--pl-divider) + 12px); }`,
            // Close button — must be auto so it can be clicked.
            `#${comparisonOverlayId} .pl-compare-close { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border: none; border-radius: 6px; background: rgba(0,0,0,.55); color: #fff; font: 700 16px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif; cursor: pointer; pointer-events: auto; }`,
            `#${comparisonOverlayId} .pl-compare-close:hover { background: rgba(0,0,0,.75); }`,
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
        if (!beforeImage) {
            throw new Error('Missing beforeImage for comparison');
        }
        if (!afterImage) {
            throw new Error('Missing afterImage for comparison');
        }
        if (!isSafeCssImageUrl(beforeImage)) {
            throw new Error('Invalid beforeImage URL: only data:image/ and https:// are allowed');
        }
        if (!isSafeCssImageUrl(afterImage)) {
            throw new Error('Invalid afterImage URL: only data:image/ and https:// are allowed');
        }

        hideComparisonOverlay();
        ensureComparisonStyle();

        const overlay = document.createElement('div');
        overlay.id = comparisonOverlayId;

        // Both panes are screenshots — left = original site colors (before),
        // right = page with PaletteLive changes applied (after).
        const beforePane = document.createElement('div');
        beforePane.className = 'pl-compare-before';

        const afterPane = document.createElement('div');
        afterPane.className = 'pl-compare-after';

        const dividerEl = document.createElement('div');
        dividerEl.className = 'pl-compare-divider';

        const handleEl = document.createElement('div');
        handleEl.className = 'pl-compare-handle';
        handleEl.setAttribute('aria-hidden', 'true');
        handleEl.textContent = '\u2194'; // ↔ arrows hinting at drag direction

        const badgeBefore = document.createElement('div');
        badgeBefore.className = 'pl-compare-badge-before';
        badgeBefore.textContent = 'Original';

        const badgeAfter = document.createElement('div');
        badgeAfter.className = 'pl-compare-badge-after';
        badgeAfter.textContent = 'Your changes';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'pl-compare-close';
        closeBtn.setAttribute('aria-label', 'Close comparison');
        closeBtn.textContent = '\xd7'; // ×

        overlay.appendChild(beforePane);
        overlay.appendChild(afterPane);
        overlay.appendChild(dividerEl);
        overlay.appendChild(handleEl);
        overlay.appendChild(badgeBefore);
        overlay.appendChild(badgeAfter);
        overlay.appendChild(closeBtn);

        // Both screenshots were taken at the same scroll position — set them on
        // their respective panes. No scroll tracking needed.
        beforePane.style.backgroundImage = `url("${sanitizeCssUrl(beforeImage)}")`;  // original colors
        afterPane.style.backgroundImage = `url("${sanitizeCssUrl(afterImage)}")`;    // modified colors

        let divider = Number(payload.divider);
        if (!Number.isFinite(divider)) divider = 50;

        const setDivider = (value) => {
            const safe = Math.max(0, Math.min(100, value));
            overlay.style.setProperty('--pl-divider', `${safe}%`);
            badgeAfter.style.left = `calc(${safe}% + 12px)`;
            handleEl.style.left = `${safe}%`;
        };

        const toDividerFromClientX = (clientX) => {
            const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
            return (clientX / width) * 100;
        };

        setDivider(divider);

        // Dragging: the overlay is pointer-events:none normally (so the user can
        // still scroll the page with the overlay open). We enable pointer-events
        // only while the user is actively dragging the divider handle.
        let dragging = false;
        const onHandlePointerDown = (event) => {
            dragging = true;
            overlay.style.pointerEvents = 'auto';
            overlay.style.cursor = 'ew-resize';
            overlay.setPointerCapture(event.pointerId);
            setDivider(toDividerFromClientX(event.clientX));
            event.preventDefault();
        };
        const onPointerMove = (event) => {
            if (!dragging) return;
            setDivider(toDividerFromClientX(event.clientX));
            event.preventDefault();
        };
        const onPointerUp = (event) => {
            if (dragging) {
                try { overlay.releasePointerCapture(event.pointerId); } catch (_) {}
                overlay.style.pointerEvents = 'none';
                overlay.style.cursor = '';
            }
            dragging = false;
        };

        handleEl.addEventListener('pointerdown', onHandlePointerDown);
        overlay.addEventListener('pointermove', onPointerMove);
        overlay.addEventListener('pointerup', onPointerUp);
        overlay.addEventListener('pointercancel', onPointerUp);

        closeBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            hideComparisonOverlay();
            safeSendRuntimeMessage({ type: 'PL_COMPARISON_OVERLAY_CLOSED' });
        });

        // Escape key closes overlay
        const onKeyDown = (event) => {
            if (event.key === 'Escape' || event.key === 'Esc') {
                hideComparisonOverlay();
                safeSendRuntimeMessage({ type: 'PL_COMPARISON_OVERLAY_CLOSED' });
            }
        };
        document.addEventListener('keydown', onKeyDown, true);

        comparisonPointerCleanup = () => {
            handleEl.removeEventListener('pointerdown', onHandlePointerDown);
            overlay.removeEventListener('pointermove', onPointerMove);
            overlay.removeEventListener('pointerup', onPointerUp);
            overlay.removeEventListener('pointercancel', onPointerUp);
            document.removeEventListener('keydown', onKeyDown, true);
        };

        document.documentElement.appendChild(overlay);
    }

    function suspendForComparison() {
        if (comparisonSnapshot) return;

        const injectorState =
            window.Injector && window.Injector.state
                ? {
                      variables: clonePlainObject(window.Injector.state.variables),
                      selectors: clonePlainObject(window.Injector.state.selectors),
                  }
                : { variables: {}, selectors: {} };

        comparisonSnapshot = {
            raw: Array.from(rawOverrideState.entries()).map(([original, current]) => ({ original, current })),
            injectorState,
        };

        // Pause the observer and watchdog during comparison to prevent them from
        // rebuilding the color map or re-applying overrides before the 'before'
        // screenshot is captured.
        if (observer) {
            observer.disconnect();
        }
        stopOverrideWatchdog();

        resetAllOverrides({ preserveScheme: true, preserveVision: true, skipObserverReconnect: true });

        // Force a synchronous style flush so the browser fully processes all the
        // inline style removals and Injector CSS reset before we return.  Reading
        // a layout property (getBoundingClientRect) causes the browser to drain
        // the style/layout pipeline immediately — without this, fast machines can
        // skip the forced style recalc and the 'before' screenshot may still show
        // residual override colors, especially when there are many changes.
        try { document.documentElement.getBoundingClientRect(); } catch (e) { /* ignore */ }
    }

    function restoreAfterComparison() {
        if (!comparisonSnapshot) return;

        const snapshot = comparisonSnapshot;
        comparisonSnapshot = null;

        if (window.Injector) {
            window.Injector.reset();
            window.Injector.apply(snapshot.injectorState || {});
        }

        // Use bulk application instead of individual applyRawOverride calls.
        // With many changes this is critical: N individual calls = N DOM walks,
        // each calling ensureColorMap() + buildColorMap() separately, which is
        // very slow and causes the restore to appear glitchy/incomplete.
        // applyBulkRawOverrides does a single optimised DOM walk for all overrides.
        if (Array.isArray(snapshot.raw) && snapshot.raw.length > 0) {
            const validEntries = snapshot.raw.filter((e) => e && e.original && e.current);
            if (validEntries.length > 0) {
                applyBulkRawOverrides(validEntries.map((e) => ({ original: e.original, current: e.current })));
            }
        }

        buildColorMap();

        // Re-initialize the observer and watchdog that were paused during comparison
        if (observer && document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style'],
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
            PLLog.warn(' Injector not available, skipping apply');
        }

        if (savedData.overrides.raw) {
            const overridesArray = Object.entries(savedData.overrides.raw).map(([original, current]) => ({
                original,
                current,
            }));
            applyBulkRawOverrides(overridesArray);
        }

        if (savedData.settings && savedData.settings.scheme) {
            setColorScheme(savedData.settings.scheme);
        }
        if (savedData.settings && savedData.settings.vision) {
            setVisionMode(savedData.settings.vision);
        }

        // Re-run text contrast enforcement with the saved palette hexes
        const paletteHexes = Array.isArray(savedData.appliedPaletteHexes) ? savedData.appliedPaletteHexes : null;
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
            const idleCb =
                typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 1000);
            idleCb(
                () => {
                    if (_lastPaletteHexes === paletteHexes) {
                        enforceTextContrast(paletteHexes);
                    }
                },
                { timeout: 2000 }
            );
        }
    }

    // Observer rate-limiting state
    let observerRescanCount = 0;
    let observerRescanWindow = Date.now();
    const OBSERVER_MAX_RESCANS_PER_MINUTE = 30;
    let observerPaused = false;

    function processAddedSubtree(node) {
        if (!node || node.nodeType !== 1) return;

        const props = _COLOR_SCAN_PROPS;

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
                    if (
                        value === 'auto' ||
                        value === 'initial' ||
                        value === 'inherit' ||
                        value === 'currentcolor' ||
                        value === 'currentColor'
                    )
                        return;

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
                            } catch (e) {
                                /* ignore — proceed with override */
                            }
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
                } catch (error) {
                    /* ignore */
                }
            } catch (error) {
                // Ignore per-element failures.
            }
        };

        if (window.ShadowWalker && typeof window.ShadowWalker.walk === 'function') {
            // ShadowWalker.walk already processes `node` as the root element,
            // so no need to call processElement(node) separately.
            window.ShadowWalker.walk(node, processElement);
        } else {
            // Fallback: process just the node itself (no shadow DOM traversal)
            processElement(node);
        }

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
        attributeFilter: ['class', 'style'],
    };

    function createObserver() {
        if (observer) return; // already created

        observer = new MutationObserver((mutations) => {
            // Check if extension is paused
            if (__plPaused) return;
            // Check if we are currently applying overrides (should be caught by performDOMChange, but safely check)
            if (window.__plIsApplyingOverrides) return;
            // Dropper is active — skip all observer processing to avoid
            // expensive DOM work competing with the dropper's RAF loop.
            if (_plDropperActive) return;

            // Rate-limit: reset counter every 60 seconds
            const now = Date.now();
            if (now - observerRescanWindow > 60000) {
                observerRescanCount = 0;
                observerRescanWindow = now;
                if (observerPaused) {
                    observerPaused = false;
                    PLLog.info(' Observer auto-sync resumed');
                }
            }

            if (observerPaused) return;

            const hasStructureChanges = mutations.some(
                (mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
            );
            const hasAttributeChanges = mutations.some((mutation) => mutation.type === 'attributes');

            if (!hasStructureChanges && !hasAttributeChanges) return;

            // Check if attribute changes are ONLY from our own highlights or styles
            // This is a backup check in case performDOMChange wasn't used
            if (hasAttributeChanges && !hasStructureChanges) {
                const innerMutations = mutations.every((m) => {
                    // Ignore mutations to our own elements
                    if (m.target.id && (m.target.id.startsWith('palettelive') || m.target.id.startsWith('pl-')))
                        return true;
                    // We can't easily distinguish style changes on elements, so we rely on debouncing
                    return false;
                });
                if (innerMutations) return;
            }

            // Check rate limit
            observerRescanCount++;
            if (observerRescanCount > OBSERVER_MAX_RESCANS_PER_MINUTE) {
                observerPaused = true;
                PLLog.debug('PaletteLive: High DOM activity detected. Auto-sync paused for 60s.');
                return;
            }

            if (hasStructureChanges) {
                // Incremental: process only newly added nodes
                const addedNodes = [];
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
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
                                addedNodes.forEach((node) => enforceTextContrast(_lastPaletteHexes, node));
                            }
                            return;
                        }
                        addedNodes.forEach((node) => processAddedSubtree(node));
                    }, PLConfig.OBSERVER_DEBOUNCE_SMALL_MS);
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
                        PLLog.info(' DOM changed significantly, full rebuild');
                        buildColorMap();
                    }, PLConfig.OBSERVER_DEBOUNCE_LARGE_MS);
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
                }, PLConfig.OBSERVER_DEBOUNCE_ATTR_MS);
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

    window.addEventListener(
        'scroll',
        () => {
            if (__plPaused) return;
            if (isRescanning) return; // never compete with an in-flight rescan
            if (_plBulkApplyCooldown) return; // suppress during post-apply cooldown
            if (_plDropperActive) return; // dropper active — skip scroll reapply
            if (rawOverrideState.size === 0) return; // nothing to re-apply

            clearTimeout(_plScrollReapplyTimer);
            _plScrollReapplyTimer = setTimeout(() => {
                if (isRescanning) return; // double-check after debounce
                const now = Date.now();
                // Throttle to at most once per 1500ms
                if (now - _plLastScrollReapply < PLConfig.SCROLL_REAPPLY_THROTTLE_MS) return;
                _plLastScrollReapply = now;
                // Lightweight re-apply — only touches elements already in the map.
                // Avoids the expensive full DOM walk that buildColorMap() does.
                reapplyAllOverrides();
            }, PLConfig.SCROLL_REAPPLY_DEBOUNCE_MS);
        },
        { passive: true }
    );

    // ── Periodic Override Watchdog ─────────────────────────────────
    // Detects when the page silently reverts overrides (React reconciliation,
    // CSS animations, framework re-renders) and forces re-application.
    let _plWatchdogTimer = null;
    let _plWatchdogNoDriftCount = 0; // adaptive: count consecutive no-drift ticks
    const _WATCHDOG_FAST_MS = PLConfig.WATCHDOG_FAST_MS;
    const _WATCHDOG_SLOW_MS = PLConfig.WATCHDOG_SLOW_MS;

    function startOverrideWatchdog() {
        if (_plWatchdogTimer) return;
        _plWatchdogNoDriftCount = 0;

        const _runWatchdogTick = () => {
            if (__plPaused) return;
            if (isRescanning) return; // never compete with an in-flight rescan
            if (_plBulkApplyCooldown) return; // suppress during post-apply cooldown
            if (_plDropperActive) {
                // Dropper is running — skip this tick but reschedule so watchdog
                // resumes automatically if _plSetDropperActive(false) is not called.
                _plWatchdogTimer = setTimeout(_runWatchdogTick, _WATCHDOG_FAST_MS);
                return;
            }
            if (rawOverrideState.size === 0) return;

            let drifted = 0;
            const sampleLimit = PLConfig.WATCHDOG_SAMPLE_LIMIT;
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
                    } catch (e) {
                        /* ignore */
                    }
                }
            });

            if (drifted > 0) {
                _plWatchdogNoDriftCount = 0;
                PLLog.info(`Watchdog: ${drifted}/${checked} overrides drifted, re-applying...`);
                reapplyAllOverrides();
            } else {
                _plWatchdogNoDriftCount++;
            }

            // Adaptive interval: slow down after 3 consecutive no-drift ticks
            const nextMs =
                _plWatchdogNoDriftCount >= PLConfig.WATCHDOG_SLOW_THRESHOLD ? _WATCHDOG_SLOW_MS : _WATCHDOG_FAST_MS;
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

    // Extension is OFF by default on every page load / refresh.
    // Saved palette data is preserved in storage but never auto-applied —
    // the user must turn the extension on via the popup each session.
    __plPaused = true;
    PLLog.info(' Extension is off by default. Use the popup to enable.');

    // ── Auto-Resume After Reload ─────────────────────────────────
    // Save the paused state before page unload so we can auto-resume if it was ON
    window.addEventListener('beforeunload', () => {
        try {
            sessionStorage.setItem('__plWasActiveBeforeReload', __plPaused ? '0' : '1');
        } catch (e) {
            /* ignore sessionStorage errors */
        }
    });

    // Check if extension was ON before the reload and auto-resume after page loads
    function tryAutoResumeAfterReload() {
        try {
            const wasActive = sessionStorage.getItem('__plWasActiveBeforeReload');

            if (wasActive === '1') {
                // Mark un-paused IMMEDIATELY so any PING from the popup that arrives
                // before the deferred DOM-work fires gets the correct state.
                // (Previously this was set inside performResume after a 300 ms delay,
                // causing the popup to see paused:true and show the extension as OFF.)
                __plPaused = false;
                PLLog.info(' Extension was active before reload, will auto-resume after page loads');

                const performResume = () => {
                    // Remove the flag now that we're resuming
                    try {
                        sessionStorage.removeItem('__plWasActiveBeforeReload');
                    } catch (e) {
                        /* ignore */
                    }

                    // __plPaused already set to false above; start observer + reapply palette.
                    startObserver();

                    // Re-apply saved palette if any
                    const domain = window.location.hostname;
                    if (window.StorageUtils && domain) {
                        window.StorageUtils.getPalette(domain)
                            .then((savedData) => {
                                if (savedData && savedData.overrides) {
                                    PLLog.info(' Auto-resuming with saved palette');
                                    applySavedPalette(savedData);
                                } else if (savedData && savedData.settings) {
                                    if (savedData.settings.scheme) setColorScheme(savedData.settings.scheme);
                                    if (savedData.settings.vision) setVisionMode(savedData.settings.vision);
                                }
                            })
                            .catch(() => {
                                /* ignore */
                            });
                    }

                    PLLog.info(' Auto-resumed after page reload');
                };

                // If page is already fully loaded, start observer+palette work immediately
                // (small delay for DOM stability; paused flag already cleared above).
                if (document.readyState === 'complete') {
                    setTimeout(performResume, 300);
                } else if (document.readyState === 'interactive') {
                    // DOM is ready but resources still loading — wait for full load
                    window.addEventListener(
                        'load',
                        () => {
                            setTimeout(performResume, 300);
                        },
                        { once: true }
                    );
                } else {
                    // Still loading — wait for full load
                    window.addEventListener(
                        'DOMContentLoaded',
                        () => {
                            window.addEventListener(
                                'load',
                                () => {
                                    setTimeout(performResume, 300);
                                },
                                { once: true }
                            );
                        },
                        { once: true }
                    );
                }
            } else {
                // Extension was OFF or no state saved — remove any stale flag
                try {
                    sessionStorage.removeItem('__plWasActiveBeforeReload');
                } catch (e) {
                    /* ignore */
                }
            }
        } catch (e) {
            PLLog.warn(' Auto-resume error', e);
        }
    }

    tryAutoResumeAfterReload();

    // ── SPA Route Detection ──────────────────────────────────────
    // Hook into History API to detect client-side navigation (React Router, Vue Router, etc.)
    let _plLastUrl = location.href;
    let _plRouteTimer = null;

    function onRouteChange() {
        if (__plPaused) return;
        const newUrl = location.href;
        if (newUrl === _plLastUrl) return;
        _plLastUrl = newUrl;

        // Invalidate scan cache — the page content has changed.
        _scanCache = null;

        clearTimeout(_plRouteTimer);
        _plRouteTimer = setTimeout(() => {
            PLLog.info(' SPA route change detected, rebuilding color map');
            buildColorMap();
        }, PLConfig.SPA_ROUTE_DEBOUNCE_MS);
    }

    // Intercept pushState / replaceState — guarded against double-patching
    // when the content script is re-injected (version upgrade or navigation).
    // Store the active handler on history so a re-injection can update it
    // without double-wrapping the original browser methods.
    history._plOnRouteChange = onRouteChange;

    if (!history._plPatched) {
        const _origPushState = history.pushState;
        const _origReplaceState = history.replaceState;

        history.pushState = function () {
            _origPushState.apply(this, arguments);
            history._plOnRouteChange();
        };

        history.replaceState = function () {
            _origReplaceState.apply(this, arguments);
            history._plOnRouteChange();
        };

        history._plPatched = true;
    }

    window.addEventListener('popstate', () => history._plOnRouteChange());

    // ── BFCache (Back-Forward Cache) Restoration ─────────────────────
    // YouTube and many SPAs use bfcache for instant back/forward navigation.
    // When Chrome restores a page from bfcache:
    //   • `pageshow` fires with event.persisted === true
    //   • `load`, `DOMContentLoaded`, `beforeunload` do NOT fire
    //   • All frozen timers (watchdog, safety timers) need to be restarted
    //   • The dropper overlay is a full-screen div that may still cover the page
    window.addEventListener('pageshow', (event) => {
        if (!event.persisted) return; // Normal load is handled by tryAutoResumeAfterReload

        PLLog.info(' BFCache restore detected — re-hydrating state');

        // 1. Force-cancel any stuck dropper.
        //    The overlay is position:fixed;inset:0;z-index:2147483646 — if it was active
        //    when leaving the page it will still be in the restored DOM and cover everything,
        //    creating the blank screen the user sees.
        if (_plDropperActive) {
            _plSetDropperActive(false);
            if (window.Dropper) window.Dropper.cancel();
        }
        // Belt-and-suspenders: remove any orphaned overlay node even if state flag was reset
        const orphanOverlay = document.getElementById('pl-dropper-overlay');
        if (orphanOverlay) orphanOverlay.remove();

        // 2. Invalidate scan cache — the frozen DOM snapshot may be out of date
        _scanCache = null;

        // 3. Track URL in case SPA navigated while page was in bfcache
        const currentUrl = location.href;
        if (currentUrl !== _plLastUrl) {
            _plLastUrl = currentUrl;
        }

        // 4. If the extension is active, restart frozen timers and reapply overrides
        if (!__plPaused) {
            startObserver();
            if (rawOverrideState.size > 0) {
                // Short delay so the restored page JS finishes reinitialising its DOM
                // before we paint our overrides back on top.
                setTimeout(() => {
                    reapplyAllOverrides();
                    startOverrideWatchdog();
                }, 300);
            } else {
                startOverrideWatchdog();
            }
        }
    });

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
            PLLog.info(' multi-tab sync — overrides cleared by another tab');
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

        PLLog.info(' multi-tab sync — overrides updated from another tab');
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
                PLLog.warn(' rejected untrusted pl-dropper-override event');
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
            PLLog.warn(' dropper override error', error);
        }
    });

    window.addEventListener('pl-dropper-save', (event) => {
        try {
            // Validate event is trusted and has correct secret
            if (!isValidDropperEvent(event)) {
                PLLog.warn(' rejected untrusted pl-dropper-save event');
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
                .then((data) => {
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
                    PLLog.info(`Saved dropper override ${detail.original} -> ${detail.current}`);
                })
                .catch((error) => {
                    PLLog.warn(' dropper save error', error);
                });
        } catch (error) {
            PLLog.warn(' dropper save error', error);
        }
    });

    // Mark content script as fully initialized
    window.__paletteLiveReady = true;
    PLLog.info('Content script ready');
})();
