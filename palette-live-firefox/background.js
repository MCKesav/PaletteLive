/**
 * PaletteLive - Background Script (Firefox)
 * Handles message relay between popup/editor window and content scripts.
 * Note: Firefox MV3 loads background scripts via manifest "scripts" array,
 * so importScripts() is not used here.
 */

chrome.runtime.onInstalled.addListener(() => {
    console.log('PaletteLive extension installed.');
});

// Helper to get domain from URL
function getDomainFromUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        return u.hostname;
    } catch (e) {
        return null;
    }
}

// Message relay between popup, editor window, and content scripts
// Persisted via chrome.storage.session to survive service worker restarts.
let activeEditorWindowId = null;
let activeHeatmapWindowId = null;

// Restore state on service worker wake-up
chrome.storage.session.get(['activeEditorWindowId', 'activeHeatmapWindowId'], (result) => {
    if (result && result.activeEditorWindowId != null) {
        // Verify the window still exists before trusting the stored value
        chrome.windows.get(result.activeEditorWindowId, (win) => {
            if (!chrome.runtime.lastError && win) {
                // Only restore if _persistEditorWindowId hasn't set a newer value
                if (activeEditorWindowId == null || activeEditorWindowId === result.activeEditorWindowId) {
                    activeEditorWindowId = result.activeEditorWindowId;
                }
            } else {
                chrome.storage.session.remove('activeEditorWindowId');
            }
        });
    }
    if (result && result.activeHeatmapWindowId != null) {
        chrome.windows.get(result.activeHeatmapWindowId, (win) => {
            if (!chrome.runtime.lastError && win) {
                if (activeHeatmapWindowId == null || activeHeatmapWindowId === result.activeHeatmapWindowId) {
                    activeHeatmapWindowId = result.activeHeatmapWindowId;
                }
            } else {
                chrome.storage.session.remove('activeHeatmapWindowId');
            }
        });
    }
});

function _persistEditorWindowId(id) {
    activeEditorWindowId = id;
    if (id != null) {
        chrome.storage.session.set({ activeEditorWindowId: id });
    } else {
        chrome.storage.session.remove('activeEditorWindowId');
    }
}

function _persistHeatmapWindowId(id) {
    activeHeatmapWindowId = id;
    if (id != null) {
        chrome.storage.session.set({ activeHeatmapWindowId: id });
    } else {
        chrome.storage.session.remove('activeHeatmapWindowId');
    }
}

function createEditorWindow() {
    chrome.windows.create(
        {
            url: 'sidepanel/sidepanel.html',
            type: 'popup',
            width: 340,
            height: 600,
            focused: true,
        },
        (window) => {
            if (window) {
                _persistEditorWindowId(window.id);
            }
        }
    );
}

function createHeatmapWindow() {
    chrome.windows.create(
        {
            url: chrome.runtime.getURL('heatmap/heatmap.html'),
            type: 'popup',
            width: 700,
            height: 700,
            focused: true,
        },
        (win) => {
            if (chrome.runtime.lastError) {
                console.error('PaletteLive: Failed to create heatmap window', chrome.runtime.lastError);
                return;
            }
            if (win) {
                _persistHeatmapWindowId(win.id);
            }
        }
    );
}

