/**
 * PaletteLive - Color Extractor
 * Scans DOM and extracts computed colors from all elements.
 */

// Guard against re-injection - use version to allow updates
const _EXTRACTOR_VERSION = 5;
if (window._extractorVersion === _EXTRACTOR_VERSION) {
  // Already loaded with same version
} else {
  window._extractorVersion = _EXTRACTOR_VERSION;

const Extractor = {
    /**
     * Scan the page for colors.
     * @returns {Promise<Object>} { colors: [], variables: [] }
     */
    scan: async () => {
        const elements = window.ShadowWalker.getAllElements();

        // Ensure <html> (documentElement) is included — ShadowWalker starts
        // from document.body, so the <html> element is normally missed.
        // Many pages set their primary background on <html>.
        if (document.documentElement && !elements.includes(document.documentElement)) {
            elements.unshift(document.documentElement);
        }

        const colorMap = new Map(); // hex -> { count, original, categories }
        const variableMap = new Map(); // name -> declared value
        const variableUsageMap = new Map(); // name -> usage count in var() references

        // 1) Scan CSS Variables, var() usage, AND raw color values from styleSheets.
        //    This captures colors from :hover, :focus, :active, ::selection, @keyframes, etc.
        //    that getComputedStyle would miss in the current state.
        try {
            for (const sheet of document.styleSheets) {
                try {
                    const rules = sheet.cssRules || sheet.rules;
                    if (!rules) continue;

                    for (const rule of rules) {
                        Extractor._scanRuleForVariables(rule, variableMap, variableUsageMap);
                        Extractor._scanRuleForColors(rule, colorMap);
                    }
                } catch (error) {
                    // Cross-origin restricted stylesheet; ignore.
                }
            }
        } catch (error) {
            console.warn('PaletteLive: Error accessing stylesheets:', error);
        }

        // 1b) Scan open Shadow DOM stylesheets.
        //     ShadowWalker finds shadow hosts; we check their shadowRoot for <style> tags.
        try {
            const allEls = window.ShadowWalker.getAllElements();
            const shadowRoots = new Set();
            for (const el of allEls) {
                if (el.shadowRoot && el.shadowRoot.mode === 'open') {
                    shadowRoots.add(el.shadowRoot);
                }
            }
            for (const root of shadowRoots) {
                try {
                    for (const sheet of (root.adoptedStyleSheets || [])) {
                        try {
                            const rules = sheet.cssRules || sheet.rules;
                            if (!rules) continue;
                            for (const rule of rules) {
                                Extractor._scanRuleForVariables(rule, variableMap, variableUsageMap);
                                Extractor._scanRuleForColors(rule, colorMap);
                            }
                        } catch (e) { /* cross-origin */ }
                    }
                    const styleTags = root.querySelectorAll('style');
                    for (const tag of styleTags) {
                        try {
                            const sheet = tag.sheet;
                            if (!sheet) continue;
                            const rules = sheet.cssRules || sheet.rules;
                            if (!rules) continue;
                            for (const rule of rules) {
                                Extractor._scanRuleForVariables(rule, variableMap, variableUsageMap);
                                Extractor._scanRuleForColors(rule, colorMap);
                            }
                        } catch (e) { /* cross-origin */ }
                    }
                } catch (e) { /* ignore shadow root read errors */ }
            }
        } catch (e) {
            // Shadow DOM stylesheet scan is best-effort.
        }

        // 2) Scan :root inline style for variables.
        try {
            const rootStyle = document.documentElement.style;
            for (let i = 0; i < rootStyle.length; i++) {
                const prop = rootStyle[i];
                if (!prop.startsWith('--')) continue;

                const value = rootStyle.getPropertyValue(prop).trim();
                if (value && Extractor._looksLikeColor(value)) {
                    variableMap.set(prop, value);
                }
            }
        } catch (error) {
            // Ignore root style read failures.
        }

        // 2b) Scan computed custom properties on :root, <html>, and <body>.
        //     getComputedStyle resolves CSS variables through inheritance/cascade.
        //     Many design systems (like the one in the screenshot) define dozens of
        //     --color-* variables. This catches variables set by JS or inherited from
        //     ancestor rules that the stylesheet walk may have missed.
        try {
            const targets = [document.documentElement, document.body].filter(Boolean);
            for (const target of targets) {
                const cs = window.getComputedStyle(target);
                // Iterate all properties; in modern Chrome, getComputedStyle includes
                // custom properties via getPropertyValue but not via iteration.
                // We cross-reference the already-discovered variable names from step 1.
                for (const [name] of variableMap) {
                    try {
                        const resolved = cs.getPropertyValue(name).trim();
                        if (resolved && Extractor._looksLikeColor(resolved)) {
                            // Update the variableMap with the computed/resolved value
                            variableMap.set(name, resolved);
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            // Computed custom property scan is best-effort.
        }

        // 2c) Resolve ALL discovered CSS variables and add their color values to colorMap.
        //     This ensures every design-system color appears in the palette even if:
        //     - The variable is only used in :hover/:focus rules
        //     - The variable is defined but not applied to any visible element
        //     - The variable is set via JavaScript on :root
        try {
            const rootCS = window.getComputedStyle(document.documentElement);
            for (const [name, rawValue] of variableMap) {
                try {
                    // Try to resolve through computed style first (handles var() references)
                    let resolved = rootCS.getPropertyValue(name).trim();
                    if (!resolved) resolved = rawValue;

                    // Add resolved color to colorMap with low weight (design token, not actively rendered)
                    if (resolved && !window.ColorUtils.isTransparent(resolved)) {
                        const hex = window.ColorUtils.rgbToHex8(resolved).toLowerCase();
                        if (hex && hex !== '#000000') {
                            if (!colorMap.has(hex)) {
                                colorMap.set(hex, {
                                    count: 0,
                                    original: resolved,
                                    categories: {},
                                    categoryWeights: {},
                                    tailwindClasses: new Set()
                                });
                            }
                            // Give variable-sourced colors a small bump so they appear
                            // but don't dominate classification from computed styles
                            const entry = colorMap.get(hex);
                            entry.count += 1;
                            entry.categoryWeights['accent'] = (entry.categoryWeights['accent'] || 0) + 0.1;
                            entry.categories['accent'] = (entry.categories['accent'] || 0) + 1;
                        }
                    }
                } catch (e) { /* skip unresolvable variables */ }
            }
        } catch (e) {
            // Variable resolution is best-effort.
        }

        // 3) Scan computed styles.
        const directProps = [
            'color', 'backgroundColor',
            'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
            'outlineColor', 'textDecorationColor', 'caretColor',
            'fill', 'stroke', 'columnRuleColor'
        ];

        const propCategoryMap = {
            color: 'text',
            backgroundColor: 'background',
            borderTopColor: 'border',
            borderRightColor: 'border',
            borderBottomColor: 'border',
            borderLeftColor: 'border',
            outlineColor: 'border',
            textDecorationColor: 'accent',
            caretColor: 'text',
            fill: 'accent',
            stroke: 'accent',
            columnRuleColor: 'border'
        };

        const BATCH_SIZE = 400;

        for (let i = 0; i < elements.length; i += BATCH_SIZE) {
            const batch = elements.slice(i, i + BATCH_SIZE);

            if (i > 0) {
                // Use requestIdleCallback when available for better scheduling,
                // fall back to setTimeout for environments without it
                await new Promise(resolve => {
                    if (typeof requestIdleCallback === 'function') {
                        requestIdleCallback(resolve, { timeout: 100 });
                    } else {
                        setTimeout(resolve, 0);
                    }
                });
            }

            for (const el of batch) {
                try {
                    const style = window.getComputedStyle(el);

                    // Hidden elements still contribute design-system colors (modals,
                    // dropdowns, tooltips, etc.) but at lower weight since they aren't
                    // currently visible.
                    const isHidden =
                        style.display === 'none' ||
                        style.visibility === 'hidden' ||
                        parseFloat(style.opacity) < 0.01 ||
                        (el.offsetParent === null &&
                            style.position !== 'fixed' && style.position !== 'sticky' &&
                            el !== document.body && el !== document.documentElement);
                    const hiddenWeight = isHidden ? 0.15 : 1;

                    // Background color — weighted by element area so large backgrounds
                    // (heroes, sections) carry more classification weight than tiny elements.
                    const bgWeight = (isHidden ? 0.15 : Extractor._getAreaWeight(el));
                    Extractor._addComputedColor(style.backgroundColor, colorMap, 'background', null, bgWeight);

                    // Text color — only categorize for elements with actual text content
                    // (checks up to 3 levels of descendants to catch wrapper elements).
                    // Elements with no text content at all are skipped to avoid noise.
                    const hasText = Extractor._hasTextContent(el);
                    if (hasText) {
                        const textWeight = (Extractor._hasDirectText(el) ? 1 : 0.5) * hiddenWeight;
                        Extractor._addComputedColor(style.color, colorMap, 'text', null, textWeight);
                    }

                    // Border colors (only categorize if borders are rendered)
                    const hasBorder =
                        parseFloat(style.borderTopWidth) > 0 ||
                        parseFloat(style.borderRightWidth) > 0 ||
                        parseFloat(style.borderBottomWidth) > 0 ||
                        parseFloat(style.borderLeftWidth) > 0;
                    const borderCategory = hasBorder ? 'border' : null;
                    Extractor._addComputedColor(style.borderTopColor, colorMap, borderCategory, null, hiddenWeight);
                    Extractor._addComputedColor(style.borderRightColor, colorMap, borderCategory, null, hiddenWeight);
                    Extractor._addComputedColor(style.borderBottomColor, colorMap, borderCategory, null, hiddenWeight);
                    Extractor._addComputedColor(style.borderLeftColor, colorMap, borderCategory, null, hiddenWeight);

                    // Outline
                    const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
                    Extractor._addComputedColor(style.outlineColor, colorMap, hasOutline ? 'border' : null, null, hiddenWeight);

                    // Text decoration
                    const hasTextDecoration = style.textDecorationLine && style.textDecorationLine !== 'none';
                    Extractor._addComputedColor(style.textDecorationColor, colorMap, hasTextDecoration ? 'accent' : null, null, hiddenWeight);

                    // Other properties
                    Extractor._addComputedColor(style.caretColor, colorMap, 'text', null, hiddenWeight);
                    Extractor._addComputedColor(style.columnRuleColor, colorMap, 'border', null, hiddenWeight);

                    if (style.fill && style.fill !== 'none') {
                        Extractor._addComputedColor(style.fill, colorMap, 'accent', null, hiddenWeight);
                    }
                    if (style.stroke && style.stroke !== 'none') {
                        Extractor._addComputedColor(style.stroke, colorMap, 'accent', null, hiddenWeight);
                    }

                    // SVG gradient stops & filter colors
                    try {
                        const stopColor = style.getPropertyValue('stop-color');
                        if (stopColor && stopColor !== 'none') {
                            Extractor._addComputedColor(stopColor, colorMap, 'accent', null, hiddenWeight);
                        }
                        const floodColor = style.getPropertyValue('flood-color');
                        if (floodColor && floodColor !== 'none') {
                            Extractor._addComputedColor(floodColor, colorMap, 'accent', null, hiddenWeight);
                        }
                        const lightingColor = style.getPropertyValue('lighting-color');
                        if (lightingColor && lightingColor !== 'none') {
                            Extractor._addComputedColor(lightingColor, colorMap, 'accent', null, hiddenWeight);
                        }
                    } catch (e) { /* SVG props not available on this element */ }

                    // accent-color
                    try {
                        const accent = style.accentColor;
                        if (accent && accent !== 'auto' && accent !== 'initial') {
                            Extractor._addComputedColor(accent, colorMap, 'accent', null, hiddenWeight);
                        }
                    } catch (error) {
                        // Ignore unsupported contexts.
                    }

                    // scrollbar-color (Firefox/Chrome)
                    try {
                        const scrollbarColor = style.getPropertyValue('scrollbar-color');
                        if (scrollbarColor && scrollbarColor !== 'auto') {
                            Extractor._extractColorsFromCSSValue(scrollbarColor, colorMap, 'accent');
                        }
                    } catch (e) { /* scrollbar-color may not be supported */ }

                    // Shadows and gradients
                    Extractor._extractColorsFromCSSValue(style.boxShadow, colorMap, 'accent');
                    Extractor._extractColorsFromCSSValue(style.textShadow, colorMap, 'accent');

                    const backgroundImage = style.backgroundImage;
                    if (backgroundImage && backgroundImage !== 'none' && backgroundImage.includes('gradient')) {
                        Extractor._extractColorsFromCSSValue(backgroundImage, colorMap, 'background');
                    }

                    // Border image
                    try {
                        const borderImage = style.borderImageSource;
                        if (borderImage && borderImage !== 'none') {
                            Extractor._extractColorsFromCSSValue(borderImage, colorMap, 'border');
                        }
                    } catch (e) { /* ignore */ }

                    // Pseudo-elements (::before, ::after, ::placeholder, ::marker, ::selection)
                    for (const pseudo of ['::before', '::after', '::placeholder', '::marker', '::selection']) {
                        try {
                            const pseudoStyle = window.getComputedStyle(el, pseudo);
                            // ::placeholder and ::selection have limited property access
                            if (pseudo === '::selection') {
                                Extractor._addComputedColor(pseudoStyle.color, colorMap, 'text', null, hiddenWeight);
                                Extractor._addComputedColor(pseudoStyle.backgroundColor, colorMap, 'accent', null, hiddenWeight);
                            } else if (pseudo === '::placeholder') {
                                Extractor._addComputedColor(pseudoStyle.color, colorMap, 'text', null, hiddenWeight);
                            } else if (pseudo === '::marker') {
                                Extractor._addComputedColor(pseudoStyle.color, colorMap, 'accent', null, hiddenWeight);
                            } else {
                                for (const prop of directProps) {
                                    Extractor._addComputedColor(pseudoStyle[prop], colorMap, propCategoryMap[prop], null, hiddenWeight);
                                }
                                const pseudoBg = pseudoStyle.backgroundImage;
                                if (pseudoBg && pseudoBg !== 'none' && pseudoBg.includes('gradient')) {
                                    Extractor._extractColorsFromCSSValue(pseudoBg, colorMap, 'background');
                                }
                            }
                        } catch (error) {
                            // Ignore pseudo-element failures (some pseudos aren't valid on all elements).
                        }
                    }

                    // Tailwind utility extras
                    Extractor._scanTailwindClasses(el, style, colorMap);
                } catch (error) {
                    // Ignore element-level failures.
                }
            }
        }

        const colors = Array.from(colorMap.entries())
            .map(([hex, data]) => {
                // Use weighted scores for category selection (area-aware, text-depth-aware)
                const weightEntries = Object.entries(data.categoryWeights || {});
                // Tie-breaking priority: text > background > border > accent
                const categoryPriority = { text: 3, background: 2, border: 1, accent: 0 };
                const primaryCategory = weightEntries.length
                    ? weightEntries.sort((a, b) => {
                        const weightDiff = b[1] - a[1];
                        if (Math.abs(weightDiff) > 0.01) return weightDiff;
                        return (categoryPriority[b[0]] || 0) - (categoryPriority[a[0]] || 0);
                    })[0][0]
                    : 'accent';

                const tailwindClasses = Array.from(data.tailwindClasses || []).sort((a, b) => a.length - b.length);
                const tailwindClass = tailwindClasses[0] || null;
                const tailwindLabel = tailwindClass ? Extractor._tailwindLabelFromClass(tailwindClass) : null;

                return {
                    value: hex,
                    original: data.original,
                    count: data.count,
                    categories: Object.keys(data.categories || {}),
                    primaryCategory,
                    tailwindClasses,
                    tailwindClass,
                    tailwindLabel
                };
            })
            .sort((a, b) => b.count - a.count);

        const variables = Array.from(variableMap.entries())
            .map(([name, value]) => ({
                name,
                value: Extractor._resolveToHex(value),
                usageCount: variableUsageMap.get(name) || 0
            }))
            .sort((a, b) => b.usageCount - a.usageCount);

        console.log(`PaletteLive: Found ${colors.length} colors, ${variables.length} variables`);
        return {
            colors,
            variables,
            closedShadowCount: window.ShadowWalker ? window.ShadowWalker.closedShadowCount : 0
        };
    },

    // CSS properties that contain color values
    _colorProps: new Set([
        'color', 'background-color', 'background', 'background-image',
        'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
        'border-image-source', 'outline-color', 'text-decoration-color',
        'caret-color', 'accent-color', 'column-rule-color',
        'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color',
        'box-shadow', 'text-shadow', 'scrollbar-color'
    ]),

    // Recursively scan CSS rules (supports @media, @supports, @layer, etc.)
    _scanRuleForVariables: (rule, variableMap, variableUsageMap) => {
        if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                const value = rule.style.getPropertyValue(prop).trim();

                if (prop.startsWith('--')) {
                    if (value && Extractor._looksLikeColor(value)) {
                        variableMap.set(prop, value);
                    }
                }

                if (value && value.includes('var(')) {
                    Extractor._countVarUsages(value, variableUsageMap);
                }
            }
        }

        if (rule.cssRules) {
            for (const nested of rule.cssRules) {
                Extractor._scanRuleForVariables(nested, variableMap, variableUsageMap);
            }
        }
    },

    /**
     * Scan a CSS rule for raw color values in color-related properties.
     * This captures colors from :hover, :focus, :active, ::selection,
     * @keyframes, @media, and any other rule that getComputedStyle
     * wouldn't see in the current DOM state.
     */
    _scanRuleForColors: (rule, colorMap) => {
        if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--')) continue; // variables handled elsewhere
                if (!Extractor._colorProps.has(prop)) continue;

                const value = rule.style.getPropertyValue(prop).trim();
                if (!value || value === 'none' || value === 'inherit' || value === 'initial' ||
                    value === 'currentColor' || value === 'currentcolor' || value === 'auto' ||
                    value === 'transparent') continue;

                // Skip values that only contain var() references (resolved at compute time)
                if (/^var\(/.test(value) && !value.includes(',')) continue;

                // Extract any color functions or hex values found in the property value
                Extractor._extractColorsFromCSSValue(value, colorMap, Extractor._propToCategory(prop));
            }
        }

        if (rule.cssRules) {
            for (const nested of rule.cssRules) {
                Extractor._scanRuleForColors(nested, colorMap);
            }
        }
    },

    /**
     * Map a CSS property name to a category.
     */
    _propToCategory: (prop) => {
        if (prop === 'color' || prop === 'caret-color') return 'text';
        if (prop === 'background-color' || prop === 'background' || prop === 'background-image') return 'background';
        if (prop.includes('border') || prop === 'outline-color' || prop === 'column-rule-color') return 'border';
        return 'accent';
    },

    _countVarUsages: (value, variableUsageMap) => {
        // Parser that handles nested var() calls like var(--a, var(--b))
        const parseVarCalls = (str) => {
            let i = 0;
            while (i < str.length) {
                const varIndex = str.indexOf('var(', i);
                if (varIndex === -1) break;

                // Find matching closing parenthesis using a stack
                let depth = 1;
                let j = varIndex + 4; // Start after 'var('
                while (j < str.length && depth > 0) {
                    if (str[j] === '(') depth++;
                    else if (str[j] === ')') depth--;
                    j++;
                }

                if (depth === 0) {
                    // Extract contents between var( and matching )
                    const contents = str.slice(varIndex + 4, j - 1);

                    // Extract the variable name (first token)
                    const nameMatch = contents.match(/^\s*(--[A-Za-z0-9-_]+)/);
                    if (nameMatch) {
                        const name = nameMatch[1];
                        variableUsageMap.set(name, (variableUsageMap.get(name) || 0) + 1);
                    }

                    // Recursively parse contents for nested var() calls
                    parseVarCalls(contents);
                }

                i = varIndex + 1;
            }
        };

        parseVarCalls(value);
    },

    // Complete set of all 148 CSS named colors
    _namedColors: new Set([
        'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure',
        'beige', 'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood',
        'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
        'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgrey', 'darkgreen', 'darkkhaki',
        'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
        'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet',
        'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue',
        'firebrick', 'floralwhite', 'forestgreen', 'fuchsia',
        'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'grey', 'green', 'greenyellow',
        'honeydew', 'hotpink',
        'indianred', 'indigo', 'ivory',
        'khaki',
        'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
        'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgrey', 'lightgreen', 'lightpink',
        'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
        'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
        'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
        'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred',
        'midnightblue', 'mintcream', 'mistyrose', 'moccasin',
        'navajowhite', 'navy',
        'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid',
        'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
        'peru', 'pink', 'plum', 'powderblue', 'purple',
        'rebeccapurple', 'red', 'rosybrown', 'royalblue',
        'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver',
        'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue',
        'tan', 'teal', 'thistle', 'tomato', 'turquoise',
        'violet',
        'wheat', 'white', 'whitesmoke',
        'yellow', 'yellowgreen'
    ]),

    /**
     * Check if a string is a CSS named color.
     */
    _isNamedColor: (value) => {
        return Extractor._namedColors.has(value.toLowerCase());
    },

    _looksLikeColor: (value) => {
        if (!value) return false;
        const trimmed = value.trim();

        if (trimmed.startsWith('#')) return /^#[0-9A-Fa-f]{3,8}$/.test(trimmed);
        if (trimmed.startsWith('rgb')) return true;
        if (trimmed.startsWith('hsl')) return true;
        if (trimmed.startsWith('hwb')) return true;
        if (trimmed.startsWith('oklch')) return true;
        if (trimmed.startsWith('oklab')) return true;
        if (trimmed.startsWith('lch(')) return true;
        if (trimmed.startsWith('lab(')) return true;
        if (trimmed.startsWith('color(')) return true;
        if (trimmed.startsWith('color-mix(')) return true;
        if (trimmed.startsWith('light-dark(')) return true;

        return Extractor._namedColors.has(trimmed.toLowerCase());
    },

    /**
     * Check if element has direct text content (immediate child text nodes).
     */
    _hasDirectText: (el) => {
        const nodes = el.childNodes;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeType === Node.TEXT_NODE && nodes[i].textContent.trim()) {
                return true;
            }
        }
        return false;
    },

    /**
     * Check if element or shallow descendants contain visible text.
     * Searches up to 3 levels deep to catch wrapper elements.
     * @param {Element} el
     * @param {number} depth - current recursion depth
     * @returns {boolean}
     */
    _hasTextContent: (el, depth = 0) => {
        if (Extractor._hasDirectText(el)) return true;
        if (depth >= 3) return false;
        for (let i = 0; i < el.children.length; i++) {
            if (Extractor._hasTextContent(el.children[i], depth + 1)) return true;
        }
        return false;
    },

    /**
     * Get element's visible area (clamped to viewport) for weighting.
     * Returns a normalized weight: 0 for invisible, up to ~1 for viewport-sized.
     * @param {Element} el
     * @returns {number} area weight between 0.1 and 1
     */
    _getAreaWeight: (el) => {
        try {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return 0.1;
            const vpW = window.innerWidth || 1;
            const vpH = window.innerHeight || 1;
            const vpArea = vpW * vpH;
            // Clamp to viewport bounds
            const visW = Math.min(rect.width, vpW);
            const visH = Math.min(rect.height, vpH);
            const ratio = (visW * visH) / vpArea;
            // Map to 0.1 .. 1 range (small elements still get some weight)
            return Math.max(0.1, Math.min(1, ratio));
        } catch (e) {
            return 0.1;
        }
    },

    /**
     * Add a computed color to the map with weighted category scoring.
     * @param {string} value - CSS color string
     * @param {Map} colorMap
     * @param {string|null} category - 'text'|'background'|'border'|'accent'|null
     * @param {string|null} tailwindClass - optional Tailwind utility class
     * @param {number} weight - category weight (default 1, use area weight for bg)
     */
    _addComputedColor: (value, colorMap, category, tailwindClass, weight = 1) => {
        if (!value || typeof value !== 'string') return;
        if (value === 'none') return;
        if (window.ColorUtils.isTransparent(value)) return;
        if (value === 'inherit' || value === 'currentcolor' || value === 'currentColor' || value === 'initial') return;

        const hex = window.ColorUtils.rgbToHex8(value).toLowerCase();
        if (!hex) return;

        if (!colorMap.has(hex)) {
            colorMap.set(hex, {
                count: 0,
                original: value,
                categories: {},
                categoryWeights: {},
                tailwindClasses: new Set()
            });
        }

        const entry = colorMap.get(hex);
        entry.count += 1;
        if (category) {
            entry.categories[category] = (entry.categories[category] || 0) + 1;
            entry.categoryWeights[category] = (entry.categoryWeights[category] || 0) + weight;
        }
        if (tailwindClass) {
            entry.tailwindClasses.add(tailwindClass);
        }
    },

    /**
     * Extract color values from a complex CSS value string (gradients, shadows, etc.).
     * Handles nested parentheses so color(display-p3 ...) and oklch(...) inside
     * gradient() are correctly captured.
     */
    _extractColorsFromCSSValue: (value, colorMap, category, tailwindClass) => {
        if (!value || value === 'none') return;

        // Match color functions, handling nested parentheses
        const colorFnPrefixes = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\s*\(/g;
        let match;
        while ((match = colorFnPrefixes.exec(value)) !== null) {
            const start = match.index;
            let depth = 0;
            let end = start + match[0].length - 1; // position of the '('
            for (let j = end; j < value.length; j++) {
                if (value[j] === '(') depth++;
                else if (value[j] === ')') {
                    depth--;
                    if (depth === 0) { end = j + 1; break; }
                }
            }
            if (depth === 0) {
                const fnStr = value.slice(start, end);
                Extractor._addComputedColor(fnStr, colorMap, category, tailwindClass);
            }
        }

        // Also pick up bare hex values not inside a function
        const hexRegex = /#[0-9A-Fa-f]{3,8}\b/g;
        const hexMatches = value.match(hexRegex);
        if (hexMatches) {
            hexMatches.forEach(m => Extractor._addComputedColor(m, colorMap, category, tailwindClass));
        }

        // Pick up bare CSS named colors in the value (e.g. "red" in "linear-gradient(red, blue)")
        Extractor._extractNamedColorsFromValue(value, colorMap, category);
    },

    /**
     * Extract bare CSS named colors from a value string.
     * Only matches whole words that are valid color names.
     */
    _extractNamedColorsFromValue: (value, colorMap, category) => {
        // Quick check — named colors are only relevant in gradient/shadow values
        if (!value || value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) return;
        const words = value.match(/\b[a-z]{3,20}\b/gi);
        if (!words) return;
        // CSS keywords to skip
        const skip = new Set(['none', 'auto', 'inherit', 'initial', 'unset', 'revert', 'transparent',
            'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset',
            'linear', 'radial', 'conic', 'gradient', 'repeating', 'from', 'deg', 'turn', 'rad',
            'top', 'bottom', 'left', 'right', 'center', 'closest', 'farthest', 'side', 'corner',
            'circle', 'ellipse', 'contain', 'cover', 'srgb', 'display', 'rgb', 'hsl', 'hwb']);
        for (const word of words) {
            if (skip.has(word.toLowerCase())) continue;
            if (Extractor._isNamedColor(word)) {
                Extractor._addComputedColor(word, colorMap, category);
            }
        }
    },

    _resolveToHex: (value) => {
        if (!value) return value;
        const hex = window.ColorUtils.rgbToHex8(value.trim());
        return hex || value;
    },

    /**
     * Attach Tailwind class labels to already-recorded colors.
     * Does NOT re-add computed colors (they were already counted in the main scan)
     * to avoid double-counting category votes.
     */
    _scanTailwindClasses: (el, style, colorMap) => {
        if (!el.className || typeof el.className !== 'string') return;

        const classes = el.className.split(/\s+/).filter(Boolean);

        for (const rawClass of classes) {
            const baseClass = String(rawClass).split(':').pop();
            if (!baseClass) continue;

            if (baseClass.startsWith('bg-') && Extractor._isTailwindColorClass(baseClass, 'bg-')) {
                Extractor._attachTailwindClass(style.backgroundColor, colorMap, rawClass);
            } else if (baseClass.startsWith('text-') && Extractor._isTailwindColorClass(baseClass, 'text-')) {
                Extractor._attachTailwindClass(style.color, colorMap, rawClass);
            } else if (baseClass.startsWith('border-') && Extractor._isTailwindColorClass(baseClass, 'border-')) {
                Extractor._attachTailwindClass(style.borderTopColor, colorMap, rawClass);
                Extractor._attachTailwindClass(style.borderRightColor, colorMap, rawClass);
                Extractor._attachTailwindClass(style.borderBottomColor, colorMap, rawClass);
                Extractor._attachTailwindClass(style.borderLeftColor, colorMap, rawClass);
            } else if (baseClass.startsWith('fill-') && Extractor._isTailwindColorClass(baseClass, 'fill-')) {
                Extractor._attachTailwindClass(style.fill, colorMap, rawClass);
            } else if (baseClass.startsWith('stroke-') && Extractor._isTailwindColorClass(baseClass, 'stroke-')) {
                Extractor._attachTailwindClass(style.stroke, colorMap, rawClass);
            } else if (baseClass.startsWith('outline-') && Extractor._isTailwindColorClass(baseClass, 'outline-')) {
                Extractor._attachTailwindClass(style.outlineColor, colorMap, rawClass);
            } else if (baseClass.startsWith('decoration-') && Extractor._isTailwindColorClass(baseClass, 'decoration-')) {
                Extractor._attachTailwindClass(style.textDecorationColor, colorMap, rawClass);
            } else if (baseClass.startsWith('caret-') && Extractor._isTailwindColorClass(baseClass, 'caret-')) {
                Extractor._attachTailwindClass(style.caretColor, colorMap, rawClass);
            } else if (baseClass.startsWith('accent-') && Extractor._isTailwindColorClass(baseClass, 'accent-')) {
                try {
                    Extractor._attachTailwindClass(style.accentColor, colorMap, rawClass);
                } catch (error) {
                    // Ignore unsupported accent-color contexts.
                }
            } else if (baseClass.startsWith('ring-') && Extractor._isTailwindColorClass(baseClass, 'ring-')) {
                Extractor._attachTailwindClassFromCSSValue(style.boxShadow, colorMap, rawClass);
            } else if (baseClass.startsWith('shadow-') && Extractor._isTailwindColorClass(baseClass, 'shadow-')) {
                Extractor._attachTailwindClassFromCSSValue(style.boxShadow, colorMap, rawClass);
            } else if (baseClass.startsWith('divide-') && Extractor._isTailwindColorClass(baseClass, 'divide-')) {
                Extractor._attachTailwindClass(style.borderTopColor, colorMap, rawClass);
            } else if ((baseClass.startsWith('from-') && Extractor._isTailwindColorClass(baseClass, 'from-')) ||
                (baseClass.startsWith('to-') && Extractor._isTailwindColorClass(baseClass, 'to-')) ||
                (baseClass.startsWith('via-') && Extractor._isTailwindColorClass(baseClass, 'via-'))) {
                Extractor._attachTailwindClassFromCSSValue(style.backgroundImage, colorMap, rawClass);
            }
        }
    },

    /**
     * Attach a Tailwind class label to an already-recorded color without re-counting.
     * If the color hasn't been recorded yet, this is a no-op.
     */
    _attachTailwindClass: (value, colorMap, tailwindClass) => {
        if (!value || typeof value !== 'string' || !tailwindClass) return;
        if (window.ColorUtils.isTransparent(value)) return;
        const hex = window.ColorUtils.rgbToHex8(value).toLowerCase();
        if (!hex) return;
        const entry = colorMap.get(hex);
        if (entry) {
            entry.tailwindClasses.add(tailwindClass);
        }
    },

    /**
     * Attach Tailwind class label to colors found in a complex CSS value (gradients, shadows).
     */
    _attachTailwindClassFromCSSValue: (value, colorMap, tailwindClass) => {
        if (!value || value === 'none' || !tailwindClass) return;
        const fnRegex = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^)]+\)/g;
        const fnMatches = value.match(fnRegex);
        if (fnMatches) {
            fnMatches.forEach(m => Extractor._attachTailwindClass(m, colorMap, tailwindClass));
        }
        const hexRegex = /#[0-9A-Fa-f]{3,8}\b/g;
        const hexMatches = value.match(hexRegex);
        if (hexMatches) {
            hexMatches.forEach(m => Extractor._attachTailwindClass(m, colorMap, tailwindClass));
        }
    },

    _isTailwindColorClass: (baseClass, prefix) => {
        if (!baseClass || !baseClass.startsWith(prefix)) return false;
        const token = baseClass.slice(prefix.length);
        if (!token) return false;

        const normalized = token.split('/')[0];
        if (!normalized) return false;
        if (normalized.startsWith('[') || normalized.startsWith('#')) return true;

        const keywordMatch = new Set(['transparent', 'black', 'white', 'current', 'inherit']);
        if (keywordMatch.has(normalized)) return true;

        const palettes = new Set([
            'slate', 'gray', 'zinc', 'neutral', 'stone',
            'red', 'orange', 'amber', 'yellow', 'lime',
            'green', 'emerald', 'teal', 'cyan', 'sky',
            'blue', 'indigo', 'violet', 'purple', 'fuchsia',
            'pink', 'rose'
        ]);

        const head = normalized.split('-')[0];
        if (palettes.has(head)) return true;
        if (/^[a-z]+-\d{2,3}$/.test(normalized)) return true;

        return false;
    },

    _tailwindLabelFromClass: (className) => {
        if (!className) return null;
        const baseClass = String(className).split(':').pop() || '';
        const prefixRegex = /^(bg|text|border|fill|stroke|outline|decoration|caret|accent|ring|shadow|divide|from|to|via)-/;
        const tokenWithShade = baseClass.replace(prefixRegex, '').split('/')[0];

        if (!tokenWithShade) return baseClass;
        if (tokenWithShade.startsWith('[') && tokenWithShade.endsWith(']')) {
            return tokenWithShade.slice(1, -1);
        }

        const parts = tokenWithShade.split('-').filter(Boolean);
        if (!parts.length) return tokenWithShade;
        const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);

        if (parts.length === 1) return cap(parts[0]);

        const shade = parts[parts.length - 1];
        const name = parts.slice(0, -1).map(cap).join(' ');
        if (/^\d{2,3}$/.test(shade)) {
            return `${name} ${shade}`;
        }
        return `${name} ${cap(shade)}`;
    }
};

window.Extractor = Extractor;

} // end re-injection guard
