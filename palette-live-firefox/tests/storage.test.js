/**
 * Tests for StorageUtils
 *
 * Chrome extension storage API is mocked to test the pure logic
 * of savePalette, getPalette, clearPalette, _migrateIfNeeded, and _evictOldest.
 */

// ── Chrome API mock ──────────────────────────────────────

let mockStorage = {};
let mockLastError = null;

const chrome = {
    storage: {
        local: {
            get: jest.fn((keys, cb) => {
                if (mockLastError) {
                    Object.defineProperty(chrome.runtime, 'lastError', { value: mockLastError, configurable: true });
                    cb({});
                    Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
                    return;
                }
                if (typeof keys === 'string') {
                    const result = {};
                    if (mockStorage[keys] !== undefined) result[keys] = mockStorage[keys];
                    cb(result);
                } else if (keys === null) {
                    cb({ ...mockStorage });
                } else if (Array.isArray(keys)) {
                    const result = {};
                    keys.forEach((k) => {
                        if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
                    });
                    cb(result);
                } else if (typeof keys === 'object') {
                    const result = {};
                    Object.keys(keys).forEach((k) => {
                        result[k] = mockStorage[k] !== undefined ? mockStorage[k] : keys[k];
                    });
                    cb(result);
                } else {
                    const result = {};
                    [keys].forEach((k) => {
                        if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
                    });
                    cb(result);
                }
            }),
            set: jest.fn((items, cb) => {
                if (mockLastError) {
                    Object.defineProperty(chrome.runtime, 'lastError', { value: mockLastError, configurable: true });
                    cb();
                    Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
                    return;
                }
                Object.assign(mockStorage, items);
                cb();
            }),
            remove: jest.fn((keys, cb) => {
                if (mockLastError) {
                    Object.defineProperty(chrome.runtime, 'lastError', { value: mockLastError, configurable: true });
                    cb();
                    Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
                    return;
                }
                const arr = Array.isArray(keys) ? keys : [keys];
                arr.forEach((k) => delete mockStorage[k]);
                cb();
            }),
            getBytesInUse: jest.fn((_, cb) => {
                const size = Buffer.byteLength(JSON.stringify(mockStorage) || '', 'utf8');
                cb(size);
            }),
            QUOTA_BYTES: 10485760,
        },
    },
    runtime: { lastError: null },
};

global.chrome = chrome;

const StorageUtils = require('../utils/storage');

beforeEach(() => {
    mockStorage = {};
    mockLastError = null;
    jest.clearAllMocks();
});

// ─── savePalette ─────────────────────────────────────────

describe('StorageUtils.savePalette', () => {
    test('saves palette data under domain key', async () => {
        const data = { colors: ['#ff0000'] };
        await StorageUtils.savePalette('example.com', data);
        expect(mockStorage['example.com']).toBeDefined();
        expect(mockStorage['example.com'].colors).toEqual(['#ff0000']);
    });

    test('stamps schema version and lastAccessed', async () => {
        await StorageUtils.savePalette('example.com', {});
        expect(mockStorage['example.com']._schemaVersion).toBe(StorageUtils.SCHEMA_VERSION);
        expect(mockStorage['example.com']._lastAccessed).toBeGreaterThan(0);
    });

    test('adds timestamp if not present', async () => {
        await StorageUtils.savePalette('example.com', {});
        expect(mockStorage['example.com'].timestamp).toBeDefined();
    });
});

// ─── getPalette ──────────────────────────────────────────

describe('StorageUtils.getPalette', () => {
    test('retrieves saved palette', async () => {
        mockStorage['test.com'] = {
            colors: ['#00ff00'],
            _schemaVersion: StorageUtils.SCHEMA_VERSION,
            _lastAccessed: Date.now(),
        };
        const data = await StorageUtils.getPalette('test.com');
        expect(data).not.toBeNull();
        expect(data.colors).toEqual(['#00ff00']);
    });

    test('returns null for missing domain', async () => {
        const data = await StorageUtils.getPalette('missing.com');
        expect(data).toBeNull();
    });

    test('updates _lastAccessed on read', async () => {
        const oldTime = Date.now() - 10000;
        mockStorage['test.com'] = {
            colors: [],
            _schemaVersion: StorageUtils.SCHEMA_VERSION,
            _lastAccessed: oldTime,
        };
        const data = await StorageUtils.getPalette('test.com');
        expect(data._lastAccessed).toBeGreaterThan(oldTime);
    });
});

// ─── clearPalette ────────────────────────────────────────

describe('StorageUtils.clearPalette', () => {
    test('removes domain data', async () => {
        mockStorage['test.com'] = { colors: [] };
        await StorageUtils.clearPalette('test.com');
        expect(mockStorage['test.com']).toBeUndefined();
    });
});

// ─── _migrateIfNeeded ────────────────────────────────────

