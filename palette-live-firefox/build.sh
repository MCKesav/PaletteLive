#!/bin/bash
# Build script for Firefox extension packaging
# Creates a ZIP with files at the root (no wrapping directory)
# Excludes node_modules, coverage, tests, and other dev files

set -e

EXTENSION_NAME="palette-live-firefox"
OUTPUT_DIR="$(pwd)"
ZIP_FILE="${OUTPUT_DIR}/${EXTENSION_NAME}.zip"

# Remove old build
rm -f "$ZIP_FILE"

echo "Building ${EXTENSION_NAME}.zip ..."

# Create ZIP from the current directory with only extension files
zip -r "$ZIP_FILE" \
    manifest.json \
    background.js \
    assets/ \
    content/ \
    heatmap/ \
    popup/ \
    sidepanel/ \
    utils/ \
    -x "*.DS_Store" "Thumbs.db" "desktop.ini"

echo ""
echo "Created: ${ZIP_FILE}"
echo "Contents:"
unzip -l "$ZIP_FILE" | head -30
echo ""
echo "Done! Upload ${ZIP_FILE} to Firefox Add-ons Developer Hub."
