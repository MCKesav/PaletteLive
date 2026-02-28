/**
 * PaletteLive - Shared Constants
 * Centralized message types, magic numbers, and configuration values.
 * Prevents typo-based silent failures and documents configuration rationale.
 */

// Guard against re-injection
if (typeof globalThis._constantsVersion !== 'undefined' && globalThis._constantsVersion === 1) {
    // Already loaded with same version
} else {
    globalThis._constantsVersion = 1;

    // ══════════════════════════════════════════════════════
    //  Message Types
    // ══════════════════════════════════════════════════════
    // Every chrome.runtime / chrome.tabs message SHOULD use a key from this
    // object. Note: Object.freeze missing keys resolve to undefined, not ReferenceError.

    const MessageTypes = Object.freeze({
        // ── Lifecycle ──
        PING: 'PING',
        PAUSE_EXTENSION: 'PAUSE_EXTENSION',
        RESUME_EXTENSION: 'RESUME_EXTENSION',

        // ── Scanning / Extraction ──
        EXTRACT_PALETTE: 'EXTRACT_PALETTE',
        RESCAN_ONLY: 'RESCAN_ONLY',
        RESET_STYLES: 'RESET_STYLES',
        RESET_AND_RESCAN: 'RESET_AND_RESCAN',
        FORCE_REAPPLY: 'FORCE_REAPPLY',

        // ── Overrides ──
        APPLY_OVERRIDE: 'APPLY_OVERRIDE',
        APPLY_OVERRIDE_FAST: 'APPLY_OVERRIDE_FAST',
        APPLY_OVERRIDE_BULK: 'APPLY_OVERRIDE_BULK',
        REMOVE_RAW_OVERRIDE: 'REMOVE_RAW_OVERRIDE',

        // ── Highlight ──
        HIGHLIGHT_ELEMENTS: 'HIGHLIGHT_ELEMENTS',
        UNHIGHLIGHT: 'UNHIGHLIGHT',

        // ── Dropper ──
        PICK_COLOR: 'PICK_COLOR',
        CANCEL_PICK: 'CANCEL_PICK',
        DROPPER_RESOLVE_CLUSTER: 'DROPPER_RESOLVE_CLUSTER',

        // ── Heatmap ──
        OPEN_HEATMAP_WINDOW: 'OPEN_HEATMAP_WINDOW',

        // ── Text Contrast ──
        FIX_TEXT_CONTRAST: 'FIX_TEXT_CONTRAST',

        // ── Comparison ──
        SUSPEND_FOR_COMPARISON: 'SUSPEND_FOR_COMPARISON',
        WAIT_FOR_PAINT: 'WAIT_FOR_PAINT',
        RESTORE_AFTER_COMPARISON: 'RESTORE_AFTER_COMPARISON',
        SHOW_COMPARISON_OVERLAY: 'SHOW_COMPARISON_OVERLAY',
        HIDE_COMPARISON_OVERLAY: 'HIDE_COMPARISON_OVERLAY',
        PL_COMPARISON_OVERLAY_CLOSED: 'PL_COMPARISON_OVERLAY_CLOSED',

        // ── Color Scheme / Vision ──
        SET_COLOR_SCHEME: 'SET_COLOR_SCHEME',
        SET_VISION_MODE: 'SET_VISION_MODE',

        // ── Editor / Side Panel ──
        OPEN_EDITOR_PANEL: 'OPEN_EDITOR_PANEL',
        OPEN_EDITOR_WINDOW: 'OPEN_EDITOR_WINDOW',
        SIDEPANEL_COLOR_CHANGED: 'SIDEPANEL_COLOR_CHANGED',
        SIDEPANEL_COLOR_COMMITTED: 'SIDEPANEL_COLOR_COMMITTED',
        SIDEPANEL_APPLY_OVERRIDE: 'SIDEPANEL_APPLY_OVERRIDE',
        SIDEPANEL_REMOVE_OVERRIDE: 'SIDEPANEL_REMOVE_OVERRIDE',
        SIDEPANEL_HIGHLIGHT: 'SIDEPANEL_HIGHLIGHT',
        SIDEPANEL_EXPORT_TOGGLED: 'SIDEPANEL_EXPORT_TOGGLED',
        SIDEPANEL_BATCH_APPLY: 'SIDEPANEL_BATCH_APPLY',
        SIDEPANEL_LOAD_COLOR: 'SIDEPANEL_LOAD_COLOR',
        SIDEPANEL_UPDATE_EXPORT: 'SIDEPANEL_UPDATE_EXPORT',
        SIDEPANEL_UPDATE_COLOR: 'SIDEPANEL_UPDATE_COLOR',

        // ── Saved Palette ──
        APPLY_SAVED_PALETTE: 'APPLY_SAVED_PALETTE',
    });

    // ══════════════════════════════════════════════════════
    //  Configuration Constants
    // ══════════════════════════════════════════════════════
    // All magic numbers extracted from across the codebase with rationale.

    const PLConfig = Object.freeze({
        // ── DOM Scanning ──
        /** Max elements scanned in buildColorMap(). Higher = more coverage, slower scan. */
        MAP_ELEMENT_LIMIT: 2000,
        /** Batch size for extractor's requestIdleCallback loop. */
        EXTRACTOR_BATCH_SIZE: 150,
        /** Batch size for heatmap element processing. */
        HEATMAP_BATCH_SIZE: 200,

        // ── Text Contrast Enforcement ──
        /** WCAG AA minimum contrast ratio for normal text. */
        WCAG_AA_CONTRAST: 4.5,
        /** WCAG AA minimum contrast ratio for large text (≥18px bold or ≥24px). */
        WCAG_AA_LARGE_CONTRAST: 3.0,
        /** Max elements processed per enforceTextContrast full-DOM pass. */
        CONTRAST_MAX_ELEMENTS: 2000,
        /** Elements processed per requestAnimationFrame chunk. */
        CONTRAST_CHUNK_SIZE: 60,
        /** Max ancestor depth for _getEffectiveBg() walk. */
        EFFECTIVE_BG_MAX_DEPTH: 20,

        // ── Override System ──
        /** ΔE₀₀ tolerance for fuzzy color matching. */
        FUZZY_MATCH_TOLERANCE: 10,
        /** Cooldown (ms) after bulk apply — suppresses observer/scroll/watchdog. */
        BULK_APPLY_COOLDOWN_MS: 2000,
        /** Fallback DOM walk cap during bulk apply phase 3. */
        FALLBACK_WALK_LIMIT: 1000,

        // ── Timers & Debounce ──
        /** Observer debounce for small structural mutations (ms). */
        OBSERVER_DEBOUNCE_SMALL_MS: 200,
        /** Observer debounce for large structural mutations (ms). */
        OBSERVER_DEBOUNCE_LARGE_MS: 400,
        /** Observer debounce for attribute-only mutations (ms). */
        OBSERVER_DEBOUNCE_ATTR_MS: 500,
        /** SPA route change rebuild debounce (ms). */
        SPA_ROUTE_DEBOUNCE_MS: 600,
        /** Max observer rescans per minute before auto-pause. */
        OBSERVER_MAX_RESCANS_PER_MIN: 30,
        /** Watchdog interval (no drift detected). */
        WATCHDOG_SLOW_MS: 10000,
        /** Watchdog interval (drift detected). */
        WATCHDOG_FAST_MS: 5000,
        /** Watchdog sample limit per tick. */
        WATCHDOG_SAMPLE_LIMIT: 100,
        /** Consecutive no-drift ticks before slowing watchdog. */
        WATCHDOG_SLOW_THRESHOLD: 3,
        /** Scroll reapply throttle (ms). */
        SCROLL_REAPPLY_THROTTLE_MS: 1500,
        /** Scroll reapply debounce (ms). */
        SCROLL_REAPPLY_DEBOUNCE_MS: 500,
        /** WeakRef pruning interval (ms). */
        WEAKREF_PRUNE_INTERVAL_MS: 60000,

        // ── Storage ──
        /** Maximum number of domains stored before LRU eviction. */
        MAX_STORED_DOMAINS: 200,
        /** Evict when storage exceeds this fraction of quota. */
        QUOTA_THRESHOLD: 0.8,
        /** Fraction of oldest domains to evict. */
        EVICTION_PERCENT: 0.2,
        /** chrome.storage.local quota in bytes (~10 MB). */
        STORAGE_QUOTA_BYTES: 10485760,

        // ── Undo / History ──
        /** Max entries in popup undo/redo stack. */
        HISTORY_LIMIT: 50,
        /** Max entries in export history. */
        EXPORT_HISTORY_LIMIT: 10,

        // ── Color Science ──
        /** Default hue range for analogous palette detection. */
        HUE_RANGE_ANALOGOUS: 30,
        /** Hue angle for complementary split delta. */
        SPLIT_COMP_ANGLE: 40,
        /** Default ΔE₀₀ clustering tolerance. */
        DEFAULT_CLUSTER_TOLERANCE: 35,

        // ── UI ──
        /** z-index for dropper full-screen overlay. */
        DROPPER_Z_INDEX: 2147483645,
        /** z-index for dropper preview bubble. */
        DROPPER_PREVIEW_Z_INDEX: 2147483647,
        /** z-index for comparison overlay. */
        COMPARISON_OVERLAY_Z_INDEX: 2147483646,
    });

    // ══════════════════════════════════════════════════════
    //  Debug Logging
    // ══════════════════════════════════════════════════════
    // Gated logger that can be toggled via chrome.storage or console command.
    // In production, verbose logs are suppressed by default.

    const PLLog = {
        _debugEnabled: false,

        /** Enable verbose logging (call from DevTools: PLLog.enableDebug()) */
        enableDebug: () => {
            PLLog._debugEnabled = true;
            console.info('PaletteLive: Debug logging ENABLED');
        },

        /** Disable verbose logging */
        disableDebug: () => {
            PLLog._debugEnabled = false;
            console.info('PaletteLive: Debug logging DISABLED');
        },

        /** Always logged — critical errors */
        error: (...args) => {
            console.error('PaletteLive:', ...args);
        },

        /** Always logged — important warnings */
        warn: (...args) => {
            console.warn('PaletteLive:', ...args);
        },

        /** Always logged — key lifecycle events */
        info: (...args) => {
            console.info('PaletteLive:', ...args);
        },

        /** Debug-only — verbose operational details */
        debug: (...args) => {
            if (PLLog._debugEnabled) {
                console.debug('PaletteLive:', ...args);
            }
        },

        /** Debug-only — performance timing */
        _inFlightTimers: new Set(),

        time: (label) => {
            if (PLLog._debugEnabled) {
                const key = 'PaletteLive: ' + label;
                PLLog._inFlightTimers.add(key);
                console.time(key);
            }
        },

        timeEnd: (label) => {
            if (PLLog._debugEnabled) {
                const key = 'PaletteLive: ' + label;
                if (PLLog._inFlightTimers.has(key)) {
                    PLLog._inFlightTimers.delete(key);
                    console.timeEnd(key);
                }
            }
        },
    };

    // Export
    globalThis.MessageTypes = MessageTypes;
    globalThis.PLConfig = PLConfig;
    globalThis.PLLog = PLLog;
} // end re-injection guard
