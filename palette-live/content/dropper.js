/**
 * PaletteLive - Color Dropper
 * Click any element on the page to pick its color, then edit it
 * via an inline floating panel — entirely self-contained in the content script.
 */

// Guard against re-injection - use version to allow updates
const _DROPPER_VERSION = 2;
if (window._dropperVersion === _DROPPER_VERSION) {
    // Already loaded with same version
} else {
    window._dropperVersion = _DROPPER_VERSION;

    const Dropper = {
        _active: false,
        _overlay: null,
        _preview: null,
        _hint: null,
        _editor: null,
        _originalHex: null,
        _outsideClickTimeout: null,
        _lastPickedElement: null,
        _lastHighlightHex: null,

        // ── Public API ────────────────────────────────────────────────

        /** Activate the dropper crosshair. Editing happens inline on click. */
        start: () => {
            if (Dropper._active) return;
            // If an editor is already open, close it first
            if (Dropper._editor) Dropper._closeEditor();
            Dropper._active = true;
            Dropper._createOverlay();
        },

        /** Cancel dropper (Escape or external call) */
        cancel: () => {
            Dropper._removeOverlay();
            Dropper._closeEditor();
            Dropper._active = false;
        },

        // ── Overlay (crosshair + preview) ─────────────────────────────

        _createOverlay: () => {
            // Full-screen transparent overlay
            const overlay = document.createElement('div');
            overlay.id = 'pl-dropper-overlay';
            overlay.style.cssText =
                'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;' +
                'background:transparent;pointer-events:auto;';

            // Floating preview bubble
            const preview = document.createElement('div');
            preview.id = 'pl-dropper-preview';
            preview.style.cssText =
                'position:fixed;pointer-events:none;display:none;flex-direction:column;' +
                'align-items:center;gap:4px;z-index:2147483647;' +
                'transform:translate(-50%,-130%);filter:drop-shadow(0 2px 8px rgba(0,0,0,0.25));';
            preview.innerHTML =
                '<div id="pl-dropper-swatch" style="width:44px;height:44px;border-radius:50%;' +
                'border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,0.2);"></div>' +
                '<div id="pl-dropper-label" style="background:#1e293b;color:#fff;font-size:11px;' +
                'font-family:Courier New,monospace;font-weight:600;padding:2px 8px;' +
                'border-radius:4px;white-space:nowrap;"></div>';

            // Hint banner
            const hint = document.createElement('div');
            hint.id = 'pl-dropper-hint';
            hint.style.cssText =
                'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
                'background:#1e293b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,' +
                '"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:500;padding:8px 18px;' +
                'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.3);pointer-events:none;' +
                'user-select:none;';
            hint.textContent = 'Click any element to pick and edit its color - Esc to cancel';

            document.documentElement.appendChild(overlay);
            document.documentElement.appendChild(preview);
            document.documentElement.appendChild(hint);

            Dropper._overlay = overlay;
            Dropper._preview = preview;
            Dropper._hint = hint;

            overlay.addEventListener('mousemove', Dropper._onMove);
            overlay.addEventListener('click', Dropper._onPickClick);
            document.addEventListener('keydown', Dropper._onKey);
        },

        _removeOverlay: () => {
            // Clear any dropper-driven highlights before removing overlay
            Dropper._lastHighlightHex = null;
            Dropper._lastHighlightElement = null;
            try {
                if (window.__plClearHighlight) {
                    window.__plClearHighlight();
                }
            } catch (err) { /* ignore */ }

            if (Dropper._overlay) {
                Dropper._overlay.removeEventListener('mousemove', Dropper._onMove);
                Dropper._overlay.removeEventListener('click', Dropper._onPickClick);
                Dropper._overlay.remove();
                Dropper._overlay = null;
            }
            if (Dropper._preview) { Dropper._preview.remove(); Dropper._preview = null; }
            if (Dropper._hint) { Dropper._hint.remove(); Dropper._hint = null; }
            document.removeEventListener('keydown', Dropper._onKey);
        },

        // ── Overlay event handlers ────────────────────────────────────

        _onMove: (e) => {
            // Use requestAnimationFrame to throttle updates to the screen refresh rate
            if (Dropper._rafId) return;

            Dropper._rafId = requestAnimationFrame(() => {
                Dropper._rafId = null;
                const preview = Dropper._preview;
                if (!preview) return;

                const x = e.clientX;
                const y = e.clientY;
                const color = Dropper._colorAtPoint(x, y);

                // Position preview (flip below cursor when near top)
                const nearTop = y < 100;
                preview.style.left = x + 'px';
                preview.style.top = y + 'px';
                preview.style.transform = nearTop
                    ? 'translate(-50%, 30px)'
                    : 'translate(-50%, -130%)';
                preview.style.display = 'flex';

                const swatch = document.getElementById('pl-dropper-swatch');
                const label = document.getElementById('pl-dropper-label');
                if (swatch) swatch.style.backgroundColor = color;
                if (label) label.textContent = color;

                // Highlight ONLY the element under the cursor (much faster than scanning the whole page)
                if (Dropper._lastHighlightElement !== Dropper._lastPickedElement || Dropper._lastHighlightHex !== color) {
                    Dropper._lastHighlightElement = Dropper._lastPickedElement;
                    Dropper._lastHighlightHex = color;
                    try {
                        if (window.__plHighlightElement && Dropper._lastPickedElement) {
                            window.__plHighlightElement(Dropper._lastPickedElement, color);
                        } else if (!Dropper._lastPickedElement && window.__plClearHighlight) {
                            window.__plClearHighlight();
                        }
                    } catch (err) { /* ignore */ }
                }
            });
        },

        _onPickClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (Dropper._rafId) cancelAnimationFrame(Dropper._rafId);

            const hex = Dropper._colorAtPoint(e.clientX, e.clientY);
            const clickX = e.clientX;
            const clickY = e.clientY;

            // Remove overlay, show inline editor
            Dropper._removeOverlay();
            Dropper._active = false;
            Dropper._showEditor(clickX, clickY, hex);
        },

        _onKey: (e) => {
            if (e.key === 'Escape') Dropper.cancel();
        },

        // ── Inline color editor ───────────────────────────────────────

        _showEditor: (x, y, originalHex) => {
            // Send message to background to open the compact popup window
            try {
                chrome.runtime.sendMessage({
                    type: 'OPEN_EDITOR_WINDOW',
                    payload: {
                        color: {
                            value: originalHex,
                            hex: originalHex
                        },
                        currentHex: originalHex,
                        sources: [originalHex] // This tells the panel which color to override on the page
                    }
                });
            } catch (error) {
                console.error('PaletteLive: Could not open editor window', error);
            }
        },

        _closeEditor: () => {
            // No-op for window mode (user closes window manually)
        },

        // ── Shared helpers ────────────────────────────────────────────

        /** Read the dominant visible color at a screen coordinate */
        _colorAtPoint: (x, y) => {
            let hex = '#000000';
            Dropper._lastPickedElement = null;

            try {
                // Temporarily hide all dropper UI elements so that
                // document.elementFromPoint returns the ACTUAL page element
                // the user sees at this coordinate.
                // This runs synchronously within one JS task, so no visual flicker.
                const hiddenEls = [];
                ['pl-dropper-overlay', 'pl-dropper-preview', 'pl-dropper-hint'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.style.visibility = 'hidden';
                        hiddenEls.push(el);
                    }
                });

                // elementFromPoint (singular) returns the true topmost element,
                // respecting overflow clipping, z-index stacking, and visibility.
                const topEl = document.elementFromPoint(x, y);

                // Restore dropper elements immediately (same sync task = no flicker)
                hiddenEls.forEach(el => { el.style.visibility = ''; });

                if (topEl) {
                    // Walk up the DOM tree from the hit element to find the
                    // nearest ancestor with a visible background color. This
                    // mirrors what the user actually sees: the hit element on
                    // top, with its background (or its parent's, grandparent's,
                    // etc.) behind it.
                    let current = topEl;
                    let found = false;

                    while (current) {
                        try {
                            const cs = window.getComputedStyle(current);

                            // Skip invisible / near-invisible elements
                            if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) {
                                current = current.parentElement;
                                continue;
                            }

                            // Check solid backgroundColor
                            const bg = cs.backgroundColor;
                            if (bg && !window.ColorUtils.isTransparent(bg)) {
                                hex = window.ColorUtils.rgbToHex8(bg).toLowerCase();
                                Dropper._lastPickedElement = current;
                                found = true;
                                break;
                            }

                            // Check gradient backgroundImage — pick the first color stop
                            const bgImg = cs.backgroundImage;
                            if (bgImg && bgImg !== 'none' && bgImg.includes('gradient')) {
                                const colorMatch = bgImg.match(/(?:rgba?|hsla?)\([^)]+\)|#[0-9A-Fa-f]{3,8}\b/);
                                if (colorMatch) {
                                    const gradHex = window.ColorUtils.rgbToHex8(colorMatch[0]).toLowerCase();
                                    if (gradHex && !window.ColorUtils.isTransparent(colorMatch[0])) {
                                        hex = gradHex;
                                        Dropper._lastPickedElement = current;
                                        found = true;
                                        break;
                                    }
                                }
                            }
                        } catch (e) { /* skip inaccessible elements */ }

                        current = current.parentElement;
                    }

                    // Fallback: use the hit element's text (foreground) color
                    if (!found) {
                        try {
                            const cs = window.getComputedStyle(topEl);
                            const fg = cs.color;
                            if (fg && !window.ColorUtils.isTransparent(fg)) {
                                hex = window.ColorUtils.rgbToHex8(fg).toLowerCase();
                                Dropper._lastPickedElement = topEl;
                            }
                        } catch (e) { /* skip */ }
                    }
                }
            } catch (err) {
                // Silently handle errors
            }

            return hex;
        }
    };

    window.Dropper = Dropper;

} // end re-injection guard
