/**
 * PaletteLive - Heatmap Window
 * Displays color frequency analysis with visual charts and detailed list.
 *
 * Data source: The popup already walks the DOM via Extractor.scan() which
 * returns per-color frequency counts and categories. That data is passed
 * here via chrome.storage.session — no extra DOM walk is needed.
 * The "Refresh" button triggers EXTRACT_PALETTE on the target tab and
 * transforms the response into the same format.
 */

let colorData = [];
let currentTabId = null;
let chartCanvas = null;
let chartCtx = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    chartCanvas = document.getElementById('frequency-chart');
    chartCtx = chartCanvas.getContext('2d');

    // Get target tab ID + pre-built data from session storage (set by popup)
    try {
        const session = await chrome.storage.session.get([
            'palettelive_heatmapTabId',
            'palettelive_heatmapData',
        ]);
        if (session.palettelive_heatmapTabId) {
            currentTabId = session.palettelive_heatmapTabId;
        }
        if (session.palettelive_heatmapData && session.palettelive_heatmapData.length) {
            colorData = session.palettelive_heatmapData;
        }
    } catch (e) {
        console.warn('Failed to read session:', e);
    }

    // Fallback: find the last focused normal window's active tab
    if (!currentTabId) {
        try {
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
            if (tabs && tabs[0]) currentTabId = tabs[0].id;
        } catch (e) {
            console.warn('Failed to query active tab:', e);
        }
    }

    // If we already have data from session, render immediately; otherwise fetch
    if (colorData.length) {
        renderAll();
    } else {
        await refreshData();
    }

    // Event listeners
    document.getElementById('refresh-btn').addEventListener('click', refreshData);
    document.getElementById('retry-btn').addEventListener('click', refreshData);
    document.getElementById('sort-select').addEventListener('change', renderColorList);
    document.getElementById('filter-input').addEventListener('input', renderColorList);
});

/**
 * Request a fresh palette scan from the content script via EXTRACT_PALETTE,
 * then transform the Extractor result into heatmap format.
 */
async function refreshData() {
    if (!currentTabId) {
        showError('No active tab found');
        return;
    }

    showLoading();

    try {
        const response = await chrome.tabs.sendMessage(
            currentTabId,
            { type: 'EXTRACT_PALETTE', payload: { forceRescan: true } },
            { frameId: 0 }
        );

        if (!response || response.success === false) {
            throw new Error(response?.error || 'Scan failed');
        }

        const rawColors = (response.data && response.data.colors) || response.colors || [];

        // Transform Extractor format → heatmap format
        colorData = rawColors.map((c) => ({
            hex: c.value,
            frequency: c.count || 1,
            usage: c.categories || [c.primaryCategory || 'unknown'],
            name: c.value, // Will be enriched by ColorNames loaded via script tag
        }));

        // Sort by frequency desc
        colorData.sort((a, b) => b.frequency - a.frequency);

        // Enrich names if ColorNames is available
        if (typeof ColorNames !== 'undefined' && ColorNames.getName) {
            colorData.forEach((item) => {
                try {
                    item.name = ColorNames.getName(item.hex);
                } catch (e) { /* keep hex as name */ }
            });
        }

        // Persist to session for quick window re-focus
        await chrome.storage.session.set({ palettelive_heatmapData: colorData });

        renderAll();
    } catch (error) {
        console.error('Heatmap refresh failed:', error);
        showError('Failed to load data: ' + error.message);
    }
}

/**
 * Render all UI components
 */
function renderAll() {
    hideLoading();
    hideError();
    renderStats();
    renderChart();
    renderColorList();
}

/**
 * Render statistics cards
 */
function renderStats() {
    const totalColors = colorData.length;
    const totalElements = colorData.reduce((sum, item) => sum + item.frequency, 0);
    const mostUsed = colorData.length > 0 ? colorData[0] : null;

    document.getElementById('total-colors').textContent = totalColors;
    document.getElementById('total-elements').textContent = totalElements;

    if (mostUsed) {
        const preview = document.querySelector('.most-used .color-preview');
        const hex = document.querySelector('.most-used .color-hex');
        preview.style.backgroundColor = mostUsed.hex;
        hex.textContent = mostUsed.hex;
    }
}

/**
 * Render frequency bar chart on Canvas
 */
