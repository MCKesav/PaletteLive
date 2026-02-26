/**
 * PaletteLive - Exporter Utilities
 * Generates code snippets for different formats.
 * Supports alpha channels and Tailwind arbitrary values.
 */

// Guard against duplicate injection
if (typeof globalThis.__plExporterLoaded !== 'undefined') {
    // Already loaded — skip re-definition
} else {
    globalThis.__plExporterLoaded = true;

    const ExporterUtils = {
        /** Sanitize a string for safe use inside CSS comments — strips comment-closing sequences. */
        _safeComment: (str) =>
            String(str || '')
                .replace(/\*\//g, '* /')
                .replace(/\/\*/g, '/ *'),

        /**
         * Generate CSS Variables
         * @param {Array} colors - Array of color objects { name/variable: '--name', value: '#hex' }
         * @returns {string} CSS code
         */
        toCSS: (colors) => {
            let css = ':root {\n';
            colors.forEach((c) => {
                const safeValue = String(c.value || '#000000');
                let name = c.name || c.variable || `--color-${safeValue.replace('#', '').substring(0, 6)}`;
                if (!name.startsWith('--')) name = '--' + name;
                // Preserve alpha in export values
                const exportValue =
                    typeof ColorUtils !== 'undefined' && ColorUtils.hexToExportString
                        ? ColorUtils.hexToExportString(safeValue)
                        : safeValue;
                const sourceComment = c.source ? ` /* source: ${ExporterUtils._safeComment(c.source)} */` : '';
                css += `  ${name}: ${exportValue};${sourceComment}\n`;
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
            colors.forEach((c) => {
                const safeValue = String(c.value || '#000000');
                const baseKey = (c.name || c.variable || `color-${safeValue.replace('#', '').substring(0, 6)}`).replace(
                    /^--/,
                    ''
                );

                let key = baseKey;
                let suffix = 1;
                while (tokens[key]) {
                    key = `${baseKey}_${suffix}`;
                    suffix++;
                }

                const exportValue =
                    typeof ColorUtils !== 'undefined' && ColorUtils.hexToExportString
                        ? ColorUtils.hexToExportString(safeValue)
                        : safeValue;
                // Include color name if available
                const colorName = typeof ColorNames !== 'undefined' ? ColorNames.getName(safeValue) : null;
                const entry = { value: exportValue };
                if (c.source) entry.source = c.source;
                if (colorName && colorName !== safeValue) entry.name = colorName;
                tokens[key] = entry;
            });
            return JSON.stringify(tokens, null, 2);
        },

        /**
         * Generate Tailwind Config with arbitrary value support.
         * Uses bg-[#hex] syntax for colors without standard Tailwind names.
         * @param {Array} colors
         * @returns {string} JS module code
         */
        toTailwind: (colors) => {
            let output = 'module.exports = {\n  theme: {\n    extend: {\n      colors: {\n';
            colors.forEach((c) => {
                let key = (c.name || c.variable || '').replace(/^--/, '');
                const safeValue = String(c.value || '#000000');
                // If no semantic name, generate one from color naming utility
                if (!key || /^color-[a-f0-9]{3,6}$/i.test(key)) {
                    if (typeof ColorNames !== 'undefined') {
                        const named = ColorNames.getName(safeValue);
                        if (named && named !== safeValue) {
                            key = named.toLowerCase().replace(/\s+/g, '-');
                        }
                    }
                }
                if (!key) {
                    key = `brand-${safeValue.replace('#', '').substring(0, 6)}`;
                }

                const exportValue =
                    typeof ColorUtils !== 'undefined' && ColorUtils.hexToExportString
                        ? ColorUtils.hexToExportString(safeValue)
                        : safeValue;
                const sourceComment = c.source ? ` /* source: ${ExporterUtils._safeComment(c.source)} */` : '';
                output += `        "${key}": '${exportValue}',${sourceComment}\n`;
            });
            output += '      }\n    }\n  }\n}';

            // Add comment with arbitrary value examples
            output += '\n\n/* Arbitrary value usage examples:\n';
            colors.slice(0, 3).forEach((c) => {
                const safeValue = String(c.value || '#000000');
                const hex = safeValue.replace('#', '').substring(0, 6);
                output += ` *  bg-[#${hex}]  text-[#${hex}]  border-[#${hex}]\n`;
            });
            output += ' */';

            return output;
        },

        // ──────────────────────────────────────────────
        //  CMYK Export
        // ──────────────────────────────────────────────

        /**
         * Convert hex → CMYK (device-independent approximation).
         * Returns a CSS-comment-style palette listing.
         */
        toCMYK: (colors) => {
            const lines = ['/* CMYK Color Palette */\n'];
            colors.forEach((c) => {
                const hex = (c.value || '').replace('#', '').substring(0, 6);
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;

                const label = c.name || c.variable || `#${hex}`;
                const sourceInfo = c.source ? ` /* source: ${ExporterUtils._safeComment(c.source)} */` : '';

                if (hex.length !== 6 || isNaN(r) || isNaN(g) || isNaN(b)) {
                    lines.push(`${label}: cmyk(0%, 0%, 0%, 100%)${sourceInfo} /* Invalid Hex */`);
                    return;
                }

                const k = 1 - Math.max(r, g, b);
                let cy = 0,
                    ma = 0,
                    ye = 0;
                if (k < 1) {
                    cy = (1 - r - k) / (1 - k);
                    ma = (1 - g - k) / (1 - k);
                    ye = (1 - b - k) / (1 - k);
                }
                lines.push(
                    `${label}: cmyk(${(cy * 100).toFixed(1)}%, ${(ma * 100).toFixed(1)}%, ${(ye * 100).toFixed(1)}%, ${(k * 100).toFixed(1)}%)${sourceInfo}`
                );
            });
            return lines.join('\n');
        },

        // ──────────────────────────────────────────────
        //  CIE LAB Export
        // ──────────────────────────────────────────────

        /**
         * Convert hex → CIE LAB (D65 illuminant).
         * Returns a palette listing with lab() values.
         */
        toLAB: (colors) => {
            function _channelToLinear(v) {
                v = v / 255;
                return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            }
            function _hexToLab(hex) {
                hex = hex.replace('#', '').substring(0, 6);
                if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { l: 0, a: 0, b: 0 };
                const r = _channelToLinear(parseInt(hex.substring(0, 2), 16));
                const g = _channelToLinear(parseInt(hex.substring(2, 4), 16));
                const b = _channelToLinear(parseInt(hex.substring(4, 6), 16));
                let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
                let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
                let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
                const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
                x = f(x);
                y = f(y);
                z = f(z);
                return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
            }

            const lines = ['/* CIE LAB Color Palette (D65) */\n'];
            colors.forEach((c) => {
                const lab = _hexToLab(c.value || '#000000');
                const label = c.name || c.variable || c.value;
                const sourceInfo = c.source ? ` /* source: ${ExporterUtils._safeComment(c.source)} */` : '';
                lines.push(`${label}: lab(${lab.l.toFixed(2)}% ${lab.a.toFixed(2)} ${lab.b.toFixed(2)})${sourceInfo}`);
            });
            return lines.join('\n');
        },

        // ──────────────────────────────────────────────
        //  OKLCH Export
        // ──────────────────────────────────────────────

        /**
         * Convert hex → OKLCH (perceptually uniform CSS color).
         * Uses the OKLab → OKLCH polar conversion.
         * Returns modern CSS oklch() values.
         */
        toOKLCH: (colors) => {
            function _channelToLinear(v) {
                v = v / 255;
                return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            }
            function _hexToOklch(hex) {
                hex = hex.replace('#', '').substring(0, 6);
                if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { l: 0, c: 0, h: 0 };
                const r = _channelToLinear(parseInt(hex.substring(0, 2), 16));
                const g = _channelToLinear(parseInt(hex.substring(2, 4), 16));
                const b = _channelToLinear(parseInt(hex.substring(4, 6), 16));
                // sRGB linear → OKLab via LMS
                const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
                const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
                const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
                const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
                const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
                const bOk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
                const C = Math.sqrt(a * a + bOk * bOk);
                let H = Math.atan2(bOk, a) * (180 / Math.PI);
                if (H < 0) H += 360;
                return { l: L, c: C, h: H };
            }

            const lines = ['/* OKLCH Color Palette */\n'];
            lines.push('/* oklch(Lightness  Chroma  Hue) — modern CSS perceptual color */\n');
            colors.forEach((c) => {
                const oklch = _hexToOklch(c.value || '#000000');
                const label = c.name || c.variable || c.value;
                const sourceInfo = c.source ? ` /* source: ${ExporterUtils._safeComment(c.source)} */` : '';
                lines.push(
                    `${label}: oklch(${(oklch.l * 100).toFixed(1)}% ${oklch.c.toFixed(4)} ${oklch.h.toFixed(1)})${sourceInfo}`
                );
            });
            return lines.join('\n');
        },
    };

    if (typeof module !== 'undefined') module.exports = ExporterUtils;
    else globalThis.ExporterUtils = ExporterUtils;
} // end re-injection guard
