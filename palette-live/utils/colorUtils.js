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
    if (h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; // #RGBA → ignore alpha
    if (h.length > 6) h = h.substring(0, 6); // #RRGGBBAA → #RRGGBB
    if (!/^[0-9a-f]{6}$/.test(h)) return '#000000';
    return '#' + h;
  },

  hexToRgb: (hex) => {
    if (!hex || !hex.startsWith('#')) return { r: 0, g: 0, b: 0, a: 1 };
    const h = ColorUtils._normalizeHex(hex).substring(1);
    const num = parseInt(h, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: 1
    };
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
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
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
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    // Cube
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    // LMS → linear sRGB
    let rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    let gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    let bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    // Linear → sRGB gamma
    const gamma = (c) => {
      if (c <= 0) return 0;
      if (c >= 1) return 1;
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };

    const r = Math.min(255, Math.max(0, Math.round(gamma(rLin) * 255)));
    const g = Math.min(255, Math.max(0, Math.round(gamma(gLin) * 255)));
    const bl = Math.min(255, Math.max(0, Math.round(gamma(bLin) * 255)));
    return '#' + [r, g, bl].map(c => c.toString(16).padStart(2, '0')).join('');
  },

  // ──────────────────────────────────────────────
  // DOM-based resolution (universal fallback)
  // ──────────────────────────────────────────────

  /**
   * Resolve any CSS color the browser understands by setting it on a
   * temporary element and reading the resolved background-color.
   * 
   * Key insight: we set `background-color` and then read it back.
   * The browser resolves color-mix, light-dark, relative color syntax,
   * hsl, hwb, lab, lch, color(), named colors, etc., and returns
   * the computed value (usually rgb/oklch/oklab).
   */
  _resolveViaDom: (colorStr) => {
    try {
      // Create a hidden element
      const el = document.createElement('div');
      el.style.display = 'none';
      el.style.color = ''; // Reset
      el.style.setProperty('color', colorStr, 'important');
      document.body.appendChild(el);

      const computed = getComputedStyle(el).color;
      document.body.removeChild(el);

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
   */
  _resolveViaCanvas: (colorStr) => {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = '#000001'; // Sentinel
      ctx.fillStyle = colorStr;
      const result = ctx.fillStyle;
      if (result === '#000001') return '#000000'; // Invalid color
      if (result.startsWith('#')) return result.toLowerCase();
      if (result.startsWith('rgb')) return ColorUtils._rgbStringToHex(result);
    } catch (e) { }
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
    try {
      const el = document.createElement('div');
      el.style.color = '';
      el.style.color = c;
      return el.style.color !== '';
    } catch (e) { }
    return false;
  },

  // ──────────────────────────────────────────────
  // Luminance & Transparency
  // ──────────────────────────────────────────────

  getLuminance: (color) => {
    const hex = ColorUtils.rgbToHex(color);
    const rgb = ColorUtils.hexToRgb(hex);
    const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map(c => {
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

    // Modern syntax with "/" for alpha: rgb(0 0 0 / 0), oklch(0 0 0 / 0)
    if (c.includes('/')) {
      const afterSlash = c.split('/')[1];
      if (afterSlash) {
        const alpha = parseFloat(afterSlash.replace(')', '').trim());
        if (!isNaN(alpha) && alpha === 0) return true;
      }
    }

    // Legacy rgba with comma-separated alpha
    if (c.startsWith('rgba')) {
      const nums = c.match(/[\d.]+/g);
      if (nums && nums.length >= 4 && Number(nums[3]) === 0) return true;
    }

    return false;
  }
};

// Export
if (typeof module !== 'undefined') module.exports = ColorUtils;
else window.ColorUtils = ColorUtils;
