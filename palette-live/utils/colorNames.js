/**
 * PaletteLive - Color Naming Utility
 * Lightweight nearest-color lookup for human-readable color names.
 * Uses a curated set of ~100 named colors for fast matching.
 */

// Guard against re-injection - use version to allow updates
const _COLOR_NAMES_VERSION = 2;
if (window._colorNamesVersion === _COLOR_NAMES_VERSION) {
  // Already loaded with same version
} else {
  window._colorNamesVersion = _COLOR_NAMES_VERSION;

const ColorNames = {
    // Curated named colors: [name, hex]
    _palette: [
        ['Black', '#000000'], ['White', '#ffffff'],
        ['Red', '#ff0000'], ['Lime', '#00ff00'], ['Blue', '#0000ff'],
        ['Yellow', '#ffff00'], ['Cyan', '#00ffff'], ['Magenta', '#ff00ff'],
        ['Silver', '#c0c0c0'], ['Gray', '#808080'], ['Maroon', '#800000'],
        ['Olive', '#808000'], ['Green', '#008000'], ['Purple', '#800080'],
        ['Teal', '#008080'], ['Navy', '#000080'],
        ['Dark Red', '#8b0000'], ['Brown', '#a52a2a'], ['Firebrick', '#b22222'],
        ['Crimson', '#dc143c'], ['Tomato', '#ff6347'], ['Coral', '#ff7f50'],
        ['Indian Red', '#cd5c5c'], ['Light Coral', '#f08080'], ['Salmon', '#fa8072'],
        ['Light Salmon', '#ffa07a'], ['Orange Red', '#ff4500'], ['Dark Orange', '#ff8c00'],
        ['Orange', '#ffa500'], ['Gold', '#ffd700'], ['Dark Khaki', '#bdb76b'],
        ['Khaki', '#f0e68c'], ['Yellow Green', '#9acd32'], ['Dark Green', '#006400'],
        ['Forest Green', '#228b22'], ['Sea Green', '#2e8b57'], ['Spring Green', '#00ff7f'],
        ['Medium Spring Green', '#00fa9a'], ['Light Green', '#90ee90'], ['Pale Green', '#98fb98'],
        ['Dark Cyan', '#008b8b'], ['Light Sea Green', '#20b2aa'], ['Cadet Blue', '#5f9ea0'],
        ['Dark Turquoise', '#00ced1'], ['Turquoise', '#40e0d0'], ['Medium Turquoise', '#48d1cc'],
        ['Aquamarine', '#7fffd4'], ['Steel Blue', '#4682b4'], ['Cornflower Blue', '#6495ed'],
        ['Deep Sky Blue', '#00bfff'], ['Dodger Blue', '#1e90ff'], ['Light Blue', '#add8e6'],
        ['Sky Blue', '#87ceeb'], ['Light Sky Blue', '#87cefa'], ['Midnight Blue', '#191970'],
        ['Dark Blue', '#00008b'], ['Medium Blue', '#0000cd'], ['Royal Blue', '#4169e1'],
        ['Blue Violet', '#8a2be2'], ['Indigo', '#4b0082'], ['Dark Slate Blue', '#483d8b'],
        ['Slate Blue', '#6a5acd'], ['Medium Slate Blue', '#7b68ee'], ['Medium Purple', '#9370db'],
        ['Dark Magenta', '#8b008b'], ['Dark Violet', '#9400d3'], ['Dark Orchid', '#9932cc'],
        ['Medium Orchid', '#ba55d3'], ['Plum', '#dda0dd'], ['Violet', '#ee82ee'],
        ['Orchid', '#da70d6'], ['Hot Pink', '#ff69b4'], ['Deep Pink', '#ff1493'],
        ['Medium Violet Red', '#c71585'], ['Pale Violet Red', '#db7093'], ['Pink', '#ffc0cb'],
        ['Light Pink', '#ffb6c1'], ['Antique White', '#faebd7'], ['Beige', '#f5f5dc'],
        ['Bisque', '#ffe4c4'], ['Blanched Almond', '#ffebcd'], ['Wheat', '#f5deb3'],
        ['Corn Silk', '#fff8dc'], ['Lemon Chiffon', '#fffacd'], ['Ivory', '#fffff0'],
        ['Lavender', '#e6e6fa'], ['Misty Rose', '#ffe4e1'], ['Seashell', '#fff5ee'],
        ['Linen', '#faf0e6'], ['Snow', '#fffafa'], ['Ghost White', '#f8f8ff'],
        ['Alice Blue', '#f0f8ff'], ['Honeydew', '#f0fff0'], ['Mint Cream', '#f5fffa'],
        ['Azure', '#f0ffff'], ['Peach Puff', '#ffdab9'], ['Sandy Brown', '#f4a460'],
        ['Chocolate', '#d2691e'], ['Sienna', '#a0522d'], ['Saddle Brown', '#8b4513'],
        ['Peru', '#cd853f'], ['Tan', '#d2b48c'], ['Rosy Brown', '#bc8f8f'],
        ['Dark Gray', '#a9a9a9'], ['Dim Gray', '#696969'], ['Light Gray', '#d3d3d3'],
        ['Gainsboro', '#dcdcdc'], ['White Smoke', '#f5f5f5'], ['Dark Slate Gray', '#2f4f4f'],
        ['Slate Gray', '#708090'], ['Light Slate Gray', '#778899']
    ],

    // Pre-computed RGB values for distance calculation
    _rgbCache: null,

    _ensureCache() {
        if (this._rgbCache) return;
        this._rgbCache = this._palette.map(([name, hex]) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return { name, hex, r, g, b };
        });
    },

    /**
     * Find the nearest human-readable color name for a hex value.
     * Uses weighted Euclidean distance in RGB space (redmean approximation).
     * @param {string} hex - #rrggbb
     * @returns {{ name: string, hex: string, distance: number }}
     */
    nearest(hex) {
        this._ensureCache();
        if (!hex || !hex.startsWith('#')) return { name: 'Unknown', hex: '#000000', distance: Infinity };

        const h = hex.replace('#', '').substring(0, 6).toLowerCase();
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);

        let bestName = 'Unknown';
        let bestHex = '#000000';
        let bestDist = Infinity;

        for (const entry of this._rgbCache) {
            // Redmean weighted distance — better perceptual accuracy than plain Euclidean
            const rMean = (r + entry.r) / 2;
            const dR = r - entry.r;
            const dG = g - entry.g;
            const dB = b - entry.b;
            const dist = Math.sqrt(
                (2 + rMean / 256) * dR * dR +
                4 * dG * dG +
                (2 + (255 - rMean) / 256) * dB * dB
            );

            if (dist < bestDist) {
                bestDist = dist;
                bestName = entry.name;
                bestHex = entry.hex;
                if (dist === 0) break; // Exact match
            }
        }

        return { name: bestName, hex: bestHex, distance: bestDist };
    },

    /**
     * Get a display-friendly name for a hex color.
     * If the color is very close to a named color, returns the name.
     * Otherwise returns the hex value.
     * @param {string} hex - #rrggbb
     * @param {number} threshold - max distance for name match (default 30)
     * @returns {string} human-readable name or hex
     */
    getName(hex, threshold = 30) {
        const result = this.nearest(hex);
        if (result.distance <= threshold) return result.name;
        return hex;
    }
};

if (typeof module !== 'undefined') module.exports = ColorNames;
else window.ColorNames = ColorNames;

} // end re-injection guard
