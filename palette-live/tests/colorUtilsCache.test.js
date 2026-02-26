/**
 * Tests for rgbToHex8 memoization cache added in Phase 2.
 */

const ColorUtils = require('../utils/colorUtils');

describe('ColorUtils.rgbToHex8 memoization', () => {
    let origMax;

    beforeEach(() => {
        // Clear the cache between tests
        ColorUtils._rgbToHex8Cache.clear();
        // Restore max in case a previous test changed it without cleaning up
        origMax = ColorUtils._RGB_TO_HEX8_CACHE_MAX;
    });

    test('returns correct value on first call (cache miss)', () => {
        expect(ColorUtils.rgbToHex8('rgb(255, 0, 0)')).toBe('#ff0000');
        expect(ColorUtils.rgbToHex8('rgba(0, 128, 255, 0.5)')).toBe('#0080ff80');
        expect(ColorUtils.rgbToHex8('#aabb33')).toBe('#aabb33');
    });

    test('returns same value on second call (cache hit)', () => {
        const first = ColorUtils.rgbToHex8('rgb(100, 200, 50)');
        const second = ColorUtils.rgbToHex8('rgb(100, 200, 50)');
        expect(first).toBe(second);
        expect(first).toBe('#64c832');
    });

    test('cache stores entries', () => {
        ColorUtils.rgbToHex8('rgb(1, 2, 3)');
        expect(ColorUtils._rgbToHex8Cache.size).toBe(1);
        ColorUtils.rgbToHex8('rgb(4, 5, 6)');
        expect(ColorUtils._rgbToHex8Cache.size).toBe(2);
    });

    test('cache evicts when max size reached', () => {
        // Temporarily lower the max to make test fast
        try {
            ColorUtils._RGB_TO_HEX8_CACHE_MAX = 50;

            // Fill cache to max with unique strings
            for (let i = 0; i < 50; i++) {
                ColorUtils.rgbToHex8(`rgb(${i}, ${i + 1}, ${i + 2})`);
            }
            expect(ColorUtils._rgbToHex8Cache.size).toBe(50);

            // One more should trigger eviction (clear + add 1)
            ColorUtils.rgbToHex8('rgb(254, 253, 252)');
            expect(ColorUtils._rgbToHex8Cache.size).toBe(1);
        } finally {
            // Restore original max even if test fails
            ColorUtils._RGB_TO_HEX8_CACHE_MAX = origMax;
        }
    });

    test('null/undefined/empty bypass cache', () => {
        expect(ColorUtils.rgbToHex8(null)).toBe('#000000');
        expect(ColorUtils.rgbToHex8(undefined)).toBe('#000000');
        expect(ColorUtils.rgbToHex8('')).toBe('#000000');
        expect(ColorUtils._rgbToHex8Cache.size).toBe(0);
    });

    test('whitespace-trimmed input is cached correctly', () => {
        const a = ColorUtils.rgbToHex8('  rgb(10, 20, 30)  ');
        const b = ColorUtils.rgbToHex8('rgb(10, 20, 30)');
        expect(a).toBe(b);
        expect(a).toBe('#0a141e');
    });

    test('hex input with alpha is cached', () => {
        const hex = ColorUtils.rgbToHex8('#ff573380');
        expect(hex).toBe('#ff573380');
        // Second call should hit cache
        expect(ColorUtils.rgbToHex8('#ff573380')).toBe('#ff573380');
    });

    test('fully opaque hex strips alpha', () => {
        expect(ColorUtils.rgbToHex8('#ff5733ff')).toBe('#ff5733');
    });
});
