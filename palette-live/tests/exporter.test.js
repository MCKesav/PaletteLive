/**
 * Tests for ExporterUtils
 *
 * ExporterUtils optionally references ColorUtils and ColorNames
 * on the global scope. We set them up before loading.
 */

const ColorUtils = require('../utils/colorUtils');
global.ColorUtils = ColorUtils;
// Stub ColorNames so tests don't break when it's absent
global.ColorNames = { getName: () => null };

const ExporterUtils = require('../utils/exporter');

// Helper colors for tests
const sampleColors = [
    { name: '--primary', value: '#6366f1' },
    { name: '--accent', value: '#f43f5e' },
    { name: '--bg', value: '#ffffff' },
];

// ─── toCSS ───────────────────────────────────────────────

describe('ExporterUtils.toCSS', () => {
    test('generates valid CSS custom properties', () => {
        const css = ExporterUtils.toCSS(sampleColors);
        expect(css).toContain(':root {');
        expect(css).toContain('--primary:');
        expect(css).toContain('--accent:');
        expect(css).toContain('--bg:');
        expect(css).toContain('}');
    });

    test('handles colors without names', () => {
        const colors = [{ value: '#abcdef' }];
        const css = ExporterUtils.toCSS(colors);
        expect(css).toContain('--color-abcdef');
    });

    test('empty array produces empty :root', () => {
        const css = ExporterUtils.toCSS([]);
        expect(css).toBe(':root {\n}');
    });
});

// ─── toJSON ──────────────────────────────────────────────

describe('ExporterUtils.toJSON', () => {
    test('generates valid JSON', () => {
        const json = ExporterUtils.toJSON(sampleColors);
        const parsed = JSON.parse(json);
        expect(parsed).toBeDefined();
        expect(parsed['primary']).toBeDefined();
        expect(parsed['accent']).toBeDefined();
    });

    test('strips leading -- from keys', () => {
        const json = ExporterUtils.toJSON(sampleColors);
        const parsed = JSON.parse(json);
        expect(parsed['--primary']).toBeUndefined();
        expect(parsed['primary']).toBeDefined();
        expect(parsed['bg']).toBeDefined();
    });

    test('handles empty array', () => {
        const json = ExporterUtils.toJSON([]);
        expect(JSON.parse(json)).toEqual({});
    });
});

// ─── toTailwind ──────────────────────────────────────────

describe('ExporterUtils.toTailwind', () => {
    test('generates module.exports structure', () => {
        const output = ExporterUtils.toTailwind(sampleColors);
        expect(output).toContain('module.exports');
        expect(output).toContain('theme:');
        expect(output).toContain('colors:');
    });

    test('includes arbitrary value examples', () => {
        const output = ExporterUtils.toTailwind(sampleColors);
        expect(output).toContain('bg-[#');
        expect(output).toContain('text-[#');
    });

    test('strips -- prefix from keys', () => {
        const output = ExporterUtils.toTailwind(sampleColors);
        expect(output).toContain('"primary"');
        expect(output).not.toContain('"--primary"');
    });
});

// ─── toCMYK ──────────────────────────────────────────────

describe('ExporterUtils.toCMYK', () => {
    test('generates CMYK palette', () => {
        const output = ExporterUtils.toCMYK(sampleColors);
        expect(output).toContain('CMYK');
        expect(output).toContain('cmyk(');
    });

    test('black produces 100% K', () => {
        const output = ExporterUtils.toCMYK([{ name: 'black', value: '#000000' }]);
        expect(output).toContain('black: cmyk(0.0%, 0.0%, 0.0%, 100.0%)');
    });

    test('white produces 0% K', () => {
        const output = ExporterUtils.toCMYK([{ name: 'white', value: '#ffffff' }]);
        expect(output).toContain('white: cmyk(0.0%, 0.0%, 0.0%, 0.0%)');
    });

    test('pure red', () => {
        const output = ExporterUtils.toCMYK([{ name: 'red', value: '#ff0000' }]);
        expect(output).toContain('red: cmyk(0.0%, 100.0%, 100.0%, 0.0%)');
    });
});

// ─── toLAB ───────────────────────────────────────────────

