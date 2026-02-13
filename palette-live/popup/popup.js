/**
 * PaletteLive - Popup Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    const paletteList = document.getElementById('palette-list');
    const editorPanel = document.getElementById('editor-panel');
    const colorPicker = document.getElementById('color-picker');
    const selectedColorLabel = document.getElementById('selected-color-label');
    const resetBtn = document.getElementById('reset-btn');
    const scanBtn = document.getElementById('scan-btn');
    const exportBtn = document.getElementById('export-btn');
    const heatmapToggle = document.getElementById('heatmap-toggle');
    const exportMenu = document.getElementById('export-menu');

    let currentColors = [];
    let currentVariables = [];
    let activeTabId = null;
    let selectedColor = null;
    let activeSwatch = null; // Currently selected swatch DOM element
    let _debounceTimer = null;

    /** Debounce helper — delays fn execution until pause in calls */
    function debounce(fn, delay) {
        return (...args) => {
            clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(() => fn(...args), delay);
        };
    }

    // Initialize
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            activeTabId = tabs[0].id;
            requestPalette();
        }
    });

    function requestPalette() {
        if (!activeTabId) {
            paletteList.innerHTML = '<div class="loading-state">No active tab found.</div>';
            return;
        }
        paletteList.innerHTML = '<div class="loading-state">Scanning page colors...</div>';
        chrome.tabs.sendMessage(activeTabId, { type: 'EXTRACT_PALETTE' }, (response) => {
            if (chrome.runtime.lastError) {
                // Content script not loaded — inject it programmatically
                console.log('Content script not found, injecting...');
                injectContentScripts().then(() => {
                    // Wait a moment for scripts to initialize, then retry
                    setTimeout(() => {
                        chrome.tabs.sendMessage(activeTabId, { type: 'EXTRACT_PALETTE' }, (retryResponse) => {
                            if (chrome.runtime.lastError) {
                                paletteList.innerHTML = '<div class="loading-state">Could not connect to page.<br>Please refresh the page and try again.</div>';
                                return;
                            }
                            handlePaletteResponse(retryResponse);
                        });
                    }, 300);
                }).catch(() => {
                    paletteList.innerHTML = '<div class="loading-state">Cannot scan this page.<br>Extensions can\'t run on browser internal pages.</div>';
                });
                return;
            }
            handlePaletteResponse(response);
        });
    }

    function handlePaletteResponse(response) {
        if (response && response.success === false) {
            paletteList.innerHTML = `<div class="loading-state">${response.error || 'Extraction failed.'}.<br>Try refreshing the page.</div>`;
            return;
        }
        if (response && response.data) {
            currentColors = response.data.colors || [];
            currentVariables = response.data.variables || [];
            renderPalette(currentColors);
        } else {
            paletteList.innerHTML = '<div class="loading-state">No data received. Try refreshing.</div>';
        }
    }

    async function injectContentScripts() {
        const scripts = [
            'utils/colorUtils.js',
            'utils/contrast.js',
            'utils/storage.js',
            'content/shadowWalker.js',
            'content/extractor.js',
            'content/injector.js',
            'content/heatmap.js',
            'content/content.js'
        ];
        await chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            files: scripts
        });
    }

    function renderPalette(colors) {
        paletteList.innerHTML = '';
        if (!colors || colors.length === 0) {
            paletteList.innerHTML = '<div class="loading-state">No colors found.</div>';
            return;
        }

        colors.forEach(color => {
            const swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.style.backgroundColor = color.value;
            swatch.title = `${color.value} (${color.count} uses)`;
            swatch.dataset.value = color.value;

            swatch.addEventListener('click', () => openEditor(color, swatch));
            paletteList.appendChild(swatch);
        });
    }

    function openEditor(color, swatchEl) {
        selectedColor = color;
        activeSwatch = swatchEl || null;
        editorPanel.classList.remove('editor-hidden');

        // colorPicker only accepts 6-digit hex (#RRGGBB), ensure we conform
        let hexValue = color.value;
        if (hexValue && hexValue.startsWith('#')) {
            hexValue = hexValue.substring(0, 7); // truncate alpha if present
        }
        // Ensure it's a valid 7-char hex for the picker
        if (!/^#[0-9A-Fa-f]{6}$/.test(hexValue)) {
            hexValue = '#000000';
        }
        colorPicker.value = hexValue;
        selectedColorLabel.textContent = color.value;
        updateContrast(hexValue);
    }

    function closeEditor() {
        editorPanel.classList.add('editor-hidden');
        selectedColor = null;
        activeSwatch = null;
    }

    document.getElementById('close-editor').addEventListener('click', closeEditor);

    /** Send override to content script and persist (debounced internals) */
    const sendOverride = debounce((newValue) => {
        if (!selectedColor || !activeTabId) return;

        // Find if this color is mapped to a variable
        const variable = currentVariables.find(v => {
            const varHex = ColorUtils.rgbToHex(v.value).toLowerCase();
            const selHex = selectedColor.value.toLowerCase();
            return varHex === selHex || v.value.toLowerCase() === selHex;
        });

        const payload = {};

        // Always send raw override so literal-color elements get updated
        payload.raw = {
            original: selectedColor.value,
            current: newValue
        };

        // Also update CSS variable if one matches (covers elements using the variable)
        if (variable) {
            payload.variables = { [variable.name]: newValue };
        }

        // Send override to content script
        chrome.tabs.sendMessage(activeTabId, {
            type: 'APPLY_OVERRIDE',
            payload: payload
        }).catch(() => console.warn('Could not reach content script for APPLY_OVERRIDE'));

        // Save to storage
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (!tabs[0] || !tabs[0].url) return;
                const domain = new URL(tabs[0].url).hostname;
                StorageUtils.getPalette(domain).then(data => {
                    const newData = data || { overrides: { variables: {} } };
                    if (!newData.overrides) newData.overrides = {};
                    if (!newData.overrides.variables) newData.overrides.variables = {};

                    // Always save raw override
                    if (!newData.overrides.raw) newData.overrides.raw = {};
                    newData.overrides.raw[selectedColor.value.toLowerCase()] = newValue;

                    // Also save variable override if matched
                    if (variable) {
                        newData.overrides.variables[variable.name] = newValue;
                    }
                    newData.timestamp = new Date().toISOString();
                    StorageUtils.savePalette(domain, newData);
                }).catch(err => console.warn('Storage save error:', err));
            });
        } catch (err) {
            console.warn('Error saving palette:', err);
        }
    }, 60);

    colorPicker.addEventListener('input', (e) => {
        const newValue = e.target.value;
        selectedColorLabel.textContent = newValue;
        updateContrast(newValue);

        // Update the active swatch visually so the grid reflects the change
        if (activeSwatch) {
            activeSwatch.style.backgroundColor = newValue;
            activeSwatch.title = `${newValue} (edited)`;
        }

        sendOverride(newValue);
    });

    function updateContrast(color) {
        try {
            const whiteRatio = ContrastUtils.getRatio(color, '#FFFFFF');
            const blackRatio = ContrastUtils.getRatio(color, '#000000');
            const ratioEl = document.getElementById('contrast-ratio');
            const ratingEl = document.getElementById('contrast-rating');
            const contextEl = document.querySelector('.contrast-context');

            // Show the more relevant ratio (against whichever gives a meaningful contrast)
            const useWhite = whiteRatio > blackRatio;
            const ratio = useWhite ? whiteRatio : blackRatio;
            const against = useWhite ? 'white' : 'black';

            ratioEl.textContent = ratio.toFixed(2) + ':1';
            const rating = ContrastUtils.getRating(ratio);
            ratingEl.textContent = rating;
            contextEl.textContent = `Against ${against}`;

            // Color code the badge
            if (rating === 'AAA') {
                ratingEl.style.backgroundColor = '#22c55e';
            } else if (rating === 'AA') {
                ratingEl.style.backgroundColor = '#3b82f6';
            } else if (rating === 'AA Large') {
                ratingEl.style.backgroundColor = '#f59e0b';
            } else {
                ratingEl.style.backgroundColor = '#ef4444';
            }
            ratingEl.style.color = '#fff';
        } catch (err) {
            console.warn('Contrast calculation error:', err);
        }
    }

    resetBtn.addEventListener('click', () => {
        if (!activeTabId) return;
        chrome.tabs.sendMessage(activeTabId, { type: 'RESET_STYLES' })
            .catch(() => console.warn('Could not reach content script for RESET_STYLES'));
        closeEditor();
        // Clear storage
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (!tabs[0] || !tabs[0].url) return;
                const domain = new URL(tabs[0].url).hostname;
                StorageUtils.clearPalette(domain).catch(err => console.warn('Error clearing palette:', err));
            });
        } catch (err) {
            console.warn('Error clearing palette:', err);
        }
    });

    scanBtn.addEventListener('click', requestPalette);

    exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle('show');
    });

    // Close export menu on outside click
    document.addEventListener('click', (e) => {
        if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) {
            exportMenu.classList.remove('show');
        }
    });

    exportMenu.addEventListener('click', (e) => {
        const format = e.target.dataset.format;
        if (!format) return;

        let output = '';
        // Merge variables + colors: prefer variables, then append remaining colors
        const varHexes = new Set(currentVariables.map(v => ColorUtils.rgbToHex(v.value).toLowerCase()));
        const extraColors = currentColors.filter(c => !varHexes.has(c.value.toLowerCase()));
        const dataToExport = [...currentVariables, ...extraColors];

        if (format === 'css') output = ExporterUtils.toCSS(dataToExport);
        else if (format === 'json') output = ExporterUtils.toJSON(dataToExport);
        else if (format === 'tailwind') output = ExporterUtils.toTailwind(dataToExport);

        navigator.clipboard.writeText(output).then(() => {
            const originalText = e.target.textContent;
            e.target.textContent = 'Copied!';
            setTimeout(() => e.target.textContent = originalText, 1500);
        }).catch(err => {
            console.warn('Clipboard write error:', err);
        });

        exportMenu.classList.remove('show');
    });

    heatmapToggle.addEventListener('change', (e) => {
        if (!activeTabId) return;
        chrome.tabs.sendMessage(activeTabId, {
            type: 'TOGGLE_HEATMAP',
            payload: { active: e.target.checked }
        }).catch(() => console.warn('Could not reach content script for TOGGLE_HEATMAP'));
    });
});
