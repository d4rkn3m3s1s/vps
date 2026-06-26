#!/usr/bin/env bash
# Second recolor pass: catch the OTHER blue/indigo/slate/teal RGB variants the
# first pass missed -> neutral platinum greys. Spaced + tight forms.
set -e
F='/mnt/c/Yeni klasör/vps/apps/dashboard/src/app/globals.css'

sed -i -E '
  s/124, ?140, ?255/190, 195, 205/g;
  s/139, ?149, ?255/205, 210, 220/g;
  s/140, ?160, ?210/150, 156, 168/g;
  s/85, ?214, ?190/170, 180, 178/g;
  s/124,140,255/190,195,205/g;
  s/139,149,255/205,210,220/g;
  s/140,160,210/150,156,168/g;
  s/85,214,190/170,180,178/g;
' "$F"

echo "=== remaining colored-blue/teal refs (target 0) ==="
grep -ocE '124, ?140, ?255|139, ?149, ?255|140, ?160, ?210|85, ?214, ?190|124,140,255|139,149,255' "$F" || true
echo "done"
