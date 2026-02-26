/**
 * PaletteLive - Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    // Clean up stale saved popup size from earlier version
    chrome.storage.local.remove('palettelive_popup_size');

    const paletteList = document.getElementById('palette-list');
    const resetBtn = document.getElementById('reset-btn');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const scanBtn = document.getElementById('scan-btn');
    const exportBtn = document.getElementById('export-btn');
    const heatmapToggle = document.getElementById('heatmap-toggle');
    const compareToggle = document.getElementById('compare-toggle');
    const compareStatus = document.getElementById('compare-status');
    const exportMenu = document.getElementById('export-menu');
    const exportHistoryContainer = document.getElementById('export-history');
    const importBtn = document.getElementById('import-btn');
    const importMenu = document.getElementById('import-menu');
    const importFileBtn = document.getElementById('import-file-btn');
    const importClipboardBtn = document.getElementById('import-clipboard-btn');
    const importInput = document.getElementById('import-input');
    const importClipboardModal = document.getElementById('import-clipboard-modal');
    const importClipboardTextarea = document.getElementById('import-clipboard-textarea');
    const importClipboardPaste = document.getElementById('import-clipboard-paste');
    const importClipboardApply = document.getElementById('import-clipboard-apply');
    const importClipboardCancel = document.getElementById('import-clipboard-cancel');
    const importFormatSelect = document.getElementById('import-format-select');
    const dropperBtn = document.getElementById('dropper-btn');
    const _schemeSelect = null; // Theme dropdown removed — always default to 'auto'
    const visionSelect = document.getElementById('vision-select');
    const paletteModeSelect = document.getElementById('palette-mode-select');
    const advancedControls = document.getElementById('advanced-controls');
    const paletteSummary = document.getElementById('palette-summary');
    const applyPaletteControls = document.getElementById('apply-palette-controls');
    const applyPaletteInput = document.getElementById('apply-palette-input');
    const applyPalettePreview = document.getElementById('apply-palette-preview');
    const applyPaletteBtn = document.getElementById('apply-palette-btn');
    const applyPaletteReset = document.getElementById('apply-palette-reset');
    const applyPaletteStatus = document.getElementById('apply-palette-status');
    const hintAuto = document.getElementById('apply-palette-hint-auto');
    const hintManual = document.getElementById('apply-palette-hint-manual');
    const clusterToggle = document.getElementById('cluster-toggle');
    const clusterThreshold = document.getElementById('cluster-threshold');
    const clusterThresholdValue = document.getElementById('cluster-threshold-value');
    const clusterSummary = document.getElementById('cluster-summary');
    const forceReapplyBtn = document.getElementById('force-reapply-btn');
    const powerToggle = document.getElementById('power-toggle');
    const disabledBanner = document.getElementById('disabled-banner');
    const containerEl = document.querySelector('.container');

    // Generator inputs
    const generatorSection = document.getElementById('generator-section');
    const genPanels = {
        monochromatic: document.getElementById('gen-monochromatic'),
        '60-30-10': document.getElementById('gen-603010'),
        analogous: document.getElementById('gen-analogous'),
        complementary: document.getElementById('gen-complementary'),
        'split-complementary': document.getElementById('gen-split-comp'),
        triadic: document.getElementById('gen-triadic'),
    };

    const genMonoColor = document.getElementById('gen-mono-color');
    const genMonoCount = document.getElementById('gen-mono-count');
    const genMonoCountVal = document.getElementById('gen-mono-count-val');

    const gen60Color = document.getElementById('gen-60-color');
    const gen30Color = document.getElementById('gen-30-color');
    const gen10Color = document.getElementById('gen-10-color');

    const genAnalogColor = document.getElementById('gen-analog-color');
    const genAnalogSpread = document.getElementById('gen-analog-spread');
    const genAnalogSpreadVal = document.getElementById('gen-analog-spread-val');

    const genCompBase = document.getElementById('gen-comp-base');
    const genCompOpp = document.getElementById('gen-comp-opp');

    const genSplitColor = document.getElementById('gen-split-color');
    const genSplitGap = document.getElementById('gen-split-gap');
    const genSplitGapVal = document.getElementById('gen-split-gap-val');

    const genTriadicColor = document.getElementById('gen-triadic-color');

    // Theme toggle elements
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIconSun = document.getElementById('theme-icon-sun');
    const themeIconMoon = document.getElementById('theme-icon-moon');

    // ── Popup Theme (dark/light/auto) ──
    const THEME_STATES = ['light', 'dark', 'auto'];
    let currentPopupTheme = 'light';

    function applyPopupTheme(theme) {
        currentPopupTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        // Update icon: show sun when dark, show moon when light
        const isDark =
            theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (themeIconSun && themeIconMoon) {
            themeIconSun.classList.toggle('hidden', !isDark);
            themeIconMoon.classList.toggle('hidden', isDark);
        }
        if (themeToggleBtn) {
            themeToggleBtn.title = `Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)} (click to cycle)`;
            themeToggleBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
        }
    }

    // Load saved popup theme
    chrome.storage.local.get('palettelive_popup_theme', (result) => {
        const saved = result.palettelive_popup_theme;
        applyPopupTheme(THEME_STATES.includes(saved) ? saved : 'light');
    });

    // Listen for system theme changes (matters when set to "auto")
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentPopupTheme === 'auto') applyPopupTheme('auto');
    });

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const nextIdx = (THEME_STATES.indexOf(currentPopupTheme) + 1) % THEME_STATES.length;
            const next = THEME_STATES[nextIdx];
            applyPopupTheme(next);
            chrome.storage.local.set({ palettelive_popup_theme: next });
        });
    }

    // Extension enabled/paused state per domain
    let extensionPaused = false;

    // Helper to escape HTML entities to prevent injection
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Helper to set a loading-state message safely without innerHTML
    function setLoadingState(container, ...textParts) {
        container.textContent = '';
        const div = document.createElement('div');
        div.className = 'loading-state';
        textParts.forEach((part, i) => {
            if (i > 0) div.appendChild(document.createElement('br'));
            div.appendChild(document.createTextNode(part));
        });
        container.appendChild(div);
    }

    let currentColors = [];
    let currentVariables = [];
    let activeTabId = null;
    let activeWindowId = null;

    let selectedColor = null;
    let selectedSource = null;
    let selectedSources = [];
    let activeSwatch = null;
    let _editStartValue = null;
    const _editorWindowId = null; // Track the editor popup window (managed in background.js)
    const editStartValues = new Map();

    const overrideState = new Map(); // sourceHex -> currentHex
    const exportSelection = new Set(); // sourceHex values

    const historyStack = [];
    const redoStack = [];
    const HISTORY_LIMIT = 50;
    const exportHistory = [];
    const EXPORT_HISTORY_LIMIT = 10;

    const debouncedInstances = new Set();
    let isResetting = false;
    let comparisonActive = false;
    let baselineScreenshot = null; // PNG data URL of original page without any PaletteLive overrides
    let footerNoticeTimer = null;
    let _highlightedSwatchHex = null;
    let highlightedSwatchEl = null;

    function normalizeHex(value) {
        return ColorUtils.rgbToHex8(value).toLowerCase();
    }

    function sanitizePickerHex(value) {
        const hex = normalizeHex(value);
        // HTML color picker only supports #rrggbb — strip alpha for the picker
        if (/^#[0-9a-f]{6,8}$/.test(hex)) return '#' + hex.substring(1, 7);
        return '#000000';
    }

    function _debounce(fn, delay) {
        let timer = null;
        const debounced = (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                fn(...args);
            }, delay);
        };
        debounced.cancel = () => {
            clearTimeout(timer);
            timer = null;
        };
        debouncedInstances.add(debounced);
        return debounced;
    }

    let isResettingTimer = null;

    function cancelPendingOperations() {
        for (const instance of debouncedInstances) {
            instance.cancel();
        }
        isResetting = true;
        // Safety: auto-unlock after 8 seconds to prevent permanent stuck state
        clearTimeout(isResettingTimer);
        isResettingTimer = setTimeout(() => {
            if (isResetting) {
                console.debug('PaletteLive: isResetting safety timeout — force unlocking');
                isResetting = false;
            }
        }, 8000);
    }

    function enableOperations() {
        isResetting = false;
        clearTimeout(isResettingTimer);
        isResettingTimer = null;
    }

    function setCompareStatus(message, type) {
        compareStatus.textContent = message || '';
        compareStatus.classList.remove('busy', 'error');
        if (type === 'busy' || type === 'error') {
            compareStatus.classList.add(type);
        }
    }

    function showFooterNotice(message, isError) {
        clearTimeout(footerNoticeTimer);
        setCompareStatus(message, isError ? 'error' : undefined);
        footerNoticeTimer = setTimeout(() => {
            if (!comparisonActive && !compareToggle.checked) {
                setCompareStatus('');
            }
        }, 2600);
    }

    function updateClusterControls() {
        clusterThreshold.disabled = !clusterToggle.checked;
        clusterThresholdValue.textContent = String(clusterThreshold.value);
    }

    function trimExportHistory(historyItems) {
        return (Array.isArray(historyItems) ? historyItems : [])
            .filter((item) => item && typeof item.output === 'string' && item.output.trim())
            .filter(
                (item) =>
                    item.format === 'css' ||
                    item.format === 'json' ||
                    item.format === 'tailwind' ||
                    item.format === 'cmyk' ||
                    item.format === 'lab' ||
                    item.format === 'oklch' ||
                    item.format === 'palettelive'
            )
            .map((item) => ({
                format: item.format,
                output: item.output,
                timestamp: Number(item.timestamp) || Date.now(),
            }))
            .slice(0, EXPORT_HISTORY_LIMIT);
    }

    function formatHistoryLabel(entry) {
        const stamp = Number(entry.timestamp) || Date.now();
        const date = new Date(stamp);
        const timeLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const FORMAT_LABELS = {
            css: 'CSS',
            json: 'JSON',
            tailwind: 'Tailwind',
            cmyk: 'CMYK',
            lab: 'LAB',
            oklch: 'OKLCH',
            palettelive: 'PaletteLive',
        };
        const formatLabel = FORMAT_LABELS[entry.format] || 'CSS';
        return `${formatLabel} - ${timeLabel}`;
    }

    function renderExportHistoryMenu() {
        if (!exportHistoryContainer) return;

        if (!exportHistory.length) {
            exportHistoryContainer.classList.add('hidden');
            exportHistoryContainer.innerHTML = '';
            return;
        }

        // Build export history using DOM API instead of innerHTML
        exportHistoryContainer.classList.remove('hidden');
        exportHistoryContainer.textContent = '';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'export-history-title';
        titleDiv.textContent = 'Recent Exports';
        exportHistoryContainer.appendChild(titleDiv);

        exportHistory.forEach((entry, index) => {
            const btn = document.createElement('button');
            btn.className = 'export-history-item';
            btn.setAttribute('data-history-index', index);
            btn.textContent = formatHistoryLabel(entry);
            exportHistoryContainer.appendChild(btn);
        });
    }

    function recordExportHistory(format, output) {
        const KNOWN_FORMATS = ['css', 'json', 'tailwind', 'cmyk', 'lab', 'oklch'];
        const normalized = KNOWN_FORMATS.includes(format) ? format : 'css';
        exportHistory.unshift({
            format: normalized,
            output,
            timestamp: Date.now(),
        });

        if (exportHistory.length > EXPORT_HISTORY_LIMIT) {
            exportHistory.length = EXPORT_HISTORY_LIMIT;
        }

        renderExportHistoryMenu();
    }

    function captureVisible(windowId) {
        return new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!dataUrl) {
                    reject(new Error('Empty screenshot capture result'));
                    return;
                }
                resolve(dataUrl);
            });
        });
    }

    function updateUndoButton() {
        undoBtn.disabled = historyStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
        // Persist stacks so they survive popup close/reopen
        chrome.storage.session.set({
            palettelive_historyStack: historyStack,
            palettelive_redoStack: redoStack,
        });
    }

    function _pushHistory(source, from, to) {
        if (!source || !from || !to || from === to) return;

        historyStack.push({ source, from, to, timestamp: Date.now() });
        if (historyStack.length > HISTORY_LIMIT) {
            historyStack.shift();
        }
        redoStack.length = 0; // new action invalidates redo
        updateUndoButton();
    }

    /**
     * Push a batch undo entry. Single undo will revert all changes at once.
     * @param {Array<{source, from, to}>} changes
     */
    function pushBatchHistory(changes) {
        const filtered = changes.filter((c) => c.source && c.from && c.to && c.from !== c.to);
        if (!filtered.length) return;

        historyStack.push({ type: 'batch', changes: filtered, timestamp: Date.now() });
        if (historyStack.length > HISTORY_LIMIT) {
            historyStack.shift();
        }
        redoStack.length = 0; // new action invalidates redo
        updateUndoButton();
    }

    async function getActiveDomain() {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tabs[0] || !tabs[0].url) return null;
            return new URL(tabs[0].url).hostname;
        } catch (error) {
            return null;
        }
    }

    function sendMessageToTab(message) {
        return new Promise((resolve) => {
            if (!activeTabId) {
                resolve({ ok: false, error: 'No active tab.' });
                return;
            }

            chrome.tabs.sendMessage(activeTabId, message, { frameId: 0 }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                resolve({ ok: true, response });
            });
        });
    }

    /**
     * Send a message to the content script with a timeout.
     * Resolves with { ok, response, error } — never rejects.
     * If the content script doesn't respond within `ms`, resolves as failed.
     */
    function sendMessageWithTimeout(message, ms = 15000) {
        return new Promise((resolve) => {
            if (!activeTabId) {
                resolve({ ok: false, error: 'No active tab.' });
                return;
            }
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ ok: false, error: 'Timed out waiting for content script.' });
                }
            }, ms);

            chrome.tabs.sendMessage(activeTabId, message, { frameId: 0 }, (response) => {
                // Always read lastError first to prevent "Unchecked runtime.lastError" warnings,
                // even when we've already timed out and will discard the result.
                const err = chrome.runtime.lastError;
                if (settled) return; // already timed out — result discarded but lastError consumed
                settled = true;
                clearTimeout(timer);
                if (err) {
                    resolve({ ok: false, error: err.message });
                } else {
                    resolve({ ok: true, response });
                }
            });
        });
    }

    const persistLocks = new Map();

    function acquirePersistLock(domain) {
        if (!persistLocks.has(domain)) {
            persistLocks.set(domain, Promise.resolve());
        }
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const previous = persistLocks.get(domain);
        persistLocks.set(
            domain,
            previous.then(() => gate)
        );
        return { ready: previous, release };
    }

    async function persistDomainData(mutator) {
        const domain = await getActiveDomain();
        if (!domain) return;

        const lock = acquirePersistLock(domain);
        await lock.ready;

        try {
            const data = (await StorageUtils.getPalette(domain)) || {};

            if (!data.overrides) data.overrides = {};
            if (!data.overrides.variables) data.overrides.variables = {};
            if (!data.overrides.raw) data.overrides.raw = {};
            if (!data.settings) data.settings = {};

            if (typeof mutator === 'function') {
                mutator(data);
            }

            data.exportSelection = Array.from(exportSelection);
            data.exportHistory = trimExportHistory(exportHistory);
            data.settings.scheme = 'auto';
            data.settings.vision = visionSelect.value;
            data.settings.clustering = {
                enabled: !!clusterToggle.checked,
                threshold: Number(clusterThreshold.value) || 5,
            };
            data.settings.paletteMode = paletteModeSelect.value;
            data.settings.applyPaletteInput = applyPaletteInput.value || '';
            data.timestamp = new Date().toISOString();

            await StorageUtils.savePalette(domain, data);
        } catch (error) {
            console.warn('PaletteLive: Failed to persist domain data', error);
        } finally {
            lock.release();
        }
    }

    function getEffectiveValueForSource(sourceHex) {
        return overrideState.get(sourceHex) || sourceHex;
    }

    function findBestVariableForSource(sourceHex) {
        const matches = currentVariables.filter((variable) => normalizeHex(variable.value) === sourceHex);
        if (!matches.length) return null;

        matches.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        return matches[0];
    }

    function setSwatchExportState(swatch, sourceHex) {
        const members = (swatch.dataset.members || sourceHex || '')
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);
        const selected = members.length
            ? members.every((member) => exportSelection.has(member))
            : exportSelection.has(sourceHex);
        swatch.classList.toggle('export-selected', selected);
        swatch.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }

    function updateSwatchesForSource(sourceHex, currentHex) {
        const swatches = paletteList.querySelectorAll('.swatch');
        swatches.forEach((swatch) => {
            const members = (swatch.dataset.members || swatch.dataset.source || '')
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean);

            if (!members.includes(sourceHex)) return;
            swatch.style.backgroundColor = currentHex;
            const uses = swatch.dataset.uses || '0';
            const clusterSize = Number(swatch.dataset.clusterSize || '1');
            const clusterSuffix = clusterSize > 1 ? `, ${clusterSize} shades merged` : '';
            const twLabel = swatch.dataset.tailwindLabel ? `, Tailwind: ${swatch.dataset.tailwindLabel}` : '';
            swatch.title = `${currentHex} (${uses} uses${clusterSuffix}${twLabel})`;
            setSwatchExportState(swatch, sourceHex);
        });
    }

    function requestHighlight(sourceHex) {
        sendMessageToTab({
            type: 'HIGHLIGHT_ELEMENTS',
            payload: { color: sourceHex },
        });
    }

    function clearHighlight() {
        sendMessageToTab({ type: 'UNHIGHLIGHT' });
    }

    function hexToLab(hex) {
        return ColorScience.hexToLab(hex);
    }

    /**
     * CIEDE2000 colour-difference (ΔE₀₀).
     * Delegates to shared ColorScience module.
     */
    function ciede2000(lab1, lab2) {
        return ColorScience.ciede2000(lab1, lab2);
    }

    /**
     * Extract alpha channel (0–1) from a hex colour.
     * #RRGGBB → 1, #RRGGBBAA → AA/255.
     */
    function hexAlpha(hex) {
        const h = hex.replace('#', '');
        if (h.length === 8) return parseInt(h.substring(6, 8), 16) / 255;
        return 1;
    }

    /**
     * Compute effective merge distance between two colours.
     * Combines CIEDE2000 (perceptual) with an alpha penalty so that
     * semi-transparent variants (e.g. #00000099 vs #000000ff) stay separate.
     * Alpha penalty scaled by 50 so a full 0→1 difference equals ΔE₀₀ ≈ 50.
     */
    function colorDistance(lab1, alpha1, lab2, alpha2) {
        const de = ciede2000(lab1, lab2);
        const alphaPenalty = Math.abs(alpha1 - alpha2) * 50;
        return de + alphaPenalty;
    }

    /**
     * Adaptive threshold: neutrals (low chroma) get a 30% looser threshold
     * because small colour-value differences between grays are less noticeable.
     * Chromatic colours keep the user threshold as-is.
     */
    function adaptiveThreshold(lab, baseThreshold) {
        const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
        // chroma < 5 → fully neutral (scale 1.3), chroma > 20 → fully chromatic (scale 1.0)
        const t = Math.min(1, Math.max(0, (chroma - 5) / 15));
        const scale = 1.3 - 0.3 * t; // 1.3 … 1.0
        return baseThreshold * scale;
    }

    function clusterPaletteColors(colors, threshold) {
        if (!colors.length || threshold <= 0) {
            return {
                colors: colors.map((color) => ({
                    ...color,
                    clusterSize: 1,
                    clusterMembers: [normalizeHex(color.value)],
                    mergedCount: 0,
                })),
                mergedCount: 0,
            };
        }

        // ── Prepare entries with LAB + alpha ──
        const sourceEntries = colors
            .map((color) => {
                const sourceHex = normalizeHex(color.value);
                return {
                    color,
                    sourceHex,
                    lab: hexToLab(sourceHex),
                    alpha: hexAlpha(sourceHex),
                };
            })
            .sort((a, b) => (b.color.count || 0) - (a.color.count || 0));

        // ── Helper: recompute a cluster's weighted centroid ──
        function recomputeCentroid(cluster) {
            let sL = 0,
                sA = 0,
                sB = 0,
                wt = 0;
            cluster.members.forEach((m) => {
                const c = m.color.count || 0;
                sL += m.lab.l * c;
                sA += m.lab.a * c;
                sB += m.lab.b * c;
                wt += c;
            });
            wt = Math.max(1, wt);
            cluster.centroid = { l: sL / wt, a: sA / wt, b: sB / wt };
            cluster.centroidAlpha = cluster.members.reduce((sum, m) => sum + m.alpha * (m.color.count || 0), 0) / wt;
        }

        // ── Helper: rebuild aggregate fields from members ──
        function rebuildCluster(cluster) {
            cluster.totalCount = 0;
            cluster.categoryTotals = {};
            // representative = highest-count member
            let bestCount = -1;
            cluster.members.forEach((m) => {
                const cnt = m.color.count || 0;
                cluster.totalCount += cnt;
                const cat = m.color.primaryCategory || 'accent';
                cluster.categoryTotals[cat] = (cluster.categoryTotals[cat] || 0) + cnt;
                if (cnt > bestCount) {
                    bestCount = cnt;
                    cluster.representative = m.color;
                }
            });
            recomputeCentroid(cluster);
        }

        // ── Pass 1: greedy assignment (CIEDE2000 + alpha + adaptive threshold) ──
        const clusters = [];

        sourceEntries.forEach((entry) => {
            let bestCluster = null;
            let bestDistance = Infinity;

            const entryThreshold = adaptiveThreshold(entry.lab, threshold);

            clusters.forEach((cluster) => {
                const dist = colorDistance(entry.lab, entry.alpha, cluster.centroid, cluster.centroidAlpha);
                if (dist <= entryThreshold && dist < bestDistance) {
                    bestDistance = dist;
                    bestCluster = cluster;
                }
            });

            if (!bestCluster) {
                const cnt = entry.color.count || 0;
                clusters.push({
                    representative: entry.color,
                    members: [entry],
                    totalCount: cnt,
                    categoryTotals: {
                        [entry.color.primaryCategory || 'accent']: cnt,
                    },
                    centroid: { ...entry.lab },
                    centroidAlpha: entry.alpha,
                });
                return;
            }

            bestCluster.members.push(entry);
            bestCluster.totalCount += entry.color.count || 0;
            const categoryKey = entry.color.primaryCategory || 'accent';
            bestCluster.categoryTotals[categoryKey] =
                (bestCluster.categoryTotals[categoryKey] || 0) + (entry.color.count || 0);
            recomputeCentroid(bestCluster);
        });

        // ── Pass 2: reassignment — fix order-dependent mis-assignments ──
        // Up to 3 iterations; stop early if nothing moves.
        for (let iter = 0; iter < 3; iter++) {
            let moved = 0;

            sourceEntries.forEach((entry) => {
                // Find current cluster
                const currentIdx = clusters.findIndex((c) => c.members.includes(entry));
                if (currentIdx < 0) return;

                let bestIdx = currentIdx;
                const entryThreshold = adaptiveThreshold(entry.lab, threshold);
                let bestDist = colorDistance(
                    entry.lab,
                    entry.alpha,
                    clusters[currentIdx].centroid,
                    clusters[currentIdx].centroidAlpha
                );

                clusters.forEach((cluster, idx) => {
                    if (idx === currentIdx) return;
                    const dist = colorDistance(entry.lab, entry.alpha, cluster.centroid, cluster.centroidAlpha);
                    if (dist < bestDist && dist <= entryThreshold) {
                        bestDist = dist;
                        bestIdx = idx;
                    }
                });

                if (bestIdx !== currentIdx) {
                    // Move entry from current cluster to best cluster
                    const cur = clusters[currentIdx];
                    cur.members = cur.members.filter((m) => m !== entry);
                    clusters[bestIdx].members.push(entry);
                    moved++;
                }
            });

            // Remove empty clusters, rebuild all
            for (let i = clusters.length - 1; i >= 0; i--) {
                if (clusters[i].members.length === 0) {
                    clusters.splice(i, 1);
                }
            }
            clusters.forEach(rebuildCluster);

            if (moved === 0) break;
        }

        // ── Build output ──
        let mergedCount = 0;
        const clusteredColors = clusters
            .map((cluster) => {
                const categoryEntries = Object.entries(cluster.categoryTotals);
                const primaryCategory = categoryEntries.length
                    ? categoryEntries.sort((a, b) => b[1] - a[1])[0][0]
                    : cluster.representative.primaryCategory || 'accent';

                const clusterSize = cluster.members.length;
                mergedCount += Math.max(0, clusterSize - 1);

                return {
                    ...cluster.representative,
                    count: cluster.totalCount,
                    primaryCategory,
                    clusterSize,
                    clusterMembers: cluster.members.map((member) => member.sourceHex),
                    mergedCount: Math.max(0, clusterSize - 1),
                };
            })
            .sort((a, b) => (b.count || 0) - (a.count || 0));

        return { colors: clusteredColors, mergedCount };
    }

    function renderClusterSummary(mergedCount, shownCount, originalCount) {
        if (!clusterToggle.checked || mergedCount <= 0) {
            clusterSummary.classList.add('hidden');
            clusterSummary.textContent = '';
            return;
        }

        clusterSummary.classList.remove('hidden');
        clusterSummary.textContent = `${mergedCount} similar shades merged into ${shownCount} swatches (from ${originalCount}, ΔE₀₀ ≤ ${clusterThreshold.value}).`;
    }

    function getRenderColors(colors) {
        if (!clusterToggle.checked) {
            renderClusterSummary(0, colors.length, colors.length);
            return colors.map((color) => ({
                ...color,
                clusterSize: 1,
                clusterMembers: [normalizeHex(color.value)],
                mergedCount: 0,
            }));
        }

        const threshold = Number(clusterThreshold.value) || 5;
        const clustered = clusterPaletteColors(colors, threshold);
        renderClusterSummary(clustered.mergedCount, clustered.colors.length, colors.length);
        return clustered.colors;
    }

    // ════════════════════════════════════════════════
    //  Palette-mode helpers: color-wheel math
    // ════════════════════════════════════════════════

    /** Extract hue (0-360), saturation (0-1), lightness (0-1) from hex */
    function hexToHsl(hex) {
        return ColorScience.hexToHsl(hex);
    }

    /** Signed angular distance (−180…180) */
    function hueDist(h1, h2) {
        let d = h2 - h1;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        return d;
    }
    function absHueDist(h1, h2) {
        return Math.abs(hueDist(h1, h2));
    }

    /** Merge colors with aggressive clustering for simplified palette modes */
    function aggressiveMerge(colors) {
        return clusterPaletteColors(colors, 10).colors; // ΔE₀₀ ≤ 10
    }

    // ════════════════════════════════════════════════
    //  Apply Palette – preset definitions
    // ════════════════════════════════════════════════
    const PALETTE_PRESETS = {
        ocean: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51'],
        sunset: ['#ffb703', '#fb8500', '#e63946', '#1d3557', '#f1faee'],
        forest: ['#283618', '#606c38', '#dda15e', '#fefae0', '#bc6c25'],
        mono: ['#212529', '#495057', '#adb5bd', '#dee2e6', '#f8f9fa'],
        candy: ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff'],
        midnight: ['#0d1b2a', '#1b263b', '#415a77', '#778da9', '#e0e1dd'],
    };

    // ════════════════════════════════════════════════
    //  Apply Palette – parse user input
    // ════════════════════════════════════════════════
    function parseApplyPaletteInput(text) {
        if (!text || !text.trim()) return [];
        const t = text.trim();

        // Coolors URL: coolors.co/palette/264653-2a9d8f-… or coolors.co/264653-2a9d8f-…
        const coolorsMatch = t.match(/coolors\.co\/(?:palette\/)?([0-9a-f]{6}(?:-[0-9a-f]{6})+)/i);
        if (coolorsMatch) {
            return coolorsMatch[1].split('-').map((c) => '#' + c.toLowerCase());
        }

        // Extract all hex-like tokens
        const hexes = [];
        const re = /#?([0-9a-fA-F]{6})\b/g;
        let m;
        while ((m = re.exec(t)) !== null) {
            hexes.push('#' + m[1].toLowerCase());
        }
        // Deduplicate while preserving order
        return [...new Set(hexes)];
    }

    // ════════════════════════════════════════════════
    //  Apply Palette – auto-map imported → page colors
    // ════════════════════════════════════════════════

    /**
     * Relative luminance (WCAG definition) for a hex color.
     * Returns 0..1 where 0 = darkest, 1 = lightest.
     * Kept for potential future use; delegates to ColorUtils.
     */
    function _relativeLuminance(hex) {
        return ColorUtils.getLuminance(hex);
    }

    /** WCAG contrast ratio between two hex colors (1..21) */
    function contrastRatio(hex1, hex2) {
        return ContrastUtils.getRatio(hex1, hex2);
    }

    /**
     * Strategy – Contrast-Relationship Preservation (v3)
     *
     * The previous category-based BG/FG split failed when a single color
     * served both roles (e.g. white = card background AND text on teal).
     *
     * New approach:
     * 1. Cluster page colors (ΔE₀₀ ≤ 20).
     * 2. Map ALL clusters → imported colors by luminance proximity (1:1).
     * 3. Detect every pair of original colors that had meaningful contrast
     *    (CR ≥ 3:1) — these are the visual relationships to preserve.
     * 4. For each broken pair (new CR < 3:1), adjust the "text-role" color
     *    in the pair to an import that restores contrast, picking by best
     *    contrast vs. the anchor while remaining as close in luminance as
     *    possible to the original role.
     *
     * Returns: Array<{ from: string (page hex), to: string (imported hex) }>
     */
    function autoMapPalette(importedHexes, pageColors) {
        if (!importedHexes.length || !pageColors.length) return [];

        const N = importedHexes.length;

        // --- 1. Cluster ---
        const clusters = clusterPaletteColors(pageColors, 20);
        const allPageClusters = clusters.colors;

        // Enrich ALL clusters (needed for final mapping)
        const allEnriched = allPageClusters.map((c) => {
            const hex = normalizeHex(c.value);
            const lum = hexToHsl(hex).l;
            return { ...c, hex, lum };
        });

        // Sort by usage for anchor selection
        const sortedByUsage = [...allEnriched].sort((a, b) => (b.count || 0) - (a.count || 0));

        // Top-N anchors are used for 1:1 assignment + contrast repair
        const anchorClusters = sortedByUsage.slice(0, N);

        // --- 2. Initial assignment: luminance-proximity 1:1 mapping for anchors ---
        const importPool = importedHexes
            .map((hex) => ({ hex: hex.toLowerCase(), lum: hexToHsl(hex).l }))
            .sort((a, b) => a.lum - b.lum);

        const sortedAnchors = [...anchorClusters].sort((a, b) => a.lum - b.lum);
        const mapping = new Map(); // original page hex → import hex
        const usedIdx = new Set();

        sortedAnchors.forEach((pc) => {
            let bestIdx = -1,
                bestDist = Infinity;
            for (let i = 0; i < importPool.length; i++) {
                if (usedIdx.has(i)) continue;
                const dist = Math.abs(importPool[i].lum - pc.lum);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = i;
                }
            }
            // Fallback: allow reuse if all imports are taken
            if (bestIdx < 0) {
                for (let i = 0; i < importPool.length; i++) {
                    const dist = Math.abs(importPool[i].lum - pc.lum);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = i;
                    }
                }
            }
            if (bestIdx >= 0) {
                mapping.set(pc.hex, importPool[bestIdx].hex);
                usedIdx.add(bestIdx);
            }
        });

        // --- 3. Detect broken contrast relationships ---
        const MIN_ORIG_CR = 3.0; // original pair must have had at least this
        const MIN_NEW_CR = 3.0; // minimum acceptable after mapping
        const TARGET_CR = 4.5; // ideal WCAG AA target

        // Collect all pairs that had meaningful contrast originally
        // but are now broken after mapping.
        const brokenPairs = [];
        for (let i = 0; i < sortedAnchors.length; i++) {
            for (let j = i + 1; j < sortedAnchors.length; j++) {
                const origCR = contrastRatio(sortedAnchors[i].hex, sortedAnchors[j].hex);
                if (origCR < MIN_ORIG_CR) continue;

                const mA = mapping.get(sortedAnchors[i].hex);
                const mB = mapping.get(sortedAnchors[j].hex);
                if (!mA || !mB) continue;

                const newCR = contrastRatio(mA, mB);
                if (newCR >= MIN_NEW_CR) continue; // still OK

                brokenPairs.push({
                    a: sortedAnchors[i], // darker (lower lum)
                    b: sortedAnchors[j], // lighter (higher lum)
                    origCR,
                    newCR,
                });
            }
        }

        // Sort by severity: worst contrast gaps first
        brokenPairs.sort((x, y) => x.newCR - y.newCR);

        // Build a quick lookup: for each page hex, which other page hexes
        // had meaningful original contrast with it? (i.e. they're visual partners)
        const contrastPartners = new Map(); // hex → Set of partner hexes
        for (let i = 0; i < sortedAnchors.length; i++) {
            for (let j = i + 1; j < sortedAnchors.length; j++) {
                const origCR = contrastRatio(sortedAnchors[i].hex, sortedAnchors[j].hex);
                if (origCR < MIN_ORIG_CR) continue;
                if (!contrastPartners.has(sortedAnchors[i].hex)) contrastPartners.set(sortedAnchors[i].hex, new Set());
                if (!contrastPartners.has(sortedAnchors[j].hex)) contrastPartners.set(sortedAnchors[j].hex, new Set());
                contrastPartners.get(sortedAnchors[i].hex).add(sortedAnchors[j].hex);
                contrastPartners.get(sortedAnchors[j].hex).add(sortedAnchors[i].hex);
            }
        }

        // --- 4. Fix broken pairs (multi-partner aware) ---
        for (const pair of brokenPairs) {
            const mA = mapping.get(pair.a.hex);
            const mB = mapping.get(pair.b.hex);
            // Re-check (a prior fix may have already repaired this pair)
            if (contrastRatio(mA, mB) >= MIN_NEW_CR) continue;

            // Decide which color to adjust ("text-role"):
            //  - If one has text in its categories, adjust that one
            //  - Otherwise adjust the one with lower usage count (likely text)
            const aCats = pair.a.categories || [];
            const bCats = pair.b.categories || [];
            const aIsText = aCats.includes('text');
            const bIsText = bCats.includes('text');

            let adjustKey, anchorKey;
            if (aIsText && !bIsText) {
                adjustKey = pair.a.hex;
                anchorKey = pair.b.hex;
            } else if (bIsText && !aIsText) {
                adjustKey = pair.b.hex;
                anchorKey = pair.a.hex;
            } else {
                // Both or neither have text role → adjust the lower-count one
                const aCnt = pair.a.count || 0;
                const bCnt = pair.b.count || 0;
                if (aCnt <= bCnt) {
                    adjustKey = pair.a.hex;
                    anchorKey = pair.b.hex;
                } else {
                    adjustKey = pair.b.hex;
                    anchorKey = pair.a.hex;
                }
            }

            const currentMapped = mapping.get(adjustKey);

            // Gather ALL partners of the adjustable color (not just the current anchor)
            const partners = contrastPartners.get(adjustKey) || new Set();
            const partnerMapped = []; // mapped hexes of all partners
            for (const p of partners) {
                const m = mapping.get(p);
                if (m) partnerMapped.push(m);
            }
            // Ensure the current anchor is included
            const anchorMapped = mapping.get(anchorKey);
            if (anchorMapped && !partnerMapped.includes(anchorMapped)) {
                partnerMapped.push(anchorMapped);
            }

            // Find the best import that maximizes the WORST contrast across ALL partners
            const adjustCluster = allEnriched.find((c) => c.hex === adjustKey);
            const origLum = adjustCluster ? adjustCluster.lum : 50;

            let bestIdx = -1,
                bestScore = -Infinity;
            for (let i = 0; i < importPool.length; i++) {
                // Compute worst contrast against all partners
                let worstCR = Infinity;
                for (const pm of partnerMapped) {
                    worstCR = Math.min(worstCR, contrastRatio(importPool[i].hex, pm));
                }
                if (worstCR < MIN_NEW_CR && partnerMapped.length > 0) continue; // fails at least one partner

                // Score: worst-case contrast quality + luminance proximity bonus
                const crBonus = Math.min(worstCR, TARGET_CR * 1.5) * 10;
                const lumPenalty = Math.abs(importPool[i].lum - origLum) * 0.3;
                const score = crBonus - lumPenalty;
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }

            // Fallback: if NO import passes MIN_NEW_CR for ALL partners,
            // pick the one with best worst-case contrast anyway
            if (bestIdx < 0) {
                let maxWorstCR = 0;
                for (let i = 0; i < importPool.length; i++) {
                    let worstCR = Infinity;
                    for (const pm of partnerMapped) {
                        worstCR = Math.min(worstCR, contrastRatio(importPool[i].hex, pm));
                    }
                    if (worstCR > maxWorstCR) {
                        maxWorstCR = worstCR;
                        bestIdx = i;
                    }
                }
            }

            if (bestIdx >= 0) {
                // Only swap if it genuinely improves the worst case
                let currentWorstCR = Infinity;
                for (const pm of partnerMapped) {
                    currentWorstCR = Math.min(currentWorstCR, contrastRatio(currentMapped, pm));
                }
                const newWorstCR = (() => {
                    let w = Infinity;
                    for (const pm of partnerMapped) {
                        w = Math.min(w, contrastRatio(importPool[bestIdx].hex, pm));
                    }
                    return w;
                })();
                if (newWorstCR > currentWorstCR) {
                    mapping.set(adjustKey, importPool[bestIdx].hex);
                }
            }
        }

        // --- 5. Map ALL remaining clusters to nearest palette color ---
        // Clusters not in the anchor set get assigned to their closest
        // palette color by luminance distance.
        const anchorHexes = new Set(anchorClusters.map((c) => c.hex));
        for (const cluster of allEnriched) {
            if (anchorHexes.has(cluster.hex)) continue; // already mapped
            let bestIdx = -1,
                bestDist = Infinity;
            for (let i = 0; i < importPool.length; i++) {
                const dist = Math.abs(importPool[i].lum - cluster.lum);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestIdx = i;
                }
            }
            if (bestIdx >= 0) {
                mapping.set(cluster.hex, importPool[bestIdx].hex);
            }
        }

        // --- 6. Build final mappings (include cluster members) ---
        const mappings = [];
        allEnriched.forEach((cluster) => {
            const toHex = mapping.get(cluster.hex);
            if (!toHex) return;
            mappings.push({ from: cluster.hex, to: toHex });
            if (cluster.clusterMembers) {
                cluster.clusterMembers.forEach((member) => {
                    if (member !== cluster.hex) {
                        mappings.push({ from: normalizeHex(member), to: toHex });
                    }
                });
            }
        });

        return mappings;
    }

    // ════════════════════════════════════════════════
    //  Apply Palette – bulk apply
    // ════════════════════════════════════════════════
    async function bulkApplyMappings(mappings, importedPaletteHexes) {
        if (!mappings.length || !activeTabId) return 0;

        const rawOverrides = [];
        const variableUpdates = {};
        let count = 0;

        for (const { from, to } of mappings) {
            const source = normalizeHex(from);
            const target = normalizeHex(to);
            if (source === target) continue;

            rawOverrides.push({ original: source, current: target });
            const variable = findBestVariableForSource(source);
            if (variable) variableUpdates[variable.name] = target;

            overrideState.set(source, target);
            updateSwatchesForSource(source, target);
            count++;
        }

        if (!rawOverrides.length) return 0;

        // Use bulk override path — single DOM walk in content script
        // Include the full imported palette for text contrast enforcement
        const allPaletteHexes =
            importedPaletteHexes && importedPaletteHexes.length
                ? [
                      ...new Set([
                          ...importedPaletteHexes.map((h) => h.toLowerCase()),
                          ...rawOverrides.map((r) => r.current),
                      ]),
                  ]
                : rawOverrides.map((r) => r.current);

        const applyResult = await sendMessageToTab({
            type: 'APPLY_OVERRIDE_BULK',
            payload: {
                raw: rawOverrides,
                variables: Object.keys(variableUpdates).length ? variableUpdates : undefined,
                paletteHexes: allPaletteHexes,
            },
        });

        if (!applyResult.ok) {
            console.warn('PaletteLive: Bulk palette apply failed', applyResult.error);
            return 0;
        }

        await persistDomainData((data) => {
            if (!data.overrides) data.overrides = {};
            if (!data.overrides.raw) data.overrides.raw = {};
            if (!data.overrides.variables) data.overrides.variables = {};
            rawOverrides.forEach((r) => {
                data.overrides.raw[r.original] = r.current;
            });
            Object.entries(variableUpdates).forEach(([name, value]) => {
                data.overrides.variables[name] = value;
            });
            // Persist the full palette hex array for text contrast enforcement after refresh
            data.appliedPaletteHexes = allPaletteHexes;
        });

        return count;
    }

    // ════════════════════════════════════════════════
    //  Apply Palette – mapping mode state
    // ════════════════════════════════════════════════
    let _paletteMappingMode = 'auto'; // 'auto' | 'manual'
    let _manualOrderedHexes = []; // user-reordered list in manual mode

    const ROLE_LABELS = ['Primary', 'Secondary', 'Bg', 'Text', 'Accent'];

    // Luminance helper for label contrast
    function _chipLabelDark(hex) {
        const rgb = ColorUtils.hexToRgb(hex);
        if (!rgb) return false;
        const l = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        return l > 0.55;
    }

    // Mapping mode tab wiring
    document.querySelectorAll('.mapping-mode-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            _paletteMappingMode = tab.dataset.mode;
            document
                .querySelectorAll('.mapping-mode-tab')
                .forEach((t) => t.classList.toggle('active', t.dataset.mode === _paletteMappingMode));
            hintAuto.classList.toggle('hidden', _paletteMappingMode !== 'auto');
            hintManual.classList.toggle('hidden', _paletteMappingMode !== 'manual');
            // Re-render preview with new mode
            const hexes = parseApplyPaletteInput(applyPaletteInput.value);
            if (hexes.length) renderApplyPreview(hexes);
        });
    });

    // ════════════════════════════════════════════════
    //  Apply Palette – UI wiring
    // ════════════════════════════════════════════════
    function renderApplyPreview(hexes) {
        applyPalettePreview.innerHTML = '';
        if (_paletteMappingMode === 'manual') {
            // Sync ordered list (preserve user reorder if same length)
            if (_manualOrderedHexes.length !== hexes.length) {
                _manualOrderedHexes = [...hexes];
            }
            applyPalettePreview.classList.add('manual-mode');
            _renderManualChips();
        } else {
            applyPalettePreview.classList.remove('manual-mode');
            hexes.forEach((hex, idx) => {
                const chip = document.createElement('div');
                chip.className = 'preview-chip';
                chip.style.backgroundColor = hex;
                chip.title = `${hex} — click to change`;
                chip.style.cursor = 'pointer';

                // Hidden color picker input
                const picker = document.createElement('input');
                picker.type = 'color';
                picker.value = hex.length === 4 ? _expandShortHex(hex) : hex.substring(0, 7);
                picker.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
                chip.appendChild(picker);

                chip.addEventListener('click', () => picker.click());
                picker.addEventListener('input', (e) => {
                    const newHex = e.target.value;
                    chip.style.backgroundColor = newHex;
                    chip.title = `${newHex} — click to change`;
                    // Update the main hex array and sync textarea
                    const currentHexes = parseApplyPaletteInput(applyPaletteInput.value);
                    if (currentHexes[idx]) {
                        currentHexes[idx] = newHex;
                        applyPaletteInput.value = currentHexes.join(', ');
                    }
                });

                applyPalettePreview.appendChild(chip);
            });
        }
        applyPaletteBtn.disabled = hexes.length < 2;
    }

    /** Expand 3-char shorthand hex (#abc → #aabbcc) */
    function _expandShortHex(hex) {
        if (hex.length === 4 && hex[0] === '#') {
            return '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        return hex;
    }

    function _renderManualChips() {
        applyPalettePreview.innerHTML = '';
        let dragSrcIdx = null;

        _manualOrderedHexes.forEach((hex, idx) => {
            const chip = document.createElement('div');
            chip.className = 'preview-chip';
            chip.style.backgroundColor = hex;
            chip.title = `${hex} — click to change, drag to reorder`;
            chip.draggable = true;
            chip.dataset.idx = idx;

            // Role label
            const label = document.createElement('span');
            label.className = 'chip-role-label' + (_chipLabelDark(hex) ? ' dark-text' : '');
            label.textContent = ROLE_LABELS[idx] || String(idx + 1);
            chip.appendChild(label);

            // Hidden color picker input
            const picker = document.createElement('input');
            picker.type = 'color';
            picker.value = hex.length === 4 ? _expandShortHex(hex) : hex.substring(0, 7);
            picker.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
            chip.appendChild(picker);

            // Click to pick color (only if not dragging)
            let _wasDragging = false;
            chip.addEventListener('click', (e) => {
                if (_wasDragging) {
                    _wasDragging = false;
                    return;
                }
                if (e.target === picker) return;
                picker.click();
            });
            picker.addEventListener('input', (e) => {
                const newHex = e.target.value;
                chip.style.backgroundColor = newHex;
                chip.title = `${newHex} — click to change, drag to reorder`;
                _manualOrderedHexes[idx] = newHex;
                // Update label color for contrast
                label.className = 'chip-role-label' + (_chipLabelDark(newHex) ? ' dark-text' : '');
                // Sync textarea
                applyPaletteInput.value = _manualOrderedHexes.join(', ');
            });

            // Drag events
            chip.addEventListener('dragstart', (e) => {
                dragSrcIdx = idx;
                _wasDragging = true;
                setTimeout(() => chip.classList.add('dragging'), 0);
                e.dataTransfer.effectAllowed = 'move';
            });
            chip.addEventListener('dragend', () => {
                chip.classList.remove('dragging');
                applyPalettePreview.querySelectorAll('.preview-chip').forEach((c) => c.classList.remove('drag-over'));
                dragSrcIdx = null;
            });
            chip.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                applyPalettePreview.querySelectorAll('.preview-chip').forEach((c) => c.classList.remove('drag-over'));
                if (dragSrcIdx !== null && dragSrcIdx !== idx) chip.classList.add('drag-over');
            });
            chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
            chip.addEventListener('drop', (e) => {
                e.preventDefault();
                if (dragSrcIdx === null || dragSrcIdx === idx) return;
                // Swap
                const arr = [..._manualOrderedHexes];
                [arr[dragSrcIdx], arr[idx]] = [arr[idx], arr[dragSrcIdx]];
                _manualOrderedHexes = arr;
                _renderManualChips();
            });

            applyPalettePreview.appendChild(chip);
        });
    }

    // ════════════════════════════════════════════════
    //  Apply Palette – manual role mapping (optimal)
    // ════════════════════════════════════════════════
    /**
     * Cluster-aware role-based palette mapping.
     *
     * Order: [0]=Primary  [1]=Secondary  [2]=Background  [3]=Text  [4]=Accent
     * Extra palette colors (>5) fill remaining unmatched clusters by distance.
     *
     * Strategy:
     *  1. Cluster page colors by perceptual similarity (ΔE₀₀ ≤ 18) so that
     *     whole shade families move together (e.g. all navy shades → new Primary).
     *  2. Score each cluster for each semantic role using category weights + HSL.
     *  3. Assign clusters to roles greedily (highest score wins, no re-use).
     *     Secondary is forced to differ from Primary by ≥ 45° hue to avoid duplication.
     *  4. Map every clusterMember hex → the assigned palette color.
     *  5. Leftover palette slots auto-map remaining clusters by luminance proximity.
     */
    function manualMapPalette(orderedHexes, pageColors) {
        if (!orderedHexes.length || !pageColors.length) return [];

        // ── Step 1: cluster ──────────────────────────────────────────
        const { colors: clusters } = clusterPaletteColors(pageColors, 18);

        // ── Step 2: per-cluster HSL & combined category score ────────
        const scored = clusters.map((cluster) => {
            const hex = normalizeHex(cluster.value);
            const hsl = hexToHsl(hex);
            const total = Math.max(cluster.count || 1, 1);

            // Fraction of this cluster's count that belongs to each category
            const cats = cluster.categoryTotals || {};
            const bgFrac = (cats.background || 0) / total;
            const textFrac = (cats.text || 0) / total;
            const accentFrac = (cats.accent || 0) / total;
            const borderFrac = (cats.border || 0) / total;
            const chromaFrac = accentFrac + borderFrac;

            return { cluster, hex, hsl, total, bgFrac, textFrac, accentFrac, borderFrac, chromaFrac };
        });

        // ── Role scorers ─────────────────────────────────────────────
        // Higher = better match for that role.
        const roleScores = {
            // Primary: most visually dominant chromatic color (buttons, links, brand)
            primary: (s) => s.chromaFrac * s.hsl.s * s.total,
            // Secondary: similar to primary scoring but different hue (handled below)
            secondary: (s) => s.chromaFrac * s.hsl.s * s.total,
            // Background: dominant background region — prefers high luminance or low saturation
            background: (s) => s.bgFrac * s.total * (s.hsl.l > 0.4 || s.hsl.s < 0.2 ? 1.6 : 0.7),
            // Text: high text fraction, typically very dark or very light
            text: (s) => s.textFrac * s.total * (s.hsl.l < 0.3 || s.hsl.l > 0.85 ? 1.8 : 0.8),
            // Accent: remaining chromatic + border elements
            accent: (s) => (s.accentFrac + s.borderFrac * 0.5) * s.hsl.s * s.total,
        };

        const ROLE_KEYS = ['primary', 'secondary', 'background', 'text', 'accent'];
        const assignedClusters = new Map(); // clusterIndex → paletteHex
        const usedClusterIdxs = new Set();

        // ── Step 3: greedy role assignment ───────────────────────────
        ROLE_KEYS.forEach((role, roleIdx) => {
            const paletteHex = orderedHexes[roleIdx];
            if (!paletteHex) return;

            const scoreFn = roleScores[role];
            let primaryHex = null; // for secondary hue-distance constraint

            if (role === 'secondary') {
                // Find which cluster was assigned Primary so we can enforce hue distance
                const primaryPaletteHex = orderedHexes[0];
                for (const [idx, hex] of assignedClusters) {
                    if (hex === primaryPaletteHex) {
                        primaryHex = scored[idx].hex;
                        break;
                    }
                }
            }

            let bestIdx = -1,
                bestScore = -Infinity;
            scored.forEach((s, idx) => {
                if (usedClusterIdxs.has(idx)) return;
                let score = scoreFn(s);

                // Secondary must differ from Primary by ≥ 45° in hue
                if (role === 'secondary' && primaryHex) {
                    const hueDiff = absHueDist(s.hsl.h, hexToHsl(primaryHex).h);
                    if (hueDiff < 45) score *= 0.05; // heavy penalty
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = idx;
                }
            });

            if (bestIdx >= 0) {
                assignedClusters.set(bestIdx, paletteHex.toLowerCase());
                usedClusterIdxs.add(bestIdx);
            }
        });

        // ── Step 4: extra palette colors → remaining clusters (luminance proximity) ──
        if (orderedHexes.length > 5) {
            const remainingIdxs = scored
                .map((_, i) => i)
                .filter((i) => !usedClusterIdxs.has(i))
                .sort((a, b) => (scored[b].total || 0) - (scored[a].total || 0));

            orderedHexes.slice(5).forEach((extraHex, offset) => {
                const idx = remainingIdxs[offset];
                if (idx != null) {
                    assignedClusters.set(idx, extraHex.toLowerCase());
                    usedClusterIdxs.add(idx);
                }
            });
        }

        // ── Step 5: build final from→to mappings (whole clusters move together) ──
        const mappings = [];
        const mapped = new Set();

        assignedClusters.forEach((paletteHex, clusterIdx) => {
            const cluster = scored[clusterIdx].cluster;
            const members = Array.isArray(cluster.clusterMembers)
                ? cluster.clusterMembers
                : [normalizeHex(cluster.value)];
            members.forEach((memberHex) => {
                const from = memberHex.toLowerCase();
                if (mapped.has(from) || from === paletteHex) return;
                mapped.add(from);
                mappings.push({ from, to: paletteHex });
            });
        });

        return mappings;
    }

    function setApplyStatus(text, isError) {
        if (!text) {
            applyPaletteStatus.classList.add('hidden');
            applyPaletteStatus.textContent = '';
            return;
        }
        applyPaletteStatus.classList.remove('hidden');
        applyPaletteStatus.classList.toggle('error', !!isError);
        applyPaletteStatus.textContent = text;
    }

    applyPaletteInput.addEventListener('input', () => {
        const hexes = parseApplyPaletteInput(applyPaletteInput.value);
        renderApplyPreview(hexes);
        setApplyStatus('');
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const name = btn.dataset.preset;
            const preset = PALETTE_PRESETS[name];
            if (!preset) return;
            applyPaletteInput.value = preset.join(', ');
            _manualOrderedHexes = [...preset]; // reset order on new preset
            renderApplyPreview(preset);
            setApplyStatus('');
            // Highlight active preset
            document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Apply button
    applyPaletteBtn.addEventListener('click', async () => {
        const hexes =
            _paletteMappingMode === 'manual' ? _manualOrderedHexes : parseApplyPaletteInput(applyPaletteInput.value);
        if (hexes.length < 2) {
            setApplyStatus('Need at least 2 colors.', true);
            return;
        }
        if (!currentColors.length) {
            setApplyStatus('No page colors loaded. Click Rescan first.', true);
            return;
        }
        applyPaletteBtn.disabled = true;
        applyPaletteBtn.textContent = 'Applying...';
        setApplyStatus('');

        try {
            const mappings =
                _paletteMappingMode === 'manual'
                    ? manualMapPalette(hexes, currentColors)
                    : autoMapPalette(hexes, currentColors);
            if (!mappings.length) {
                setApplyStatus('Could not map any colors.', true);
                return;
            }
            const applied = await bulkApplyMappings(mappings, hexes);
            const modeLabel = _paletteMappingMode === 'manual' ? 'role-based' : 'auto';
            setApplyStatus(`Applied ${hexes.length}-color palette (${modeLabel}) → ${applied} page colors remapped.`);
            renderPalette(currentColors);
        } catch (err) {
            console.warn('PaletteLive: Apply palette error', err);
            setApplyStatus('Error: ' + (err.message || 'failed'), true);
        } finally {
            applyPaletteBtn.disabled = false;
            applyPaletteBtn.textContent = 'Apply to Page';
        }
    });

    // Reset button — undo all overrides from applied palette
    applyPaletteReset.addEventListener('click', () => {
        // Delegate to the main reset handler
        resetBtn.click();
        setApplyStatus('');
    });

    /** Enrich a color array with HSL data, sorted by count desc */
    function enrichWithHsl(colors) {
        return colors
            .map((c) => {
                const hex = normalizeHex(c.value);
                return { ...c, hex, hsl: hexToHsl(hex) };
            })
            .sort((a, b) => (b.count || 0) - (a.count || 0));
    }

    /** Filter out near-neutral colors (saturation < 0.08) */
    function isChromatic(hsl) {
        return hsl.s >= 0.08;
    }

    // ──────────────────────────────────────────────
    //  60-30-10 Analyzer
    // ──────────────────────────────────────────────
    function analyze603010(colors) {
        const merged = aggressiveMerge(colors);
        const totalCount = merged.reduce((s, c) => s + (c.count || 0), 0) || 1;

        // Sort by usage proportion
        const sorted = merged
            .map((c) => ({ ...c, pct: ((c.count || 0) / totalCount) * 100 }))
            .sort((a, b) => b.pct - a.pct);

        // Assign: top by count → primary, next → secondary, rest → accent
        const primary = [];
        const secondary = [];
        const accent = [];
        let cumPct = 0;

        sorted.forEach((c) => {
            if (cumPct < 55 && primary.length < 3) {
                primary.push(c);
            } else if (cumPct < 85 && secondary.length < 5) {
                secondary.push(c);
            } else {
                accent.push(c);
            }
            cumPct += c.pct;
        });

        return [
            {
                key: 'primary',
                label: 'Primary (60%)',
                icon: 'P',
                colors: primary,
                desc: 'Dominant — backgrounds & large surfaces',
            },
            {
                key: 'secondary',
                label: 'Secondary (30%)',
                icon: 'S',
                colors: secondary,
                desc: 'Supporting — headers, sidebars, cards',
            },
            {
                key: 'accent',
                label: 'Accent (10%)',
                icon: 'A',
                colors: accent,
                desc: 'CTAs, links, alerts',
            },
        ];
    }

    // ──────────────────────────────────────────────
    //  Monochromatic Analyzer
    // ──────────────────────────────────────────────
    function analyzeMonochromatic(colors) {
        const merged = aggressiveMerge(colors);
        const enriched = enrichWithHsl(merged);

        // Find dominant hue from the most-used chromatic color
        const chromatic = enriched.filter((c) => isChromatic(c.hsl));
        if (!chromatic.length) {
            return [
                {
                    key: 'neutrals',
                    label: 'Neutrals',
                    icon: 'N',
                    colors: merged,
                    desc: 'No dominant hue detected — all neutrals',
                },
            ];
        }

        const dominantHue = chromatic[0].hsl.h;
        const HUE_RANGE = 30;

        const mono = [];
        const others = [];
        enriched.forEach((c) => {
            if (absHueDist(c.hsl.h, dominantHue) <= HUE_RANGE || !isChromatic(c.hsl)) {
                mono.push(c);
            } else {
                others.push(c);
            }
        });

        // Sort mono by lightness
        mono.sort((a, b) => b.hsl.l - a.hsl.l);

        const groups = [
            {
                key: 'mono',
                label: `Monochromatic (${Math.round(dominantHue)}°)`,
                icon: 'M',
                colors: mono,
                desc: 'Single-hue shades, tints & tones',
            },
        ];
        if (others.length) {
            groups.push({
                key: 'off-hue',
                label: 'Off-hue Colors',
                icon: 'O',
                colors: others,
                desc: 'Colors outside the dominant hue family',
            });
        }
        return groups;
    }

    // ──────────────────────────────────────────────
    //  Analogous Analyzer
    // ──────────────────────────────────────────────
    function analyzeAnalogous(colors) {
        const merged = aggressiveMerge(colors);
        const enriched = enrichWithHsl(merged);
        const chromatic = enriched.filter((c) => isChromatic(c.hsl));
        const neutrals = enriched.filter((c) => !isChromatic(c.hsl));

        if (chromatic.length < 2) {
            return [
                {
                    key: 'all',
                    label: 'All Colors',
                    icon: 'A',
                    colors: merged,
                    desc: 'Not enough chromatic colors for analogous grouping',
                },
            ];
        }

        const anchor = chromatic[0].hsl.h;
        const ANG = 40; // analogous range each side

        const analogous = [];
        const outside = [];
        chromatic.forEach((c) => {
            if (absHueDist(c.hsl.h, anchor) <= ANG) analogous.push(c);
            else outside.push(c);
        });

        analogous.sort((a, b) => a.hsl.h - b.hsl.h);

        const groups = [
            {
                key: 'analogous',
                label: `Analogous (${Math.round(anchor - ANG)}°–${Math.round(anchor + ANG)}°)`,
                icon: 'AN',
                colors: analogous,
                desc: 'Adjacent hues — natural & calming',
            },
        ];
        if (outside.length) {
            groups.push({
                key: 'contrast',
                label: 'Contrasting Colors',
                icon: 'C',
                colors: outside,
                desc: 'Hues outside the analogous range',
            });
        }
        if (neutrals.length) {
            groups.push({
                key: 'neutrals',
                label: 'Neutrals',
                icon: 'N',
                colors: neutrals,
                desc: 'Achromatic / low-saturation',
            });
        }
        return groups;
    }

    // ──────────────────────────────────────────────
    //  Complementary Analyzer
    // ──────────────────────────────────────────────
    function analyzeComplementary(colors) {
        const merged = aggressiveMerge(colors);
        const enriched = enrichWithHsl(merged);
        const chromatic = enriched.filter((c) => isChromatic(c.hsl));
        const neutrals = enriched.filter((c) => !isChromatic(c.hsl));

        if (chromatic.length < 2) {
            return [
                {
                    key: 'all',
                    label: 'All Colors',
                    icon: 'A',
                    colors: merged,
                    desc: 'Not enough chromatic colors for complementary analysis',
                },
            ];
        }

        const primaryHue = chromatic[0].hsl.h;
        const compHue = (primaryHue + 180) % 360;
        const TOLERANCE = 35;

        const primaryGroup = [];
        const compGroup = [];
        const others = [];

        chromatic.forEach((c) => {
            if (absHueDist(c.hsl.h, primaryHue) <= TOLERANCE) primaryGroup.push(c);
            else if (absHueDist(c.hsl.h, compHue) <= TOLERANCE) compGroup.push(c);
            else others.push(c);
        });

        const groups = [
            {
                key: 'primary',
                label: `Primary Hue (${Math.round(primaryHue)}°)`,
                icon: 'P',
                colors: primaryGroup,
                desc: 'Dominant hue family',
            },
        ];
        if (compGroup.length) {
            groups.push({
                key: 'complement',
                label: `Complement (${Math.round(compHue)}°)`,
                icon: 'C',
                colors: compGroup,
                desc: 'Opposite hue — high contrast & energy',
            });
        }
        if (others.length) {
            groups.push({
                key: 'others',
                label: 'Other Hues',
                icon: 'O',
                colors: others,
                desc: 'Neither primary nor complement',
            });
        }
        if (neutrals.length) {
            groups.push({
                key: 'neutrals',
                label: 'Neutrals',
                icon: 'N',
                colors: neutrals,
                desc: 'Achromatic / low-saturation',
            });
        }
        return groups;
    }

    // ──────────────────────────────────────────────
    //  Split-Complementary Analyzer
    // ──────────────────────────────────────────────
    function analyzeSplitComplementary(colors) {
        const merged = aggressiveMerge(colors);
        const enriched = enrichWithHsl(merged);
        const chromatic = enriched.filter((c) => isChromatic(c.hsl));
        const neutrals = enriched.filter((c) => !isChromatic(c.hsl));

        if (chromatic.length < 2) {
            return [
                {
                    key: 'all',
                    label: 'All Colors',
                    icon: 'A',
                    colors: merged,
                    desc: 'Not enough chromatic colors',
                },
            ];
        }

        const primaryHue = chromatic[0].hsl.h;
        const splitA = (primaryHue + 150) % 360;
        const splitB = (primaryHue + 210) % 360;
        const TOL = 30;

        const pGroup = [],
            saGroup = [],
            sbGroup = [],
            others = [];
        chromatic.forEach((c) => {
            if (absHueDist(c.hsl.h, primaryHue) <= TOL) pGroup.push(c);
            else if (absHueDist(c.hsl.h, splitA) <= TOL) saGroup.push(c);
            else if (absHueDist(c.hsl.h, splitB) <= TOL) sbGroup.push(c);
            else others.push(c);
        });

        const groups = [
            {
                key: 'primary',
                label: `Primary (${Math.round(primaryHue)}°)`,
                icon: 'P',
                colors: pGroup,
                desc: 'Dominant hue',
            },
        ];
        if (saGroup.length) {
            groups.push({
                key: 'split-a',
                label: `Split A (${Math.round(splitA)}°)`,
                icon: 'SA',
                colors: saGroup,
                desc: 'First split-complement',
            });
        }
        if (sbGroup.length) {
            groups.push({
                key: 'split-b',
                label: `Split B (${Math.round(splitB)}°)`,
                icon: 'SB',
                colors: sbGroup,
                desc: 'Second split-complement',
            });
        }
        if (others.length) {
            groups.push({
                key: 'others',
                label: 'Other Hues',
                icon: 'O',
                colors: others,
                desc: 'Outside split-complement zones',
            });
        }
        if (neutrals.length) {
            groups.push({
                key: 'neutrals',
                label: 'Neutrals',
                icon: 'N',
                colors: neutrals,
                desc: 'Achromatic / low-saturation',
            });
        }
        return groups;
    }

    // ──────────────────────────────────────────────
    //  Triadic Analyzer
    // ──────────────────────────────────────────────
    function analyzeTriadic(colors) {
        const merged = aggressiveMerge(colors);
        const enriched = enrichWithHsl(merged);
        const chromatic = enriched.filter((c) => isChromatic(c.hsl));
        const neutrals = enriched.filter((c) => !isChromatic(c.hsl));

        if (chromatic.length < 2) {
            return [
                {
                    key: 'all',
                    label: 'All Colors',
                    icon: 'A',
                    colors: merged,
                    desc: 'Not enough chromatic colors for triadic analysis',
                },
            ];
        }

        const h1 = chromatic[0].hsl.h;
        const h2 = (h1 + 120) % 360;
        const h3 = (h1 + 240) % 360;
        const TOL = 35;

        const g1 = [],
            g2 = [],
            g3 = [],
            others = [];
        chromatic.forEach((c) => {
            if (absHueDist(c.hsl.h, h1) <= TOL) g1.push(c);
            else if (absHueDist(c.hsl.h, h2) <= TOL) g2.push(c);
            else if (absHueDist(c.hsl.h, h3) <= TOL) g3.push(c);
            else others.push(c);
        });

        const groups = [
            {
                key: 'triad-1',
                label: `Triad A (${Math.round(h1)}°)`,
                icon: 'A',
                colors: g1,
                desc: 'Dominant triad arm',
            },
        ];
        if (g2.length) {
            groups.push({
                key: 'triad-2',
                label: `Triad B (${Math.round(h2)}°)`,
                icon: 'B',
                colors: g2,
                desc: 'Second triad arm (+120°)',
            });
        }
        if (g3.length) {
            groups.push({
                key: 'triad-3',
                label: `Triad C (${Math.round(h3)}°)`,
                icon: 'C',
                colors: g3,
                desc: 'Third triad arm (+240°)',
            });
        }
        if (others.length) {
            groups.push({
                key: 'others',
                label: 'Other Hues',
                icon: 'O',
                colors: others,
                desc: 'Outside triadic zones',
            });
        }
        if (neutrals.length) {
            groups.push({
                key: 'neutrals',
                label: 'Neutrals',
                icon: 'N',
                colors: neutrals,
                desc: 'Achromatic / low-saturation',
            });
        }
        return groups;
    }

    // ════════════════════════════════════════════════
    //  Swatch builder (shared by all modes)
    // ════════════════════════════════════════════════
    function buildSwatch(color) {
        const sourceHex = normalizeHex(color.value);
        const effectiveHex = getEffectiveValueForSource(sourceHex);
        const uses = color.count || 0;
        const clusterSuffix = color.clusterSize > 1 ? `, ${color.clusterSize} shades merged` : '';
        const tailwindSuffix = color.tailwindLabel ? `, Tailwind: ${color.tailwindLabel}` : '';
        const pctSuffix = color.pct != null ? `, ~${Math.round(color.pct)}%` : '';

        const swatch = document.createElement('div');
        swatch.className = 'swatch';
        swatch.setAttribute('role', 'button');
        swatch.setAttribute('tabindex', '0');
        swatch.dataset.source = sourceHex;
        swatch.dataset.uses = String(uses);
        swatch.dataset.category = color.primaryCategory || 'accent';
        swatch.dataset.clusterSize = String(color.clusterSize || 1);
        swatch.dataset.members = (color.clusterMembers || [sourceHex]).join(',');
        swatch.dataset.tailwindClass = color.tailwindClass || '';
        swatch.dataset.tailwindLabel = color.tailwindLabel || '';
        if (color.tailwindClass) swatch.classList.add('swatch-tailwind');
        swatch.style.backgroundColor = effectiveHex;

        const visitedNote =
            color.primaryCategory === 'text'
                ? '. Note: :visited link colors cannot be overridden due to browser privacy restrictions'
                : '';
        swatch.title = `${effectiveHex} (${uses} uses${pctSuffix}${clusterSuffix}${tailwindSuffix}${visitedNote})`;
        swatch.setAttribute(
            'aria-label',
            `${effectiveHex} ${color.primaryCategory || 'accent'} color used ${uses} times${pctSuffix}${clusterSuffix}${tailwindSuffix}`
        );

        setSwatchExportState(swatch, sourceHex);

        const clickHandler = () => {
            if (activeSwatch === swatch) closeEditor();
            else openEditor(color, swatch);
        };
        swatch.addEventListener('click', clickHandler);
        swatch.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                clickHandler();
            }
        });
        return swatch;
    }

    // ════════════════════════════════════════════════
    //  Grouped section builder (shared by all modes)
    // ════════════════════════════════════════════════
    function buildGroupSection(groupDef) {
        const section = document.createElement('div');
        section.className = 'palette-group';

        const header = document.createElement('div');
        header.className = 'group-header';
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.setAttribute('aria-expanded', 'true');

        // Build header content using DOM API to avoid innerHTML XSS risk
        const iconSpan = document.createElement('span');
        iconSpan.className = 'group-icon';
        iconSpan.textContent = groupDef.icon;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-name';
        nameSpan.textContent = groupDef.label;

        const countSpan = document.createElement('span');
        countSpan.className = 'group-count';
        countSpan.textContent = groupDef.colors.length;

        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'group-toggle';
        toggleSpan.textContent = 'v';

        header.appendChild(iconSpan);
        header.appendChild(nameSpan);
        header.appendChild(countSpan);
        header.appendChild(toggleSpan);

        if (groupDef.desc) {
            const descSpan = document.createElement('span');
            descSpan.className = 'group-desc';
            descSpan.textContent = groupDef.desc;
            header.appendChild(descSpan);
        }
        section.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'palette-grid';
        groupDef.colors.forEach((c) => grid.appendChild(buildSwatch(c)));
        section.appendChild(grid);

        const toggleSection = () => {
            section.classList.toggle('collapsed');
            header.setAttribute('aria-expanded', section.classList.contains('collapsed') ? 'false' : 'true');
            header.querySelector('.group-toggle').textContent = section.classList.contains('collapsed') ? '>' : 'v';
        };
        header.addEventListener('click', toggleSection);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSection();
            }
        });

        return section;
    }

    // ════════════════════════════════════════════════
    //  Palette mode toggle & render dispatcher
    // ════════════════════════════════════════════════
    function updatePaletteModeUI() {
        const mode = paletteModeSelect.value;
        const isAdvanced = mode === 'advanced';
        const isGenerator = [
            'monochromatic',
            '60-30-10',
            'analogous',
            'complementary',
            'split-complementary',
            'triadic',
        ].includes(mode);
        const isApplyPalette = mode === 'apply-palette' || isGenerator;

        advancedControls.classList.toggle('hidden', !isAdvanced);
        applyPaletteControls.classList.toggle('hidden', !isApplyPalette);

        if (generatorSection) {
            generatorSection.classList.toggle('hidden', !isGenerator);
            if (isGenerator) {
                Object.keys(genPanels).forEach((key) => {
                    if (genPanels[key]) genPanels[key].classList.toggle('hidden', key !== mode);
                });
                runGenerator();
            }
        }

        // Hide per-mode summary when switching; each renderer will set it
        paletteSummary.classList.add('hidden');
        paletteSummary.textContent = '';
    }

    // ════════════════════════════════════════════════
    //  Palette Generators
    // ════════════════════════════════════════════════

    function hslToHex(h, s, l) {
        return ColorScience.hslToHex(h, s, l);
    }

    function generateColors() {
        const mode = paletteModeSelect.value;
        let colors = [];

        if (mode === 'monochromatic') {
            const baseHex = String(genMonoColor.value || '#3b82f6').trim();
            const count = parseInt(genMonoCount.value || '5', 10);
            const { h, s, l } = hexToHsl(baseHex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            const s100 = s * 100;
            const l100 = l * 100;

            colors.push(baseHex);

            // Generate variations
            const steps = count - 1;
            if (steps > 0) {
                const availableRange = l100 < 50 ? 95 - l100 : l100 - 5;
                const step = Math.floor(availableRange / count);
                for (let i = 1; i <= steps; i++) {
                    const lStep = l100 < 50 ? Math.min(l100 + i * step, 95) : Math.max(l100 - i * step, 5);
                    colors.push(hslToHex(h, s100, lStep));
                }
            }
        } else if (mode === '60-30-10') {
            colors = [
                String(gen60Color.value || '#f8fafc').trim(),
                String(gen30Color.value || '#3b82f6').trim(),
                String(gen10Color.value || '#ef4444').trim(),
            ];
        } else if (mode === 'analogous') {
            const baseHex = String(genAnalogColor.value || '#3b82f6').trim();
            const spread = parseInt(genAnalogSpread.value || '30', 10);
            const { h, s, l } = hexToHsl(baseHex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            const s100 = s * 100;
            const l100 = l * 100;

            colors = [
                hslToHex((h - spread + 360) % 360, s100, l100),
                baseHex,
                hslToHex((h + spread) % 360, s100, l100),
            ];
        } else if (mode === 'complementary') {
            const baseHex = String(genCompBase.value || '#3b82f6').trim();
            const { h, s, l } = hexToHsl(baseHex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            colors = [baseHex, hslToHex((h + 180) % 360, s * 100, l * 100)];
        } else if (mode === 'split-complementary') {
            const baseHex = String(genSplitColor.value || '#3b82f6').trim();
            const gap = parseInt(genSplitGap.value || '150', 10);
            const { h, s, l } = hexToHsl(baseHex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            const s100 = s * 100;
            const l100 = l * 100;

            colors = [baseHex, hslToHex((h + gap) % 360, s100, l100), hslToHex((h + (360 - gap)) % 360, s100, l100)];
        } else if (mode === 'triadic') {
            const baseHex = String(genTriadicColor.value || '#3b82f6').trim();
            const { h, s, l } = hexToHsl(baseHex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            colors = [
                baseHex,
                hslToHex((h + 120) % 360, s * 100, l * 100),
                hslToHex((h + 240) % 360, s * 100, l * 100),
            ];
        }

        return colors;
    }

    function runGenerator() {
        const mode = paletteModeSelect.value;
        const isGenerator = [
            'monochromatic',
            '60-30-10',
            'analogous',
            'complementary',
            'split-complementary',
            'triadic',
        ].includes(mode);
        if (!isGenerator) return;

        const colors = generateColors();
        if (colors && colors.length > 0) {
            applyPaletteInput.value = colors.join(', ');
            // Force apply preview update
            const e = new Event('input');
            applyPaletteInput.dispatchEvent(e);
        }
    }

    // Attach listeners to interactable generator inputs
    [
        genMonoColor,
        genMonoCount,
        gen60Color,
        gen30Color,
        gen10Color,
        genAnalogColor,
        genAnalogSpread,
        genCompBase,
        genSplitColor,
        genSplitGap,
        genTriadicColor,
    ].forEach((el) => {
        if (el) el.addEventListener('input', runGenerator);
        if (el) el.addEventListener('change', runGenerator);
    });

    if (genMonoCount)
        genMonoCount.addEventListener('input', (e) => {
            if (genMonoCountVal) genMonoCountVal.textContent = e.target.value;
        });
    if (genAnalogSpread)
        genAnalogSpread.addEventListener('input', (e) => {
            if (genAnalogSpreadVal) genAnalogSpreadVal.textContent = e.target.value + '°';
        });
    if (genSplitGap)
        genSplitGap.addEventListener('input', (e) => {
            if (genSplitGapVal) genSplitGapVal.textContent = e.target.value + '°';
        });

    // Complementary sync logic
    if (genCompBase && genCompOpp) {
        genCompBase.addEventListener('input', (e) => {
            const hex = e.target.value;
            const { h, s, l } = hexToHsl(hex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            genCompOpp.value = hslToHex((h + 180) % 360, s * 100, l * 100);
            runGenerator();
        });
        genCompOpp.addEventListener('input', (e) => {
            const hex = e.target.value;
            const { h, s, l } = hexToHsl(hex);
            // hexToHsl returns s and l in 0–1; hslToHex expects 0–100
            genCompBase.value = hslToHex((h + 180) % 360, s * 100, l * 100);
            runGenerator();
        });
    }

    function setPaletteSummary(text) {
        if (!text) {
            paletteSummary.classList.add('hidden');
            paletteSummary.textContent = '';
            return;
        }
        paletteSummary.classList.remove('hidden');
        paletteSummary.textContent = text;
    }

    function renderPalette(colors) {
        paletteList.innerHTML = '';
        _highlightedSwatchHex = null;
        highlightedSwatchEl = null;
        clearHighlight();

        if (!colors || colors.length === 0) {
            renderClusterSummary(0, 0, 0);
            setPaletteSummary('');
            setLoadingState(paletteList, 'No colors found.');
            return;
        }

        const mode = paletteModeSelect.value;

        if (mode === 'advanced') {
            renderAdvancedPalette(colors);
            return;
        }

        // For all simplified modes, hide advanced cluster summary
        renderClusterSummary(0, 0, 0);

        let groups;
        switch (mode) {
            case '60-30-10':
                groups = analyze603010(colors);
                break;
            case 'monochromatic':
                groups = analyzeMonochromatic(colors);
                break;
            case 'analogous':
                groups = analyzeAnalogous(colors);
                break;
            case 'complementary':
                groups = analyzeComplementary(colors);
                break;
            case 'split-complementary':
                groups = analyzeSplitComplementary(colors);
                break;
            case 'triadic':
                groups = analyzeTriadic(colors);
                break;
            case 'apply-palette':
                groups = analyze603010(colors);
                break;
            default:
                groups = analyze603010(colors);
                break;
        }

        const modeLabel = mode === 'apply-palette' ? '60-30-10' : mode;
        const totalShown = groups.reduce((s, g) => s + g.colors.length, 0);
        setPaletteSummary(`${totalShown} colors · ${modeLabel} analysis from ${colors.length} extracted`);

        let hasAny = false;
        groups.forEach((g) => {
            if (!g.colors.length) return;
            hasAny = true;
            paletteList.appendChild(buildGroupSection(g));
        });

        if (!hasAny) {
            setLoadingState(paletteList, 'No colors found.');
        }
    }

    /** Advanced mode — original full palette with merge controls */
    function renderAdvancedPalette(colors) {
        setPaletteSummary('');
        const renderColors = getRenderColors(colors);

        const groupDefs = [
            { key: 'background', label: 'Backgrounds', icon: 'BG' },
            { key: 'text', label: 'Text', icon: 'T' },
            { key: 'border', label: 'Borders', icon: 'B' },
            { key: 'accent', label: 'Accents & Other', icon: 'A' },
        ];

        const groups = {};
        groupDefs.forEach((g) => {
            groups[g.key] = [];
        });
        renderColors.forEach((color) => {
            const cat = color.primaryCategory || 'accent';
            (groups[cat] || groups.accent).push(color);
        });

        let hasAny = false;
        groupDefs.forEach(({ key, label, icon }) => {
            const groupColors = groups[key];
            if (!groupColors || !groupColors.length) return;
            hasAny = true;
            paletteList.appendChild(buildGroupSection({ key, label, icon, colors: groupColors, desc: '' }));
        });

        if (!hasAny) {
            renderClusterSummary(0, 0, colors.length);
            setLoadingState(paletteList, 'No colors found.');
        }
    }

    // --- Variable info helper (builds lines for side panel) ---
    function buildVariableInfoLines(sourceInput) {
        const sources = Array.isArray(sourceInput) ? sourceInput : sourceInput ? [sourceInput] : [];
        const primarySource = sources[0] || null;
        const variable = primarySource ? findBestVariableForSource(primarySource) : null;
        const infoLines = [];

        if (variable) {
            const usage = variable.usageCount || 0;
            infoLines.push(`Variable: ${variable.name} (usage: ${usage})`);
        }

        if (selectedColor && selectedColor.tailwindClass) {
            const label = selectedColor.tailwindLabel || selectedColor.tailwindClass;
            infoLines.push(`Tailwind: ${label} (${selectedColor.tailwindClass})`);
        }

        if (sources.length > 1) {
            infoLines.push(`Merged shades: ${sources.length} source colors`);
        }

        return infoLines;
    }

    // --- Open editor via Chrome Side Panel ---
    function openEditor(color, swatchEl) {
        selectedColor = color;
        activeSwatch = swatchEl || null;

        const sourceCandidates =
            swatchEl && swatchEl.dataset.members
                ? swatchEl.dataset.members.split(',')
                : [swatchEl && swatchEl.dataset.source ? swatchEl.dataset.source : normalizeHex(color.value)];

        selectedSources = Array.from(new Set(sourceCandidates.map((source) => normalizeHex(source)).filter(Boolean)));
        selectedSource = selectedSources[0] || null;

        const currentHex = selectedSource ? getEffectiveValueForSource(selectedSource) : '#000000';
        const pickerHex = sanitizePickerHex(currentHex);

        _editStartValue = normalizeHex(pickerHex);
        editStartValues.clear();
        selectedSources.forEach((source) => {
            editStartValues.set(source, getEffectiveValueForSource(source));
        });

        if (selectedSource) {
            if (highlightedSwatchEl) {
                highlightedSwatchEl.classList.remove('pl-swatch-active');
            }
            requestHighlight(selectedSource);
            if (swatchEl) {
                swatchEl.classList.add('pl-swatch-active');
                highlightedSwatchEl = swatchEl;
                _highlightedSwatchHex = selectedSource;
            }
        }

        // Build effective values map for side panel
        const effectiveValues = {};
        selectedSources.forEach((source) => {
            effectiveValues[source] = getEffectiveValueForSource(source);
        });

        const exportChecked =
            selectedSources.length > 0 && selectedSources.every((source) => exportSelection.has(source));

        // Build payload for side panel
        const sidePanelPayload = {
            color: {
                value: color.value,
                clusterSize: color.clusterSize,
                primaryCategory: color.primaryCategory,
                tailwindClass: color.tailwindClass,
                tailwindLabel: color.tailwindLabel,
            },
            sources: selectedSources,
            currentHex: pickerHex,
            effectiveValues,
            exportChecked,
            variableLines: buildVariableInfoLines(selectedSources),
            tabId: activeTabId,
        };

        // Send the payload to the background script to open the compact editor window
        console.log('PaletteLive: Opening compact editor window', sidePanelPayload);
        chrome.runtime.sendMessage(
            {
                type: 'OPEN_EDITOR_WINDOW',
                payload: sidePanelPayload,
            },
            () => {
                if (chrome.runtime.lastError) {
                    console.warn('PaletteLive: Could not open editor window', chrome.runtime.lastError);
                }
            }
        );
    }

    // Removed openEditorWindow as we now use the compact popup window managed by background.js

    function closeEditor() {
        selectedColor = null;
        selectedSource = null;
        selectedSources = [];
        activeSwatch = null;
        _editStartValue = null;
        editStartValues.clear();

        if (highlightedSwatchEl) {
            highlightedSwatchEl.classList.remove('pl-swatch-active');
        }
        _highlightedSwatchHex = null;
        highlightedSwatchEl = null;
        clearHighlight();
    }

    async function _applyOverrideForSource(newValue, sourceHex) {
        const source = normalizeHex(sourceHex);
        const current = normalizeHex(newValue);
        const variable = findBestVariableForSource(source);

        if (current === source) {
            const result = await sendMessageToTab({
                type: 'REMOVE_RAW_OVERRIDE',
                payload: {
                    original: source,
                    removeVariables: variable ? [variable.name] : [],
                },
            });

            if (!result.ok) {
                console.warn('PaletteLive: Could not remove override', result.error);
                return { ok: false, error: result.error || 'Failed to remove override' };
            }

            overrideState.delete(source);
            updateSwatchesForSource(source, source);

            return { ok: true, source, current: source, variableName: variable ? variable.name : null, removed: true };
        }

        const payload = {
            raw: {
                original: source,
                current,
            },
        };

        if (variable) {
            payload.variables = { [variable.name]: current };
        }

        const applyResult = await sendMessageToTab({
            type: 'APPLY_OVERRIDE',
            payload,
        });

        if (!applyResult.ok) {
            console.warn('PaletteLive: Could not apply override', applyResult.error);
            return { ok: false, error: applyResult.error || 'Failed to apply override' };
        }

        // Check if any elements were actually updated
        const appliedCount = applyResult.response && applyResult.response.appliedCount;
        if (appliedCount === 0) {
            console.warn(
                `PaletteLive: No elements found for color ${source}. The color may have changed on the page or the element may not exist.`
            );
            // Still update the state since the user wants this override
        }

        overrideState.set(source, current);
        updateSwatchesForSource(source, current);

        return {
            ok: true,
            source,
            current,
            variableName: variable ? variable.name : null,
            removed: false,
            appliedCount,
        };
    }

    async function applyOverrideNow(newValue, sourceInput) {
        if (isResetting || !sourceInput || !activeTabId) return;

        const sources = Array.isArray(sourceInput)
            ? sourceInput.map((source) => normalizeHex(source)).filter(Boolean)
            : [normalizeHex(sourceInput)];
        if (!sources.length) return;

        const current = normalizeHex(newValue);

        // Build batched payload for all sources
        const rawOverrides = [];
        const variableUpdates = {};
        const updates = [];

        for (const source of sources) {
            if (current === source) {
                // Reverting to original — clean up override state
                if (overrideState.has(source)) {
                    overrideState.delete(source);
                    updateSwatchesForSource(source, source);
                    // Tell content script to remove this override
                    rawOverrides.push({ original: source, current: source });
                    updates.push({ source, current: source, variableName: null, revert: true });
                }
                continue;
            }

            const variable = findBestVariableForSource(source);

            rawOverrides.push({ original: source, current });
            if (variable) {
                variableUpdates[variable.name] = current;
            }

            updates.push({ source, current, variableName: variable ? variable.name : null });
            overrideState.set(source, current);
            updateSwatchesForSource(source, current);
        }

        if (!updates.length) return;

        // Send batched override to content script
        const applyResult = await sendMessageToTab({
            type: 'APPLY_OVERRIDE',
            payload: {
                raw: rawOverrides.length === 1 ? rawOverrides[0] : rawOverrides,
                variables: Object.keys(variableUpdates).length ? variableUpdates : undefined,
            },
        });

        if (!applyResult.ok) {
            console.warn('PaletteLive: Could not apply override', applyResult.error);
            return;
        }

        await persistDomainData((data) => {
            if (!data.overrides) data.overrides = {};
            if (!data.overrides.raw) data.overrides.raw = {};
            if (!data.overrides.variables) data.overrides.variables = {};

            updates.forEach((update) => {
                if (!update) return;
                if (update.revert) {
                    // Remove reverted override from storage
                    delete data.overrides.raw[update.source];
                    if (update.variableName) {
                        delete data.overrides.variables[update.variableName];
                    }
                } else {
                    data.overrides.raw[update.source] = update.current;
                    if (update.variableName) {
                        data.overrides.variables[update.variableName] = update.current;
                    }
                }
            });
        });
    }

    // --- Fast override: send directly to content script, skip full pipeline ---
    async function applyOverrideFast(newValue, sources) {
        if (isResetting || !activeTabId || !sources || !sources.length) return;
        const current = normalizeHex(newValue);
        for (const source of sources) {
            const s = normalizeHex(source);
            if (!s || current === s) continue;
            const variable = findBestVariableForSource(s);
            await sendMessageToTab({
                type: 'APPLY_OVERRIDE_FAST',
                payload: {
                    original: s,
                    current,
                    variableName: variable ? variable.name : null,
                },
            });
            overrideState.set(s, current);
        }
    }

    // --- Side panel message listeners ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.type) return;

        // Dropper asks popup to resolve a picked hex into its full cluster
        if (message.type === 'DROPPER_RESOLVE_CLUSTER') {
            const pickedHex = normalizeHex(message.payload?.hex);
            if (!pickedHex) {
                sendResponse({ sources: [], color: null });
                return true;
            }

            // Search currentColors for a cluster that contains this hex
            let matchedColor = null;
            for (const color of currentColors) {
                const members = Array.isArray(color.clusterMembers)
                    ? color.clusterMembers.map((m) => normalizeHex(m))
                    : [normalizeHex(color.value)];
                if (members.includes(pickedHex)) {
                    matchedColor = color;
                    break;
                }
            }

            if (matchedColor) {
                const sources = (matchedColor.clusterMembers || [normalizeHex(matchedColor.value)])
                    .map((m) => normalizeHex(m))
                    .filter(Boolean);
                const effectiveValues = {};
                sources.forEach((source) => {
                    effectiveValues[source] = getEffectiveValueForSource(source);
                });
                sendResponse({
                    sources,
                    color: {
                        value: matchedColor.value,
                        clusterSize: matchedColor.clusterSize,
                        primaryCategory: matchedColor.primaryCategory,
                        tailwindClass: matchedColor.tailwindClass,
                        tailwindLabel: matchedColor.tailwindLabel,
                    },
                    effectiveValues,
                });
            } else {
                // No cluster match — single-source fallback
                sendResponse({
                    sources: [pickedHex],
                    color: { value: pickedHex },
                    effectiveValues: { [pickedHex]: getEffectiveValueForSource(pickedHex) },
                });
            }
            return true; // async sendResponse
        }

        // Side panel changed color (real-time fast path or deferred full path)
        if (message.type === 'SIDEPANEL_COLOR_CHANGED') {
            const { newValue, sources, fast } = message.payload;
            if (!sources || !sources.length || isResetting || !activeTabId) return;

            // Update swatch visually
            if (activeSwatch) {
                activeSwatch.style.backgroundColor = newValue;
                activeSwatch.title = `${newValue} (edited)`;
            }

            if (fast) {
                // Fast path — lightweight setProperty only, no fallback CSS
                applyOverrideFast(newValue, sources);
            } else {
                // Full path — variable resolution, fallback CSS, colorMap rebuild
                applyOverrideNow(newValue, sources);
            }
        }

        // Side panel committed final color (for history + full override)
        if (message.type === 'SIDEPANEL_COLOR_COMMITTED') {
            const { finalValue, sources, startValues } = message.payload;
            if (!sources || !sources.length) return;

            // Run full override to ensure fallback CSS, variable resolution,
            // and persistence are applied (the fast path during drag skips these).
            applyOverrideNow(finalValue, sources);

            const batchUndo = [];
            sources.forEach((source) => {
                const startValue = normalizeHex(startValues?.[source] || source);
                if (finalValue !== startValue) {
                    batchUndo.push({ source, from: startValue, to: finalValue });
                    editStartValues.set(source, finalValue);
                }
            });
            pushBatchHistory(batchUndo);
            _editStartValue = finalValue;
        }

        // Side panel toggled export
        if (message.type === 'SIDEPANEL_EXPORT_TOGGLED') {
            const { checked, sources } = message.payload;
            if (!sources || !sources.length) return;

            sources.forEach((source) => {
                if (checked) exportSelection.add(source);
                else exportSelection.delete(source);
                updateSwatchesForSource(source, getEffectiveValueForSource(source));
            });
            persistDomainData();
        }

        // Side panel batch apply
        if (message.type === 'SIDEPANEL_BATCH_APPLY') {
            const { targetHex } = message.payload;
            const batchSources = Array.from(exportSelection);
            if (!batchSources.length) {
                showFooterNotice('No export-selected colors to batch apply.', true);
                return;
            }

            const batchChanges = [];
            batchSources.forEach((source) => {
                const from = normalizeHex(getEffectiveValueForSource(source));
                const to = normalizeHex(targetHex);
                if (from !== to) batchChanges.push({ source, from, to });
            });
            pushBatchHistory(batchChanges);

            applyOverrideNow(targetHex, batchSources).then(() => {
                showFooterNotice(`Applied ${targetHex} to ${batchSources.length} selected colors.`);
            });
        }
    });

    undoBtn.addEventListener('click', async () => {
        if (!historyStack.length) return;

        const entry = historyStack.pop();
        redoStack.push(entry); // save for redo
        updateUndoButton();

        if (entry.type === 'batch') {
            for (const change of entry.changes) {
                await applyOverrideNow(change.from, change.source);
            }
            // Notify side panel of updated color if affected
            const affectedSources = new Set(entry.changes.map((c) => c.source));
            if (selectedSources.some((s) => affectedSources.has(s)) && selectedSource) {
                const current = getEffectiveValueForSource(selectedSource);
                const pickerHex = sanitizePickerHex(current);
                _editStartValue = normalizeHex(pickerHex);
                selectedSources.forEach((source) => {
                    editStartValues.set(source, normalizeHex(getEffectiveValueForSource(source)));
                });
                // Update side panel via session storage
                chrome.storage.session.set({
                    sidePanelColorData: {
                        color: selectedColor,
                        sources: selectedSources,
                        currentHex: pickerHex,
                        effectiveValues: Object.fromEntries(
                            selectedSources.map((s) => [s, getEffectiveValueForSource(s)])
                        ),
                        exportChecked: selectedSources.every((s) => exportSelection.has(s)),
                        variableLines: buildVariableInfoLines(selectedSources),
                    },
                });
            }
        } else {
            await applyOverrideNow(entry.from, entry.source);

            if (selectedSources.includes(entry.source)) {
                const pickerHex = sanitizePickerHex(entry.from);
                _editStartValue = normalizeHex(pickerHex);
                editStartValues.set(entry.source, normalizeHex(pickerHex));
                // Update side panel via session storage
                chrome.storage.session.set({
                    sidePanelColorData: {
                        color: selectedColor,
                        sources: selectedSources,
                        currentHex: pickerHex,
                        effectiveValues: Object.fromEntries(
                            selectedSources.map((s) => [s, getEffectiveValueForSource(s)])
                        ),
                        exportChecked: selectedSources.every((s) => exportSelection.has(s)),
                        variableLines: buildVariableInfoLines(selectedSources),
                    },
                });
            }
        }
    });

    redoBtn.addEventListener('click', async () => {
        if (!redoStack.length) return;

        const entry = redoStack.pop();
        historyStack.push(entry); // put back on history without clearing redo
        updateUndoButton();

        if (entry.type === 'batch') {
            for (const change of entry.changes) {
                await applyOverrideNow(change.to, change.source);
            }
            const affectedSources = new Set(entry.changes.map((c) => c.source));
            if (selectedSources.some((s) => affectedSources.has(s)) && selectedSource) {
                const current = getEffectiveValueForSource(selectedSource);
                const pickerHex = sanitizePickerHex(current);
                _editStartValue = normalizeHex(pickerHex);
                selectedSources.forEach((source) => {
                    editStartValues.set(source, normalizeHex(getEffectiveValueForSource(source)));
                });
                chrome.storage.session.set({
                    sidePanelColorData: {
                        color: selectedColor,
                        sources: selectedSources,
                        currentHex: pickerHex,
                        effectiveValues: Object.fromEntries(
                            selectedSources.map((s) => [s, getEffectiveValueForSource(s)])
                        ),
                        exportChecked: selectedSources.every((s) => exportSelection.has(s)),
                        variableLines: buildVariableInfoLines(selectedSources),
                    },
                });
            }
        } else {
            await applyOverrideNow(entry.to, entry.source);

            if (selectedSources.includes(entry.source)) {
                const pickerHex = sanitizePickerHex(entry.to);
                _editStartValue = normalizeHex(pickerHex);
                editStartValues.set(entry.source, normalizeHex(pickerHex));
                chrome.storage.session.set({
                    sidePanelColorData: {
                        color: selectedColor,
                        sources: selectedSources,
                        currentHex: pickerHex,
                        effectiveValues: Object.fromEntries(
                            selectedSources.map((s) => [s, getEffectiveValueForSource(s)])
                        ),
                        exportChecked: selectedSources.every((s) => exportSelection.has(s)),
                        variableLines: buildVariableInfoLines(selectedSources),
                    },
                });
            }
        }
    });

    async function hydrateDomainState() {
        overrideState.clear();
        exportSelection.clear();
        historyStack.length = 0;
        redoStack.length = 0;
        exportHistory.length = 0;
        renderExportHistoryMenu();

        // Restore undo/redo stacks from session storage
        try {
            const sessionData = await chrome.storage.session.get(['palettelive_historyStack', 'palettelive_redoStack']);
            if (Array.isArray(sessionData.palettelive_historyStack)) {
                sessionData.palettelive_historyStack.forEach((entry) => historyStack.push(entry));
            }
            if (Array.isArray(sessionData.palettelive_redoStack)) {
                sessionData.palettelive_redoStack.forEach((entry) => redoStack.push(entry));
            }
        } catch (e) {
            console.warn('PaletteLive: Failed to restore undo/redo stacks', e);
        }
        updateUndoButton();

        const domain = await getActiveDomain();
        if (!domain) return;

        try {
            const data = await StorageUtils.getPalette(domain);
            if (!data) return;

            if (data.overrides && data.overrides.raw) {
                Object.entries(data.overrides.raw).forEach(([source, current]) => {
                    const sourceHex = normalizeHex(source);
                    const currentHex = normalizeHex(current);
                    if (sourceHex !== currentHex) {
                        overrideState.set(sourceHex, currentHex);
                    }
                });
            }

            if (Array.isArray(data.exportSelection)) {
                data.exportSelection.forEach((source) => {
                    exportSelection.add(normalizeHex(source));
                });
            }

            trimExportHistory(data.exportHistory).forEach((item) => {
                exportHistory.push(item);
            });
            renderExportHistoryMenu();

            if (
                data.settings &&
                (data.settings.scheme === 'auto' || data.settings.scheme === 'light' || data.settings.scheme === 'dark')
            ) {
                // scheme is stored but dropdown removed — keep persisted value
            } else {
                // default
            }

            if (
                data.settings &&
                (data.settings.vision === 'none' ||
                    data.settings.vision === 'protanopia' ||
                    data.settings.vision === 'deuteranopia' ||
                    data.settings.vision === 'tritanopia' ||
                    data.settings.vision === 'achromatopsia')
            ) {
                visionSelect.value = data.settings.vision;
            } else {
                visionSelect.value = 'none';
            }

            const clustering = data.settings && data.settings.clustering;
            if (clustering && typeof clustering.enabled === 'boolean') {
                clusterToggle.checked = clustering.enabled;
            } else {
                clusterToggle.checked = true;
            }

            if (clustering && Number.isFinite(Number(clustering.threshold))) {
                const normalizedThreshold = Math.max(1, Math.min(20, Number(clustering.threshold)));
                clusterThreshold.value = String(normalizedThreshold);
            } else {
                clusterThreshold.value = '5';
            }

            // Restore palette mode
            const validModes = [
                '60-30-10',
                'monochromatic',
                'analogous',
                'complementary',
                'split-complementary',
                'triadic',
                'advanced',
                'apply-palette',
            ];
            if (data.settings.paletteMode && validModes.includes(data.settings.paletteMode)) {
                paletteModeSelect.value = data.settings.paletteMode;
            } else {
                paletteModeSelect.value = 'apply-palette';
            }

            // Restore apply-palette input text & preview
            if (data.settings.applyPaletteInput) {
                applyPaletteInput.value = data.settings.applyPaletteInput;
                const hexes = parseApplyPaletteInput(data.settings.applyPaletteInput);
                if (hexes.length) renderApplyPreview(hexes);
            }

            updateClusterControls();
            updatePaletteModeUI();
        } catch (error) {
            console.warn('PaletteLive: Could not hydrate saved domain state', error);
        }
    }

    async function injectContentScripts() {
        // Must match the same files and order as manifest.json content_scripts
        const scripts = [
            'utils/constants.js',
            'utils/colorUtils.js',
            'utils/colorNames.js',
            'utils/contrast.js',
            'utils/storage.js',
            'content/shadowWalker.js',
            'content/extractor.js',
            'content/injector.js',
            'content/heatmap.js',
            'content/dropper.js',
            'content/content.js',
        ];

        // Never inject into a still-loading tab — the scripts would run before
        // the page's own JS, causing race conditions and "page not loading" issues.
        const tab = await new Promise((resolve) => chrome.tabs.get(activeTabId, (t) => resolve(t)));
        if (!tab || tab.status !== 'complete') {
            throw new Error('Tab not ready for injection (status: ' + (tab ? tab.status : 'unknown') + ')');
        }

        await chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            files: scripts,
        });
    }

    /**
     * Wait until the active tab's status is 'complete'.
     * If it's already complete, resolves immediately.
     * If it's still loading, listens for chrome.tabs.onUpdated.
     * Rejects after `timeoutMs` milliseconds.
     */
    function waitForTabReady(timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            chrome.tabs.get(activeTabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    reject(new Error('Tab not found'));
                    return;
                }
                if (tab.status === 'complete') {
                    resolve();
                    return;
                }

                // Tab is still loading — wait for it to complete
                setLoadingState(paletteList, 'Waiting for page to load…');
                let settled = false;

                const timer = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    chrome.tabs.onUpdated.removeListener(listener);
                    reject(new Error('Timed out waiting for page to load'));
                }, timeoutMs);

                const listener = (tabId, changeInfo) => {
                    if (tabId !== activeTabId) return;
                    if (changeInfo.status === 'complete') {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });
        });
    }

    /**
     * Wait for content script to be fully ready by polling with PING.
     * @param {number} maxAttempts - Maximum attempts before giving up
     * @param {number} interval - Milliseconds between attempts
     * @returns {Promise<boolean>} - True if ready, false if timed out
     */
    async function waitForContentScriptReady(maxAttempts = 15, interval = 200) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const result = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(activeTabId, { type: 'PING' }, { frameId: 0 }, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve({ ok: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve({ ok: true, response });
                        }
                    });
                });

                if (
                    result.ok &&
                    result.response &&
                    result.response.ready &&
                    result.response.hasExtractor &&
                    result.response.hasShadowWalker
                ) {
                    console.log('PaletteLive: Content script ready after', attempt + 1, 'attempts');
                    return true;
                }
            } catch (e) {
                // Ignore and retry
            }

            await new Promise((r) => setTimeout(r, interval));
        }
        console.log('PaletteLive: Content script did not become ready in time');
        return false;
    }

    function handlePaletteResponse(response) {
        if (response && response.success === false) {
            renderClusterSummary(0, 0, 0);
            const safeError = response.error || 'Extraction failed';
            setLoadingState(paletteList, safeError + '.', 'Try refreshing the page.');
            return;
        }

        if (response && response.data) {
            currentColors = response.data.colors || [];
            currentVariables = response.data.variables || [];

            // When overrides are active on the page, the extractor reports
            // overridden (current) hex values instead of the originals.
            // Reverse-map them to their original source colors.
            // If multiple source colors were overridden to the SAME current hex,
            // they must be merged into a single cluster swatch.
            if (overrideState.size > 0) {
                const reverseOverrides = new Map();
                overrideState.forEach((currentHex, sourceHex) => {
                    if (!reverseOverrides.has(currentHex)) reverseOverrides.set(currentHex, new Set());
                    reverseOverrides.get(currentHex).add(sourceHex);
                });

                const expandedColors = [];
                currentColors.forEach((color) => {
                    const hex = normalizeHex(color.value);
                    if (reverseOverrides.has(hex)) {
                        const mergedSources = new Set();

                        // Add existing natural cluster members if any
                        if (color.clusterMembers) {
                            color.clusterMembers.forEach((m) => mergedSources.add(normalizeHex(m)));
                        } else {
                            mergedSources.add(hex);
                        }

                        // Add all reverse-mapped sources that now look like this color
                        const sourcesToAdd = new Set();
                        mergedSources.forEach((m) => {
                            if (reverseOverrides.has(m)) {
                                reverseOverrides.get(m).forEach((src) => sourcesToAdd.add(src));
                            }
                        });

                        sourcesToAdd.forEach((src) => mergedSources.add(src));
                        const membersArray = Array.from(mergedSources).filter(Boolean);

                        expandedColors.push({
                            ...color,
                            value: sourcesToAdd.size > 0 ? Array.from(sourcesToAdd)[0] : membersArray[0],
                            clusterMembers: membersArray,
                            clusterSize: membersArray.length,
                        });
                    } else {
                        expandedColors.push(color);
                    }
                });
                currentColors = expandedColors;
            }

            renderPalette(currentColors);

            // Show closed Shadow DOM warning if detected
            const closedCount = response.data.closedShadowCount || 0;
            if (closedCount > 0) {
                showFooterNotice(
                    `${closedCount} closed Shadow DOM${closedCount > 1 ? 's' : ''} detected — some colors may be inaccessible.`
                );
            }
            return;
        }

        renderClusterSummary(0, 0, 0);
        setLoadingState(paletteList, 'No data received. Try refreshing.');
    }

    async function requestPalette() {
        if (!activeTabId) {
            renderClusterSummary(0, 0, 0);
            setLoadingState(paletteList, 'No active tab found.');
            return;
        }

        renderClusterSummary(0, 0, 0);
        setLoadingState(paletteList, 'Scanning page colors...');

        // Helper to send EXTRACT_PALETTE and get response (with 15s timeout)
        const extractPalette = () => sendMessageWithTimeout({ type: 'EXTRACT_PALETTE' }, 15000);

        /** Check if a result is usable (not just ok, but has actual data) */
        const isUsable = (r) => r.ok && r.response && r.response.success !== false;

        // First attempt
        let result = await extractPalette();

        // If first attempt fails or returns empty, try injecting scripts and wait for ready
        if (!isUsable(result)) {
            console.log('PaletteLive: Content script not responding, attempting injection...');
            try {
                await injectContentScripts();
                setLoadingState(paletteList, 'Loading extension...');

                // Wait for content script to be fully ready
                const isReady = await waitForContentScriptReady(15, 200);

                if (!isReady) {
                    // One more retry after scripts should have loaded
                    await new Promise((r) => setTimeout(r, 500));
                }

                // Retry extraction
                result = await extractPalette();

                if (!isUsable(result)) {
                    renderClusterSummary(0, 0, 0);
                    const errorMsg =
                        result.response && result.response.error
                            ? String(result.response.error)
                            : 'Could not connect to page.';
                    setLoadingState(paletteList, errorMsg, 'Please refresh the page and try again.');
                    return;
                }
            } catch (injectError) {
                renderClusterSummary(0, 0, 0);
                setLoadingState(
                    paletteList,
                    'Cannot scan this page.',
                    'Extensions cannot run on browser internal pages.'
                );
                return;
            }
        }

        handlePaletteResponse(result.response);

        // If this is a fresh scan with no overrides active, capture the
        // baseline screenshot now while the page is in its original state.
        // Only capture if we don't already have a baseline (avoids overwriting
        // a valid baseline when the user rescans without resetting).
        if (overrideState.size === 0 && !baselineScreenshot) {
            await captureBaseline();
        }
    }

    function normalizeTokenKey(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/^--/, '')
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    function normalizeImportedColor(value) {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (!ColorUtils.isValidColor(trimmed)) return null;
        const hex = normalizeHex(trimmed);
        return /^#[0-9a-f]{6,8}$/.test(hex) ? hex : null;
    }

    function variableLookupKeys(variableName) {
        const base = normalizeTokenKey(variableName);
        const keys = new Set([base]);

        if (base.startsWith('color-')) keys.add(base.slice(6));
        if (base.endsWith('-color')) keys.add(base.slice(0, -6));

        const compressed = base
            .replace(/(^|-)color(-|$)/g, '$1')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        if (compressed) keys.add(compressed);

        return Array.from(keys).filter(Boolean);
    }

    function collectColorEntries(node, path, out, depth) {
        if (!node || typeof node !== 'object' || depth > 6) return;

        Object.entries(node).forEach(([key, value]) => {
            const nextPath = [...path, key];

            if (typeof value === 'string') {
                const hex = normalizeImportedColor(value);
                if (!hex) return;
                out.push({
                    key: String(key),
                    pathKey: nextPath.join('-'),
                    value: hex,
                });
                return;
            }

            // Handle JSON token objects like { "value": "#hex", "name": "Color Name", "source": "#orig" }
            // Use the parent key as the token key, not "value"
            if (value && typeof value === 'object' && typeof value.value === 'string') {
                const hex = normalizeImportedColor(value.value);
                if (hex) {
                    const sourceHex = value.source ? normalizeImportedColor(value.source) : null;
                    out.push({
                        key: String(key),
                        pathKey: nextPath.join('-'),
                        value: hex,
                        source: sourceHex || null,
                    });
                    return;
                }
            }

            if (value && typeof value === 'object') {
                collectColorEntries(value, nextPath, out, depth + 1);
            }
        });
    }

    function buildVariableOverridesFromTokens(tokenEntries) {
        const tokenIndex = new Map();

        tokenEntries.forEach((entry) => {
            const keyA = normalizeTokenKey(entry.key);
            const keyB = normalizeTokenKey(entry.pathKey);
            if (keyA && !tokenIndex.has(keyA)) tokenIndex.set(keyA, entry.value);
            if (keyB && !tokenIndex.has(keyB)) tokenIndex.set(keyB, entry.value);
        });

        const variableOverrides = {};
        currentVariables.forEach((variable) => {
            const lookup = variableLookupKeys(variable.name);
            for (const key of lookup) {
                if (!tokenIndex.has(key)) continue;
                variableOverrides[variable.name] = tokenIndex.get(key);
                break;
            }
        });

        return variableOverrides;
    }

    /**
     * Pre-process pasted text based on a user-selected format.
     * Converts CMYK/LAB/OKLCH comment-style exports back into a format
     * that parseImportText can consume.  For labels that are CSS variable
     * names (--xxx), outputs CSS variable syntax.  For labels that are hex
     * colors (#xxx), outputs raw override syntax (#old: #new).
     * For auto/css/json/tailwind the text passes through unchanged.
     */
    function preprocessImportByFormat(text, format) {
        if (!format || format === 'auto' || format === 'css' || format === 'json' || format === 'tailwind') {
            return text;
        }

        // Helper to extract /* source: #hex */ comment from a line
        function extractSource(line) {
            const m = line.match(/\/\*\s*source:\s*(#[0-9a-fA-F]{3,8})\s*\*\//);
            return m ? m[1].trim() : null;
        }

        const lines = text.split('\n');
        const cssLines = [':root {'];
        const rawLines = [];

        function emitEntry(label, hexValue, sourceHex) {
            // If we have a source hex, always use raw override (source → new value)
            if (sourceHex) {
                rawLines.push(`${sourceHex}: ${hexValue}`);
                // Also emit variable if label is a CSS variable
                if (label.startsWith('--')) {
                    cssLines.push(`  ${label}: ${hexValue}; /* source: ${sourceHex} */`);
                }
                return;
            }
            if (label.startsWith('--')) {
                cssLines.push(`  ${label}: ${hexValue};`);
            } else if (/^#[0-9a-f]{3,8}$/i.test(label)) {
                rawLines.push(`${label}: ${hexValue}`);
            } else {
                const varName = `--${label
                    .replace(/[^a-zA-Z0-9-_]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')}`;
                cssLines.push(`  ${varName}: ${hexValue};`);
            }
        }

        if (format === 'cmyk') {
            const cmykRe = /^(.+?):\s*cmyk\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)/i;
            lines.forEach((line) => {
                const m = line.trim().match(cmykRe);
                if (!m) return;
                const label = m[1].trim();
                const sourceHex = extractSource(line);
                const rawC = parseFloat(m[2]);
                const rawMag = parseFloat(m[3]);
                const rawY = parseFloat(m[4]);
                const rawK = parseFloat(m[5]);
                // Detect scale: if '%' present or value > 1, treat as percentage
                const hasPct = m[0].slice(m[1].length).includes('%');
                const c = hasPct || rawC > 1 ? rawC / 100 : rawC;
                const mag = hasPct || rawMag > 1 ? rawMag / 100 : rawMag;
                const y = hasPct || rawY > 1 ? rawY / 100 : rawY;
                const k = hasPct || rawK > 1 ? rawK / 100 : rawK;
                const r = Math.round(255 * (1 - c) * (1 - k));
                const g = Math.round(255 * (1 - mag) * (1 - k));
                const b = Math.round(255 * (1 - y) * (1 - k));
                const hex =
                    '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
                emitEntry(label, hex, sourceHex);
            });
        } else if (format === 'lab') {
            const labRe = /^(.+?):\s*lab\(\s*([\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)\s*\)/i;
            lines.forEach((line) => {
                const m = line.trim().match(labRe);
                if (!m) return;
                const label = m[1].trim();
                const sourceHex = extractSource(line);
                const colorVal = `lab(${m[2]}% ${m[3]} ${m[4]})`;
                emitEntry(label, colorVal, sourceHex);
            });
        } else if (format === 'oklch') {
            const oklchRe = /^(.+?):\s*oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\s*\)/i;
            lines.forEach((line) => {
                const m = line.trim().match(oklchRe);
                if (!m) return;
                const label = m[1].trim();
                const sourceHex = extractSource(line);
                const colorVal = `oklch(${m[2]}% ${m[3]} ${m[4]})`;
                emitEntry(label, colorVal, sourceHex);
            });
        }

        cssLines.push('}');
        const hasCss = cssLines.length > 2;
        const hasRaw = rawLines.length > 0;

        if (hasCss && hasRaw) {
            return cssLines.join('\n') + '\n' + rawLines.join('\n');
        } else if (hasCss) {
            return cssLines.join('\n');
        } else if (hasRaw) {
            return rawLines.join('\n');
        }
        return text;
    }

    function parseImportText(text) {
        const rawOverrides = {};
        const variableOverrides = {};
        const settings = {};

        const assignRaw = (original, current) => {
            const source = normalizeImportedColor(original);
            const target = normalizeImportedColor(current);
            if (!source || !target) return;
            rawOverrides[source] = target;
        };

        const assignVariable = (name, current) => {
            if (!name || !String(name).startsWith('--')) return;
            const target = normalizeImportedColor(current);
            if (!target) return;
            variableOverrides[String(name)] = target;
        };

        const trimmed = String(text || '').trim();
        if (!trimmed) return { rawOverrides, variableOverrides, settings };

        try {
            const parsed = JSON.parse(trimmed);
            const tokenEntries = [];
            let unmatchedTokenColors = [];

            if (parsed && typeof parsed === 'object') {
                // ── PaletteLive Native format — lossless round-trip, apply directly ──
                // Detected by _palettelive version field. No fuzzy matching needed.
                if (parsed._palettelive) {
                    if (parsed.overrides && typeof parsed.overrides.raw === 'object') {
                        Object.entries(parsed.overrides.raw).forEach(([original, current]) =>
                            assignRaw(original, current)
                        );
                    }
                    if (parsed.overrides && typeof parsed.overrides.variables === 'object') {
                        Object.entries(parsed.overrides.variables).forEach(([name, current]) =>
                            assignVariable(name, current)
                        );
                    }
                    if (parsed.settings) {
                        const s = parsed.settings;
                        if (s.scheme === 'auto' || s.scheme === 'light' || s.scheme === 'dark')
                            settings.scheme = s.scheme;
                        const validVision = ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
                        if (validVision.includes(s.vision)) settings.vision = s.vision;
                        const validModes = ['60-30-10', 'monochromatic', 'analogous', 'complementary', 'split-complementary', 'triadic', 'advanced', 'apply-palette'];
                        if (s.paletteMode && validModes.includes(s.paletteMode)) settings.paletteMode = s.paletteMode;
                        if (typeof s.applyPaletteInput === 'string') settings.applyPaletteInput = s.applyPaletteInput;
                        if (s.clustering && typeof s.clustering === 'object') settings.clustering = s.clustering;
                    }
                    return { rawOverrides, variableOverrides, settings };
                }
                const parsedScheme = parsed.settings && parsed.settings.scheme ? parsed.settings.scheme : parsed.scheme;
                const parsedVision = parsed.settings && parsed.settings.vision ? parsed.settings.vision : parsed.vision;
                if (parsedScheme === 'auto' || parsedScheme === 'light' || parsedScheme === 'dark') {
                    settings.scheme = parsedScheme;
                }
                if (
                    parsedVision === 'none' ||
                    parsedVision === 'protanopia' ||
                    parsedVision === 'deuteranopia' ||
                    parsedVision === 'tritanopia' ||
                    parsedVision === 'achromatopsia'
                ) {
                    settings.vision = parsedVision;
                }

                if (parsed.overrides && parsed.overrides.raw && typeof parsed.overrides.raw === 'object') {
                    Object.entries(parsed.overrides.raw).forEach(([original, current]) => assignRaw(original, current));
                }
                if (parsed.raw && typeof parsed.raw === 'object') {
                    Object.entries(parsed.raw).forEach(([original, current]) => assignRaw(original, current));
                }

                if (parsed.overrides && parsed.overrides.variables && typeof parsed.overrides.variables === 'object') {
                    Object.entries(parsed.overrides.variables).forEach(([name, current]) =>
                        assignVariable(name, current)
                    );
                }
                if (parsed.variables && typeof parsed.variables === 'object') {
                    Object.entries(parsed.variables).forEach(([name, current]) => assignVariable(name, current));
                }

                if (parsed.colors && typeof parsed.colors === 'object') {
                    collectColorEntries(parsed.colors, ['colors'], tokenEntries, 0);
                }
                if (parsed.tokens && parsed.tokens.colors && typeof parsed.tokens.colors === 'object') {
                    collectColorEntries(parsed.tokens.colors, ['tokens', 'colors'], tokenEntries, 0);
                }
                if (
                    parsed.theme &&
                    parsed.theme.extend &&
                    parsed.theme.extend.colors &&
                    typeof parsed.theme.extend.colors === 'object'
                ) {
                    collectColorEntries(parsed.theme.extend.colors, ['theme', 'extend', 'colors'], tokenEntries, 0);
                }
                collectColorEntries(parsed, [], tokenEntries, 0);

                // Use source field from token entries for direct raw overrides
                tokenEntries.forEach((entry) => {
                    if (entry.source && entry.value && entry.source !== entry.value) {
                        rawOverrides[entry.source] = entry.value;
                    }
                });

                const tokenMappedVariables = buildVariableOverridesFromTokens(tokenEntries);
                Object.entries(tokenMappedVariables).forEach(([name, value]) => {
                    if (!variableOverrides[name]) variableOverrides[name] = value;
                });

                // Collect unmatched token colors for raw-override fallback
                // (only those without source — sourced ones are already raw overrides)
                const mappedValues = new Set(Object.values(tokenMappedVariables));
                unmatchedTokenColors = tokenEntries
                    .filter((entry) => !entry.source && !mappedValues.has(entry.value))
                    .map((entry) => entry.value);

                Object.entries(parsed).forEach(([key, value]) => {
                    if (String(key).startsWith('--')) assignVariable(key, value);
                    if (/^#[0-9a-f]{3,8}$/i.test(String(key))) assignRaw(key, value);
                });
            }

            return { rawOverrides, variableOverrides, settings, unmatchedTokenColors };
        } catch (error) {
            // Fallback to plain-text parsing below.
        }

        const cssVarRegex =
            /(--[A-Za-z0-9-_]+)\s*:\s*([^;}{\/\n]+?)\s*;(?:\s*\/\*\s*source:\s*(#[0-9a-fA-F]{3,8})\s*\*\/)?/g;
        let cssMatch;
        while ((cssMatch = cssVarRegex.exec(trimmed)) !== null) {
            const varName = cssMatch[1];
            const colorValue = cssMatch[2].trim();
            const sourceHex = cssMatch[3] ? cssMatch[3].trim() : null;
            if (sourceHex) {
                // We have the original source color — use raw override
                const target = normalizeImportedColor(colorValue);
                const source = normalizeImportedColor(sourceHex);
                if (target && source && target !== source) {
                    rawOverrides[source] = target;
                }
                // Also assign variable override for pages with CSS variables
                assignVariable(varName, colorValue);
            } else {
                assignVariable(varName, colorValue);
            }
        }

        const rawRegex = /(#[0-9A-Fa-f]{3,8})\s*[:=]\s*(#[0-9A-Fa-f]{3,8})/g;
        let rawMatch;
        while ((rawMatch = rawRegex.exec(trimmed)) !== null) {
            assignRaw(rawMatch[1], rawMatch[2]);
        }

        // Also match raw hex → color-function mappings like:
        //   #264653: lab(56.29% -8.35 -40.11)
        //   #264653: oklch(60.9% 0.126 241.96)
        const rawFuncRegex = /(#[0-9A-Fa-f]{3,8})\s*:\s*((lab|oklch|oklab|lch|hsl|hwb|rgb|rgba|hsla)\([^)]+\))/gi;
        let rawFuncMatch;
        while ((rawFuncMatch = rawFuncRegex.exec(trimmed)) !== null) {
            assignRaw(rawFuncMatch[1], rawFuncMatch[2]);
        }

        const tokenRegex =
            /['"]?([A-Za-z0-9-_]+)['"]?\s*:\s*['"]([^'"\n]+)['"],?\s*(?:\/\*\s*source:\s*(#[0-9a-fA-F]{3,8})\s*\*\/)?/g;
        const tokenEntries = [];
        let tokenMatch;
        while ((tokenMatch = tokenRegex.exec(trimmed)) !== null) {
            const hex = normalizeImportedColor(tokenMatch[2]);
            if (!hex) continue;
            const sourceHex = tokenMatch[3] ? tokenMatch[3].trim() : null;
            if (sourceHex) {
                const src = normalizeImportedColor(sourceHex);
                if (src && src !== hex) {
                    rawOverrides[src] = hex;
                }
            }
            tokenEntries.push({ key: tokenMatch[1], pathKey: tokenMatch[1], value: hex, source: sourceHex || null });
        }

        // Use source field from token entries for raw overrides
        tokenEntries.forEach((entry) => {
            if (entry.source && entry.value && entry.source !== entry.value) {
                rawOverrides[entry.source] = entry.value;
            }
        });

        const tokenMappedVariables = buildVariableOverridesFromTokens(tokenEntries);
        Object.entries(tokenMappedVariables).forEach(([name, value]) => {
            if (!variableOverrides[name]) variableOverrides[name] = value;
        });

        const mappedVals = new Set(Object.values(tokenMappedVariables));
        const unmatchedTokenColors = tokenEntries
            .filter((entry) => !mappedVals.has(entry.value))
            .map((entry) => entry.value);

        return { rawOverrides, variableOverrides, settings, unmatchedTokenColors };
    }

    async function applyImportedPaletteText(text) {
        const parsed = parseImportText(text);
        const rawEntries = Object.entries(parsed.rawOverrides || {});
        const variableEntries = Object.entries(parsed.variableOverrides || {});
        const hasScheme = !!(parsed.settings && parsed.settings.scheme);
        const hasVision = !!(parsed.settings && parsed.settings.vision);
        const hasPaletteMode = !!(parsed.settings && parsed.settings.paletteMode);
        const hasApplyPaletteInput = !!(parsed.settings && typeof parsed.settings.applyPaletteInput === 'string' && parsed.settings.applyPaletteInput !== '');
        const hasClustering = !!(parsed.settings && parsed.settings.clustering && typeof parsed.settings.clustering === 'object');

        if (!rawEntries.length && !variableEntries.length && !hasScheme && !hasVision && !hasPaletteMode && !hasApplyPaletteInput && !hasClustering) {
            throw new Error('No compatible overrides found in this file');
        }

        // ── Phase 1: Update popup-side overrideState for variables matched to currentVariables ──
        // This syncs UI swatches but does NOT send anything to content yet.
        const matchedVariableNames = new Set();
        variableEntries.forEach(([name, value]) => {
            currentVariables
                .filter((variable) => variable.name === name)
                .forEach((variable) => {
                    matchedVariableNames.add(name);
                    const source = normalizeHex(variable.value);
                    overrideState.set(source, value);
                    updateSwatchesForSource(source, value);
                });
        });

        // ── Phase 2: Collect additional raw overrides from unmatched variable entries ──
        // Generated names like --color-XXXXXX encode the original hex → safe exact match.
        // All other unmatched variable names are skipped (no guessing).
        const generatedVarRe = /^--color-([0-9a-f]{6,8})$/i;
        const additionalRawMap = {}; // originalHex → currentHex
        const assignedSources = new Set(rawEntries.map(([o]) => o));

        variableEntries.forEach(([name, value]) => {
            if (matchedVariableNames.has(name)) return;
            const genMatch = name.match(generatedVarRe);
            if (genMatch) {
                // Generated variable names encode the original hex directly — safe exact match.
                const originalHex = '#' + genMatch[1].toLowerCase();
                if (normalizeHex(value) !== originalHex && !assignedSources.has(originalHex)) {
                    additionalRawMap[originalHex] = value;
                    assignedSources.add(originalHex);
                }
            }
            // Non-generated unmatched variables are skipped — no distance-based guessing.
        });

        // ── Phase 3 (removed): positional token-colour mapping was unreliable.
        //    Token colours without an explicit source field are now ignored.
        //    Only exact raw-hex and exact CSS-variable matches are applied.

        // ── Phase 4: Merge confirmed raw overrides into one map ──
        const allRawMap = { ...Object.fromEntries(rawEntries), ...additionalRawMap };
        const allRawArray = Object.entries(allRawMap)
            .filter(([original, current]) => original !== current)
            .map(([original, current]) => ({ original, current }));

        // ── Phase 5: Build variable payload ──
        const variablePayload = {};
        variableEntries.forEach(([name, value]) => {
            variablePayload[name] = value;
        });
        const hasVarPayload = Object.keys(variablePayload).length > 0;

        // ── Phase 6: Send ONE bulk message — content script applies RAW first
        //            (preserving original colorElementMap), then injects CSS variables.
        //            This prevents the race where variable injection rebuilds the color
        //            map before raw overrides can find their original source colors. ──
        if (allRawArray.length || hasVarPayload) {
            const result = await sendMessageToTab({
                type: 'APPLY_OVERRIDE_BULK',
                payload: {
                    raw: allRawArray.length ? allRawArray : [],
                    variables: hasVarPayload ? variablePayload : undefined,
                },
            });
            if (!result.ok) {
                throw new Error(result.error || 'Failed to apply overrides');
            }
        }

        // ── Phase 7: Sync popup overrideState + UI for all raw overrides ──
        Object.entries(allRawMap).forEach(([original, current]) => {
            if (original === current) return;
            overrideState.set(original, current);
            updateSwatchesForSource(original, current);
        });

        // ── Phase 8: Apply page-level settings ──
        if (hasScheme) {
            await sendMessageToTab({
                type: 'SET_COLOR_SCHEME',
                payload: { mode: parsed.settings.scheme },
            });
        }

        if (hasVision) {
            visionSelect.value = parsed.settings.vision;
            await sendMessageToTab({
                type: 'SET_VISION_MODE',
                payload: { mode: parsed.settings.vision },
            });
        }

        if (hasPaletteMode) {
            const validModes = ['60-30-10', 'monochromatic', 'analogous', 'complementary', 'split-complementary', 'triadic', 'advanced', 'apply-palette'];
            if (validModes.includes(parsed.settings.paletteMode)) {
                paletteModeSelect.value = parsed.settings.paletteMode;
                updatePaletteModeUI();
            }
        }

        if (hasApplyPaletteInput) {
            applyPaletteInput.value = parsed.settings.applyPaletteInput;
            const hexes = parseApplyPaletteInput(parsed.settings.applyPaletteInput);
            if (hexes.length) renderApplyPreview(hexes);
        }

        if (hasClustering) {
            const cl = parsed.settings.clustering;
            if (typeof cl.enabled === 'boolean') clusterToggle.checked = cl.enabled;
            if (Number.isFinite(Number(cl.threshold))) {
                clusterThreshold.value = String(Math.max(1, Math.min(20, Number(cl.threshold))));
            }
            updateClusterControls();
        }

        // ── Phase 9: Persist everything in one write ──
        await persistDomainData((data) => {
            if (!data.overrides) data.overrides = {};
            if (!data.overrides.raw) data.overrides.raw = {};
            if (!data.overrides.variables) data.overrides.variables = {};
            Object.entries(allRawMap).forEach(([original, current]) => {
                if (original !== current) data.overrides.raw[original] = current;
            });
            variableEntries.forEach(([name, value]) => {
                data.overrides.variables[name] = value;
            });
        });
    }

    /**
     * Builds a lossless PaletteLive-native (.plp) export object.
     * Contains exact before→after override pairs — no fuzzy matching needed on import.
     */
    async function buildNativeExportJson() {
        const domain = await getActiveDomain();

        // Exact raw color overrides: {originalHex: currentHex}
        const raw = {};
        overrideState.forEach((current, original) => {
            raw[original] = current;
        });

        // Exact CSS variable overrides: {--varName: currentHex}
        const variables = {};
        currentVariables.forEach((v) => {
            const source = normalizeHex(v.value);
            const effective = getEffectiveValueForSource(source);
            if (effective !== source) {
                variables[v.name] = effective;
            }
        });

        // Human-readable color reference: shows what changed and the variable name if any
        const changed = [];
        overrideState.forEach((current, original) => {
            const entry = { original, current };
            const matched = currentColors.find((c) => normalizeHex(c.value) === original);
            if (matched && matched.variable) entry.variable = matched.variable;
            changed.push(entry);
        });

        const payload = {
            _palettelive: '1.0',
            domain: domain || '',
            timestamp: new Date().toISOString(),
            overrides: { raw, variables },
            settings: {
                vision: visionSelect ? visionSelect.value || 'none' : 'none',
                paletteMode: paletteModeSelect ? paletteModeSelect.value || 'apply-palette' : 'apply-palette',
                applyPaletteInput: applyPaletteInput ? applyPaletteInput.value || '' : '',
                clustering: {
                    enabled: clusterToggle ? !!clusterToggle.checked : true,
                    threshold: clusterThreshold ? Number(clusterThreshold.value) || 5 : 5,
                },
            },
        };

        if (changed.length) {
            payload._colorReference = changed; // informational — not used by import
        }

        return JSON.stringify(payload, null, 2);
    }

    function buildExportData() {
        // Smart default: if nothing is explicitly export-selected,
        // auto-select modified colors first; if none, export all.
        let selectedSources;
        if (exportSelection.size) {
            selectedSources = new Set(Array.from(exportSelection));
        } else if (overrideState.size) {
            // Auto-select modified (overridden) colors
            selectedSources = new Set(overrideState.keys());
        } else {
            selectedSources = null; // all colors
        }

        const variableEntries = currentVariables
            .filter((variable) => {
                if (!selectedSources) return true;
                return selectedSources.has(normalizeHex(variable.value));
            })
            .map((variable) => {
                const source = normalizeHex(variable.value);
                return {
                    name: variable.name,
                    source: source,
                    value: getEffectiveValueForSource(source),
                };
            });

        const variableSourceSet = new Set(
            currentVariables
                .filter((variable) => !selectedSources || selectedSources.has(normalizeHex(variable.value)))
                .map((variable) => normalizeHex(variable.value))
        );

        const colorEntries = currentColors
            .filter((color) => {
                const source = normalizeHex(color.value);
                if (selectedSources && !selectedSources.has(source)) return false;
                return !variableSourceSet.has(source);
            })
            .map((color) => {
                const source = normalizeHex(color.value);
                return {
                    source: source,
                    value: getEffectiveValueForSource(source),
                };
            });

        return [...variableEntries, ...colorEntries];
    }

    // ── Export helper: map format name → { output, ext } ─────────────────────
    // Single source of truth — used by both clipboard and file-download paths.
    function _exportFormatOutput(format, dataToExport) {
        switch (format) {
            case 'css':      return { output: ExporterUtils.toCSS(dataToExport),      ext: 'css'  };
            case 'json':     return { output: ExporterUtils.toJSON(dataToExport),     ext: 'json' };
            case 'tailwind': return { output: ExporterUtils.toTailwind(dataToExport), ext: 'js'   };
            case 'cmyk':     return { output: ExporterUtils.toCMYK(dataToExport),     ext: 'txt'  };
            case 'lab':      return { output: ExporterUtils.toLAB(dataToExport),      ext: 'txt'  };
            case 'oklch':    return { output: ExporterUtils.toOKLCH(dataToExport),    ext: 'txt'  };
            default:         return { output: '',                                      ext: 'txt'  };
        }
    }

    // ── Export helper: trigger a browser file-download for text content. ─────
    function _downloadText(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    exportBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        renderExportHistoryMenu();
        exportMenu.classList.toggle('show');
    });

    document.addEventListener('click', (event) => {
        if (!exportBtn.contains(event.target) && !exportMenu.contains(event.target)) {
            exportMenu.classList.remove('show');
        }
        if (importBtn && importMenu && !importBtn.contains(event.target) && !importMenu.contains(event.target)) {
            importMenu.classList.remove('show');
        }
    });

    exportMenu.addEventListener('click', async (event) => {
        const button = event.target.closest('button');
        if (!button) return;

        const historyIndexRaw = button.dataset.historyIndex;
        if (typeof historyIndexRaw !== 'undefined') {
            const historyIndex = Number(historyIndexRaw);
            const entry = Number.isFinite(historyIndex) ? exportHistory[historyIndex] : null;
            if (!entry || !entry.output) {
                exportMenu.classList.remove('show');
                return;
            }

            navigator.clipboard
                .writeText(entry.output)
                .then(() => {
                    const originalText = button.textContent;
                    button.textContent = 'Copied!';
                    setTimeout(() => {
                        button.textContent = originalText;
                    }, 1500);
                })
                .catch((error) => {
                    console.warn('Clipboard write error:', error);
                });

            exportMenu.classList.remove('show');
            return;
        }

        const format = button.dataset.format;
        const fileFormat = button.dataset.fileFormat;

        // ── PaletteLive Native format: lossless round-trip with exact override map ──
        if (format === 'palettelive' || fileFormat === 'palettelive') {
            try {
                const nativeJson = await buildNativeExportJson();
                if (fileFormat === 'palettelive') {
                    const blob = new Blob([nativeJson], { type: 'application/json;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'palette.plp';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 100);
                    recordExportHistory('palettelive', nativeJson);
                    persistDomainData();
                } else {
                    await navigator.clipboard.writeText(nativeJson);
                    const originalText = button.textContent;
                    button.textContent = 'Copied!';
                    setTimeout(() => { button.textContent = originalText; }, 1500);
                    recordExportHistory('palettelive', nativeJson);
                    persistDomainData();
                }
            } catch (err) {
                console.warn('PaletteLive: Native export failed', err);
            }
            exportMenu.classList.remove('show');
            return;
        }

        // ── All other formats: CSS, JSON, Tailwind, CMYK, LAB, OKLCH ─────────
        // Single dispatch: file-download or clipboard, then record + persist.
        const activeFormat = fileFormat || format;
        if (!activeFormat) return;

        const dataToExport = buildExportData();
        if (!dataToExport.length) {
            exportMenu.classList.remove('show');
            return;
        }

        const { output, ext } = _exportFormatOutput(activeFormat, dataToExport);
        if (!output) {
            exportMenu.classList.remove('show');
            return;
        }

        if (fileFormat) {
            _downloadText(output, `palette-${fileFormat}.${ext}`);
        } else {
            try {
                await navigator.clipboard.writeText(output);
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                setTimeout(() => { button.textContent = originalText; }, 1500);
            } catch (error) {
                console.warn('Clipboard write error:', error);
            }
        }

        recordExportHistory(activeFormat, output);
        persistDomainData();
        exportMenu.classList.remove('show');
    });

    // --- Import dropdown + modal ---
    if (importBtn && importMenu) {
        importBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            exportMenu.classList.remove('show');
            importMenu.classList.toggle('show');
        });
    }

    if (importFileBtn && importInput) {
        importFileBtn.addEventListener('click', () => {
            importMenu.classList.remove('show');
            importInput.click();
        });

        importInput.addEventListener('change', async (event) => {
            const file = event.target.files && event.target.files[0];
            importInput.value = '';
            if (!file) return;

            try {
                const text = await file.text();
                await applyImportedPaletteText(text);
                showFooterNotice(`Imported ${file.name}`);
            } catch (error) {
                console.warn('PaletteLive: Import failed', error);
                showFooterNotice(`Import failed: ${error.message || 'Invalid file'}`, true);
            }
        });
    }

    if (importClipboardBtn && importClipboardModal) {
        const importFormatPlaceholders = {
            auto: 'e.g. {"overrides": {"#fff": "#000"}} or --primary: #3498db;',
            palettelive: 'Paste the content of a .plp file exported by PaletteLive',
            css: 'e.g. --primary: #3498db;\n--secondary: #2ecc71;',
            json: 'e.g. {"colors": {"primary": "#3498db", "secondary": "#2ecc71"}}',
            tailwind: 'e.g. {"theme": {"extend": {"colors": {"primary": "#3498db"}}}}',
            cmyk: 'e.g. primary: cmyk(75%, 32%, 0%, 15%)\nsecondary: cmyk(77%, 0%, 55%, 7%)',
            lab: 'e.g. primary: lab(56.29, -8.35, -40.11)\nsecondary: lab(76.07, -52.25, 21.57)',
            oklch: 'e.g. primary: oklch(0.609 0.126 241.96)\nsecondary: oklch(0.765 0.155 160.03)',
        };

        importClipboardBtn.addEventListener('click', () => {
            importMenu.classList.remove('show');
            importClipboardTextarea.value = '';
            if (importFormatSelect) importFormatSelect.value = 'auto';
            importClipboardTextarea.placeholder = importFormatPlaceholders.auto;
            importClipboardModal.classList.remove('hidden');
            importClipboardTextarea.focus();
        });

        // Focus trap inside the modal
        importClipboardModal.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab') return;
            const focusable = importClipboardModal.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                last.focus();
                e.preventDefault();
            } else if (!e.shiftKey && document.activeElement === last) {
                first.focus();
                e.preventDefault();
            }
        });

        if (importFormatSelect) {
            importFormatSelect.addEventListener('change', () => {
                const fmt = importFormatSelect.value;
                importClipboardTextarea.placeholder = importFormatPlaceholders[fmt] || importFormatPlaceholders.auto;
            });
        }

        importClipboardPaste.addEventListener('click', async () => {
            try {
                const clipText = await navigator.clipboard.readText();
                importClipboardTextarea.value = clipText;
            } catch (err) {
                console.warn('PaletteLive: Clipboard read failed', err);
                showFooterNotice('Could not read clipboard. Please paste manually.', true);
            }
        });

        importClipboardApply.addEventListener('click', async () => {
            const text = importClipboardTextarea.value.trim();
            if (!text) {
                showFooterNotice('Nothing to import — paste or type palette data first.', true);
                return;
            }
            const format = importFormatSelect ? importFormatSelect.value : 'auto';
            try {
                const processedText = preprocessImportByFormat(text, format);
                await applyImportedPaletteText(processedText);
                importClipboardModal.classList.add('hidden');
                showFooterNotice('Imported from clipboard');
            } catch (error) {
                console.warn('PaletteLive: Clipboard import failed', error);
                showFooterNotice(`Import failed: ${error.message || 'Invalid data'}`, true);
            }
        });

        importClipboardCancel.addEventListener('click', () => {
            importClipboardModal.classList.add('hidden');
        });

        importClipboardModal.addEventListener('click', (event) => {
            if (event.target === importClipboardModal) {
                importClipboardModal.classList.add('hidden');
            }
        });
    }

    heatmapToggle.addEventListener('change', (event) => {
        if (!activeTabId) return;

        // Persist state so popup reopens with the same toggle position.
        chrome.storage.session.set({ palettelive_heatmap_active: event.target.checked });

        sendMessageToTab({
            type: 'TOGGLE_HEATMAP',
            payload: { active: event.target.checked },
        }).then((result) => {
            if (!result.ok) {
                console.warn('PaletteLive: Heatmap toggle failed', result.error);
            }
        });
    });

    // Theme dropdown removed — color scheme always defaults to 'auto'

    visionSelect.addEventListener('change', async () => {
        const mode = visionSelect.value;
        const result = await sendMessageToTab({
            type: 'SET_VISION_MODE',
            payload: { mode },
        });

        if (!result.ok) {
            console.warn('PaletteLive: Vision mode update failed', result.error);
        }

        await persistDomainData();
    });

    paletteModeSelect.addEventListener('change', async () => {
        updatePaletteModeUI();
        renderPalette(currentColors);
        await persistDomainData();
    });

    clusterToggle.addEventListener('change', async () => {
        updateClusterControls();
        renderPalette(currentColors);
        await persistDomainData();
    });

    clusterThreshold.addEventListener('input', () => {
        updateClusterControls();
        renderPalette(currentColors);
    });

    clusterThreshold.addEventListener('change', async () => {
        updateClusterControls();
        renderPalette(currentColors);
        await persistDomainData();
    });

    /**
     * Capture and persist the original page screenshot as the comparison baseline.
     * Called after a clean scan (no overrides) or after a reset.
     * Persists to chrome.storage.session so it survives popup close/reopen.
     */
    async function captureBaseline() {
        if (!activeWindowId) return;
        try {
            baselineScreenshot = await captureVisible(activeWindowId);
            chrome.storage.session.set({ palettelive_baselineScreenshot: baselineScreenshot });
        } catch (e) {
            console.warn('PaletteLive: Could not capture baseline screenshot', e);
            baselineScreenshot = null;
        }
    }

    async function startComparison() {
        if (!activeTabId || activeWindowId === null || activeWindowId === undefined) {
            compareToggle.checked = false;
            setCompareStatus('No active tab to compare.', 'error');
            return;
        }

        compareToggle.disabled = true;
        setCompareStatus('Preparing comparison...', 'busy');

        try {
            // ── Step 1: Remove overrides → screenshot at current scroll position ──
            // This captures what the page looks like with the original site colors.
            setCompareStatus('Capturing original state...', 'busy');

            const suspendResult = await sendMessageToTab({ type: 'SUSPEND_FOR_COMPARISON' });
            if (!suspendResult.ok || (suspendResult.response && suspendResult.response.success === false)) {
                throw new Error(
                    (suspendResult.response && suspendResult.response.error) ||
                        suspendResult.error ||
                        'Could not suspend overrides'
                );
            }

            const paintResult1 = await sendMessageToTab({ type: 'WAIT_FOR_PAINT' });
            if (!paintResult1.ok) {
                await new Promise((resolve) => setTimeout(resolve, 400));
            }

            const beforeImage = await captureVisible(activeWindowId);

            // ── Step 2: Re-apply overrides → screenshot at same scroll position ──
            // This captures what the page looks like with PaletteLive changes.
            setCompareStatus('Capturing modified state...', 'busy');

            const restoreResult = await sendMessageToTab({ type: 'RESTORE_AFTER_COMPARISON' });
            if (!restoreResult.ok || (restoreResult.response && restoreResult.response.success === false)) {
                throw new Error(
                    (restoreResult.response && restoreResult.response.error) ||
                        restoreResult.error ||
                        'Could not restore overrides'
                );
            }

            const paintResult2 = await sendMessageToTab({ type: 'WAIT_FOR_PAINT' });
            if (!paintResult2.ok) {
                await new Promise((resolve) => setTimeout(resolve, 400));
            }

            const afterImage = await captureVisible(activeWindowId);

            // ── Step 3: Show split overlay with both screenshots ─────────────────
            // Both images were captured at the same scroll position so they align
            // perfectly in the left/right split view.
            const showResult = await sendMessageToTab({
                type: 'SHOW_COMPARISON_OVERLAY',
                payload: {
                    beforeImage,
                    afterImage,
                    divider: 50,
                },
            });
            if (!showResult.ok || (showResult.response && showResult.response.success === false)) {
                throw new Error(
                    (showResult.response && showResult.response.error) ||
                        showResult.error ||
                        'Could not show comparison overlay'
                );
            }

            comparisonActive = true;
            chrome.storage.session.set({ palettelive_compare_active: true });
            setCompareStatus('Drag divider on page.');
        } catch (error) {
            comparisonActive = false;
            compareToggle.checked = false;
            chrome.storage.session.set({ palettelive_compare_active: false });
            setCompareStatus('Compare unavailable on this page.', 'error');

            await sendMessageToTab({ type: 'RESTORE_AFTER_COMPARISON' });
            await sendMessageToTab({ type: 'HIDE_COMPARISON_OVERLAY' });

            console.warn('PaletteLive: comparison failed', error);
        } finally {
            compareToggle.disabled = false;
        }
    }

    async function stopComparison(options) {
        const opts = options || {};
        const clearStatus = opts.clearStatus !== false;

        comparisonActive = false;
        chrome.storage.session.set({ palettelive_compare_active: false });
        await sendMessageToTab({ type: 'HIDE_COMPARISON_OVERLAY' });
        await sendMessageToTab({ type: 'RESTORE_AFTER_COMPARISON' });

        if (clearStatus) {
            setCompareStatus('');
        }
    }

    compareToggle.addEventListener('change', async (event) => {
        if (event.target.checked) {
            await startComparison();
            return;
        }

        await stopComparison({ clearStatus: true });
    });

    const onRuntimeMessage = (message) => {
        if (!message || message.type !== 'PL_COMPARISON_OVERLAY_CLOSED') return;
        comparisonActive = false;
        compareToggle.checked = false;
        chrome.storage.session.set({ palettelive_compare_active: false });
        setCompareStatus('');
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    dropperBtn.addEventListener('click', () => {
        if (!activeTabId) return;

        // Store cluster membership data in session storage so the background
        // script can resolve picked colors to full clusters after popup closes.
        const clusterMap = {};
        currentColors.forEach((color) => {
            const members = Array.isArray(color.clusterMembers)
                ? color.clusterMembers.map((m) => normalizeHex(m)).filter(Boolean)
                : [normalizeHex(color.value)];

            const effectiveValues = {};
            members.forEach((m) => {
                effectiveValues[m] = getEffectiveValueForSource(m);
            });

            const colorInfo = {
                value: color.value,
                clusterSize: color.clusterSize,
                primaryCategory: color.primaryCategory,
                tailwindClass: color.tailwindClass,
                tailwindLabel: color.tailwindLabel,
            };

            const entry = { sources: members, color: colorInfo, effectiveValues };

            members.forEach((memberHex) => {
                // Map original hex
                clusterMap[memberHex] = entry;
                // Map current effective hex (if different)
                const current = effectiveValues[memberHex];
                if (current && current !== memberHex) {
                    clusterMap[current] = entry;
                }
            });
        });
        chrome.storage.session.set({ palettelive_clusterMap: clusterMap }, () => {
            if (chrome.runtime.lastError) {
                // Session storage quota exceeded or other error — non-fatal.
                // The dropper will fall back to single-hex mode gracefully.
                console.warn('PaletteLive: Could not save cluster map to session storage:', chrome.runtime.lastError.message);
            }
        });

        // Close the popup immediately — no need to wait for the content script
        // to echo back success. The message is already in-flight; Chrome
        // will deliver it even after the popup context closes.
        chrome.tabs.sendMessage(activeTabId, { type: 'PICK_COLOR' }, { frameId: 0 }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Dropper error:', chrome.runtime.lastError.message);
            }
        });
        window.close();
    });

    resetBtn.addEventListener('click', async () => {
        if (!activeTabId) return;

        cancelPendingOperations();

        if (comparisonActive || compareToggle.checked) {
            compareToggle.checked = false;
            await stopComparison({ clearStatus: true });
        }

        currentColors = [];
        currentVariables = [];
        overrideState.clear();
        exportSelection.clear();
        historyStack.length = 0;
        redoStack.length = 0;
        exportHistory.length = 0;
        editStartValues.clear();
        _editStartValue = null;
        renderExportHistoryMenu();
        updateUndoButton();
        // Explicitly clear session storage to avoid stale state on reopen
        baselineScreenshot = null;
        chrome.storage.session.remove(['palettelive_historyStack', 'palettelive_redoStack', 'sidePanelColorData', 'palettelive_baselineScreenshot', 'palettelive_heatmap_active', 'palettelive_compare_active']);
        closeEditor();

        heatmapToggle.checked = false;
        compareToggle.checked = false;
        comparisonActive = false;
        // schemeSelect removed — scheme defaults to 'auto'
        visionSelect.value = 'none';

        // Clear apply-palette input & preview
        applyPaletteInput.value = '';
        applyPalettePreview.innerHTML = '';
        applyPaletteBtn.disabled = true;
        setApplyStatus('');

        renderClusterSummary(0, 0, 0);
        setLoadingState(paletteList, 'Resetting and rescanning...');

        try {
            const domain = await getActiveDomain();
            if (domain) {
                await StorageUtils.clearPalette(domain);
            }
        } catch (error) {
            console.warn('PaletteLive: Failed to clear saved palette', error);
        }

        await sendMessageToTab({
            type: 'TOGGLE_HEATMAP',
            payload: { active: false },
        });

        // Helper to send RESET_AND_RESCAN and get response (with 20s timeout)
        const resetAndRescan = () =>
            sendMessageWithTimeout(
                { type: 'RESET_AND_RESCAN', payload: { preserveScheme: false, preserveVision: false } },
                20000
            );

        let result = await resetAndRescan();

        // If failed or empty response, try injecting scripts and retry
        if (!result.ok || !result.response || result.response.success === false) {
            if (!result.ok) {
                try {
                    await injectContentScripts();
                    setLoadingState(paletteList, 'Loading extension...');
                    await waitForContentScriptReady(15, 200);
                    result = await resetAndRescan();
                } catch (e) {
                    // Ignore injection error
                }
            }
        }

        enableOperations();

        if (!result.ok || !result.response) {
            renderClusterSummary(0, 0, 0);
            const timeoutMsg =
                !result.ok && result.error && result.error.includes('Timed out')
                    ? 'Scan timed out — the page may be too complex.'
                    : 'Could not connect to page.';
            setLoadingState(paletteList, timeoutMsg, 'Please refresh and try again.');
            return;
        }

        handlePaletteResponse(result.response);

        // Page is now in its original state (all overrides cleared).
        // Capture the baseline screenshot so Compare can use it directly
        // without having to suspend and restore on every activation.
        await captureBaseline();
    });

    scanBtn.addEventListener('click', async () => {
        if (!activeTabId) return;
        if (scanBtn.disabled) return; // prevent double-click during active rescan

        scanBtn.disabled = true;
        cancelPendingOperations();

        if (comparisonActive || compareToggle.checked) {
            compareToggle.checked = false;
            await stopComparison({ clearStatus: true });
        }

        // Preserve existing overrides and export selection across rescan
        const savedOverrides = new Map(overrideState);
        const savedExportSelection = new Set(exportSelection);

        currentColors = [];
        currentVariables = [];
        // Do NOT clear overrideState — we want to keep changes
        closeEditor();

        renderClusterSummary(0, 0, 0);
        setLoadingState(paletteList, 'Rescanning page colors...');

        // Helper to send RESCAN_ONLY and get response (with 20s timeout)
        const rescanPalette = () => sendMessageWithTimeout({ type: 'RESCAN_ONLY' }, 20000);

        let result = await rescanPalette();

        // If failed or empty response, try injecting scripts and retry
        if (!result.ok || !result.response || result.response.success === false) {
            if (!result.ok) {
                try {
                    await injectContentScripts();
                    setLoadingState(paletteList, 'Loading extension...');
                    await waitForContentScriptReady(15, 200);
                    result = await rescanPalette();
                } catch (e) {
                    // Ignore injection error
                }
            }
        }

        enableOperations();
        scanBtn.disabled = false;

        if (!result.ok || !result.response) {
            renderClusterSummary(0, 0, 0);
            const timeoutMsg =
                !result.ok && result.error && result.error.includes('Timed out')
                    ? 'Scan timed out — the page may be too complex.'
                    : 'Could not connect to page.';
            setLoadingState(paletteList, timeoutMsg, 'Please refresh and try again.');
            return;
        }

        // Restore overrides and export selection
        savedOverrides.forEach((current, source) => {
            overrideState.set(source, current);
        });
        savedExportSelection.forEach((source) => {
            exportSelection.add(source);
        });

        handlePaletteResponse(result.response);
    });

    // Force Reapply: rebuild color map + hard re-apply all overrides
    const _REAPPLY_SVG =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"></path><path d="M2.5 22v-6h6"></path><path d="M2.5 12a10 10 0 0 1 16.4-6.2L21.5 8"></path><path d="M21.5 12a10 10 0 0 1-16.4 6.2L2.5 16"></path></svg>';

    function setReapplyLabel(label) {
        forceReapplyBtn.innerHTML = _REAPPLY_SVG;
        const labelNode = document.createTextNode(' ' + label);
        forceReapplyBtn.appendChild(labelNode);
    }

    forceReapplyBtn.addEventListener('click', () => {
        if (!activeTabId) return;

        forceReapplyBtn.classList.add('busy');
        forceReapplyBtn.textContent = 'Reapplying...';

        chrome.tabs.sendMessage(activeTabId, { type: 'FORCE_REAPPLY' }, { frameId: 0 }, (response) => {
            forceReapplyBtn.classList.remove('busy');

            if (chrome.runtime.lastError || !response || !response.success) {
                setReapplyLabel('Failed');
                setTimeout(() => setReapplyLabel('Reapply'), 2000);
                return;
            }

            const count = response.applied || 0;
            setReapplyLabel('Done (' + count + ')');
            setTimeout(() => setReapplyLabel('Reapply'), 2000);
        });
    });

    // Fix Text: enforce WCAG AA contrast on all page text
    const fixTextBtn = document.getElementById('fix-text-btn');
    const _FIX_TEXT_SVG =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"></path><line x1="12" y1="4" x2="12" y2="20"></line><line x1="8" y1="20" x2="16" y2="20"></line></svg>';

    function setFixTextLabel(label) {
        fixTextBtn.innerHTML = _FIX_TEXT_SVG + ' ' + escapeHtml(label);
    }

    if (fixTextBtn) {
        fixTextBtn.addEventListener('click', () => {
            if (!activeTabId) return;

            fixTextBtn.classList.add('busy');
            setFixTextLabel('Fixing...');

            chrome.tabs.sendMessage(
                activeTabId,
                { type: 'FIX_TEXT_CONTRAST', payload: {} },
                { frameId: 0 },
                (response) => {
                    fixTextBtn.classList.remove('busy');

                    if (chrome.runtime.lastError || !response || !response.success) {
                        setFixTextLabel('Failed');
                        setTimeout(() => setFixTextLabel('Fix Text'), 2000);
                        return;
                    }

                    const count = response.fixed || 0;
                    setFixTextLabel(count > 0 ? 'Fixed ' + count : 'All OK');
                    setTimeout(() => setFixTextLabel('Fix Text'), 2500);
                }
            );
        });
    }

    window.addEventListener('unload', () => {
        clearTimeout(footerNoticeTimer);
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
        clearHighlight();
        sendMessageToTab({ type: 'HIDE_COMPARISON_OVERLAY' });
        sendMessageToTab({ type: 'RESTORE_AFTER_COMPARISON' });
    });

    // ════════════════════════════════════════════════
    //  Extension enable/disable toggle
    // ════════════════════════════════════════════════
    function updatePowerUI(paused) {
        extensionPaused = paused;
        powerToggle.classList.toggle('active', !paused);
        powerToggle.classList.toggle('paused', paused);
        powerToggle.title = paused ? 'Resume PaletteLive on this site' : 'Pause PaletteLive on this site';
        disabledBanner.classList.toggle('hidden', !paused);
        containerEl.classList.toggle('extension-paused', paused);
    }

    async function getActiveDomainForPower() {
        if (!activeTabId) return null;
        try {
            const tab = await chrome.tabs.get(activeTabId);
            if (tab && tab.url) {
                try {
                    return new URL(tab.url).hostname;
                } catch (_) {}
            }
        } catch (_) {}
        return null;
    }

    async function _loadPausedState() {
        const domain = await getActiveDomainForPower();
        if (!domain) return false;
        return new Promise((resolve) => {
            const key = `palettelive_paused_${domain}`;
            chrome.storage.local.get(key, (result) => {
                resolve(!!result[key]);
            });
        });
    }

    async function _savePausedState(paused) {
        const domain = await getActiveDomainForPower();
        if (!domain) return;
        const key = `palettelive_paused_${domain}`;
        if (paused) {
            await chrome.storage.local.set({ [key]: true });
        } else {
            await chrome.storage.local.remove(key);
        }
    }

    powerToggle.addEventListener('click', async () => {
        const newPaused = !extensionPaused;
        updatePowerUI(newPaused);

        if (newPaused) {
            // Pause — tell content script to stop all background work
            await sendMessageToTab({ type: 'PAUSE_EXTENSION' });
            // Update badge
            try {
                await chrome.action.setBadgeText({ text: 'OFF', tabId: activeTabId });
                await chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: activeTabId });
            } catch (_) {}
        } else {
            // Resume — tell content script to restart
            await sendMessageToTab({ type: 'RESUME_EXTENSION' });
            try {
                await chrome.action.setBadgeText({ text: '', tabId: activeTabId });
            } catch (_) {}
            // Re-scan the page
            await requestPalette();
        }
    });

    // Initialize popup
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!tabs[0]) {
            renderClusterSummary(0, 0, 0);
            setLoadingState(paletteList, 'No active tab found.');
            return;
        }

        activeTabId = tabs[0].id;
        activeWindowId = tabs[0].windowId;

        // ── Navigation listener ──────────────────────────────────────
        // When the user navigates to a new URL while the popup is open,
        // show a "page navigated" notice and a Rescan button instead of
        // showing stale data or a confusing error message.
        let _lastSeenUrl = tabs[0].url || '';
        const _navListener = (tabId, changeInfo, updatedTab) => {
            if (tabId !== activeTabId) return;
            // A real navigation: URL changed and new load completed
            if (
                changeInfo.status === 'complete' &&
                updatedTab.url &&
                updatedTab.url !== _lastSeenUrl &&
                !updatedTab.url.startsWith('chrome://') &&
                !updatedTab.url.startsWith('chrome-extension://')
            ) {
                _lastSeenUrl = updatedTab.url;
                // Reset UI but don't auto-rescan — let user trigger it to avoid
                // interfering with the page's own load completion handlers.
                currentColors = [];
                currentVariables = [];
                overrideState.clear();
                baselineScreenshot = null;
                comparisonActive = false;
                heatmapToggle.checked = false;
                compareToggle.checked = false;
                chrome.storage.session.remove(['palettelive_baselineScreenshot', 'palettelive_heatmap_active', 'palettelive_compare_active']);
                renderClusterSummary(0, 0, 0);
                paletteList.textContent = '';
                const navDiv = document.createElement('div');
                navDiv.className = 'loading-state';
                navDiv.appendChild(document.createTextNode('Page navigated.'));
                navDiv.appendChild(document.createElement('br'));
                const navBtn = document.createElement('button');
                navBtn.id = 'nav-rescan-btn';
                navBtn.style.cssText =
                    'margin-top:8px;padding:4px 12px;border-radius:6px;border:none;' +
                    'background:var(--accent,#6366f1);color:#fff;cursor:pointer;font-size:13px;';
                navBtn.textContent = 'Rescan';
                navBtn.addEventListener('click', () => requestPalette());
                navDiv.appendChild(navBtn);
                paletteList.appendChild(navDiv);
            }
        };
        chrome.tabs.onUpdated.addListener(_navListener);
        // Clean up when popup closes
        window.addEventListener(
            'unload',
            () => {
                chrome.tabs.onUpdated.removeListener(_navListener);
            },
            { once: true }
        );
        // ─────────────────────────────────────────────────

        // Wait for the tab and content script to be ready first.
        // Sending messages to a still-loading tab causes the content script
        // to miss the injection window and the page can appear broken.
        try {
            await waitForTabReady(5000);
        } catch (e) {
            renderClusterSummary(0, 0, 0);
            setLoadingState(
                paletteList,
                'Page is taking too long to load.',
                'Please try again once it finishes loading.'
            );
            return;
        }

        // Read real-time paused state from the content script via PING.
        // content.js always starts as paused (off) on every fresh page load/refresh.
        // If the popup is re-opened while the extension is already on (same page
        // session, no refresh), the PING returns paused: false and we show ON.
        const pingResult = await sendMessageWithTimeout({ type: 'PING' }, 3000);
        // Only treat as paused when PING *succeeds* and explicitly says paused:true.
        // If PING fails (content script not yet injected / service-worker cold-start),
        // assume active and let requestPalette()'s injection-retry path take over.
        // Previously a failed PING set isPaused=true and showed "Extension is off",
        // causing the extension to appear turned off on newly loaded pages.
        const isPaused = pingResult.ok ? !!pingResult.response?.paused : false;
        updatePowerUI(isPaused);

        if (isPaused) {
            // Extension is explicitly off — show banner and set badge, but don't scan.
            setLoadingState(paletteList, 'Extension is off on this page.', 'Click the power button to start.');
            try {
                await chrome.action.setBadgeText({ text: 'OFF', tabId: activeTabId });
                await chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: activeTabId });
            } catch (_) {}
            return;
        }

        // Extension is ON — clear any stale OFF badge from a previous session
        try {
            await chrome.action.setBadgeText({ text: '', tabId: activeTabId });
        } catch (_) {}

        updateClusterControls();
        updatePaletteModeUI();
        setCompareStatus('');

        await hydrateDomainState();

        // Restore the baseline screenshot from session storage (persists while the
        // browser session is active, survives popup close/reopen but not page refresh).
        try {
            const sessionData = await chrome.storage.session.get([
                'palettelive_baselineScreenshot',
                'palettelive_heatmap_active',
                'palettelive_compare_active',
            ]);
            if (sessionData && sessionData.palettelive_baselineScreenshot) {
                baselineScreenshot = sessionData.palettelive_baselineScreenshot;
            }
            // Restore toggle states — the content script still has the overlay/
            // heatmap active from before the popup was closed.
            if (sessionData && sessionData.palettelive_heatmap_active === true) {
                heatmapToggle.checked = true;
            }
            if (sessionData && sessionData.palettelive_compare_active === true) {
                compareToggle.checked = true;
                comparisonActive = true;
            }
        } catch (e) {
            // Non-fatal — compare will fall back to suspend/restore
        }

        // Cancel any stale dropper session leftover from a previous Pick interaction
        // (e.g. user clicked Pick, popup closed, then reopened before picking anything).
        // Fire-and-forget with a short timeout — no need to block or check the result.
        sendMessageWithTimeout({ type: 'CANCEL_PICK' }, 2000);

        await requestPalette();

        await sendMessageToTab({
            type: 'SET_COLOR_SCHEME',
            payload: { mode: 'auto' },
        });
        await sendMessageToTab({
            type: 'SET_VISION_MODE',
            payload: { mode: visionSelect.value },
        });
    });
});