describe('StorageUtils._migrateIfNeeded', () => {
    test('returns null/undefined as-is', () => {
        expect(StorageUtils._migrateIfNeeded(null)).toBeNull();
        expect(StorageUtils._migrateIfNeeded(undefined)).toBeUndefined();
    });

    test('adds missing structure fields for v0 data', () => {
        const old = { colors: ['#ff0000'] };
        const migrated = StorageUtils._migrateIfNeeded(old);
        expect(migrated.overrides).toBeDefined();
        expect(migrated.overrides.raw).toBeDefined();
        expect(migrated.overrides.variables).toBeDefined();
        expect(migrated.settings).toBeDefined();
        expect(migrated._schemaVersion).toBe(StorageUtils.SCHEMA_VERSION);
    });

    test('does not modify current-version data', () => {
        const data = {
            _schemaVersion: StorageUtils.SCHEMA_VERSION,
            overrides: { raw: {}, variables: {} },
            settings: {},
        };
        const migrated = StorageUtils._migrateIfNeeded({ ...data });
        expect(migrated._schemaVersion).toBe(StorageUtils.SCHEMA_VERSION);
    });
});

// ─── _evictOldest ────────────────────────────────────────

describe('StorageUtils._evictOldest', () => {
    test('evicts oldest entries', async () => {
        // Add 10 domains with ascending access times
        for (let i = 0; i < 10; i++) {
            mockStorage[`domain${i}.com`] = {
                _lastAccessed: 1000 + i,
                _schemaVersion: 1,
            };
        }
        await StorageUtils._evictOldest();
        // Should have evicted 20% = 2 domains (the two oldest)
        expect(mockStorage['domain0.com']).toBeUndefined();
        expect(mockStorage['domain1.com']).toBeUndefined();
        // The rest should remain
        expect(mockStorage['domain2.com']).toBeDefined();
        expect(mockStorage['domain9.com']).toBeDefined();
    });

    test('handles empty storage gracefully', async () => {
        await expect(StorageUtils._evictOldest()).resolves.toBeUndefined();
    });
});

// ─── getStorageInfo ──────────────────────────────────────

describe('StorageUtils.getStorageInfo', () => {
    test('returns storage stats', async () => {
        mockStorage['test.com'] = { colors: ['#ff0000'] };
        const info = await StorageUtils.getStorageInfo();
        expect(info.bytesInUse).toBeGreaterThan(0);
        expect(info.quota).toBe(10485760);
        expect(info.percentage).toBeGreaterThanOrEqual(0);
    });
});

// ─── _validatePaletteData ────────────────────────────────

