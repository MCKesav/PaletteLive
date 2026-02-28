/**
 * Tests for PaletteLive ShadowWalker
 * Tests depth limit, element cap, early exit, and closed shadow detection.
 */

describe('ShadowWalker', () => {
    let ShadowWalker;

    beforeEach(() => {
        // Reset module state
        delete window._shadowWalkerVersion;
        delete window.ShadowWalker;

        // Reset Jest module registry so the IIFE re-executes
        jest.resetModules();

        require('../content/shadowWalker');
        ShadowWalker = window.ShadowWalker;
    });

    afterEach(() => {
        // Clean up any elements added to the DOM
        document.body.innerHTML = '';
    });

    test('walk visits all elements in a simple tree', () => {
        const container = document.createElement('div');
        const child1 = document.createElement('span');
        const child2 = document.createElement('p');
        container.appendChild(child1);
        container.appendChild(child2);
        document.body.appendChild(container);

        const visited = [];
        ShadowWalker.walk(container, (el) => visited.push(el));

        expect(visited).toContain(container);
        expect(visited).toContain(child1);
        expect(visited).toContain(child2);
        expect(visited.length).toBe(3);

        document.body.removeChild(container);
    });

    test('walk skips null root', () => {
        const visited = [];
        ShadowWalker.walk(null, (el) => visited.push(el));
        expect(visited.length).toBe(0);
    });

    test('walk respects callback return false for early exit', () => {
        const container = document.createElement('div');
        for (let i = 0; i < 10; i++) {
            container.appendChild(document.createElement('span'));
        }
        document.body.appendChild(container);

        const visited = [];
        ShadowWalker.walk(container, (el) => {
            visited.push(el);
            if (visited.length >= 3) return false; // stop after 3
        });

        expect(visited.length).toBe(3);
        document.body.removeChild(container);
    });

    test('getAllElements respects MAX_ELEMENTS cap', () => {
        const container = document.createElement('div');
        // Create more elements than a small cap
        const origMax = ShadowWalker.MAX_ELEMENTS;
        try {
            ShadowWalker.MAX_ELEMENTS = 5;

            for (let i = 0; i < 20; i++) {
                container.appendChild(document.createElement('span'));
            }
            document.body.appendChild(container);

            const elements = ShadowWalker.getAllElements();
            expect(elements.length).toBeLessThanOrEqual(5);
        } finally {
            // Restore
            ShadowWalker.MAX_ELEMENTS = origMax;
        }
    });

    test('walk respects MAX_SHADOW_DEPTH', () => {
        // We can't easily create 30+ nested shadow DOMs in jsdom,
        // but we can test the depth parameter directly
        const container = document.createElement('div');
        document.body.appendChild(container);

        const visited = [];
        // Call with depth beyond max — should return immediately
        ShadowWalker.walk(container, (el) => visited.push(el), ShadowWalker.MAX_SHADOW_DEPTH + 1);
        expect(visited.length).toBe(0);

        document.body.removeChild(container);
    });

    test('walk visits shadow DOM root at depth 0', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const visited = [];
        ShadowWalker.walk(container, (el) => visited.push(el), 0);
        expect(visited).toContain(container);

        document.body.removeChild(container);
    });

    test('getAllElements resets closedShadowCount', () => {
        ShadowWalker.closedShadowCount = 5;
        ShadowWalker.getAllElements();
        expect(ShadowWalker.closedShadowCount).toBe(0);
    });

    test('walk detects closed shadow hosts (custom elements with dashes)', () => {
        const container = document.createElement('div');
        // Use a custom element tag (contains '-') — these are the only elements that
        // realistically use closed shadow roots. Plain divs are now excluded by the heuristic.
        const host = document.createElement('x-widget');
        // Ensure no children so heuristic triggers
        container.appendChild(host);
        document.body.appendChild(container);

        ShadowWalker.closedShadowCount = 0;
        ShadowWalker.walk(container, () => {});

        // x-widget has a tagName with '-', no shadowRoot, and no children → should be counted
        expect(ShadowWalker.closedShadowCount).toBe(1);
    });

    test('walk does not count plain divs as closed shadow hosts', () => {
        const container = document.createElement('div');
        const child = document.createElement('div'); // no '-' in tagName
        container.appendChild(child);
        document.body.appendChild(container);

        ShadowWalker.closedShadowCount = 0;
        ShadowWalker.walk(container, () => {});

        // Regular divs should NOT be counted even if they have no children
        expect(ShadowWalker.closedShadowCount).toBe(0);
    });
});
