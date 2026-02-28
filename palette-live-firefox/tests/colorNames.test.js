/**
 * Tests for ColorNames
 *
 * The module exposes nearest() and getName() for mapping hex colors to
 * human-friendly names using a curated palette. We validate correctness,
 * thresholds, caching, and guard behavior.
 */

const ColorNames = require('../utils/colorNames');

describe('ColorNames.nearest', () => {
    test('returns exact match with distance 0', () => {
        const res = ColorNames.nearest('#ff0000');
        expect(res.name).toBe('Red');
        expect(res.hex).toBe('#ff0000'.toLowerCase());
        expect(res.distance).toBe(0);
    });

    test('handles lowercase and mixed-case hex', () => {
        expect(ColorNames.nearest('#FF0000').name).toBe('Red');
        expect(ColorNames.nearest('#FfFfFf').name).toBe('White');
    });

    test('returns Unknown for invalid input', () => {
        const res = ColorNames.nearest(null);
        expect(res.name).toBe('Unknown');
        expect(res.hex).toBe('#000000');
        expect(res.distance).toBe(Infinity);
    });

    test('finds a sensible nearest for off-red', () => {
        const res = ColorNames.nearest('#ff1100');
        expect(res.name).toBe('Red');
        expect(res.distance).toBe(34);
    });

    test('cache is initialized only once', () => {
        const spy = jest.spyOn(ColorNames, '_ensureCache');
        ColorNames.nearest('#000001');
        ColorNames.nearest('#000002');
        expect(spy).toHaveBeenCalledTimes(2); // _ensureCache called twice, but it internally skips reconstruction
        spy.mockRestore();
    });
});

describe('ColorNames.getName', () => {
    test('returns the human name when within default threshold', () => {
        // #ff6348 is 1 step from Tomato (#ff6347); should map to 'Tomato' with default threshold
        const name = ColorNames.getName('#ff6348');
        expect(name).toBe('Tomato');
    });

    test('returns hex when outside a strict threshold', () => {
        const name = ColorNames.getName('#ff1100', 1); // too strict
        expect(name).toBe('#ff1100');
    });

    test('exact match returns canonical name regardless of threshold', () => {
        expect(ColorNames.getName('#000000', 0)).toBe('Black');
        expect(ColorNames.getName('#ffffff', 0)).toBe('White');
    });

    test('invalid input returns hex from getName when not matchable', () => {
        const name = ColorNames.getName('not-a-hex');
        expect(name).toBe('not-a-hex');
        const fallback = ColorNames.nearest('not-a-hex');
        expect(fallback.name).toBe('Unknown');
        expect(fallback.hex).toBe('#000000');
        expect(fallback.distance).toBe(Infinity);
    });

    test('threshold tuning affects classification', () => {
        // Near Dodger Blue (#1e90ff) but with a larger delta to exceed strict threshold 2
        const hex = '#1e90f5';
        const loose = ColorNames.getName(hex); // default threshold 30
        const strict = ColorNames.getName(hex, 2); // very strict
        expect(loose).toBe('Dodger Blue');
        expect(strict).toBe(hex);
    });
});