describe('ExporterUtils.toLAB', () => {
    test('generates LAB palette', () => {
        const output = ExporterUtils.toLAB(sampleColors);
        expect(output).toContain('LAB');
        expect(output).toContain('lab(');
    });

    test('black LAB values are near zero', () => {
        const output = ExporterUtils.toLAB([{ value: '#000000' }]);
        // L=0, a≈0, b≈0
        expect(output).toContain('lab(');
        expect(output).toMatch(/lab\(\s*0\.00/);
    });
});

// ─── toOKLCH ─────────────────────────────────────────────

describe('ExporterUtils.toOKLCH', () => {
    test('generates OKLCH palette', () => {
        const output = ExporterUtils.toOKLCH(sampleColors);
        expect(output).toContain('OKLCH');
        expect(output).toContain('oklch(');
    });

    test('black OKLCH lightness is 0', () => {
        const output = ExporterUtils.toOKLCH([{ value: '#000000' }]);
        expect(output).toMatch(/oklch\(\s*0\.0%/);
    });
});

// ─── Source comments ─────────────────────────────────────

describe('ExporterUtils source comment handling', () => {
    test('toCSS includes source comment', () => {
        const css = ExporterUtils.toCSS([{ name: '--bg', value: '#fff', source: 'body' }]);
        expect(css).toContain('/* source: body */');
    });

    test('toJSON includes source field', () => {
        const json = ExporterUtils.toJSON([{ name: '--bg', value: '#fff', source: 'body' }]);
        const parsed = JSON.parse(json);
        expect(parsed['bg'].source).toBe('body');
    });

    test('toTailwind includes source comment', () => {
        const output = ExporterUtils.toTailwind([{ name: '--bg', value: '#fff', source: 'body' }]);
        expect(output).toContain('/* source: body */');
    });

    test('toCMYK includes source comment', () => {
        const output = ExporterUtils.toCMYK([{ name: 'bg', value: '#ffffff', source: 'body' }]);
        expect(output).toContain('/* source: body */');
    });

    test('toLAB includes source comment', () => {
        const output = ExporterUtils.toLAB([{ name: 'bg', value: '#ffffff', source: 'body' }]);
        expect(output).toContain('/* source: body */');
    });

    test('toOKLCH includes source comment', () => {
        const output = ExporterUtils.toOKLCH([{ name: 'bg', value: '#ffffff', source: 'body' }]);
        expect(output).toContain('/* source: body */');
    });

    test('_safeComment strips comment injection', () => {
        const safe = ExporterUtils._safeComment('test */ payload /* injected');
        expect(safe).not.toContain('*/');
        expect(safe).not.toContain('/*');
    });
});

// ─── Duplicate key dedup ─────────────────────────────────

describe('ExporterUtils duplicate key handling', () => {
    test('toJSON deduplicates identical keys', () => {
        const colors = [
            { name: '--primary', value: '#ff0000' },
            { name: '--primary', value: '#00ff00' },
        ];
        const json = ExporterUtils.toJSON(colors);
        const parsed = JSON.parse(json);
        expect(parsed['primary']).toBeDefined();
        expect(parsed['primary_1']).toBeDefined();
    });
});

// ─── CMYK edge cases ────────────────────────────────────

describe('ExporterUtils.toCMYK edge cases', () => {
    test('invalid hex produces 100% K with marker', () => {
        const output = ExporterUtils.toCMYK([{ name: 'bad', value: '#xyz' }]);
        expect(output).toContain('Invalid Hex');
    });

    test('missing value defaults gracefully', () => {
        const output = ExporterUtils.toCMYK([{ name: 'empty' }]);
        expect(output).toContain('empty:');
    });
});

// ─── Tailwind edge cases ────────────────────────────────

describe('ExporterUtils.toTailwind edge cases', () => {
    test('generates brand- key when no name or variable', () => {
        const spy = jest.spyOn(global.ColorNames, 'getName').mockReturnValue(null);

        const output = ExporterUtils.toTailwind([{ value: '#abcdef' }]);
        expect(output).toContain('"brand-abcdef"');

        spy.mockRestore();
    });

    test('uses ColorNames for semantic key when available', () => {
        const spy = jest.spyOn(global.ColorNames, 'getName').mockReturnValue('Coral Red');

        const output = ExporterUtils.toTailwind([{ value: '#ff5733' }]);
        expect(output).toContain('"coral-red"');

        spy.mockRestore();
    });
});

// ─── toJSON with ColorNames integration ──────────────────

describe('ExporterUtils.toJSON with ColorNames', () => {
    test('includes color name when available', () => {
        const spy = jest.spyOn(global.ColorNames, 'getName').mockImplementation((val) => (val === '#ff0000' ? 'Red' : null));

        const json = ExporterUtils.toJSON([{ name: '--primary', value: '#ff0000' }]);
        const parsed = JSON.parse(json);
        expect(parsed['primary'].name).toBe('Red');

        spy.mockRestore();
    });

    test('omits name when ColorNames returns same as value', () => {
        const spy = jest.spyOn(global.ColorNames, 'getName').mockImplementation((val) => val);

        const json = ExporterUtils.toJSON([{ name: '--primary', value: '#ff0000' }]);
        const parsed = JSON.parse(json);
        expect(parsed['primary'].name).toBeUndefined();

        spy.mockRestore();
    });
});
