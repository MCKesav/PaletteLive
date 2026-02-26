/**
 * Tests for ColorScience
 *
 * Validates conversions between color spaces and round-trip consistency
 * for hexToHsl/hslToHex and hexToLab.
 */

// Provide a minimal ColorUtils stub for hexToRgb since colorScience.js
// relies on globalThis.ColorUtils.hexToRgb.
globalThis.ColorUtils = require('../utils/colorUtils');

const ColorScience = require('../utils/colorScience');

// ─── channelToLinear ────────────────────────────────────

describe('ColorScience.channelToLinear', () => {
    test('0 → 0', () => {
        expect(ColorScience.channelToLinear(0)).toBe(0);
    });

    test('255 → ~1', () => {
        expect(ColorScience.channelToLinear(255)).toBeCloseTo(1, 4);
    });

    test('mid-value is in linear range', () => {
        const val = ColorScience.channelToLinear(128);
        expect(val).toBeGreaterThan(0.2);
        expect(val).toBeLessThan(0.3);
    });
});

// ─── hexToLab ───────────────────────────────────────────

describe('ColorScience.hexToLab', () => {
    test('black → L≈0', () => {
        const lab = ColorScience.hexToLab('#000000');
        expect(lab.l).toBeCloseTo(0, 0);
        expect(lab.a).toBeCloseTo(0, 0);
        expect(lab.b).toBeCloseTo(0, 0);
    });

    test('white → L≈100', () => {
        const lab = ColorScience.hexToLab('#ffffff');
        expect(lab.l).toBeCloseTo(100, 0);
    });

    test('pure red has positive a', () => {
        const lab = ColorScience.hexToLab('#ff0000');
        expect(lab.a).toBeGreaterThan(40);
    });

    test('returns {0,0,0} when ColorUtils is missing', () => {
        const saved = globalThis.ColorUtils;
        try {
            globalThis.ColorUtils = null;
            const lab = ColorScience.hexToLab('#ff0000');
            expect(lab).toEqual({ l: 0, a: 0, b: 0 });
        } finally {
            globalThis.ColorUtils = saved;
        }
    });
});

// ─── ciede2000 ──────────────────────────────────────────

describe('ColorScience.ciede2000', () => {
    test('identical colors → distance 0', () => {
        const lab = ColorScience.hexToLab('#3b82f6');
        expect(ColorScience.ciede2000(lab, lab)).toBeCloseTo(0, 4);
    });

    test('black vs white → large distance', () => {
        const black = ColorScience.hexToLab('#000000');
        const white = ColorScience.hexToLab('#ffffff');
        expect(ColorScience.ciede2000(black, white)).toBeGreaterThan(90);
    });

    test('similar colors → small distance', () => {
        const c1 = ColorScience.hexToLab('#3b82f6');
        const c2 = ColorScience.hexToLab('#3b85f9');
        expect(ColorScience.ciede2000(c1, c2)).toBeLessThan(3);
    });
});

// ─── hexToHsl ───────────────────────────────────────────

describe('ColorScience.hexToHsl', () => {
    test('pure red → h=0, s=100, l=50', () => {
        const hsl = ColorScience.hexToHsl('#ff0000');
        expect(hsl.h % 360).toBeCloseTo(0, 0);
        expect(hsl.s).toBeCloseTo(100, 0);
        expect(hsl.l).toBeCloseTo(50, 0);
    });

    test('white → s=0, l=100', () => {
        const hsl = ColorScience.hexToHsl('#ffffff');
        expect(hsl.s).toBeCloseTo(0, 0);
        expect(hsl.l).toBeCloseTo(100, 0);
    });

    test('black → s=0, l=0', () => {
        const hsl = ColorScience.hexToHsl('#000000');
        expect(hsl.s).toBeCloseTo(0, 0);
        expect(hsl.l).toBeCloseTo(0, 0);
    });

    test('s and l are in 0-100 range, not 0-1', () => {
        const hsl = ColorScience.hexToHsl('#3b82f6');
        expect(hsl.s).toBeGreaterThanOrEqual(0);
        expect(hsl.s).toBeLessThanOrEqual(100);
        expect(hsl.l).toBeGreaterThanOrEqual(0);
        expect(hsl.l).toBeLessThanOrEqual(100);
    });
});

// ─── hslToHex ───────────────────────────────────────────

describe('ColorScience.hslToHex', () => {
    test('red round trip', () => {
        const hex = ColorScience.hslToHex(0, 100, 50);
        expect(hex).toBe('#ff0000');
    });

    test('white', () => {
        const hex = ColorScience.hslToHex(0, 0, 100);
        expect(hex).toBe('#ffffff');
    });

    test('black', () => {
        const hex = ColorScience.hslToHex(0, 0, 0);
        expect(hex).toBe('#000000');
    });
});