describe('StorageUtils._validatePaletteData', () => {
    test('returns null for non-object input', () => {
        expect(StorageUtils._validatePaletteData(null)).toBeNull();
        expect(StorageUtils._validatePaletteData('string')).toBeNull();
        expect(StorageUtils._validatePaletteData(42)).toBeNull();
        expect(StorageUtils._validatePaletteData([1, 2])).toBeNull();
    });

    test('strips invalid hex from overrides.raw', () => {
        const data = {
            overrides: {
                raw: {
                    '#ff0000': '#00ff00', // valid
                    'not-a-hex': '#aaa', // invalid key
                    '#abc': 'not-hex', // invalid value
                },
                variables: {},
            },
            settings: {},
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(Object.keys(result.overrides.raw)).toEqual(['#ff0000']);
    });

    test('strips invalid CSS variable names', () => {
        const data = {
            overrides: {
                raw: {},
                variables: {
                    '--valid-name': '#ff0000',
                    'no-dashes': '#ff0000', // missing --
                    '--has spaces': '#ff0000', // spaces
                    '--ok_123': '#aabbcc', // valid
                },
            },
            settings: {},
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(Object.keys(result.overrides.variables)).toEqual(['--valid-name', '--ok_123']);
    });

    test('sanitises invalid settings.scheme', () => {
        const data = {
            overrides: { raw: {}, variables: {} },
            settings: { scheme: 'evil<script>' },
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(result.settings.scheme).toBe('');
    });

    test('sanitises invalid settings.vision', () => {
        const data = {
            overrides: { raw: {}, variables: {} },
            settings: { vision: 'hacker' },
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(result.settings.vision).toBe('');
    });

    test('filters invalid appliedPaletteHexes', () => {
        const data = {
            overrides: { raw: {}, variables: {} },
            settings: {},
            appliedPaletteHexes: ['#ff0000', 'bad', 42, '#abc', null],
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(result.appliedPaletteHexes).toEqual(['#ff0000', '#abc']);
    });

    test('replaces non-array appliedPaletteHexes', () => {
        const data = {
            overrides: { raw: {}, variables: {} },
            settings: {},
            appliedPaletteHexes: 'not-an-array',
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(result.appliedPaletteHexes).toEqual([]);
    });

    test('valid data passes through intact', () => {
        const data = {
            overrides: {
                raw: { '#aabbcc': '#ddeeff' },
                variables: { '--primary': '#112233' },
            },
            settings: { scheme: 'dark', vision: 'protanopia' },
            appliedPaletteHexes: ['#112233', '#aabbcc'],
        };
        const result = StorageUtils._validatePaletteData(data);
        expect(result.overrides.raw).toEqual({ '#aabbcc': '#ddeeff' });
        expect(result.overrides.variables).toEqual({ '--primary': '#112233' });
        expect(result.appliedPaletteHexes).toEqual(['#112233', '#aabbcc']);
    });

    test('getPalette discards corrupt data', async () => {
        mockStorage['corrupt.com'] = 'not an object';
        const data = await StorageUtils.getPalette('corrupt.com');
        expect(data).toBeNull();
    });
});

// ─── savePalette error paths ─────────────────────────────

describe('StorageUtils.savePalette error paths', () => {
    test('rejects on non-QUOTA chrome storage error', async () => {
        mockLastError = { message: 'Internal storage failure' };
        await expect(StorageUtils.savePalette('fail.com', {})).rejects.toMatchObject({
            message: 'Internal storage failure',
        });
    });

    test('retries save after QUOTA eviction and resolves on success', async () => {
        // Prepopulate storage so _evictOldest has entries to remove
        for (let i = 0; i < 5; i++) {
            mockStorage[`old${i}.com`] = { _lastAccessed: 1000 + i, _schemaVersion: 1 };
        }

        let setCallCount = 0;
        const originalSet = chrome.storage.local.set;
        const originalGet = chrome.storage.local.get;
        const originalRemove = chrome.storage.local.remove;

        // Override get/remove to simulate Chrome clearing lastError before each callback
        chrome.storage.local.get = jest.fn((keys, cb) => {
            Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
            if (keys === null) {
                cb({ ...mockStorage });
            } else {
                const result = {};
                if (typeof keys === 'string' && mockStorage[keys] !== undefined) result[keys] = mockStorage[keys];
                cb(result);
            }
        });
        chrome.storage.local.remove = jest.fn((keys, cb) => {
            Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach((k) => delete mockStorage[k]);
            cb();
        });

        chrome.storage.local.set = jest.fn((items, cb) => {
            setCallCount++;
            if (setCallCount === 1) {
                // First write — simulate QUOTA exceeded
                Object.defineProperty(chrome.runtime, 'lastError', {
                    value: { message: 'QUOTA_BYTES exceeded' },
                    configurable: true,
                });
                cb();
                Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
            } else {
                // Retry write — succeed (simulate Chrome clearing lastError first)
                Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
                Object.assign(mockStorage, items);
                cb();
            }
        });

        try {
            await StorageUtils.savePalette('retry.com', { colors: [] });
            expect(mockStorage['retry.com']).toBeDefined();
            expect(setCallCount).toBe(2); // First attempt + one retry
        } finally {
            chrome.storage.local.set = originalSet;
            chrome.storage.local.get = originalGet;
            chrome.storage.local.remove = originalRemove;
        }
    });

    test('rejects when retry write also fails after QUOTA eviction', async () => {
        for (let i = 0; i < 5; i++) {
            mockStorage[`evict${i}.com`] = { _lastAccessed: 2000 + i, _schemaVersion: 1 };
        }

        const originalSet = chrome.storage.local.set;
        const originalGet = chrome.storage.local.get;
        const originalRemove = chrome.storage.local.remove;

        // Override get/remove to simulate Chrome's lastError reset between callbacks
        chrome.storage.local.get = jest.fn((keys, cb) => {
            Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
            if (keys === null) {
                cb({ ...mockStorage });
            } else {
                cb({});
            }
        });
        chrome.storage.local.remove = jest.fn((keys, cb) => {
            Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach((k) => delete mockStorage[k]);
            cb();
        });

        // Every set call fails with QUOTA
        chrome.storage.local.set = jest.fn((items, cb) => {
            Object.defineProperty(chrome.runtime, 'lastError', {
                value: { message: 'QUOTA_BYTES exceeded' },
                configurable: true,
            });
            cb();
            Object.defineProperty(chrome.runtime, 'lastError', { value: null, configurable: true });
        });

        try {
            await expect(StorageUtils.savePalette('nospace.com', {})).rejects.toMatchObject({
                message: expect.stringContaining('QUOTA'),
            });
        } finally {
            chrome.storage.local.set = originalSet;
            chrome.storage.local.get = originalGet;
            chrome.storage.local.remove = originalRemove;
        }
    });
});

// ─── getPalette chrome.runtime.lastError ─────────────────

describe('StorageUtils.getPalette runtime error', () => {
    test('rejects when chrome.runtime.lastError is set during get', async () => {
        mockLastError = { message: 'Storage read error' };
        await expect(StorageUtils.getPalette('test.com')).rejects.toMatchObject({
            message: 'Storage read error',
        });
    });
});
