#!/bin/bash
# Filter lists download karke rules dobara banata hai. Chalao: bash build/update_lists.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p /tmp/vab-lists && cd /tmp/vab-lists
E=https://raw.githubusercontent.com/easylist/easylist/gh-pages
U=https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters
for u in $E/easylist.txt $E/easyprivacy.txt $E/fanboy-annoyance.txt \
  https://raw.githubusercontent.com/easylist/antiadblockfilters/master/antiadblockfilters/antiadblock_english.txt \
  $U/filters.txt $U/quick-fixes.txt $U/badware.txt $U/annoyances-cookies.txt; do
  echo "download: $(basename $u)"; curl -sfL -o "$(basename $u)" "$u"
done
cd - >/dev/null
python3 build/build_filters.py /tmp/vab-lists
echo "Ho gaya! Ab manifest.json mein version badhao aur naya zip banao."