// Track window closure
chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === activeEditorWindowId) {
        _persistEditorWindowId(null);
    }
    if (windowId === activeHeatmapWindowId) {
        _persistHeatmapWindowId(null);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    // Editor window is opened via chrome.windows.create() from popup.js or dropper.js
    // Color data is passed via chrome.storage.session
    if (message.type === 'OPEN_EDITOR_WINDOW') {
        const payload = message.payload || {};

        // Ensure tabId is present so the side panel knows which tab to target.
        // If opened from dropper.js, sender.tab will be available.
        if (!payload.tabId && sender && sender.tab && sender.tab.id) {
            payload.tabId = sender.tab.id;
        }

        // Store data first so the new window can read it on load
        chrome.storage.session.set({ sidePanelColorData: payload }, () => {
            // Check if window already exists
            if (activeEditorWindowId !== null) {
                chrome.windows.get(activeEditorWindowId, (win) => {
                    if (chrome.runtime.lastError || !win) {
                        createEditorWindow();
                    } else {
                        chrome.windows.update(activeEditorWindowId, { focused: true });
                    }
                });
            } else {
                createEditorWindow();
            }
        });
        return true;
    }

    // Heatmap window is opened from popup.js
    // Palette data is passed via session storage — no extra DOM walk needed
    if (message.type === 'OPEN_HEATMAP_WINDOW') {
        const payload = message.payload || {};

        // Store palette data + tab ID so the heatmap window can read it
        const sessionData = {};
        if (payload.tabId) sessionData.palettelive_heatmapTabId = payload.tabId;
        if (payload.colors) sessionData.palettelive_heatmapData = payload.colors;

        chrome.storage.session.set(sessionData, () => {
            if (chrome.runtime.lastError) {
                console.error('PaletteLive: session.set failed', chrome.runtime.lastError);
            }
            // Check if window already exists
            if (activeHeatmapWindowId !== null) {
                chrome.windows.get(activeHeatmapWindowId, (win) => {
                    if (chrome.runtime.lastError || !win) {
                        createHeatmapWindow();
                    } else {
                        chrome.windows.update(activeHeatmapWindowId, { focused: true });
                    }
                });
            } else {
                createHeatmapWindow();
            }
        });
        return true;
    }

    // Dropper requests cluster resolution for a picked color.
    // The popup stores palettelive_clusterMap in session storage before closing.
    if (message.type === 'DROPPER_RESOLVE_CLUSTER') {
        const pickedHex = (message.payload?.hex || '').toLowerCase();
        if (!pickedHex) {
            sendResponse({ sources: [], color: null });
            return true;
        }
        chrome.storage.session.get('palettelive_clusterMap', (result) => {
            const clusterMap = result?.palettelive_clusterMap || {};
            const match = clusterMap[pickedHex];
            if (match && match.sources && match.sources.length > 0) {
                sendResponse({
                    sources: match.sources,
                    color: match.color,
                    effectiveValues: match.effectiveValues || {},
                });
            } else {
                sendResponse({
                    sources: [pickedHex],
                    color: { value: pickedHex },
                    effectiveValues: {},
                });
            }
        });
        return true; // async sendResponse
    }

    // Side panel sends color change back - relay to the popup AND content script
    if (message.type === 'SIDEPANEL_COLOR_CHANGED') {
        const { newValue, sources, fast, tabId } = message.payload;
        if (!sources || !sources.length) return false;

        const sendPayload = (targetTabId) => {
            if (fast) {
                sources.forEach((source) => {
                    chrome.tabs.sendMessage(
                        targetTabId,
                        {
                            type: 'APPLY_OVERRIDE_FAST',
                            payload: {
                                original: source,
                                current: newValue,
                                raw: { original: source, current: newValue },
                            },
                        },
                        { frameId: 0 },
                        () => {
                            if (chrome.runtime.lastError) {
                                /* ignore */
                            }
                        }
                    );
                });
            } else {
                const rawOverrides = sources.map((source) => ({ original: source, current: newValue }));
                chrome.tabs.sendMessage(
                    targetTabId,
                    {
                        type: 'APPLY_OVERRIDE_BULK',
                        payload: { raw: rawOverrides },
                    },
                    { frameId: 0 },
                    () => {
                        if (chrome.runtime.lastError) {
                            /* ignore */
                        }
                    }
                );
            }
        };

        if (tabId) {
            sendPayload(tabId);
        } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true, windowTypes: ['normal'] }, (tabs) => {
                if (tabs[0]) sendPayload(tabs[0].id);
            });
        }
        return false;
    }

    // Side panel committed a color change - relay and PERSIST
    if (message.type === 'SIDEPANEL_COLOR_COMMITTED') {
        const { finalValue, sources, tabId } = message.payload;
        if (!sources || !sources.length) return false;

        const processCommit = (targetTabId, url) => {
            const domain = getDomainFromUrl(url);

            // 1. Relay to content script using BULK
            const rawOverrides = sources.map((source) => ({ original: source, current: finalValue }));
            chrome.tabs.sendMessage(
                targetTabId,
                {
                    type: 'APPLY_OVERRIDE_BULK',
                    payload: { raw: rawOverrides },
                },
                { frameId: 0 },
                () => {
                    if (chrome.runtime.lastError) {
                        /* ignore */
                    }
                }
            );

            // 2. Persist to domain storage
            if (domain && typeof StorageUtils !== 'undefined') {
                StorageUtils.getPalette(domain)
                    .then((data) => {
                        const palette = data || {};
                        if (!palette.overrides) palette.overrides = {};
                        if (!palette.overrides.raw) palette.overrides.raw = {};

                        sources.forEach((source) => {
                            const s = (source || '').toLowerCase();
                            const c = (finalValue || '').toLowerCase();
                            if (s === c) delete palette.overrides.raw[s];
                            else palette.overrides.raw[s] = c;
                        });

                        return StorageUtils.savePalette(domain, palette);
                    })
                    .catch((err) => console.warn('Background: Failed to save override', err));
            }
        };

        if (tabId) {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) return;
                if (tab) processCommit(tabId, tab.url);
            });
        } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true, windowTypes: ['normal'] }, (tabs) => {
                if (tabs[0]) processCommit(tabs[0].id, tabs[0].url);
            });
        }
        return false;
    }

    // Side panel requests to apply override directly to content script
    if (message.type === 'SIDEPANEL_APPLY_OVERRIDE') {
        const { tabId } = message.payload || {};
        const sendUpdate = (targetTabId) => {
            chrome.tabs.sendMessage(
                targetTabId,
                {
                    type: 'APPLY_OVERRIDE',
                    payload: message.payload,
                },
                { frameId: 0 },
                (response) => {
                    const err = chrome.runtime.lastError;
                    sendResponse({ ok: !err, error: err ? err.message : null, response });
                }
            );
        };

        if (tabId) {
            sendUpdate(tabId);
        } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                if (!tabs[0]) return sendResponse({ ok: false, error: 'No active tab' });
                sendUpdate(tabs[0].id);
            });
        }
        return true; // async response
    }

    // Side panel requests to remove an override
    if (message.type === 'SIDEPANEL_REMOVE_OVERRIDE') {
        const { tabId } = message.payload || {};
        const sendRemove = (targetTabId) => {
            chrome.tabs.sendMessage(
                targetTabId,
                {
                    type: 'REMOVE_RAW_OVERRIDE',
                    payload: message.payload,
                },
                { frameId: 0 },
                (response) => {
                    const err = chrome.runtime.lastError;
                    sendResponse({ ok: !err, error: err ? err.message : null, response });
                }
            );
        };

        if (tabId) {
            sendRemove(tabId);
        } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                if (!tabs[0]) return sendResponse({ ok: false, error: 'No active tab' });
                sendRemove(tabs[0].id);
            });
        }
        return true; // async response
    }

    // Side panel requests highlight
    if (message.type === 'SIDEPANEL_HIGHLIGHT') {
        const { tabId } = message.payload || {};
        const sendHighlight = (targetTabId) => {
            chrome.tabs.sendMessage(
                targetTabId,
                {
                    type: 'HIGHLIGHT_COLOR',
                    payload: message.payload,
                },
                { frameId: 0 },
                () => {
                    if (chrome.runtime.lastError) {
                        /* ignore */
                    }
                }
            );
        };

        if (tabId) {
            sendHighlight(tabId);
        } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
                if (tabs[0]) sendHighlight(tabs[0].id);
            });
        }
        return false;
    }

    return false;
});
