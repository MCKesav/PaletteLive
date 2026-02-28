/**
 * PaletteLive - Color Utilities
 * Universal CSS color parsing — supports EVERY format Chrome can produce.
 *
 * Strategy: For unknown formats, we use a temporary DOM element to let the
 * BROWSER resolve colors to rgb()/rgba(), then parse that. This future-proofs
 * against any new color space Chrome adds.
 *
 * Formats handled:
 *  - hex:       #RGB, #RRGGBB, #RRGGBBAA
 *  - rgb/rgba:  rgb(R, G, B) / rgb(R G B) / rgba(R, G, B, A) / rgb(R G B / A)
 *  - hsl/hsla:  hsl(H, S%, L%) / hsl(H S% L%) / hsla(H, S%, L%, A)
 *  - hwb:       hwb(H W% B%)
 *  - oklch:     oklch(L C H) / oklch(L C H / A)
 *  - oklab:     oklab(L a b) / oklab(L a b / A)
 *  - lab:       lab(L a b)
 *  - lch:       lch(L C H)
 *  - color():   color(display-p3 R G B) / color(srgb ...) / color(a98-rgb ...) etc.
 *  - color-mix: resolved by browser before we see it
 *  - light-dark: resolved by browser before we see it
 *  - named:     red, blue, green, rebeccapurple, etc. (all 148 CSS named colors)
 */
