/**
 * Tests for PaletteLive Constants
 * Validates MessageTypes and PLConfig integrity.
 */

describe('Constants', () => {
    beforeEach(() => {
        delete globalThis._constantsVersion;
        delete globalThis.MessageTypes;
        delete globalThis.PLConfig;
        delete globalThis.PLLog;

        // Reset Jest module registry so the IIFE re-executes
        jest.resetModules();

        require('../utils/constants');
    });

    afterAll(() => {
        delete globalThis._constantsVersion;
        delete globalThis.MessageTypes;
        delete globalThis.PLConfig;
        delete globalThis.PLLog;
    });

    describe('MessageTypes', () => {
        test('is frozen', () => {
            expect(Object.isFrozen(globalThis.MessageTypes)).toBe(true);
        });

        test('all values are strings', () => {
            for (const [key, value] of Object.entries(globalThis.MessageTypes)) {
                expect(typeof value).toBe('string');
            }
        });

        test('all keys match their values', () => {
            // Convention: MessageTypes.FOO === 'FOO'
            for (const [key, value] of Object.entries(globalThis.MessageTypes)) {
                expect(value).toBe(key);
            }
        });

        test('contains all required message types used in content.js', () => {
            const required = [
                'PING',
                'PAUSE_EXTENSION',
                'RESUME_EXTENSION',
                'EXTRACT_PALETTE',
                'APPLY_OVERRIDE',
                'APPLY_OVERRIDE_BULK',
                'APPLY_OVERRIDE_FAST',
                'REMOVE_RAW_OVERRIDE',
                'RESET_STYLES',
                'RESET_AND_RESCAN',
                'RESCAN_ONLY',
                'FORCE_REAPPLY',
                'TOGGLE_HEATMAP',
                'HIGHLIGHT_ELEMENTS',
                'UNHIGHLIGHT',
                'SET_COLOR_SCHEME',
                'FIX_TEXT_CONTRAST',
                'SET_VISION_MODE',
                'SUSPEND_FOR_COMPARISON',
                'WAIT_FOR_PAINT',
                'RESTORE_AFTER_COMPARISON',
                'SHOW_COMPARISON_OVERLAY',
                'HIDE_COMPARISON_OVERLAY',
                'PL_COMPARISON_OVERLAY_CLOSED',
                'OPEN_EDITOR_PANEL',
            ];

            for (const type of required) {
                expect(globalThis.MessageTypes[type]).toBe(type);
            }
        });

        test('contains all required message types used in background.js', () => {
            const required = [
                'OPEN_EDITOR_WINDOW',
                'DROPPER_RESOLVE_CLUSTER',
                'SIDEPANEL_COLOR_CHANGED',
                'SIDEPANEL_COLOR_COMMITTED',
                'SIDEPANEL_APPLY_OVERRIDE',
                'SIDEPANEL_REMOVE_OVERRIDE',
                'SIDEPANEL_HIGHLIGHT',
            ];

            for (const type of required) {
                expect(globalThis.MessageTypes[type]).toBe(type);
            }
        });

        test('contains all required message types used in sidepanel.js', () => {
            const required = [
                'SIDEPANEL_EXPORT_TOGGLED',
                'SIDEPANEL_BATCH_APPLY',
                'SIDEPANEL_LOAD_COLOR',
                'SIDEPANEL_UPDATE_EXPORT',
                'SIDEPANEL_UPDATE_COLOR',
            ];

            for (const type of required) {
                expect(globalThis.MessageTypes[type]).toBe(type);
            }
        });

        test('no duplicate values', () => {
            const values = Object.values(globalThis.MessageTypes);
            const unique = new Set(values);
            expect(unique.size).toBe(values.length);
        });
    });

    describe('PLConfig', () => {
        test('is frozen', () => {
            expect(Object.isFrozen(globalThis.PLConfig)).toBe(true);
        });

        test('all values are numbers', () => {
            for (const [key, value] of Object.entries(globalThis.PLConfig)) {
                expect(typeof value).toBe('number');
            }
        });

        test('element limits are positive', () => {
            expect(globalThis.PLConfig.MAP_ELEMENT_LIMIT).toBeGreaterThan(0);
            expect(globalThis.PLConfig.CONTRAST_MAX_ELEMENTS).toBeGreaterThan(0);
            expect(globalThis.PLConfig.FALLBACK_WALK_LIMIT).toBeGreaterThan(0);
        });

        test('contrast ratios are valid WCAG values', () => {
            expect(globalThis.PLConfig.WCAG_AA_CONTRAST).toBe(4.5);
            expect(globalThis.PLConfig.WCAG_AA_LARGE_CONTRAST).toBe(3.0);
        });

        test('timers are sensible', () => {
            expect(globalThis.PLConfig.OBSERVER_DEBOUNCE_SMALL_MS).toBeGreaterThan(0);
            expect(globalThis.PLConfig.WATCHDOG_FAST_MS).toBeGreaterThan(0);
            expect(globalThis.PLConfig.WATCHDOG_FAST_MS).toBeLessThan(globalThis.PLConfig.WATCHDOG_SLOW_MS);
        });
    });

    describe('PLLog', () => {
        test('has all required methods', () => {
            expect(typeof globalThis.PLLog.error).toBe('function');
            expect(typeof globalThis.PLLog.warn).toBe('function');
            expect(typeof globalThis.PLLog.info).toBe('function');
            expect(typeof globalThis.PLLog.debug).toBe('function');
            expect(typeof globalThis.PLLog.enableDebug).toBe('function');
            expect(typeof globalThis.PLLog.disableDebug).toBe('function');
        });

        test('debug is suppressed by default', () => {
            const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
            globalThis.PLLog.debug('test');
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });

        test('debug is enabled after enableDebug()', () => {
            const spy = jest.spyOn(console, 'debug').mockImplementation(() => {});
            const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
            globalThis.PLLog.enableDebug();
            globalThis.PLLog.debug('test message');
            expect(spy).toHaveBeenCalled();
            globalThis.PLLog.disableDebug();
            spy.mockRestore();
            infoSpy.mockRestore();
        });
    });
});
