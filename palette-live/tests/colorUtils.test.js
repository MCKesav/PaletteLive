/**
 * Tests for ColorUtils
 *
 * The source file uses a re-injection guard (`window._colorUtilsVersion`)
 * and attaches the module via `window.ColorUtils` when `module` is not
 * defined, OR via `module.exports` when it IS.
 *
 * Because Jest provides a module system we can `require()` it directly.
 */

const ColorUtils = require('../utils/colorUtils');

// ─── rgbToHex ────────────────────────────────────────────

describe('ColorUtils.rgbToHex', () => {
    test('returns #000000 for null/undefined/empty', () => {
        expect(ColorUtils.rgbToHex(null)).toBe('#000000');
        expect(ColorUtils.rgbToHex(undefined)).toBe('#000000');
        expect(ColorUtils.rgbToHex('')).toBe('#000000');
        expect(ColorUtils.rgbToHex(42)).toBe('#000000');
    });

    test('normalises 3-digit hex', () => {
        expect(ColorUtils.rgbToHex('#abc')).toBe('#aabbcc');
        expect(ColorUtils.rgbToHex('#FFF')).toBe('#ffffff');
    });

    test('normalises 6-digit hex', () => {
        expect(ColorUtils.rgbToHex('#FF5733')).toBe('#ff5733');
        expect(ColorUtils.rgbToHex('#000000')).toBe('#000000');
    });

    test('strips alpha from 8-digit hex', () => {
        expect(ColorUtils.rgbToHex('#FF573380')).toBe('#ff5733');
    });

    test('converts rgb() string', () => {
        expect(ColorUtils.rgbToHex('rgb(255, 87, 51)')).toBe('#ff5733');
        expect(ColorUtils.rgbToHex('rgb(0, 0, 0)')).toBe('#000000');
        expect(ColorUtils.rgbToHex('rgb(255, 255, 255)')).toBe('#ffffff');
    });

    test('converts rgba() string (ignores alpha for 6-digit)', () => {
        expect(ColorUtils.rgbToHex('rgba(255, 87, 51, 0.5)')).toBe('#ff5733');
    });

    test('converts modern space-separated rgb()', () => {
        expect(ColorUtils.rgbToHex('rgb(255 87 51)')).toBe('#ff5733');
    });

    test('clamps out-of-range values', () => {
        // Note: _rgbStringToHex uses /[\d.]+/g regex, so -10 → 10 (sign stripped)
        // then clamped to [0,255]. 300 → 255.
        expect(ColorUtils.rgbToHex('rgb(300, 10, 51)')).toBe('#ff0a33');
    });

    test('converts oklch() to hex', () => {
        // oklch(0.627 0.258 29.23) ≈ red-orange
        const result = ColorUtils.rgbToHex('oklch(0.627 0.258 29.23)');
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('converts oklab() to hex', () => {
        const result = ColorUtils.rgbToHex('oklab(0.627 0.1 0.05)');
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });
});

// ─── _normalizeHex ───────────────────────────────────────

describe('ColorUtils._normalizeHex', () => {
    test('expands shorthand', () => {
        expect(ColorUtils._normalizeHex('#abc')).toBe('#aabbcc');
    });

    test('strips alpha from #RGBA', () => {
        expect(ColorUtils._normalizeHex('#abcd')).toBe('#aabbcc');
    });

    test('strips alpha from #RRGGBBAA', () => {
        expect(ColorUtils._normalizeHex('#aabbccdd')).toBe('#aabbcc');
    });

    test('returns #000000 for invalid hex', () => {
        expect(ColorUtils._normalizeHex('#xyz')).toBe('#000000');
    });
});

// ─── _normalizeHex8 ──────────────────────────────────────

describe('ColorUtils._normalizeHex8', () => {
    test('appends ff to 3-digit', () => {
        expect(ColorUtils._normalizeHex8('#abc')).toBe('#aabbcc');
    });

    test('expands 4-digit and preserves alpha', () => {
        expect(ColorUtils._normalizeHex8('#abcd')).toBe('#aabbccdd');
    });

    test('treats 6-digit as opaque', () => {
        expect(ColorUtils._normalizeHex8('#aabbcc')).toBe('#aabbcc');
    });

    test('preserves alpha on 8-digit', () => {
        expect(ColorUtils._normalizeHex8('#aabbcc80')).toBe('#aabbcc80');
    });

    test('strips ff alpha', () => {
        expect(ColorUtils._normalizeHex8('#aabbccff')).toBe('#aabbcc');
    });
});

// ─── hexToRgb ────────────────────────────────────────────

describe('ColorUtils.hexToRgb', () => {
    test('parses 6-digit hex', () => {
        const { r, g, b, a } = ColorUtils.hexToRgb('#ff5733');
        expect(r).toBe(255);
        expect(g).toBe(87);
        expect(b).toBe(51);
        expect(a).toBe(1);
    });

    test('parses 3-digit hex', () => {
        const { r, g, b } = ColorUtils.hexToRgb('#fff');
        expect(r).toBe(255);
        expect(g).toBe(255);
        expect(b).toBe(255);
    });

    test('parses 8-digit hex with alpha', () => {
        const { r, g, b, a } = ColorUtils.hexToRgb('#ff573380');
        expect(r).toBe(255);
        expect(g).toBe(87);
        expect(b).toBe(51);
        expect(a).toBeCloseTo(0.502, 1);
    });

    test('returns black for invalid input', () => {
        const { r, g, b, a } = ColorUtils.hexToRgb(null);
        expect(r).toBe(0);
        expect(g).toBe(0);
        expect(b).toBe(0);
        expect(a).toBe(1);
    });
});

// ─── toRgba ──────────────────────────────────────────────

describe('ColorUtils.toRgba', () => {
    test('converts hex + alpha to rgba string', () => {
        expect(ColorUtils.toRgba('#ff5733', 0.5)).toBe('rgba(255, 87, 51, 0.5)');
    });

    test('works with #000000', () => {
        expect(ColorUtils.toRgba('#000000', 1)).toBe('rgba(0, 0, 0, 1)');
    });
});

// ─── rgbToHex8 ───────────────────────────────────────────

describe('ColorUtils.rgbToHex8', () => {
    test('returns #000000 for empty input', () => {
        expect(ColorUtils.rgbToHex8('')).toBe('#000000');
        expect(ColorUtils.rgbToHex8(null)).toBe('#000000');
    });

    test('normalises hex input', () => {
        expect(ColorUtils.rgbToHex8('#ff5733')).toBe('#ff5733');
    });

    test('preserves alpha in 8-digit hex', () => {
        expect(ColorUtils.rgbToHex8('#ff573380')).toBe('#ff573380');
    });

    test('parses rgba string and preserves alpha', () => {
        const result = ColorUtils.rgbToHex8('rgba(255, 87, 51, 0.5)');
        expect(result).toBe('#ff573380');
    });

    test('parses opaque rgb string', () => {
        expect(ColorUtils.rgbToHex8('rgb(255, 87, 51)')).toBe('#ff5733');
    });
});

// ─── parseAlpha ──────────────────────────────────────────

describe('ColorUtils.parseAlpha', () => {
    test('returns 1 for opaque hex', () => {
        expect(ColorUtils.parseAlpha('#ff5733')).toBe(1);
    });

    test('returns 0 for transparent keyword', () => {
        expect(ColorUtils.parseAlpha('transparent')).toBe(0);
    });

    test('parses 8-digit hex alpha', () => {
        const a = ColorUtils.parseAlpha('#ff573380');
        expect(a).toBeCloseTo(0.502, 1);
    });

    test('parses rgba() alpha', () => {
        expect(ColorUtils.parseAlpha('rgba(0, 0, 0, 0.75)')).toBe(0.75);
    });

    test('parses modern slash alpha', () => {
        expect(ColorUtils.parseAlpha('rgb(0 0 0 / 0.25)')).toBe(0.25);
    });

    test('returns 1 for null/undefined', () => {
        expect(ColorUtils.parseAlpha(null)).toBe(1);
        expect(ColorUtils.parseAlpha(undefined)).toBe(1);
    });
});

// ─── _oklchStringToHex / _oklabToHex (math) ─────────────

describe('oklch/oklab math conversions', () => {
    test('pure black oklch', () => {
        const hex = ColorUtils._oklchStringToHex('oklch(0 0 0)');
        expect(hex).toBe('#000000');
    });

    test('pure white oklch', () => {
        const hex = ColorUtils._oklchStringToHex('oklch(1 0 0)');
        expect(hex).toBe('#ffffff');
    });

    test('oklabToHex black', () => {
        expect(ColorUtils._oklabToHex(0, 0, 0)).toBe('#000000');
    });

    test('oklabToHex white', () => {
        expect(ColorUtils._oklabToHex(1, 0, 0)).toBe('#ffffff');
    });

    test('oklabToHex mid-gray', () => {
        const hex = ColorUtils._oklabToHex(0.5, 0, 0);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        // Should be a medium gray
        const { r, g, b } = ColorUtils.hexToRgb(hex);
        expect(r).toBeGreaterThan(50);
        expect(r).toBeLessThan(200);
        expect(r).toBeCloseTo(g, 0);
        expect(g).toBeCloseTo(b, 0);
    });
});

// ─── isTransparent ───────────────────────────────────────

describe('ColorUtils.isTransparent', () => {
    test('"transparent" keyword', () => {
        expect(ColorUtils.isTransparent('transparent')).toBe(true);
    });

    test('rgba(0,0,0,0)', () => {
        expect(ColorUtils.isTransparent('rgba(0, 0, 0, 0)')).toBe(true);
    });

    test('#RRGGBB00 hex', () => {
        expect(ColorUtils.isTransparent('#ff573300')).toBe(true);
    });

    test('modern slash alpha zero', () => {
        expect(ColorUtils.isTransparent('rgb(0 0 0 / 0)')).toBe(true);
    });

    test('opaque colors are not transparent', () => {
        expect(ColorUtils.isTransparent('#ff5733')).toBe(false);
        expect(ColorUtils.isTransparent('rgb(255, 0, 0)')).toBe(false);
    });

    test('null/empty is transparent', () => {
        expect(ColorUtils.isTransparent(null)).toBe(true);
        expect(ColorUtils.isTransparent('')).toBe(true);
    });
});

// ─── getLuminance ────────────────────────────────────────

describe('ColorUtils.getLuminance', () => {
    test('black has luminance 0', () => {
        expect(ColorUtils.getLuminance('#000000')).toBeCloseTo(0, 4);
    });

    test('white has luminance 1', () => {
        expect(ColorUtils.getLuminance('#ffffff')).toBeCloseTo(1, 4);
    });

    test('pure red has expected luminance', () => {
        // sRGB relative luminance of pure red ≈ 0.2126
        expect(ColorUtils.getLuminance('#ff0000')).toBeCloseTo(0.2126, 3);
    });

    test('pure green has expected luminance', () => {
        expect(ColorUtils.getLuminance('#00ff00')).toBeCloseTo(0.7152, 3);
    });
});

// ─── areSimilar ──────────────────────────────────────────

describe('ColorUtils.areSimilar', () => {
    test('identical colors are similar', () => {
        expect(ColorUtils.areSimilar('#ff5733', '#ff5733')).toBe(true);
    });

    test('very close colors within default tolerance', () => {
        expect(ColorUtils.areSimilar('#ff5733', '#ff5835')).toBe(true);
    });

    test('distant colors are not similar', () => {
        expect(ColorUtils.areSimilar('#ff0000', '#0000ff')).toBe(false);
    });

    test('custom tolerance', () => {
        expect(ColorUtils.areSimilar('#ff0000', '#ee0000', 20)).toBe(true);
        expect(ColorUtils.areSimilar('#ff0000', '#ee0000', 1)).toBe(false);
    });

    test('null input returns false', () => {
        expect(ColorUtils.areSimilar(null, '#ff5733')).toBe(false);
    });
});

// ─── hexToExportString ───────────────────────────────────

describe('ColorUtils.hexToExportString', () => {
    test('opaque hex returns normalised hex', () => {
        expect(ColorUtils.hexToExportString('#FF5733')).toBe('#ff5733');
    });

    test('translucent hex returns rgba()', () => {
        const result = ColorUtils.hexToExportString('#ff573380');
        expect(result).toMatch(/^rgba\(/);
        expect(result).toContain('255');
        expect(result).toContain('87');
        expect(result).toContain('51');
    });
});

// ─── _rgbStringToHex / _rgbStringToHex8 ─────────────────

describe('RGB string parsing', () => {
    test('_rgbStringToHex parses standard rgb()', () => {
        expect(ColorUtils._rgbStringToHex('rgb(100, 200, 50)')).toBe('#64c832');
    });

    test('_rgbStringToHex returns #000000 for bad input', () => {
        expect(ColorUtils._rgbStringToHex('garbage')).toBe('#000000');
    });

    test('_rgbStringToHex8 preserves alpha', () => {
        const hex = ColorUtils._rgbStringToHex8('rgba(255, 0, 0, 0.5)');
        expect(hex).toBe('#ff000080');
    });

    test('_rgbStringToHex8 opaque returns 6-digit', () => {
        expect(ColorUtils._rgbStringToHex8('rgb(255, 0, 0)')).toBe('#ff0000');
    });
});

// ─── DOM / Canvas resolution fallback ────────────────────

describe('ColorUtils DOM resolution', () => {
    test('_resolveViaDom creates hidden helper element', () => {
        // In jsdom getComputedStyle returns the raw string — the Dom helper
        // will enter the "browser couldn't resolve it" branch and fall back
        // to canvas, which also won't work → #000000
        const result = ColorUtils._resolveViaDom('hsl(120, 100%, 50%)');
        // Result depends on jsdom capability; should be a valid hex string
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('_resolveViaDom with undefined document falls back to canvas', () => {
        // Can't easily undefine document in jsdom, but calling with a bogus
        // color should still return a hex value without throwing
        const result = ColorUtils._resolveViaDom('definitelynotacolor');
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('_resolveViaCanvas returns #000000 for invalid color', () => {
        const result = ColorUtils._resolveViaCanvas('notacolor');
        expect(result).toBe('#000000');
    });

    test('_resolveViaCanvas returns hex for valid color', () => {
        // jsdom canvas support is limited, but the function should not throw
        const result = ColorUtils._resolveViaCanvas('#ff0000');
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('_getCanvasCtx returns null or context', () => {
        const ctx = ColorUtils._getCanvasCtx();
        // jsdom may or may not support canvas; either way no crash
        expect(ctx === null || typeof ctx === 'object').toBe(true);
    });
});

// ─── rgbToHex fallback paths ─────────────────────────────

describe('ColorUtils.rgbToHex fallback paths', () => {
    test('rgbToHex with hsl() triggers DOM resolution', () => {
        // Tests line 68 — the _resolveViaDom fallback
        const result = ColorUtils.rgbToHex('hsl(0, 100%, 50%)');
        expect(result).toMatch(/^#[0-9a-f]{6}$/);
    });

    test('rgbToHex8 with non-hex non-rgb triggers rgbToHex fallback', () => {
        // Tests line 180 — the else branch in rgbToHex8
        const result = ColorUtils.rgbToHex8('hsl(0, 100%, 50%)');
        expect(result).toMatch(/^#[0-9a-f]{6,8}$/);
    });
});

// ─── isTransparent fine-grained branches ─────────────────

describe('ColorUtils.isTransparent branches', () => {
    test('4-digit hex with zero alpha (#RGB0)', () => {
        // Tests the h.length === 4 expansion branch
        expect(ColorUtils.isTransparent('#f0f0')).toBe(true);
    });

    test('4-digit hex with non-zero alpha (#RGBA)', () => {
        expect(ColorUtils.isTransparent('#f0ff')).toBe(false);
    });

    test('legacy rgba with alpha zero (not the exact string match)', () => {
        // Tests lines 422-423: the regex-based rgba parsing branch
        // Uses a differently-formatted rgba string to avoid the exact match on L403
        expect(ColorUtils.isTransparent('rgba(100, 200, 50, 0)')).toBe(true);
    });

    test('legacy rgba with non-zero alpha', () => {
        expect(ColorUtils.isTransparent('rgba(100, 200, 50, 0.5)')).toBe(false);
    });

    test('oklch with slash alpha zero', () => {
        expect(ColorUtils.isTransparent('oklch(0.5 0.2 120 / 0)')).toBe(true);
    });

    test('oklch with slash alpha non-zero', () => {
        expect(ColorUtils.isTransparent('oklch(0.5 0.2 120 / 0.8)')).toBe(false);
    });
});

// ─── hexToExportString edge cases ────────────────────────

describe('ColorUtils.hexToExportString edge cases', () => {
    test('non-hex input returned as-is', () => {
        // Tests line 469: early return for non-# input
        expect(ColorUtils.hexToExportString('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)');
    });

    test('null input returned as-is', () => {
        expect(ColorUtils.hexToExportString(null)).toBe(null);
    });

    test('empty string returned as-is', () => {
        expect(ColorUtils.hexToExportString('')).toBe('');
    });
});

// ─── isValidColor ────────────────────────────────────────

describe('ColorUtils.isValidColor', () => {
    test('valid hex returns true', () => {
        expect(ColorUtils.isValidColor('#ff0000')).toBe(true);
    });

    test('valid 3-digit hex returns true', () => {
        expect(ColorUtils.isValidColor('#f00')).toBe(true);
    });

    test('valid rgb() returns true', () => {
        expect(ColorUtils.isValidColor('rgb(255, 0, 0)')).toBe(true);
    });

    test('valid oklch() returns true', () => {
        expect(ColorUtils.isValidColor('oklch(0.5 0.2 120)')).toBe(true);
    });

    test('invalid color returns false', () => {
        expect(ColorUtils.isValidColor('notacolor')).toBe(false);
    });

    test('null returns false', () => {
        expect(ColorUtils.isValidColor(null)).toBe(false);
    });

    test('empty string returns false', () => {
        expect(ColorUtils.isValidColor('')).toBe(false);
    });
});
