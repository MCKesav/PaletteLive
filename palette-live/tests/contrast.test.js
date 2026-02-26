/**
 * Tests for ContrastUtils
 *
 * ContrastUtils depends on window.ColorUtils for getLuminance.
 * We load ColorUtils first, then ContrastUtils.
 */

const ColorUtils = require('../utils/colorUtils');
// ContrastUtils expects window.ColorUtils
global.window = global.window || {};
global.window.ColorUtils = ColorUtils;

const ContrastUtils = require('../utils/contrast');

// ─── getRatio ────────────────────────────────────────────

describe('ContrastUtils.getRatio', () => {
    test('black on white is 21:1', () => {
        const ratio = ContrastUtils.getRatio('#000000', '#ffffff');
        expect(ratio).toBeCloseTo(21, 0);
    });

    test('white on white is 1:1', () => {
        const ratio = ContrastUtils.getRatio('#ffffff', '#ffffff');
        expect(ratio).toBeCloseTo(1, 0);
    });

    test('black on black is 1:1', () => {
        const ratio = ContrastUtils.getRatio('#000000', '#000000');
        expect(ratio).toBeCloseTo(1, 0);
    });

    test('ratio is always >= 1', () => {
        const ratio = ContrastUtils.getRatio('#ff0000', '#00ff00');
        expect(ratio).toBeGreaterThanOrEqual(1);
    });

    test('order does not matter (symmetric)', () => {
        const r1 = ContrastUtils.getRatio('#ff0000', '#ffffff');
        const r2 = ContrastUtils.getRatio('#ffffff', '#ff0000');
        expect(r1).toBeCloseTo(r2, 4);
    });

    test('mid-gray on white is around 4.5', () => {
        // #767676 is the lightest gray that passes WCAG AA against white
        const ratio = ContrastUtils.getRatio('#767676', '#ffffff');
        expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
});

// ─── getRating ───────────────────────────────────────────

describe('ContrastUtils.getRating', () => {
    test('ratio >= 7 → AAA', () => {
        expect(ContrastUtils.getRating(7)).toBe('AAA');
        expect(ContrastUtils.getRating(21)).toBe('AAA');
    });

    test('ratio >= 4.5 but < 7 → AA', () => {
        expect(ContrastUtils.getRating(4.5)).toBe('AA');
        expect(ContrastUtils.getRating(6.99)).toBe('AA');
    });

    test('ratio >= 3 but < 4.5 → AA Large', () => {
        expect(ContrastUtils.getRating(3)).toBe('AA Large');
        expect(ContrastUtils.getRating(4.49)).toBe('AA Large');
    });

    test('ratio < 3 → Fail', () => {
        expect(ContrastUtils.getRating(2.99)).toBe('Fail');
        expect(ContrastUtils.getRating(1)).toBe('Fail');
    });
});

// ─── End-to-end: WCAG known pairs ───────────────────────

describe('WCAG known color pairs', () => {
    test('#000 on #fff passes AAA', () => {
        const ratio = ContrastUtils.getRatio('#000000', '#ffffff');
        expect(ContrastUtils.getRating(ratio)).toBe('AAA');
    });

    test('#777 on #fff fails AA for normal text but passes AA Large', () => {
        const ratio = ContrastUtils.getRatio('#777777', '#ffffff');
        expect(ratio).toBeLessThan(4.5);
        expect(ratio).toBeGreaterThanOrEqual(3);
        expect(ContrastUtils.getRating(ratio)).toBe('AA Large');
    });
});
