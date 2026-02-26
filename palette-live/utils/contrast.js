/**
 * PaletteLive - Contrast Utilities
 * Calculates WCAG contrast ratios.
 */

// Guard against re-injection - use version to allow updates
if (typeof globalThis._contrastUtilsVersion !== 'undefined' && globalThis._contrastUtilsVersion >= 2) {
    // Already loaded with same version
} else {
    globalThis._contrastUtilsVersion = 2;

    const ContrastUtils = {
        /**
         * Calculates contrast ratio between two colors
         * @param {string} color1 - Foreground
         * @param {string} color2 - Background
         * @returns {number} Contrast ratio (1 to 21)
         */
        getRatio: (color1, color2) => {
            const ColorUtils = globalThis.ColorUtils;
            if (!ColorUtils) {
                console.warn('PaletteLive: ColorUtils not available for contrast calculation');
                return null;
            }
            const lum1 = ColorUtils.getLuminance(color1);
            const lum2 = ColorUtils.getLuminance(color2);
            const brightest = Math.max(lum1, lum2);
            const darkest = Math.min(lum1, lum2);
            return (brightest + 0.05) / (darkest + 0.05);
        },

        /**
         * Determines WCAG rating
         * @param {number} ratio
         * @returns {string} 'AAA', 'AA', 'AA Large', 'Fail'
         */
        getRating: (ratio) => {
            if (ratio === null || ratio === undefined) return 'Fail';
            if (ratio >= 7) return 'AAA';
            if (ratio >= 4.5) return 'AA';
            if (ratio >= 3) return 'AA Large'; // Acceptable for large text
            return 'Fail';
        },
    };

    if (typeof module !== 'undefined') module.exports = ContrastUtils;
    else globalThis.ContrastUtils = ContrastUtils;
} // end re-injection guard
