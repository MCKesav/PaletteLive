/**
 * PaletteLive - Color Extractor
 * Scans DOM and extracts computed colors from all elements.
 */

const Extractor = {
    /**
     * Scan the page for colors
     * @returns {Promise<Object>} { colors: [], variables: [] }
     */
    scan: async () => {
        const elements = window.ShadowWalker.getAllElements();
        const colorMap = new Map(); // hex -> { count, original }
        const variableMap = new Map(); // name -> value

        // ── 1. Scan CSS Variables from StyleSheets ──
        try {
            for (const sheet of document.styleSheets) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    if (!rules) continue;
                    for (const rule of rules) {
                        Extractor._scanRuleForVariables(rule, variableMap);
                    }
                } catch (e) {
                    // CORS restricted stylesheet — skip silently
                }
            }
        } catch (e) {
            console.warn('PaletteLive: Error accessing stylesheets:', e);
        }

        // ── 2. Scan :root inline style for variables ──
        try {
            const rootStyle = document.documentElement.style;
            for (let i = 0; i < rootStyle.length; i++) {
                const prop = rootStyle[i];
                if (prop.startsWith('--')) {
                    const val = rootStyle.getPropertyValue(prop).trim();
                    if (val && Extractor._looksLikeColor(val)) {
                        variableMap.set(prop, val);
                    }
                }
            }
        } catch (e) { }

        // ── 3. Scan ALL Computed Styles ──
        const directProps = [
            'color', 'backgroundColor',
            'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
            'outlineColor', 'textDecorationColor', 'caretColor',
            'fill', 'stroke', 'columnRuleColor'
        ];

        const BATCH_SIZE = 400;

        for (let i = 0; i < elements.length; i += BATCH_SIZE) {
            const batch = elements.slice(i, i + BATCH_SIZE);
            // Yield to main thread every batch
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            for (const el of batch) {
                try {
                    const style = window.getComputedStyle(el);

                    // A. Direct color properties
                    for (const prop of directProps) {
                        Extractor._addComputedColor(style[prop], colorMap);
                    }

                    // B. accent-color (toggles, checkboxes, radio buttons)
                    try {
                        const accent = style.accentColor;
                        if (accent && accent !== 'auto' && accent !== 'initial') {
                            Extractor._addComputedColor(accent, colorMap);
                        }
                    } catch (e) { }

                    // C. box-shadow colors
                    Extractor._extractColorsFromCSSValue(style.boxShadow, colorMap);

                    // D. text-shadow colors
                    Extractor._extractColorsFromCSSValue(style.textShadow, colorMap);

                    // E. background-image gradients
                    const bgImage = style.backgroundImage;
                    if (bgImage && bgImage !== 'none' && bgImage.includes('gradient')) {
                        Extractor._extractColorsFromCSSValue(bgImage, colorMap);
                    }

                    // F. Pseudo-elements ::before and ::after
                    for (const pseudo of ['::before', '::after']) {
                        try {
                            const ps = window.getComputedStyle(el, pseudo);
                            // Scan ALL pseudo-element styles (modern CSS toggles use
                            // pseudo-elements without setting content)
                            for (const prop of directProps) {
                                Extractor._addComputedColor(ps[prop], colorMap);
                            }
                            const psBg = ps.backgroundImage;
                            if (psBg && psBg !== 'none' && psBg.includes('gradient')) {
                                Extractor._extractColorsFromCSSValue(psBg, colorMap);
                            }
                        } catch (e) { }
                    }

                    // G. Tailwind class detection
                    Extractor._scanTailwindClasses(el, style, colorMap);

                } catch (e) { }
            }
        }

        // Format results — sort by usage count, descending
        const colors = Array.from(colorMap.entries())
            .map(([hex, data]) => ({
                value: hex,
                original: data.original,
                count: data.count,
                category: 'General'
            }))
            .sort((a, b) => b.count - a.count);

        const variables = Array.from(variableMap.entries()).map(([name, value]) => ({
            name,
            value: Extractor._resolveToHex(value)
        }));

        console.log(`PaletteLive: Found ${colors.length} colors, ${variables.length} variables`);
        return { colors, variables };
    },

    // ── Helper: Recursively scan CSS rules (handles @media, @supports, etc.) ──
    _scanRuleForVariables: (rule, variableMap) => {
        if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--')) {
                    const val = rule.style.getPropertyValue(prop).trim();
                    if (val && Extractor._looksLikeColor(val)) {
                        variableMap.set(prop, val);
                    }
                }
            }
        }
        // Recurse into nested rules (@media, @supports, @layer)
        if (rule.cssRules) {
            for (const nested of rule.cssRules) {
                Extractor._scanRuleForVariables(nested, variableMap);
            }
        }
    },

    // ── Helper: Quick check if a string looks like a CSS color ──
    _looksLikeColor: (val) => {
        if (!val) return false;
        val = val.trim();
        if (val.startsWith('#')) return /^#[0-9A-Fa-f]{3,8}$/.test(val);
        if (val.startsWith('rgb')) return true;
        if (val.startsWith('hsl')) return true;
        if (val.startsWith('hwb')) return true;
        if (val.startsWith('oklch')) return true;
        if (val.startsWith('oklab')) return true;
        if (val.startsWith('lch')) return true;
        if (val.startsWith('lab')) return true;
        if (val.startsWith('color(')) return true;
        // Common named colors
        const named = ['red', 'blue', 'green', 'black', 'white', 'gray', 'grey', 'orange', 'yellow', 'purple', 'pink',
            'brown', 'cyan', 'magenta', 'lime', 'teal', 'navy', 'maroon', 'olive', 'aqua', 'fuchsia', 'silver',
            'coral', 'crimson', 'darkblue', 'darkgreen', 'darkred', 'gold', 'indigo', 'ivory', 'khaki',
            'lavender', 'linen', 'mintcream', 'orchid', 'peru', 'plum', 'salmon', 'sienna', 'tan', 'tomato', 'violet', 'wheat'];
        return named.includes(val.toLowerCase());
    },

    // ── Helper: Add a computed color value to the map ──
    _addComputedColor: (val, colorMap) => {
        if (!val || typeof val !== 'string') return;
        if (window.ColorUtils.isTransparent(val)) return;
        if (val === 'inherit' || val === 'currentcolor' || val === 'currentColor' || val === 'initial') return;

        const hex = window.ColorUtils.rgbToHex(val).toLowerCase();
        if (!hex) return;

        if (!colorMap.has(hex)) {
            colorMap.set(hex, { count: 0, original: val });
        }
        colorMap.get(hex).count++;
    },

    // ── Helper: Extract ALL color functions from complex CSS value strings ──
    _extractColorsFromCSSValue: (str, colorMap) => {
        if (!str || str === 'none') return;

        // Match ALL CSS color functions: rgb, rgba, hsl, hsla, hwb,
        // oklch, oklab, lab, lch, color(...)
        const fnRegex = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^)]+\)/g;
        const fnMatches = str.match(fnRegex);
        if (fnMatches) {
            fnMatches.forEach(m => Extractor._addComputedColor(m, colorMap));
        }

        // Match hex colors
        const hexRegex = /#[0-9A-Fa-f]{3,8}\b/g;
        const hexMatches = str.match(hexRegex);
        if (hexMatches) {
            hexMatches.forEach(m => Extractor._addComputedColor(m, colorMap));
        }
    },

    // ── Helper: Resolve a CSS value to hex (for variables) ──
    _resolveToHex: (val) => {
        if (!val) return val;
        const hex = window.ColorUtils.rgbToHex(val.trim());
        return hex || val;
    },

    // ── Helper: Scan Tailwind utility classes ──
    _scanTailwindClasses: (el, style, colorMap) => {
        if (!el.className || typeof el.className !== 'string') return;
        const classes = el.className.split(/\s+/);
        const twColorPattern = /^(bg|text|border|ring|outline|accent|fill|stroke|decoration|shadow|divide|from|to|via)-/;

        for (const cls of classes) {
            if (twColorPattern.test(cls)) {
                // This element uses Tailwind color utilities
                // The computed style already captures the resolved color,
                // but we make sure we scan the relevant property
                if (cls.startsWith('bg-')) {
                    Extractor._addComputedColor(style.backgroundColor, colorMap);
                } else if (cls.startsWith('text-')) {
                    Extractor._addComputedColor(style.color, colorMap);
                } else if (cls.startsWith('border-')) {
                    Extractor._addComputedColor(style.borderTopColor, colorMap);
                } else if (cls.startsWith('ring-') || cls.startsWith('outline-')) {
                    Extractor._addComputedColor(style.outlineColor, colorMap);
                } else if (cls.startsWith('accent-')) {
                    try { Extractor._addComputedColor(style.accentColor, colorMap); } catch (e) { }
                } else if (cls.startsWith('fill-')) {
                    Extractor._addComputedColor(style.fill, colorMap);
                } else if (cls.startsWith('stroke-')) {
                    Extractor._addComputedColor(style.stroke, colorMap);
                } else if (cls.startsWith('decoration-')) {
                    Extractor._addComputedColor(style.textDecorationColor, colorMap);
                }
            }
        }
    }
};

window.Extractor = Extractor;