// Guard against re-injection - use version to allow updates
if (typeof globalThis._colorUtilsVersion !== 'undefined' && globalThis._colorUtilsVersion === 3) {
    // Already loaded with same version — skip re-declaration
} else {
    // Clean up stale DOM node from previous injection before re-defining
    if (globalThis.ColorUtils && globalThis.ColorUtils._resolveViaDomEl) {
        try {
            globalThis.ColorUtils._resolveViaDomEl.remove();
        } catch (e) {}
        globalThis.ColorUtils._resolveViaDomEl = null;
    }
    globalThis._colorUtilsVersion = 3;
    const ColorUtils = {
        // ──────────────────────────────────────────────
        // Core: resolve ANY CSS color string to #rrggbb
        // ──────────────────────────────────────────────

        /**
         * Converts ANY valid CSS color string to 6-digit hex (#rrggbb).
         * Uses a temporary DOM element as the ultimate fallback so we never
         * miss a format the browser understands.
         * @param {string} input
         * @returns {string} lowercase #rrggbb
         */
        rgbToHex: (input) => {
            if (!input || typeof input !== 'string') return '#000000';
            const s = input.trim();
            if (!s) return '#000000';

            // ── Fast path: already hex ──
            if (s.startsWith('#')) {
                return ColorUtils._normalizeHex(s);
            }

            // ── Fast path: rgb/rgba (most common from getComputedStyle) ──
            if (s.startsWith('rgb')) {
                return ColorUtils._rgbStringToHex(s);
            }

            // ── oklch ── mathematical conversion (no DOM needed)
            if (s.startsWith('oklch')) {
                return ColorUtils._oklchStringToHex(s);
            }

            // ── oklab ── mathematical conversion
            if (s.startsWith('oklab')) {
                return ColorUtils._oklabStringToHex(s);
            }

            // ── Everything else: use DOM resolution ──
            // This handles hsl, hwb, lab, lch, color(), named colors,
            // and ANY future formats the browser supports.
            return ColorUtils._resolveViaDom(s);
        },

        // ──────────────────────────────────────────────
        // Hex utilities
        // ──────────────────────────────────────────────

        _normalizeHex: (hex) => {
            let h = hex.substring(1).toLowerCase();
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; // #RGBA → ignore alpha for 6-digit
            if (h.length > 6) h = h.substring(0, 6); // #RRGGBBAA → #RRGGBB
            if (!/^[0-9a-f]{6}$/.test(h)) return '#000000';
            return '#' + h;
        },

        /**
         * Normalize hex preserving alpha channel.
         * Returns #rrggbb if fully opaque, #rrggbbaa if alpha < 1.
         */
        _normalizeHex8: (hex) => {
            let h = hex.substring(1).toLowerCase();
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + 'ff';
            if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
            if (h.length === 6) h = h + 'ff';
            if (!/^[0-9a-f]{8}$/.test(h)) return '#000000ff';
            // Strip alpha if fully opaque
            if (h.endsWith('ff')) return '#' + h.substring(0, 6);
            return '#' + h;
        },

        hexToRgb: (hex) => {
            if (!hex || !hex.startsWith('#')) return { r: 0, g: 0, b: 0, a: 1 };
            let h = hex.substring(1).toLowerCase();
            // Expand shorthand
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
            const num = parseInt(h.substring(0, 6), 16);
            const a = h.length === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1;
            return {
                r: (num >> 16) & 255,
                g: (num >> 8) & 255,
                b: num & 255,
                a: Math.round(a * 1000) / 1000,
            };
        },

        /**
         * Convert hex to rgba css string with custom alpha.
         */
        toRgba: (hex, alpha) => {
            const rgb = ColorUtils.hexToRgb(hex);
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        },

        // ──────────────────────────────────────────────
        // RGB string parsing (handles both old & new syntax)
        // ──────────────────────────────────────────────

        _rgbStringToHex: (str) => {
            const nums = str.match(/[\d.]+/g);
            if (!nums || nums.length < 3) return '#000000';
            const r = Math.min(255, Math.max(0, Math.round(Number(nums[0]))));
            const g = Math.min(255, Math.max(0, Math.round(Number(nums[1]))));
            const b = Math.min(255, Math.max(0, Math.round(Number(nums[2]))));
            return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
        },

        /**
         * RGB/RGBA string to 8-digit hex (preserves alpha).
         * Returns #rrggbb if fully opaque, #rrggbbaa otherwise.
         */
        _rgbStringToHex8: (str) => {
            const nums = str.match(/[\d.]+/g);
            if (!nums || nums.length < 3) return '#000000';
            const r = Math.min(255, Math.max(0, Math.round(Number(nums[0]))));
            const g = Math.min(255, Math.max(0, Math.round(Number(nums[1]))));
            const b = Math.min(255, Math.max(0, Math.round(Number(nums[2]))));
            const a = nums.length >= 4 ? Number(nums[3]) : 1;
            const hex6 = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
            if (a >= 1) return hex6;
            const aa = Math.min(255, Math.max(0, Math.round(a * 255)));
            return hex6 + aa.toString(16).padStart(2, '0');
        },

        /**
         * Convert ANY CSS color to hex preserving alpha.
         * Returns #rrggbb if opaque, #rrggbbaa if translucent.
         *
         * Hot-path memoized: identical input strings (common from getComputedStyle)
         * return cached results. Cache is capped to prevent unbounded growth.
         */
        _rgbToHex8Cache: new Map(),
        _RGB_TO_HEX8_CACHE_MAX: 4000,

        rgbToHex8: (input) => {
            if (!input || typeof input !== 'string') return '#000000';
            const s = input.trim();
            if (!s) return '#000000';

            // Check memo cache
            const cached = ColorUtils._rgbToHex8Cache.get(s);
            if (cached !== undefined) return cached;

            let result;
            if (s.startsWith('#')) {
                result = ColorUtils._normalizeHex8(s);
            } else if (s.startsWith('rgb')) {
                result = ColorUtils._rgbStringToHex8(s);
            } else {
                // For other formats, fall back to DOM resolution which loses alpha
                // but at least returns a valid color
                result = ColorUtils.rgbToHex(s);
            }

            // Store in cache (evict all if too large — simple & fast)
            if (ColorUtils._rgbToHex8Cache.size >= ColorUtils._RGB_TO_HEX8_CACHE_MAX) {
                ColorUtils._rgbToHex8Cache.clear();
            }
            ColorUtils._rgbToHex8Cache.set(s, result);
            return result;
        },

        /**
         * Parse the alpha value from any CSS color string.
         * Returns 0-1 float (1 = fully opaque).
         */
        parseAlpha: (input) => {
            if (!input || typeof input !== 'string') return 1;
            const s = input.trim();
            if (s === 'transparent') return 0;
            // #RRGGBBAA
            if (s.startsWith('#') && (s.length === 5 || s.length === 9)) {
                let h = s.substring(1);
                if (h.length === 4) h = h[3] + h[3];
                else h = h.substring(6, 8);
                return parseInt(h, 16) / 255;
            }
            // rgba(r, g, b, a) or rgb(r g b / a)
            if (s.includes('/')) {
                const after = s.split('/')[1];
                if (after) {
                    const val = parseFloat(after.replace(')', '').trim());
                    if (!isNaN(val)) return val > 1 ? val / 100 : val;
                }
            }
            if (s.startsWith('rgba') || s.startsWith('hsla')) {
                const nums = s.match(/[\d.]+/g);
                if (nums && nums.length >= 4) {
                    const a = Number(nums[3]);
                    return a > 1 ? a / 100 : a;
                }
            }
            return 1;
        },

        // ──────────────────────────────────────────────
        // oklch / oklab mathematical conversion
        // ──────────────────────────────────────────────

        _oklchStringToHex: (str) => {
            const nums = str.match(/[\d.]+/g);
            if (!nums || nums.length < 3) return ColorUtils._resolveViaDom(str);
            const L = Number(nums[0]);
            const C = Number(nums[1]);
            const H = Number(nums[2]);
            // oklch → oklab
            const hRad = (H * Math.PI) / 180;
            const a = C * Math.cos(hRad);
            const b = C * Math.sin(hRad);
            return ColorUtils._oklabToHex(L, a, b);
        },

        _oklabStringToHex: (str) => {
            // oklab values can be negative (a, b channels)
            const nums = str.match(/-?[\d.]+/g);
            if (!nums || nums.length < 3) return ColorUtils._resolveViaDom(str);
            return ColorUtils._oklabToHex(Number(nums[0]), Number(nums[1]), Number(nums[2]));
        },

        _oklabToHex: (L, a, b) => {
            // oklab → LMS (cube-root domain)
            const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
            const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
            const s_ = L - 0.0894841775 * a - 1.291485548 * b;

            // Cube
            const l = l_ * l_ * l_;
            const m = m_ * m_ * m_;
            const s = s_ * s_ * s_;

            // LMS → linear sRGB
            const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
            const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
            const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

            // Linear → sRGB gamma
            const gamma = (c) => {
                if (c <= 0) return 0;
                if (c >= 1) return 1;
                return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
            };

            const r = Math.min(255, Math.max(0, Math.round(gamma(rLin) * 255)));
            const g = Math.min(255, Math.max(0, Math.round(gamma(gLin) * 255)));
            const bl = Math.min(255, Math.max(0, Math.round(gamma(bLin) * 255)));
            return '#' + [r, g, bl].map((c) => c.toString(16).padStart(2, '0')).join('');
        },

        // ──────────────────────────────────────────────
        // DOM-based resolution (universal fallback)
        // ──────────────────────────────────────────────

        /** Cached hidden element for _resolveViaDom to avoid DOM churn. */
        _resolveViaDomEl: null,

        /**
         * Resolve any CSS color the browser understands by setting it on a
         * temporary element and reading the resolved color property.
         *
         * Key insight: we set `color` and then read it back.
         * The browser resolves color-mix, light-dark, relative color syntax,
         * hsl, hwb, lab, lch, color(), named colors, etc., and returns
         * the computed value (usually rgb/oklch/oklab).
         */
        _resolveViaDom: (colorStr) => {
            if (typeof document === 'undefined') return ColorUtils._resolveViaCanvas(colorStr);
            try {
                // Reuse a hidden element to avoid repeated DOM create/append/remove
                let el = ColorUtils._resolveViaDomEl;
                if (!el || !el.isConnected) {
                    el = document.createElement('div');
                    el.style.display = 'none';
                    const root = document.body || document.documentElement;
                    if (root) root.appendChild(el);
                    ColorUtils._resolveViaDomEl = el;
                }
                el.style.color = ''; // Reset
                el.style.setProperty('color', colorStr, 'important');

                const computed = getComputedStyle(el).color;

                if (!computed || computed === colorStr) {
                    // Browser couldn't resolve it, or returned the same format
                    // Try canvas as last resort
                    return ColorUtils._resolveViaCanvas(colorStr);
                }

                // Recursively parse the resolved value (usually rgb/oklch/oklab)
                if (computed.startsWith('#')) return ColorUtils._normalizeHex(computed);
                if (computed.startsWith('rgb')) return ColorUtils._rgbStringToHex(computed);
                if (computed.startsWith('oklch')) return ColorUtils._oklchStringToHex(computed);
                if (computed.startsWith('oklab')) return ColorUtils._oklabStringToHex(computed);

                // If still something else, try canvas
                return ColorUtils._resolveViaCanvas(computed);
            } catch (e) {
                return ColorUtils._resolveViaCanvas(colorStr);
            }
        },

        /**
         * Canvas 2D context fallback. Handles hex, rgb, hsl, and named colors.
         * Does NOT handle oklch/oklab/lab/lch (canvas API limitation).
         * Uses a pooled canvas to avoid creating a new element per call.
         */
        _canvasCtx: null,
        _getCanvasCtx: () => {
            if (typeof document === 'undefined') return null;
            if (ColorUtils._canvasCtx === false) return null; // sentinel for failed creation
            if (!ColorUtils._canvasCtx) {
                try {
                    ColorUtils._canvasCtx = document.createElement('canvas').getContext('2d') || false;
                } catch (e) {
                    ColorUtils._canvasCtx = false;
                    return null;
                }
            }
            return ColorUtils._canvasCtx === false ? null : ColorUtils._canvasCtx;
        },

        _resolveViaCanvas: (colorStr) => {
            try {
                const ctx = ColorUtils._getCanvasCtx();
                if (!ctx) return '#000000';
                const pre = ctx.fillStyle;
                ctx.fillStyle = colorStr;
                const result = ctx.fillStyle;
                if (result === pre) return '#000000'; // Invalid — browser ignored assignment
                if (result.startsWith('#')) return result.toLowerCase();
                if (result.startsWith('rgb')) return ColorUtils._rgbStringToHex(result);
            } catch (e) {}
            return '#000000';
        },

        // ──────────────────────────────────────────────
        // Validation
        // ──────────────────────────────────────────────

        isValidColor: (color) => {
            if (!color || typeof color !== 'string') return false;
            const c = color.trim();
            if (!c) return false;

            // Quick checks for known prefixes
            if (c.startsWith('#') && /^#[0-9A-Fa-f]{3,8}$/.test(c)) return true;
            if (/^(rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\s*\(/.test(c)) return true;

            // Try DOM resolution for everything else (named colors, etc.)
            if (typeof document === 'undefined') return false;
            try {
                const el = document.createElement('div');
                el.style.color = '';
                el.style.color = c;
                return el.style.color !== '';
            } catch (e) {}
            return false;
        },

        // ──────────────────────────────────────────────
        // Luminance & Transparency
        // ──────────────────────────────────────────────

        getLuminance: (color) => {
            const hex = ColorUtils.rgbToHex(color);
            const rgb = ColorUtils.hexToRgb(hex);
            const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map((c) => {
                c = c / 255;
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        },

        isTransparent: (color) => {
            if (!color) return true;
            const c = color.trim();
            if (c === 'transparent') return true;
            if (c === 'rgba(0, 0, 0, 0)') return true;

            // 8-digit hex with zero alpha: #RRGGBB00
            if (c.startsWith('#')) {
                let h = c.substring(1).toLowerCase();
                if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
                if (h.length === 8 && h.endsWith('00')) return true;
            }

            // Modern syntax with "/" for alpha: rgb(0 0 0 / 0), oklch(0 0 0 / 0)
            if (c.includes('/')) {
                const afterSlash = c.split('/')[1];
                if (afterSlash) {
                    const alpha = parseFloat(afterSlash.replace(')', '').trim());
                    if (!isNaN(alpha) && alpha === 0) return true;
                }
            }

            // Legacy rgba/hsla with comma-separated alpha
            if (c.startsWith('rgba') || c.startsWith('hsla')) {
                const nums = c.match(/[\d.]+/g);
                if (nums && nums.length >= 4 && Number(nums[3]) === 0) return true;
            }

            return false;
        },

        /**
         * Compare two colors for similarity within a tolerance.
         * Useful for matching computed styles (which may drift slightly) against stored values.
         * @param {string} color1 - First color
         * @param {string} color2 - Second color
         * @param {number} tolerance - Max Euclidean distance (0-442). Default 5.
         * @returns {boolean}
         */
        areSimilar: (color1, color2, tolerance = 5) => {
            if (!color1 || !color2) return false;
            const rgb1 = ColorUtils.hexToRgb(ColorUtils.rgbToHex8(color1));
            const rgb2 = ColorUtils.hexToRgb(ColorUtils.rgbToHex8(color2));

            // Euclidean distance in RGBA space
            const distance = Math.sqrt(
                Math.pow(rgb1.r - rgb2.r, 2) +
                    Math.pow(rgb1.g - rgb2.g, 2) +
                    Math.pow(rgb1.b - rgb2.b, 2) +
                    Math.pow((rgb1.a - rgb2.a) * 255, 2) // Scale alpha to 0-255 range
            );

            return distance <= tolerance;
        },

        /**
         * Format a hex color for export, preserving alpha if present.
         * Returns rgba() string for translucent, hex for opaque.
         */
        hexToExportString: (hex) => {
            if (!hex || !hex.startsWith('#')) return hex;
            const rgb = ColorUtils.hexToRgb(hex);
            if (rgb.a < 1) {
                return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})`;
            }
            return ColorUtils._normalizeHex(hex);
        },
    };

    // Export
    if (typeof module !== 'undefined') module.exports = ColorUtils;
    else {
        Object.freeze(ColorUtils);
        globalThis.ColorUtils = ColorUtils;
    }
} // end re-injection guard
