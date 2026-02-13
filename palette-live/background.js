/**
 * PaletteLive - Background Worker
 * Handles extension lifecycle and events.
 */

chrome.runtime.onInstalled.addListener(() => {
    console.log('PaletteLive extension installed.');
});

// Example: Listen for tab updates if we wanted to auto-inject or check status
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
        // We could verify content script status here
    }
});

// Since we use chrome.storage.local directly in content/popup,
// we don't need complex messaging for storage here.
// But we might handle specific cross-origin or long-running tasks here later.
