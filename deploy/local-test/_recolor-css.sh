#!/usr/bin/env bash
# Recolor globals.css: blue/cyan/violet -> achromatic platinum-silver.
# Operates on RGB triplets (both "r, g, b" and "r,g,b" spacing) + hex tokens.
# Idempotent enough for one pass; run once after the :root edit.
set -e
F='/mnt/c/Yeni klasör/vps/apps/dashboard/src/app/globals.css'
cp "$F" "$F.bak-blue"

# RGB triplets (spaced)  -> platinum greys
sed -i -E '
  s/79, ?124, ?255/214, 220, 230/g;
  s/106, ?147, ?255/223, 227, 234/g;
  s/85, ?214, ?224/174, 182, 194/g;
  s/139, ?123, ?255/184, 188, 200/g;
  s/20, ?40, ?110/0, 0, 0/g;
' "$F"

# RGB triplets (tight, no spaces)
sed -i -E '
  s/79,124,255/214,220,230/g;
  s/106,147,255/223,227,234/g;
  s/85,214,224/174,182,194/g;
  s/139,123,255/184,188,200/g;
  s/20,40,110/0,0,0/g;
' "$F"

# Hex tokens
sed -i -E '
  s/#4f7cff/#c8ccd4/g;
  s/#6a93ff/#dfe3ea/g;
  s/#9db4ff/#f2f4f8/g;
  s/#55d6e0/#aeb6c2/g;
  s/#8b7bff/#b8bcc8/g;
  s/#7c5cff/#b0b4c0/g;
' "$F"

echo "=== remaining blue refs (should be 0) ==="
grep -ocE '79, ?124, ?255|#4f7cff|85, ?214, ?224|139, ?123, ?255' "$F" || true
echo "done"
