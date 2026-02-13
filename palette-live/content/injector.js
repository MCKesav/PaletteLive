/**
 * PaletteLive - Injector
 * Handles CSS injection for live editing.
 */

const Injector = {
    styleId: 'palettelive-overrides',

    /**
     * Initialize override stylesheet
     */
    init: () => {
        let style = document.getElementById(Injector.styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = Injector.styleId;
            document.head.appendChild(style);
        }
    },

    state: {
        variables: {},
        selectors: {}
    },

    /**
     * Apply overrides
     * @param {Object} overrides - key-value pairs of CSS variables or selectors
     */
    apply: (overrides) => {
        Injector.init();

        // Merge state
        if (overrides.variables) {
            Object.assign(Injector.state.variables, overrides.variables);
        }
        if (overrides.selectors) {
            Object.assign(Injector.state.selectors, overrides.selectors);
        }

        const style = document.getElementById(Injector.styleId);
        let css = ':root {\n';

        // Handle CSS Variables
        for (const [key, value] of Object.entries(Injector.state.variables)) {
            css += `  ${key}: ${value} !important;\n`;
        }

        css += '}\n';

        // Handle specific selector overrides
        for (const [selector, rules] of Object.entries(Injector.state.selectors)) {
            css += `${selector} {\n`;
            for (const [prop, val] of Object.entries(rules)) {
                css += `  ${prop}: ${val} !important;\n`;
            }
            css += '}\n';
        }

        style.textContent = css;
    },

    /**
     * Reset all overrides
     */
    reset: () => {
        Injector.state = { variables: {}, selectors: {} };
        const style = document.getElementById(Injector.styleId);
        if (style) {
            style.textContent = '';
        }
    }
};

window.Injector = Injector;
