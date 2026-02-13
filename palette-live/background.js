/**
 * PaletteLive - Background Worker
 * Handles extension lifecycle and events.
 */

chrome.runtime.onInstalled.addListener(() => {
    console.log('PaletteLive extension installed.');
});

// Since we use chrome.storage.local directly in content/popup,
// we don't need complex messaging for storage here.
// But we might handle specific cross-origin or long-running tasks here later.
