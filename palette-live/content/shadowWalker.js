/**
 * PaletteLive - Shadow Walker
 * Recursively traverses open Shadow DOMs to find all elements.
 */

const ShadowWalker = {
    /**
     * Traverse all nodes including those in open Shadow roots
     * @param {Node} root - Starting node (usually document.body)
     * @param {Function} callback - Function to execute for each element
     */
    walk: (root, callback) => {
        if (!root) return;

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

            node = walker.nextNode();
        }
    },

    /**
     * Get all elements in the page, including inside open shadow roots
     * @returns {Array<Element>}
     */
    getAllElements: () => {
        const elements = [];
        ShadowWalker.walk(document.body, (el) => elements.push(el));
        return elements;
    }
};

window.ShadowWalker = ShadowWalker;
