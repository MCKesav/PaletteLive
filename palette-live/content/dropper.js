/**
 * PaletteLive - Color Dropper
 * Click any element on the page to pick its color, then edit it
 * via an inline floating panel — entirely self-contained in the content script.
 */

const Dropper = {
    _active: false,
    _overlay: null,
    _preview: null,
    _hint: null,
    _editor: null,
    _originalHex: null,
    _outsideClickTimeout: null,

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
        const preview = Dropper._preview;
        if (!preview) return;
        const color = Dropper._colorAtPoint(e.clientX, e.clientY);

        // Position preview (flip below cursor when near top)
        const nearTop = e.clientY < 100;
        preview.style.left = e.clientX + 'px';
        preview.style.top = e.clientY + 'px';
        preview.style.transform = nearTop
            ? 'translate(-50%, 30px)'
            : 'translate(-50%, -130%)';
        preview.style.display = 'flex';

        const swatch = document.getElementById('pl-dropper-swatch');
        const label = document.getElementById('pl-dropper-label');
        if (swatch) swatch.style.backgroundColor = color;
        if (label) label.textContent = color;
    },

    _onPickClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
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
        // Close any previous editor
        Dropper._closeEditor();
        Dropper._originalHex = originalHex;

        const panel = document.createElement('div');
        panel.id = 'pl-dropper-editor';
        // All styles inline so page CSS can't interfere
        panel.style.cssText =
            'position:fixed;z-index:2147483647;background:#fff;border:1px solid #e2e8f0;' +
            'border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.18);' +
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
            'font-size:13px;color:#1e293b;width:240px;overflow:hidden;user-select:none;';

        // Header
        const header = document.createElement('div');
        header.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;' +
            'padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;';
        header.innerHTML =
            '<span style="font-weight:700;font-size:12px;letter-spacing:0.3px;">EDIT COLOR</span>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText =
            'background:none;border:none;font-size:18px;cursor:pointer;color:#64748b;' +
            'line-height:1;padding:0 2px;';
        closeBtn.addEventListener('click', () => Dropper._closeEditor());
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;';

        // Original color row
        const origRow = document.createElement('div');
        origRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
        origRow.innerHTML =
            '<div style="width:28px;height:28px;border-radius:6px;border:2px solid rgba(0,0,0,0.1);' +
            'background:' + originalHex + ';flex-shrink:0;"></div>' +
            '<div style="flex:1;">' +
            '<div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;' +
            'letter-spacing:0.4px;">Original</div>' +
            '<div style="font-family:Courier New,monospace;font-weight:600;font-size:13px;">' +
            originalHex + '</div></div>';
        body.appendChild(origRow);

        // Divider
        const divider = document.createElement('div');
        divider.style.cssText = 'height:1px;background:#e2e8f0;';
        body.appendChild(divider);

        // New color row with picker
        const newRow = document.createElement('div');
        newRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
        const pickerWrap = document.createElement('div');
        pickerWrap.style.cssText =
            'width:28px;height:28px;border-radius:6px;overflow:hidden;' +
            'border:2px solid rgba(0,0,0,0.1);flex-shrink:0;position:relative;';
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = originalHex.length === 7 ? originalHex : '#000000';
        picker.style.cssText =
            'position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);' +
            'border:none;cursor:pointer;padding:0;';
        pickerWrap.appendChild(picker);

        const labelWrap = document.createElement('div');
        labelWrap.style.cssText = 'flex:1;';
        labelWrap.innerHTML =
            '<div style="font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase;' +
            'letter-spacing:0.4px;">New Color</div>';
        const hexLabel = document.createElement('div');
        hexLabel.id = 'pl-editor-hex';
        hexLabel.style.cssText =
            'font-family:Courier New,monospace;font-weight:600;font-size:13px;';
        hexLabel.textContent = picker.value;
        labelWrap.appendChild(hexLabel);
        newRow.appendChild(pickerWrap);
        newRow.appendChild(labelWrap);
        body.appendChild(newRow);
        panel.appendChild(body);

        // Footer with buttons
        const footer = document.createElement('div');
        footer.style.cssText =
            'display:flex;gap:6px;padding:0 12px 12px 12px;';
        const resetBtn = document.createElement('button');
        resetBtn.textContent = 'Reset';
        resetBtn.style.cssText =
            'flex:1;padding:7px 0;border:1px solid #e2e8f0;border-radius:6px;' +
            'background:#fff;color:#1e293b;font-size:12px;font-weight:600;cursor:pointer;';
        const doneBtn = document.createElement('button');
        doneBtn.textContent = 'Done';
        doneBtn.style.cssText =
            'flex:1;padding:7px 0;border:none;border-radius:6px;' +
            'background:#6366f1;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';
        footer.appendChild(resetBtn);
        footer.appendChild(doneBtn);
        panel.appendChild(footer);

        // Position the panel near the click point
        document.documentElement.appendChild(panel);
        const rect = panel.getBoundingClientRect();
        let left = x + 16;
        let top = y - rect.height / 2;
        // Keep within viewport
        if (left + rect.width > window.innerWidth) left = x - rect.width - 16;
        if (top < 8) top = 8;
        if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';

        Dropper._editor = panel;

        // ── Editor event handlers ──

        picker.addEventListener('input', () => {
            const newVal = picker.value;
            hexLabel.textContent = newVal;
            // Dispatch override event for content.js to apply
            window.dispatchEvent(new CustomEvent('pl-dropper-override', {
                detail: { original: originalHex, current: newVal }
            }));
        });

        resetBtn.addEventListener('click', () => {
            picker.value = originalHex.length === 7 ? originalHex : '#000000';
            hexLabel.textContent = originalHex;
            // Revert to original
            window.dispatchEvent(new CustomEvent('pl-dropper-override', {
                detail: { original: originalHex, current: originalHex }
            }));
        });

        doneBtn.addEventListener('click', () => {
            const finalColor = picker.value;
            // Save the override
            window.dispatchEvent(new CustomEvent('pl-dropper-save', {
                detail: { original: originalHex, current: finalColor }
            }));
            Dropper._closeEditor();
        });

        // Close on Escape
        Dropper._editorKeyHandler = (e) => {
            if (e.key === 'Escape') Dropper._closeEditor();
        };
        document.addEventListener('keydown', Dropper._editorKeyHandler);

        // Close on outside click (after a short delay so this click doesn't trigger it)
        Dropper._outsideClickTimeout = setTimeout(() => {
            Dropper._outsideClickTimeout = null;
            if (!Dropper._editor || !panel.parentNode) return;
            Dropper._outsideClickHandler = (e) => {
                if (panel && !panel.contains(e.target)) {
                    Dropper._closeEditor();
                }
            };
            document.addEventListener('mousedown', Dropper._outsideClickHandler);
        }, 200);
    },

    _closeEditor: () => {
        if (Dropper._outsideClickTimeout) {
            clearTimeout(Dropper._outsideClickTimeout);
            Dropper._outsideClickTimeout = null;
        }
        if (Dropper._editor) {
            Dropper._editor.remove();
            Dropper._editor = null;
        }
        if (Dropper._editorKeyHandler) {
            document.removeEventListener('keydown', Dropper._editorKeyHandler);
            Dropper._editorKeyHandler = null;
        }
        if (Dropper._outsideClickHandler) {
            document.removeEventListener('mousedown', Dropper._outsideClickHandler);
            Dropper._outsideClickHandler = null;
        }
        Dropper._originalHex = null;
    },

    // ── Shared helpers ────────────────────────────────────────────

    /** Read the dominant color at a screen coordinate */
    _colorAtPoint: (x, y) => {
        // Temporarily hide dropper elements so elementFromPoint hits the real page.
        const elems = [Dropper._overlay, Dropper._preview, Dropper._hint, Dropper._editor];
        const restoreState = [];

        elems.forEach(el => {
            if (!el) return;
            restoreState.push({
                el,
                pointerEvents: el.style.pointerEvents,
                display: el.style.display
            });
            el.style.pointerEvents = 'none';
        });

        if (Dropper._preview) Dropper._preview.style.display = 'none';
        if (Dropper._hint) Dropper._hint.style.display = 'none';

        let hex = '#000000';
        try {
            const el = document.elementFromPoint(x, y);
            if (el) {
                const cs = window.getComputedStyle(el);
                // Prefer background-color, then text color.
                const bg = cs.backgroundColor;
                if (bg && !window.ColorUtils.isTransparent(bg)) {
                    hex = window.ColorUtils.rgbToHex(bg).toLowerCase();
                } else {
                    const fg = cs.color;
                    if (fg && !window.ColorUtils.isTransparent(fg)) {
                        hex = window.ColorUtils.rgbToHex(fg).toLowerCase();
                    }
                }
            }
        } catch (err) {
            console.warn('PaletteLive Dropper: error reading color', err);
        }

        // Restore the exact previous interaction/display state.
        restoreState.forEach(state => {
            state.el.style.pointerEvents = state.pointerEvents;
            state.el.style.display = state.display;
        });

        return hex;
    }
};

window.Dropper = Dropper;
