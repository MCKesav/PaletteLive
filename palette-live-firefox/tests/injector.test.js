/**
 * Tests for PaletteLive Injector
 * Tests the deep merge fix and CSS sanitization.
 */

describe('Injector', () => {
    let Injector;

    beforeEach(() => {
        // Reset module state
        delete window._injectorVersion;
        delete window.Injector;

        // Clear any existing style tags
        const existing = document.getElementById('palettelive-overrides');
        if (existing) existing.remove();

        // Reset Jest module registry so the IIFE re-executes
        jest.resetModules();

        // Load the injector fresh
        require('../content/injector');
        Injector = window.Injector;
    });

    afterEach(() => {
        if (Injector) Injector.reset();
    });

    test('init creates style element', () => {
        Injector.init();
        expect(document.getElementById('palettelive-overrides')).toBeTruthy();
    });

    test('apply sets CSS variables', () => {
        Injector.apply({ variables: { '--pl-bg': '#ff0000' } });
        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).toContain('--pl-bg: #ff0000 !important');
    });

    test('apply deep-merges selector rules', () => {
        // First call: set background-color
        Injector.apply({
            selectors: {
                '.pl-test': { 'background-color': 'red' },
            },
        });

        // Second call: add color to same selector
        Injector.apply({
            selectors: {
                '.pl-test': { color: 'blue' },
            },
        });

        // Both properties should be present
        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).toContain('background-color: red !important');
        expect(style.textContent).toContain('color: blue !important');
    });

    test('apply overwrites same property in selector', () => {
        Injector.apply({
            selectors: { '.pl-test': { color: 'red' } },
        });
        Injector.apply({
            selectors: { '.pl-test': { color: 'blue' } },
        });

        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).toContain('color: blue !important');
        expect(style.textContent).not.toContain('color: red');
    });

    test('reset clears state and style content', () => {
        Injector.apply({ variables: { '--pl-bg': '#ff0000' } });
        Injector.reset();
        expect(Injector.state.variables).toEqual({});
        expect(Injector.state.selectors).toEqual({});
        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).toBe('');
    });

    // ── Sanitization tests ──

    test('rejects invalid CSS variable names', () => {
        Injector.apply({ variables: { 'not-a-var': '#ff0000', '--valid-var': '#00ff00' } });
        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).not.toContain('not-a-var');
        expect(style.textContent).toContain('--valid-var');
    });

    test('rejects CSS values with injection chars', () => {
        Injector.apply({ variables: { '--pl-test': 'red; } body { display: none' } });
        const style = document.getElementById('palettelive-overrides');
        // The injection attempt (breakout via braces/semicolons) should be neutralized
        // Braces are stripped so no new CSS block is created
        expect(style.textContent).not.toContain('} body {');
        // Semicolons are stripped so the value can't terminate early
        expect(style.textContent).not.toMatch(/red\s*;/);
        // The variable should still be applied (with stripped/sanitized value)
        expect(style.textContent).toContain('--pl-test');
    });

    test('rejects invalid selectors', () => {
        Injector.apply({
            selectors: {
                'body': { color: 'red' },        // not a .pl- class
                '.pl-valid': { color: 'blue' },   // valid
            },
        });
        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).not.toMatch(/\bbody\b/);
        expect(style.textContent).toContain('.pl-valid');
    });

    test('rejects invalid property names', () => {
        Injector.apply({
            selectors: {
                '.pl-test': {
                    'color': 'red',
                    'INVALID_PROP': 'blue',
                },
            },
        });
        const style = document.getElementById('palettelive-overrides');
        expect(style.textContent).toContain('color: red');
        expect(style.textContent).not.toContain('INVALID_PROP');
    });
});
