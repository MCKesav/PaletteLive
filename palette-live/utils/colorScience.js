/**
 * PaletteLive - Color Science Utilities
 * Shared CIELAB, CIEDE2000, and HSL conversion functions.
 * Used by popup.js palette logic and potentially by any future module
 * that needs perceptual color distance or HSL conversion.
 */

// Guard against re-injection
if (typeof globalThis._colorScienceVersion !== 'undefined' && globalThis._colorScienceVersion === 1) {
    // Already loaded with same version
} else {
    globalThis._colorScienceVersion = 1;

    const ColorScience = {
        /**
         * Linearize an sRGB channel (0–255) → linear-light (0–1).
         * @param {number} value - sRGB channel value (0–255)
         * @returns {number}
         */
        channelToLinear(value) {
            const clamped = Math.max(0, Math.min(255, value));
            const v = clamped / 255;
            return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        },

        /**
         * Convert a hex color to CIELAB (D65 illuminant).
         * Requires globalThis.ColorUtils.hexToRgb.
         * @param {string} hex - e.g. '#3b82f6'
         * @returns {{ l: number, a: number, b: number }}
         */
        hexToLab(hex) {
            const ColorUtils = globalThis.ColorUtils;
            if (!ColorUtils || typeof ColorUtils.hexToRgb !== 'function') {
                return { l: 0, a: 0, b: 0 };
            }
            const rgb = ColorUtils.hexToRgb(hex);
            if (!rgb) return { l: 0, a: 0, b: 0 };
            const r = this.channelToLinear(rgb.r);
            const g = this.channelToLinear(rgb.g);
            const b = this.channelToLinear(rgb.b);

            const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
            const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
            const z = (r * 0.0193 + g * 0.1192 + b * 0.9503041) / 1.08883;

            const fx = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
            const fy = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
            const fz = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

            return {
                l: 116 * fy - 16,
                a: 500 * (fx - fy),
                b: 200 * (fy - fz),
            };
        },

        /**
         * CIEDE2000 colour-difference (ΔE₀₀).
         * More perceptually uniform than CIE76 Euclidean distance,
         * especially for blues, grays, and low-chroma colours.
         * Reference: Sharma, Wu, Dalal (2005).
         * @param {{ l: number, a: number, b: number }} lab1
         * @param {{ l: number, a: number, b: number }} lab2
         * @returns {number}
         */
        ciede2000(lab1, lab2) {
            const { l: L1, a: a1, b: b1 } = lab1;
            const { l: L2, a: a2, b: b2 } = lab2;
            const RAD = Math.PI / 180;
            const DEG = 180 / Math.PI;

            const Cab1 = Math.sqrt(a1 * a1 + b1 * b1);
            const Cab2 = Math.sqrt(a2 * a2 + b2 * b2);
            const CabAvg7 = Math.pow((Cab1 + Cab2) / 2, 7);
            const G = 0.5 * (1 - Math.sqrt(CabAvg7 / (CabAvg7 + 6103515625))); // 25^7
            const ap1 = a1 * (1 + G);
            const ap2 = a2 * (1 + G);
            const Cp1 = Math.sqrt(ap1 * ap1 + b1 * b1);
            const Cp2 = Math.sqrt(ap2 * ap2 + b2 * b2);

            let hp1 = Math.atan2(b1, ap1) * DEG;
            if (hp1 < 0) hp1 += 360;
            let hp2 = Math.atan2(b2, ap2) * DEG;
            if (hp2 < 0) hp2 += 360;

            const dLp = L2 - L1;
            const dCp = Cp2 - Cp1;

            let dhp;
            if (Cp1 * Cp2 === 0) {
                dhp = 0;
            } else if (Math.abs(hp2 - hp1) <= 180) {
                dhp = hp2 - hp1;
            } else if (hp2 - hp1 > 180) {
                dhp = hp2 - hp1 - 360;
            } else {
                dhp = hp2 - hp1 + 360;
            }
            const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp / 2) * RAD);

            const Lpm = (L1 + L2) / 2;
            const Cpm = (Cp1 + Cp2) / 2;

            let hpm;
            if (Cp1 * Cp2 === 0) {
                hpm = hp1 + hp2;
            } else if (Math.abs(hp1 - hp2) <= 180) {
                hpm = (hp1 + hp2) / 2;
            } else if (hp1 + hp2 < 360) {
                hpm = (hp1 + hp2 + 360) / 2;
            } else {
                hpm = (hp1 + hp2 - 360) / 2;
            }

            const T =
                1 -
                0.17 * Math.cos((hpm - 30) * RAD) +
                0.24 * Math.cos(2 * hpm * RAD) +
                0.32 * Math.cos((3 * hpm + 6) * RAD) -
                0.2 * Math.cos((4 * hpm - 63) * RAD);

            const Lpm50sq = (Lpm - 50) * (Lpm - 50);
            const SL = 1 + (0.015 * Lpm50sq) / Math.sqrt(20 + Lpm50sq);
            const SC = 1 + 0.045 * Cpm;
            const SH = 1 + 0.015 * Cpm * T;

            const CpmPow7 = Math.pow(Cpm, 7);
            const RC = 2 * Math.sqrt(CpmPow7 / (CpmPow7 + 6103515625));
            const dTheta = 30 * Math.exp(-((hpm - 275) / 25) * ((hpm - 275) / 25));
            const RT = -Math.sin(2 * dTheta * RAD) * RC;

            const LTerm = dLp / SL;
            const CTerm = dCp / SC;
            const HTerm = dHp / SH;

            return Math.sqrt(LTerm * LTerm + CTerm * CTerm + HTerm * HTerm + RT * CTerm * HTerm);
        },

        /**
         * Extract hue (0–360), saturation (0–100), lightness (0–100) from hex.
         * @param {string} hex
         * @returns {{ h: number, s: number, l: number }}
         */
        hexToHsl(hex) {
            const ColorUtils = globalThis.ColorUtils;
            if (!ColorUtils || typeof ColorUtils.hexToRgb !== 'function') return { h: 0, s: 0, l: 0 };
            const rgb = ColorUtils.hexToRgb(hex);
            if (!rgb) return { h: 0, s: 0, l: 0 };
            const r = rgb.r / 255,
                g = rgb.g / 255,
                b = rgb.b / 255;
            const max = Math.max(r, g, b),
                min = Math.min(r, g, b);
            let h = 0,
                s = 0;
            const l = (max + min) / 2;
            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                else if (max === g) h = ((b - r) / d + 2) / 6;
                else h = ((r - g) / d + 4) / 6;
            }
            return { h: h * 360, s: s * 100, l: l * 100 };
        },

        /**
         * Convert HSL to hex string.
         * @param {number} h - Hue (0–360)
         * @param {number} s - Saturation (0–100)
         * @param {number} l - Lightness (0–100)
         * @returns {string} e.g. '#3b82f6'
         */
        hslToHex(h, s, l) {
            const light = l / 100;
            const a = (s * Math.min(light, 1 - light)) / 100;
            const f = (n) => {
                const k = (n + h / 30) % 12;
                const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.min(255, Math.max(0, Math.round(255 * color)))
                    .toString(16)
                    .padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        },
    };

    if (typeof module !== 'undefined') {
        try {
            if (!globalThis.ColorUtils) {
                globalThis.ColorUtils = require('./colorUtils');
            }
        } catch (e) { /* optional peer dependency */ }
        module.exports = ColorScience;
    } else {
        globalThis.ColorScience = ColorScience;
    }
} // end re-injection guard