function renderChart() {
    if (!chartCtx || colorData.length === 0) return;

    const topColors = colorData.slice(0, 20);
    const maxFreq = Math.max(...topColors.map((c) => c.frequency));

    const containerWidth = chartCanvas.parentElement.offsetWidth - 40; // padding
    const chartHeight = 240;
    const dpr = window.devicePixelRatio || 1;

    chartCanvas.width = containerWidth * dpr;
    chartCanvas.height = chartHeight * dpr;
    chartCanvas.style.width = containerWidth + 'px';
    chartCanvas.style.height = chartHeight + 'px';
    chartCtx.scale(dpr, dpr);

    const gap = 4;
    const barWidth = Math.max(8, Math.floor((containerWidth - gap * topColors.length) / topColors.length));
    const barAreaHeight = chartHeight - 40;

    chartCtx.clearRect(0, 0, containerWidth, chartHeight);

    topColors.forEach((colorItem, index) => {
        const barHeight = Math.max(2, (colorItem.frequency / maxFreq) * barAreaHeight);
        const x = index * (barWidth + gap) + gap;
        const y = chartHeight - barHeight - 20;

        // Bar
        chartCtx.fillStyle = colorItem.hex;
        chartCtx.fillRect(x, y, barWidth, barHeight);

        // Frequency label
        chartCtx.fillStyle = '#eaeaea';
        chartCtx.font = '11px sans-serif';
        chartCtx.textAlign = 'center';
        chartCtx.fillText(colorItem.frequency.toString(), x + barWidth / 2, y - 4);

        // Hex label (rotated)
        chartCtx.save();
        chartCtx.translate(x + barWidth / 2, chartHeight - 4);
        chartCtx.rotate(-Math.PI / 4);
        chartCtx.fillStyle = '#9ca3af';
        chartCtx.font = '9px monospace';
        chartCtx.textAlign = 'right';
        chartCtx.fillText(colorItem.hex, 0, 0);
        chartCtx.restore();
    });
}

/**
 * Render color list with sorting and filtering
 */
function renderColorList() {
    const container = document.getElementById('color-list');
    const sortBy = document.getElementById('sort-select').value;
    const filterText = document.getElementById('filter-input').value.toLowerCase();

    // Filter
    let filtered = colorData.filter((item) => {
        if (!filterText) return true;
        const hexMatch = item.hex.toLowerCase().includes(filterText);
        const nameMatch = item.name?.toLowerCase().includes(filterText);
        const usageMatch = item.usage?.some((u) => u.toLowerCase().includes(filterText));
        return hexMatch || nameMatch || usageMatch;
    });

    // Sort
    if (sortBy === 'frequency-asc') {
        filtered = [...filtered].reverse();
    } else if (sortBy === 'color') {
        filtered = [...filtered].sort((a, b) => hexToHue(a.hex) - hexToHue(b.hex));
    }
    // 'frequency' is the default order (desc), already sorted

    // Build DOM
    container.innerHTML = '';
    const maxFreq = colorData.length > 0 ? colorData[0].frequency : 1;

    filtered.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'color-item';

        const barWidth = (item.frequency / maxFreq) * 100;
        const usageText = Array.isArray(item.usage) ? item.usage.join(' \u2022 ') : '';

        const swatch = document.createElement('div');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = item.hex;

        const hexEl = document.createElement('div');
        hexEl.className = 'hex';
        hexEl.textContent = item.hex;

        const details = document.createElement('div');
        details.className = 'details';
        const nameEl = document.createElement('div');
        nameEl.className = 'name';
        nameEl.textContent = item.name || 'Unnamed';
        const usageEl = document.createElement('div');
        usageEl.className = 'usage';
        usageEl.textContent = usageText;
        details.appendChild(nameEl);
        details.appendChild(usageEl);

        const freq = document.createElement('div');
        freq.className = 'frequency';
        freq.innerHTML =
            '<span class="count">' + item.frequency + '</span>' +
            '<div class="bar-container"><div class="bar" style="width:' + barWidth + '%;"></div></div>';

        div.appendChild(swatch);
        div.appendChild(hexEl);
        div.appendChild(details);
        div.appendChild(freq);
        container.appendChild(div);
    });
}

/**
 * Convert hex to hue (0-360)
 */
function hexToHue(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    if (delta === 0) return 0;

    let hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;

    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
    return hue;
}

function showLoading() {
    document.getElementById('loading').classList.add('active');
    hideError();
}

function hideLoading() {
    document.getElementById('loading').classList.remove('active');
}

function showError(message) {
    document.getElementById('error-message').textContent = message;
    document.getElementById('error').classList.add('active');
    hideLoading();
}

function hideError() {
    document.getElementById('error').classList.remove('active');
}
