/**
 * PaletteLive - Background Worker
 * Handles message relay between popup/editor window and content scripts.
 */

chrome.runtime.onInstalled.addListener(() => {
    console.log('PaletteLive extension installed.');
});

// Message relay between popup, editor window, and content scripts
let activeEditorWindowId = null;

function createEditorWindow() {
    chrome.windows.create({
        url: 'sidepanel/sidepanel.html',
        type: 'popup',
        width: 340,
        height: 600,
        focused: true
    }, (window) => {
        if (window) {
            activeEditorWindowId = window.id;
        }
    });
}

// Track window closure
chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === activeEditorWindowId) {
        activeEditorWindowId = null;
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    // Editor window is opened via chrome.windows.create() from popup.js
    // Color data is passed via chrome.storage.session
    if (message.type === 'OPEN_EDITOR_WINDOW') {
        const payload = message.payload;
        // Store data first so the new window allows reads it on load
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

    // Side panel sends color change back - relay to the popup
    if (message.type === 'SIDEPANEL_COLOR_CHANGED') {
        // The popup listens for this via chrome.runtime.onMessage
        // No relay needed - it's already broadcast to all extension pages
        return false;
    }

    // Side panel requests to apply override directly to content script
    if (message.type === 'SIDEPANEL_APPLY_OVERRIDE') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                sendResponse({ ok: false, error: 'No active tab' });
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'APPLY_OVERRIDE',
                payload: message.payload
            }, { frameId: 0 }, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                sendResponse({ ok: true, response });
            });
        });
        return true; // async response
    }

    // Side panel requests to remove an override
    if (message.type === 'SIDEPANEL_REMOVE_OVERRIDE') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) {
                sendResponse({ ok: false, error: 'No active tab' });
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'REMOVE_RAW_OVERRIDE',
                payload: message.payload
            }, { frameId: 0 }, (response) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                sendResponse({ ok: true, response });
            });
        });
        return true; // async response
    }

    // Side panel requests highlight
    if (message.type === 'SIDEPANEL_HIGHLIGHT') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]) return;
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'HIGHLIGHT_COLOR',
                payload: message.payload
            }, { frameId: 0 }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
            });
        });
        return false;
    }

    return false;
});
