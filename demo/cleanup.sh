#!/usr/bin/env bash
set -euo pipefail

# Clean up any test artifacts
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Cleaning up test artifacts..."
rm -rf /tmp/kit-test-* /tmp/kit-gen-* /tmp/kit-verify-*
echo "Done."
