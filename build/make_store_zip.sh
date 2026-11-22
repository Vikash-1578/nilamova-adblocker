#!/bin/bash
# Chrome Web Store / Edge par upload karne wali zip banata hai (build/, _metadata, README bahar)
cd "$(dirname "$0")/.."
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
rm -rf _metadata
OUT="../NilamovaAdBlocker-store-v$V.zip"
rm -f "$OUT"
zip -qr "$OUT" . -x "build/*" "_metadata/*" "README.md" ".*"
echo "Bana: $OUT"
