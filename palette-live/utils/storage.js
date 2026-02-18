/**
 * PaletteLive - Storage Utilities
 * Handles local storage persistence per domain with LRU eviction and schema versioning.
 */

// Guard against re-injection - use version to allow updates
const _STORAGE_UTILS_VERSION = 2;
if (window._storageUtilsVersion === _STORAGE_UTILS_VERSION) {
  // Already loaded with same version
} else {
  window._storageUtilsVersion = _STORAGE_UTILS_VERSION;

const StorageUtils = {
    SCHEMA_VERSION: 1,
    QUOTA_THRESHOLD: 0.8, // Evict when 80% full
    MAX_STORED_DOMAINS: 200,
    EVICTION_PERCENT: 0.2, // Delete oldest 20% of domains

    /**
     * Save palette data for current domain
     * @param {string} domain
     * @param {object} data
     * @returns {Promise}
     */
    savePalette: (domain, data) => {
        return new Promise((resolve, reject) => {
            // Stamp with schema version and last accessed time
            data._schemaVersion = StorageUtils.SCHEMA_VERSION;
            data._lastAccessed = Date.now();
            if (!data.timestamp) data.timestamp = new Date().toISOString();

            const storageItem = {};
            storageItem[domain] = data;
            chrome.storage.local.set(storageItem, () => {
                if (chrome.runtime.lastError) {
                    // Quota exceeded — attempt eviction then retry
                    if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('QUOTA')) {
                        StorageUtils._evictOldest()
                            .then(() => {
                                chrome.storage.local.set(storageItem, () => {
                                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                                    else resolve();
                                });
                            })
                            .catch(reject);
                        return;
                    }
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
                    return;
                }
                const data = result[domain] || null;
                if (data) {
                    // Migrate old schema if needed
                    const migrated = StorageUtils._migrateIfNeeded(data);
                    // Update last accessed timestamp (fire-and-forget)
                    migrated._lastAccessed = Date.now();
                    const update = {};
                    update[domain] = migrated;
                    chrome.storage.local.set(update, () => { /* ignore errors */ });
                    resolve(migrated);
                } else {
                    resolve(null);
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
    },

    /**
     * Migrate stored data from older schema versions.
     * @param {object} data
     * @returns {object} migrated data
     */
    _migrateIfNeeded: (data) => {
        if (!data) return data;
        const version = data._schemaVersion || 0;

        if (version >= StorageUtils.SCHEMA_VERSION) return data;

        // v0 → v1: Add missing structure fields
        if (version < 1) {
            if (!data.overrides) data.overrides = {};
            if (!data.overrides.raw) data.overrides.raw = {};
            if (!data.overrides.variables) data.overrides.variables = {};
            if (!data.settings) data.settings = {};
            if (!data._lastAccessed) data._lastAccessed = Date.now();
        }

        // Future migrations go here:
        // if (version < 2) { ... }

        data._schemaVersion = StorageUtils.SCHEMA_VERSION;
        return data;
    },

    /**
     * Evict oldest domains by last accessed time to free storage.
     * @returns {Promise}
     */
    _evictOldest: () => {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (allData) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                const entries = Object.entries(allData)
                    .filter(([, value]) => value && typeof value === 'object' && value._lastAccessed)
                    .sort((a, b) => (a[1]._lastAccessed || 0) - (b[1]._lastAccessed || 0));

                if (entries.length === 0) {
                    resolve();
                    return;
                }

                const deleteCount = Math.max(1, Math.ceil(entries.length * StorageUtils.EVICTION_PERCENT));
                const keysToDelete = entries.slice(0, deleteCount).map(([key]) => key);

                console.log(`PaletteLive: Evicting ${keysToDelete.length} oldest domains to free storage`);

                chrome.storage.local.remove(keysToDelete, () => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve();
                });
            });
        });
    },

    /**
     * Get storage usage info.
     * @returns {Promise<{bytesInUse: number, quota: number, percentage: number}>}
     */
    getStorageInfo: () => {
        return new Promise((resolve) => {
            chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
                // chrome.storage.local quota is ~10MB (10485760 bytes)
                const quota = 10485760;
                resolve({
                    bytesInUse: bytesInUse || 0,
                    quota,
                    percentage: Math.round(((bytesInUse || 0) / quota) * 100)
                });
            });
        });
    }
};

if (typeof module !== 'undefined') module.exports = StorageUtils;
else window.StorageUtils = StorageUtils;

} // end re-injection guard
