/**
 * PaletteLive - Shadow Walker
 * Recursively traverses open Shadow DOMs to find all elements.
 */

// Guard against re-injection - use version to allow updates
const _SHADOW_WALKER_VERSION = 3;
if (window._shadowWalkerVersion === _SHADOW_WALKER_VERSION) {
    // Already loaded with same version
} else {
    window._shadowWalkerVersion = _SHADOW_WALKER_VERSION;

    const ShadowWalker = {
        // Counter for closed Shadow DOM hosts detected during walks
        closedShadowCount: 0,

        /**
         * Traverse all nodes including those in open Shadow roots
         * @param {Node} root - Starting node (usually document.body)
         * @param {Function} callback - Function to execute for each element
         */
        walk: (root, callback) => {
            if (!root) return;

            // Process the root itself if it is an element (e.g. document.body)
            // ShadowRoots are DocumentFragments (nodeType 11), so they are skipped here
            if (root.nodeType === 1) { // Node.ELEMENT_NODE
                callback(root);
            }

            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT,
                null,
                false
            );

            let node = walker.nextNode();
            while (node) {
                callback(node);

                // Check for Shadow Root
                if (node.shadowRoot && node.shadowRoot.mode === 'open') {
                    ShadowWalker.walk(node.shadowRoot, callback);
                }

                // Detect closed Shadow DOMs (element has shadow host behavior but no accessible shadowRoot)
                // Elements with closed shadow roots have no .shadowRoot property, but the browser
                // may render content inside them that we can't access.
                // NOTE: getBoundingClientRect() is intentionally avoided here because calling it
                // for every empty element forces a synchronous layout reflow, which can freeze
                // the page on large DOMs. We use a simple structural heuristic instead.
                if (!node.shadowRoot && node.attachShadow && node.innerHTML === '' &&
                    node.childElementCount === 0 && node.children.length === 0) {
                    ShadowWalker.closedShadowCount++;
                }

                node = walker.nextNode();
            }
        },

        /**
         * Get all elements in the page, including inside open shadow roots
         * @returns {Array<Element>}
         */
        getAllElements: () => {
            ShadowWalker.closedShadowCount = 0; // Reset counter each scan
            const elements = [];
            ShadowWalker.walk(document.body, (el) => elements.push(el));
            return elements;
        }
    };

    window.ShadowWalker = ShadowWalker;

} // end re-injection guard