// ─── hexToHsl → hslToHex round-trip ─────────────────────

describe('hexToHsl → hslToHex round trip', () => {
    test.each(['#ff0000', '#00ff00', '#0000ff', '#3b82f6', '#808080'])('%s round-trips correctly', (hex) => {
        const hsl = ColorScience.hexToHsl(hex);
        const result = ColorScience.hslToHex(hsl.h, hsl.s, hsl.l);
        const expectedRgb = globalThis.ColorUtils.hexToRgb(hex);
        const actualRgb = globalThis.ColorUtils.hexToRgb(result);
        expect(Math.abs(expectedRgb.r - actualRgb.r)).toBeLessThanOrEqual(1);
        expect(Math.abs(expectedRgb.g - actualRgb.g)).toBeLessThanOrEqual(1);
        expect(Math.abs(expectedRgb.b - actualRgb.b)).toBeLessThanOrEqual(1);
    });
});

// ─── hexToHsl channel-max branches ──────────────────────

describe('ColorScience.hexToHsl channel-max branches', () => {
    test('pure green → h≈120 (green-max branch)', () => {
        const hsl = ColorScience.hexToHsl('#00ff00');
        expect(hsl.h).toBeCloseTo(120, 0);
        expect(hsl.s).toBeCloseTo(100, 0);
        expect(hsl.l).toBeCloseTo(50, 0);
    });

    test('pure blue → h≈240 (blue-max branch)', () => {
        const hsl = ColorScience.hexToHsl('#0000ff');
        expect(hsl.h).toBeCloseTo(240, 0);
        expect(hsl.s).toBeCloseTo(100, 0);
        expect(hsl.l).toBeCloseTo(50, 0);
    });
});

// ─── ciede2000 CIEDE2000 branch coverage ────────────────

describe('ColorScience.ciede2000 branch coverage', () => {
    // dhp = 0 / hpm = hp1+hp2  (Cp1*Cp2 === 0 — achromatic pair)
    test('achromatic pair (gray vs black) – Cp=0 branch', () => {
        const gray = ColorScience.hexToLab('#808080');
        const black = ColorScience.hexToLab('#000000');
        const de = ColorScience.ciede2000(gray, black);
        expect(de).toBeGreaterThan(0);
        expect(de).toBeLessThan(60);
    });

    // dhp = hp2 - hp1 - 360  (hp2 - hp1 > 180)
    // hpm = (hp1+hp2+360)/2   (|hp1-hp2|>180 and hp1+hp2 < 360)
    // Uses orange (~46°) as lab1 and blue (~306°) as lab2:
    //   hp2 - hp1 ≈ 260 > 180  →  dhp branch 3
    //   hp1+hp2 ≈ 352 < 360   →  hpm branch 3
    test('orange vs blue (hp2-hp1 > 180, sum < 360)', () => {
        const orange = ColorScience.hexToLab('#ff4400');
        const blue = ColorScience.hexToLab('#0000ff');
        const de = ColorScience.ciede2000(orange, blue);
        expect(de).toBeGreaterThan(30);
    });

    // dhp = hp2 - hp1 + 360  (hp2 - hp1 < -180, "else" branch)
    // Uses blue (~306°) as lab1 and orange (~46°) as lab2:
    //   hp2 - hp1 ≈ -260 < -180  →  dhp else branch
    test('blue vs orange (hp2-hp1 < -180, else branch)', () => {
        const blue = ColorScience.hexToLab('#0000ff');
        const orange = ColorScience.hexToLab('#ff4400');
        const de = ColorScience.ciede2000(blue, orange);
        expect(de).toBeGreaterThan(30);
    });

    // hpm = (hp1+hp2-360)/2  (|hp1-hp2|>180 and hp1+hp2 >= 360)
    // Uses yellow (~103°) as lab1 and blue (~306°) as lab2:
    //   |hp1-hp2| ≈ 203 > 180, hp1+hp2 ≈ 409 >= 360  →  hpm branch 4
    test('yellow vs blue (hpm sum >= 360 branch)', () => {
        const yellow = ColorScience.hexToLab('#ffff00');
        const blue = ColorScience.hexToLab('#0000ff');
        const de = ColorScience.ciede2000(yellow, blue);
        expect(de).toBeGreaterThan(30);
    });

    // symmetry check — distance is unchanged when colors are commuted
    test('ciede2000 is symmetric for cross-hue pairs', () => {
        const c1 = ColorScience.hexToLab('#ff4400');
        const c2 = ColorScience.hexToLab('#0000ff');
        expect(ColorScience.ciede2000(c1, c2)).toBeCloseTo(ColorScience.ciede2000(c2, c1), 4);
    });
});
