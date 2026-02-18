/**
 * PaletteLive - Side Panel Logic
 * Handles color editing in the Chrome side panel.
 * Communicates with the popup via chrome.runtime messages.
 */

document.addEventListener('DOMContentLoaded', () => {
    const waitingState = document.getElementById('waiting-state');
    const editorContent = document.getElementById('editor-content');
    const colorPicker = document.getElementById('color-picker');
    const selectedColorLabel = document.getElementById('selected-color-label');
    const variableInfo = document.getElementById('variable-info');
    const exportSelectToggle = document.getElementById('export-select-toggle');
    const realtimeToggle = document.getElementById('realtime-toggle');
    const batchApplyBtn = document.getElementById('batch-apply-btn');

    const wcagRows = {
        aaNormal: document.getElementById('wcag-aa-normal'),
        aaaNormal: document.getElementById('wcag-aaa-normal'),
        aaLarge: document.getElementById('wcag-aa-large'),
        aaaLarge: document.getElementById('wcag-aaa-large')
    };

    // --- State ---
    let selectedSources = [];
    let selectedSource = null;
    let selectedColor = null;
    let editStartValue = null;
    const editStartValues = new Map();

    // --- Utility functions ---
    function sanitizePickerHex(hex) {
        if (!hex || typeof hex !== 'string') return '#000000';
        hex = hex.trim();
        if (!hex.startsWith('#')) hex = '#' + hex;
        hex = hex.replace(/[^#0-9a-fA-F]/g, '');
        if (hex.length === 4) {
            hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        if (hex.length !== 7) return '#000000';
        return hex.toLowerCase();
    }

    function normalizeHex(hex) {
        if (!hex || typeof hex !== 'string') return null;
        hex = hex.trim().toLowerCase();
        if (!hex.startsWith('#')) hex = '#' + hex;
        hex = hex.replace(/[^#0-9a-f]/g, '');
        if (hex.length === 4) {
            hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        return hex.length === 7 ? hex : null;
    }

    function setWcagRow(el, label, pass) {
        if (!el) return;
        el.textContent = `${label}: ${pass ? 'Pass' : 'Fail'}`;
        el.className = `wcag-row ${pass ? 'pass' : 'fail'}`;
    }

    function updateContrast(hex, category) {
        try {
            const contrastEl = document.getElementById('contrast-ratio');
            const ratingEl = document.getElementById('contrast-rating');
            const contextEl = document.querySelector('.contrast-context');

            if (!contrastEl || !ratingEl) return;

            // Determine background to check against
            let bgHex = '#ffffff';
            if (category === 'text' || category === 'border') {
                bgHex = '#ffffff';
            }

            // Use contrast utility if available
            let ratio = 1;
            if (typeof window.getContrastRatio === 'function') {
                ratio = window.getContrastRatio(hex, bgHex);
            } else {
                // Fallback: simple luminance calc
                const hexToRgb = (h) => {
                    const r = parseInt(h.slice(1, 3), 16) / 255;
                    const g = parseInt(h.slice(3, 5), 16) / 255;
                    const b = parseInt(h.slice(5, 7), 16) / 255;
                    const toLinear = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
                    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
                };
                const l1 = hexToRgb(hex);
                const l2 = hexToRgb(bgHex);
                ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            }

            contrastEl.textContent = `${ratio.toFixed(2)}:1`;

            // Determine rating
            let rating = 'Fail';
            if (ratio >= 7) rating = 'AAA';
            else if (ratio >= 4.5) rating = 'AA';
            else if (ratio >= 3) rating = 'AA Large';

            ratingEl.textContent = rating;

            if (rating === 'AAA') {
                ratingEl.style.backgroundColor = '#22c55e';
            } else if (rating === 'AA') {
                ratingEl.style.backgroundColor = '#3b82f6';
            } else if (rating === 'AA Large') {
                ratingEl.style.backgroundColor = '#f59e0b';
            } else {
                ratingEl.style.backgroundColor = '#ef4444';
            }
            ratingEl.style.color = '#ffffff';

            if (contextEl) {
                contextEl.textContent = `Against worst of black/white (${bgHex})`;
            }

            setWcagRow(wcagRows.aaNormal, 'AA normal', ratio >= 4.5);
            setWcagRow(wcagRows.aaaNormal, 'AAA normal', ratio >= 7);
            setWcagRow(wcagRows.aaLarge, 'AA large', ratio >= 3);
            setWcagRow(wcagRows.aaaLarge, 'AAA large', ratio >= 4.5);
        } catch (error) {
            console.warn('Contrast calculation error:', error);
        }
    }

    function updateSelectedLabel(hex) {
        const base = sanitizePickerHex(hex);
        if (selectedColor && selectedColor.clusterSize && selectedColor.clusterSize > 1) {
            selectedColorLabel.textContent = `${base} (${selectedColor.clusterSize} merged)`;
            return;
        }
        selectedColorLabel.textContent = base;
    }

    function updateVariableInfoUI(data) {
        if (!data || !data.length) {
            variableInfo.classList.add('hidden');
            variableInfo.textContent = '';
            return;
        }
        variableInfo.classList.remove('hidden');
        variableInfo.innerHTML = data
            .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            .join('<br>');
    }

    function showEditor(payload) {
        waitingState.style.display = 'none';
        editorContent.classList.remove('hidden');

        selectedColor = payload.color || null;
        selectedSources = payload.sources || [];
        selectedSource = selectedSources[0] || null;

        const hex = sanitizePickerHex(payload.currentHex || (selectedColor && selectedColor.value) || '#000000');

        colorPicker.value = hex;
        updateSelectedLabel(hex);
        editStartValue = normalizeHex(hex);
        editStartValues.clear();
        selectedSources.forEach(source => {
            editStartValues.set(source, payload.effectiveValues?.[source] || source);
        });

        exportSelectToggle.checked = !!payload.exportChecked;
        updateVariableInfoUI(payload.variableLines || []);
        updateContrast(hex, selectedColor ? selectedColor.primaryCategory : null);
    }

    // --- RAF-throttle: fires at most once per animation frame (~16ms at 60Hz) ---
    function rafThrottle(fn) {
        let queued = false;
        let latestArgs = null;
        return (...args) => {
            latestArgs = args;
            if (!queued) {
                queued = true;
                requestAnimationFrame(() => {
                    queued = false;
                    fn(...latestArgs);
                });
            }
        };
    }

    // --- Color picker change → tell popup to apply override ---
    const throttledNotifyPopup = rafThrottle((newValue) => {
        chrome.runtime.sendMessage({
            type: 'SIDEPANEL_COLOR_CHANGED',
            payload: {
                newValue,
                sources: [...selectedSources],
                fast: true   // signal popup to use the fast path
            }
        }).catch(() => { });
    });

    colorPicker.addEventListener('input', (event) => {
        if (!selectedSources.length) return;
        const newValue = sanitizePickerHex(event.target.value);
        updateSelectedLabel(newValue);
        updateContrast(newValue, selectedColor ? selectedColor.primaryCategory : null);

        if (realtimeToggle.checked) {
            throttledNotifyPopup(newValue);
        }
        // If real-time is off, only the local UI updates (picker + label + contrast)
    });

    colorPicker.addEventListener('change', () => {
        if (!selectedSources.length) return;
        const finalValue = normalizeHex(colorPicker.value);

        // If real-time was off, this is the first time the page gets updated
        if (!realtimeToggle.checked) {
            chrome.runtime.sendMessage({
                type: 'SIDEPANEL_COLOR_CHANGED',
                payload: {
                    newValue: finalValue,
                    sources: [...selectedSources],
                    fast: false   // full override path
                }
            }).catch(() => { });
        }

        // Always commit for history + full fallback CSS
        chrome.runtime.sendMessage({
            type: 'SIDEPANEL_COLOR_COMMITTED',
            payload: {
                finalValue,
                sources: [...selectedSources],
                startValues: Object.fromEntries(editStartValues)
            }
        }).catch(() => { });
        // Update start values
        selectedSources.forEach(source => {
            editStartValues.set(source, finalValue);
        });
        editStartValue = finalValue;
    });

    // --- Export toggle ---
    exportSelectToggle.addEventListener('change', () => {
        if (!selectedSources.length) return;
        chrome.runtime.sendMessage({
            type: 'SIDEPANEL_EXPORT_TOGGLED',
            payload: {
                checked: exportSelectToggle.checked,
                sources: [...selectedSources]
            }
        }).catch(() => { });
    });

    // --- Batch apply ---
    if (batchApplyBtn) {
        batchApplyBtn.addEventListener('click', () => {
            if (!selectedSources.length) return;
            const targetHex = sanitizePickerHex(colorPicker.value);
            chrome.runtime.sendMessage({
                type: 'SIDEPANEL_BATCH_APPLY',
                payload: {
                    targetHex,
                    sources: [...selectedSources]
                }
            }).catch(() => { });
        });
    }

    // --- Listen for messages from popup/background ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !message.type) return;

        if (message.type === 'SIDEPANEL_LOAD_COLOR') {
            showEditor(message.payload);
            sendResponse({ ok: true });
        }

        if (message.type === 'SIDEPANEL_UPDATE_EXPORT') {
            exportSelectToggle.checked = !!message.payload.checked;
        }

        if (message.type === 'SIDEPANEL_UPDATE_COLOR') {
            const hex = sanitizePickerHex(message.payload.hex);
            colorPicker.value = hex;
            updateSelectedLabel(hex);
            updateContrast(hex, selectedColor ? selectedColor.primaryCategory : null);
        }
    });

    // --- Read initial data from session storage (popup stores data here before opening side panel) ---
    chrome.storage.session.get('sidePanelColorData', (result) => {
        if (result && result.sidePanelColorData) {
            showEditor(result.sidePanelColorData);
        }
    });

    // --- Also listen for storage changes (when popup updates color data) ---
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'session' && changes.sidePanelColorData && changes.sidePanelColorData.newValue) {
            showEditor(changes.sidePanelColorData.newValue);
        }
    });
});
