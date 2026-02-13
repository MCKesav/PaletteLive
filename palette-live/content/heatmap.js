/**
 * PaletteLive - Heatmap
 * Visualizes color usage on the page by highlighting elements with
 * colored outlines matching their computed background-color.
 */

const Heatmap = {
    isActive: false,
    styleId: 'palettelive-heatmap-style',
    _elements: [],

    toggle: (active) => {
        Heatmap.isActive = active;
        if (active) {
            Heatmap.show();
        } else {
            Heatmap.hide();
        }
    },

    show: () => {
        // Create or reuse the heatmap stylesheet
        let style = document.getElementById(Heatmap.styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = Heatmap.styleId;
            document.head.appendChild(style);
        }

        // Clean up any previous run
        Heatmap._cleanup();

        const elements = window.ShadowWalker.getAllElements();

        for (const el of elements) {
            try {
                const cs = window.getComputedStyle(el);
                const bg = cs.backgroundColor;
                if (!bg || window.ColorUtils.isTransparent(bg)) continue;

                const hex = window.ColorUtils.rgbToHex(bg).toLowerCase();

                el.setAttribute('data-pl-heat', '');
                el.style.setProperty('--pl-heat-color', hex);
                Heatmap._elements.push(el);
            } catch (e) { }
        }

        style.textContent = [
            '[data-pl-heat] {',
            '  outline: 3px solid var(--pl-heat-color, #ff0000) !important;',
            '  outline-offset: -2px !important;',
            '}'
        ].join('\n');

        console.log(`PaletteLive Heatmap: ${Heatmap._elements.length} elements highlighted`);
    },

    hide: () => {
        const style = document.getElementById(Heatmap.styleId);
        if (style) style.textContent = '';
        Heatmap._cleanup();
    },

    _cleanup: () => {
        for (const el of Heatmap._elements) {
            try {
                el.removeAttribute('data-pl-heat');
                el.style.removeProperty('--pl-heat-color');
            } catch (e) { }
        }
        Heatmap._elements = [];
    }
};

window.Heatmap = Heatmap;
