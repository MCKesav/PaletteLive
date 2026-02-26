/**
 * PaletteLive - Storage Utilities
 * Handles local storage persistence per domain with LRU eviction and schema versioning.
 */

// Guard against re-injection - use version to allow updates
if (typeof globalThis._storageUtilsVersion !== 'undefined' && globalThis._storageUtilsVersion === 2) {
    // Already loaded with same version
} else {
    globalThis._storageUtilsVersion = 2;

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
                        // Validate data structure
                        const validated = StorageUtils._validatePaletteData(migrated);
                        if (!validated) {
                            console.warn('PaletteLive: Corrupt stored data for', domain, '— discarding');
                            chrome.storage.local.remove(domain, () => {
                                /* fire-and-forget */
                            });
                            resolve(null);
                            return;
                        }
                        // Update last accessed timestamp (fire-and-forget)
                        validated._lastAccessed = Date.now();
                        const update = {};
                        update[domain] = validated;
                        chrome.storage.local.set(update, () => {
                            /* ignore errors */
                        });
                        resolve(validated);
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
            if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
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
         * Validate palette data structure retrieved from storage.
         * Strips invalid fields and returns a sanitised copy, or null
         * if the data is fundamentally corrupt.
         * @param {*} data
         * @returns {object|null}
         */
        _validatePaletteData: (data) => {
            if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

            // Validate overrides.raw — should be {string: string}
            if (data.overrides && data.overrides.raw && typeof data.overrides.raw === 'object') {
                const clean = {};
                for (const [k, v] of Object.entries(data.overrides.raw)) {
                    if (
                        typeof k === 'string' &&
                        typeof v === 'string' &&
                        /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/i.test(k) &&
                        /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/i.test(v)
                    ) {
                        clean[k] = v;
                    }
                }
                data.overrides.raw = clean;
            }

            // Validate overrides.variables — should be {string: string}
            if (data.overrides && data.overrides.variables && typeof data.overrides.variables === 'object') {
                const clean = {};
                for (const [k, v] of Object.entries(data.overrides.variables)) {
                    if (typeof k === 'string' && typeof v === 'string') {
                        // Variable names should match CSS custom property pattern
                        if (
                            /^--[a-zA-Z0-9_-]+$/.test(k) &&
                            /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/i.test(v)
                        ) {
                            clean[k] = v;
                        }
                    }
                }
                data.overrides.variables = clean;
            }

            // Validate settings
            if (data.settings && typeof data.settings === 'object') {
                const validSchemes = ['normal', 'light', 'dark', ''];
                if (data.settings.scheme && !validSchemes.includes(data.settings.scheme)) {
                    data.settings.scheme = '';
                }
                const validVisions = ['normal', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia', ''];
                if (data.settings.vision && !validVisions.includes(data.settings.vision)) {
                    data.settings.vision = '';
                }
            }

            // Validate appliedPaletteHexes
            if (data.appliedPaletteHexes) {
                if (!Array.isArray(data.appliedPaletteHexes)) {
                    data.appliedPaletteHexes = [];
                } else {
                    data.appliedPaletteHexes = data.appliedPaletteHexes.filter(
                        (h) =>
                            typeof h === 'string' &&
                            /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/i.test(h)
                    );
                }
            }

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
                        percentage: Math.round(((bytesInUse || 0) / quota) * 100),
                    });
                });
            });
        },
    };

    if (typeof module !== 'undefined') module.exports = StorageUtils;
    else globalThis.StorageUtils = StorageUtils;
} // end re-injection guard
