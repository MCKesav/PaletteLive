/**
 * PaletteLive - Shadow Walker
 * Recursively traverses open Shadow DOMs to find all elements.
 */

// Guard against re-injection - use version to allow updates
var _SHADOW_WALKER_VERSION = 3;
if (window._shadowWalkerVersion === _SHADOW_WALKER_VERSION) {
    // Already loaded with same version
} else {
    window._shadowWalkerVersion = _SHADOW_WALKER_VERSION;

    const ShadowWalker = {
        // Counter for closed Shadow DOM hosts detected during walks
        closedShadowCount: 0,

        // Maximum recursion depth for nested shadow roots to prevent stack overflow
        MAX_SHADOW_DEPTH: 30,

        // Maximum total elements collected by getAllElements to prevent OOM
        MAX_ELEMENTS: 50000,

        // Non-visual element tags that never carry rendered color — skipping them
        // avoids unnecessary getComputedStyle calls downstream.
        _NON_VISUAL_TAGS: new Set([
            'SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE',
            'HEAD', 'TITLE', 'BASE', 'BR', 'WBR',
        ]),

        /**
         * Traverse all nodes including those in open Shadow roots
         * @param {Node} root - Starting node (usually document.body)
         * @param {Function} callback - Function to execute for each element; return false to stop walk
         * @param {number} [depth=0] - Current shadow DOM nesting depth (internal)
         */
        walk: (root, callback, depth = 0) => {
            if (!root) return;

            // Prevent stack overflow from deeply nested shadow DOMs
            if (depth > ShadowWalker.MAX_SHADOW_DEPTH) return;

            // Process the root itself if it is an element (e.g. document.body)
            // ShadowRoots are DocumentFragments (nodeType 11), so they are skipped here
            if (root.nodeType === 1) {
                // Node.ELEMENT_NODE
                if (callback(root) === false) return false;
            }

            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);

            let node = walker.nextNode();
            while (node) {
                // Skip non-visual elements — they never carry rendered color
                if (ShadowWalker._NON_VISUAL_TAGS.has(node.tagName)) {
                    node = walker.nextNode();
                    continue;
                }
                if (callback(node) === false) return false;

                // Check for Shadow Root
                if (node.shadowRoot && node.shadowRoot.mode === 'open') {
                    if (ShadowWalker.walk(node.shadowRoot, callback, depth + 1) === false) return false;
                }

                // Detect closed Shadow DOMs (element has shadow host behavior but no accessible shadowRoot)
                // Elements with closed shadow roots have no .shadowRoot property, but the browser
                // may render content inside them that we can't access.
                // NOTE: getBoundingClientRect() is intentionally avoided here because calling it
                // for every empty element forces a synchronous layout reflow, which can freeze
                // the page on large DOMs. We use a structural heuristic: the element must be
                // a valid shadow host (has attachShadow) with no light DOM children.
                // Checking childElementCount is sufficient and avoids innerHTML which triggers
                // HTML serialization of the entire subtree.
                if (
                    !node.shadowRoot &&
                    node.attachShadow &&
                    node.tagName && node.tagName.includes('-') &&
                    node.childElementCount === 0 &&
                    node.childNodes.length === 0
                ) {
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
            let stopped = false;
            ShadowWalker.walk(document.body, (el) => {
                if (stopped) return false;
                elements.push(el);
                if (elements.length >= ShadowWalker.MAX_ELEMENTS) {
                    stopped = true;
                    return false;
                }
            });
            return elements;
        },
    };

    // Lock methods & constants to prevent monkey-patching, but keep
    // closedShadowCount and MAX_ELEMENTS writable (they mutate at runtime).
    Object.freeze(ShadowWalker._NON_VISUAL_TAGS);
    ['walk', 'getAllElements', '_NON_VISUAL_TAGS', 'MAX_SHADOW_DEPTH'].forEach((key) => {
        Object.defineProperty(ShadowWalker, key, { writable: false, configurable: false });
    });
    Object.seal(ShadowWalker); // prevent adding new properties
    window.ShadowWalker = ShadowWalker;
} // end re-injection guard
