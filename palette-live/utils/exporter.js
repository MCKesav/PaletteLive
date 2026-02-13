/**
 * PaletteLive - Exporter Utilities
 * Generates code snippets for different formats.
 */

const ExporterUtils = {
    /**
     * Generate CSS Variables
     * @param {Array} colors - Array of color objects { name/variable: '--name', value: '#hex' }
     * @returns {string} CSS code
     */
    toCSS: (colors) => {
        let css = ':root {\n';
        colors.forEach(c => {
            const name = c.name || c.variable || `--color-${c.value.replace('#', '')}`;
            css += `  ${name}: ${c.value};\n`;
        });
        css += '}';
        return css;
    },

    /**
     * Generate JSON Token format
     * @param {Array} colors
     * @returns {string} JSON string
     */
    toJSON: (colors) => {
        const tokens = {};
        colors.forEach(c => {
            const key = (c.name || c.variable || `color-${c.value.replace('#', '')}`).replace(/^--/, '');
            tokens[key] = c.value;
        });
        return JSON.stringify(tokens, null, 2);
    },

    /**
     * Generate Tailwind Config
     * @param {Array} colors
     * @returns {string} JS module code
     */
    toTailwind: (colors) => {
        let output = 'module.exports = {\n  theme: {\n    extend: {\n      colors: {\n';
        colors.forEach(c => {
            const key = (c.name || c.variable || `brand-${c.value.replace('#', '')}`).replace(/^--/, '');
            output += `        '${key}': '${c.value}',\n`;
        });
        output += '      }\n    }\n  }\n}';
        return output;
    }
};

if (typeof module !== 'undefined') module.exports = ExporterUtils;
else window.ExporterUtils = ExporterUtils;
