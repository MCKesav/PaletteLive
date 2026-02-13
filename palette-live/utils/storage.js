/**
 * PaletteLive - Storage Utilities
 * Handles local storage persistence per domain.
 */

const StorageUtils = {
    /**
     * Save palette data for current domain
     * @param {string} domain
     * @param {object} data
     * @returns {Promise}
     */
    savePalette: (domain, data) => {
        return new Promise((resolve, reject) => {
            const storageItem = {};
            storageItem[domain] = data;
            chrome.storage.local.set(storageItem, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    },

    /**
     * Get palette data for current domain
     * @param {string} domain
     * @returns {Promise<object>}
     */
    getPalette: (domain) => {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(domain, (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result[domain] || null);
                }
            });
        });
    },

    /**
     * Clear palette data for current domain
     * @param {string} domain
     * @returns {Promise}
     */
    clearPalette: (domain) => {
        return new Promise((resolve, reject) => {
            chrome.storage.local.remove(domain, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }
};

if (typeof module !== 'undefined') module.exports = StorageUtils;
else window.StorageUtils = StorageUtils;
