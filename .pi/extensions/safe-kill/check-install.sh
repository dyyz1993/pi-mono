#!/bin/bash

echo "======================================"
echo "Safe Kill Extension - Installation Check"
echo "======================================"
echo ""

# Check source
echo "📁 Source (pi-mono):"
if [ -f "/Users/xuyingzhou/Project/temporary/pi-mono/.pi/extensions/safe-kill/index.ts" ]; then
	echo "   ✓ index.ts exists"
else
	echo "   ✗ index.ts NOT found"
fi
echo ""

# Check pi-example project
echo "📁 Project (pi-example):"
if [ -f "/Users/xuyingzhou/Project/temporary/pi-example/.pi/extensions/safe-kill/index.ts" ]; then
	echo "   ✓ Installed"
else
	echo "   ✗ NOT installed"
fi
echo ""

# Check global
echo "📁 Global (~/.pi/agent/extensions):"
if [ -f "~/.pi/agent/extensions/safe-kill/index.ts" ]; then
	echo "   ✓ Installed"
else
	echo "   ✗ NOT installed"
fi
echo ""

echo "======================================"
echo "To install, run ONE of these:"
echo ""
echo "# Option 1: Copy to pi-example project"
echo "cp -r /Users/xuyingzhou/Project/temporary/pi-mono/.pi/extensions/safe-kill \\"
echo "   /Users/xuyingzhou/Project/temporary/pi-example/.pi/extensions/"
echo ""
echo "# Option 2: Copy to global (all projects)"
echo "cp -r /Users/xuyingzhou/Project/temporary/pi-mono/.pi/extensions/safe-kill \\"
echo "   ~/.pi/agent/extensions/"
echo ""
echo "# Option 3: Test with -e flag"
echo "pi -e /Users/xuyingzhou/Project/temporary/pi-mono/.pi/extensions/safe-kill/index.ts"
echo "======================================"
