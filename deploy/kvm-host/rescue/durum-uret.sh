#!/bin/bash
# 2026-08-14 v2 Canli durum SAYFASI. http://125.253.73.45/durum
# Kaynaklar: /var/log/wd-izle.log (20sn sayim) + state/detay.txt (2dk derin tarama)
#            + wd-fren.log (sisme kayitlari) + state/saglik.out (cihaz bazli)
OUT=/opt/fleet-agent/state/durum.html
L=/var/log/wd-izle.log
DETAY=/opt/fleet-agent/state/detay.txt
S=/opt/fleet-agent/state/saglik.out

esc(){ sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g'; }

while true; do
  SON=$(tail -1 "$L" 2>/dev/null)
  g(){ echo "$SON" | grep -oE "$1=[0-9.]+" | head -1 | cut -d= -f2; }
  ACIK=$(g acik); KUY=$(g kuyruk); ADB=$(g adb); OFF=$(g off)
  D=$(g D); LO=$(g load); RAM=$(g RAM); CPUID=$(g cpuidle)
  AG=$(echo "$SON" | grep -oE "agent=[a-z]+" | cut -d= -f2)
  FR=$(echo "$SON" | grep -oE "fren=[a-z]+" | cut -d= -f2)
  ACIK=${ACIK:-0}; D=${D:-0}; ADB=${ADB:-0}; KUY=${KUY:-0}; OFF=${OFF:-0}

  # Derin tarama verileri
  dg(){ grep "^$1=" "$DETAY" 2>/dev/null | cut -d= -f2-; }
  IP=$(dg ip); NOIP=$(dg noip); BOOT=$(dg boot); ADBOK=$(dg adbok)
  NET=$(dg net); CIKIS=$(dg cikis); DZAMAN=$(dg zaman)

  # Renkler
  if [ "$D" -ge 50 ]; then DR="#e74c3c"; DT="TEHLIKE"; elif [ "$D" -ge 25 ]; then DR="#f39c12"; DT="dikkat"; else DR="#2ecc71"; DT="normal"; fi
  if [ "$ACIK" -ge 140 ]; then AR="#2ecc71"; elif [ "$ACIK" -ge 80 ]; then AR="#f39c12"; else AR="#e74c3c"; fi
  if [ "$AG" = "active" ]; then AGR="#2ecc71"; else AGR="#e74c3c"; fi
  if [ "$FR" = "active" ]; then FRR="#2ecc71"; else FRR="#e74c3c"; fi
  YUZDE=$(( ACIK * 100 / 156 ))

  # Mini grafik: son 30 olcumun acik-cihaz seyri
  BARS=""
  while read -r v; do
    [ -z "$v" ] && continue
    H=$(( v * 60 / 156 )); [ "$H" -lt 2 ] && H=2
    BARS="$BARS<div style=\"flex:1;background:#3498db;height:${H}px;border-radius:2px 2px 0 0\" title=\"$v cihaz\"></div>"
  done < <(tail -30 "$L" 2>/dev/null | grep -oE "acik=[0-9]+" | cut -d= -f2)

  # D-state seyri
  DBARS=""
  while read -r v; do
    [ -z "$v" ] && continue
    H=$(( v * 60 / 100 )); [ "$H" -lt 2 ] && H=2; [ "$H" -gt 60 ] && H=60
    if [ "$v" -ge 50 ]; then C="#e74c3c"; elif [ "$v" -ge 25 ]; then C="#f39c12"; else C="#2ecc71"; fi
    DBARS="$DBARS<div style=\"flex:1;background:$C;height:${H}px;border-radius:2px 2px 0 0\" title=\"D=$v\"></div>"
  done < <(tail -30 "$L" 2>/dev/null | grep -oE " D=[0-9]+" | cut -d= -f2)

  FRENLOG=$(tail -8 /var/log/wd-fren.log 2>/dev/null | tac | esc)
  [ -z "$FRENLOG" ] && FRENLOG="(sisme kaydi yok - sistem hic zorlanmadi)"

  # Sorunlu cihazlar
  SORUN=$(awk -F'|' '$2=="NOIP" || ($2 ~ /^19|^10/ && $6=="-") {printf "%s ", $1}' "$S" 2>/dev/null | fold -w 100 -s | head -4 | esc)
  [ -z "$SORUN" ] && SORUN="(sorunlu cihaz yok)"

  {
    cat <<'HEAD'
<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="refresh" content="10">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Filo Durumu</title><style>
*{box-sizing:border-box}
body{background:#0d0d0f;color:#e8e8ea;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:16px;max-width:1100px;margin:0 auto}
h1{font-size:19px;margin:0 0 3px;font-weight:600}
.sub{color:#7a7a85;font-size:13px;margin-bottom:16px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin-bottom:16px}
.c{background:#18181c;border-radius:12px;padding:13px;border:1px solid #232329}
.k{color:#8a8a95;font-size:11px;text-transform:uppercase;letter-spacing:.6px;font-weight:500}
.v{font-size:27px;font-weight:650;margin-top:4px;line-height:1.1}
.s{font-size:14px;color:#6a6a75}
.n{font-size:11px;color:#7a7a85;margin-top:3px}
h2{font-size:13px;color:#8a8a95;margin:18px 0 7px;font-weight:600;text-transform:uppercase;letter-spacing:.6px}
pre{background:#18181c;border:1px solid #232329;border-radius:12px;padding:13px;overflow-x:auto;font-size:12px;line-height:1.65;margin:0;font-family:ui-monospace,"SF Mono",Menlo,monospace}
.bar{background:#232329;border-radius:99px;height:9px;overflow:hidden;margin-top:9px}
.fill{height:100%;border-radius:99px;transition:width .4s}
.chart{display:flex;align-items:flex-end;gap:2px;height:62px;background:#18181c;border:1px solid #232329;border-radius:12px;padding:10px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:640px){.two{grid-template-columns:1fr}}
</style></head><body>
HEAD
    echo "<h1>Filo Durumu</h1><div class=\"sub\">10 saniyede bir yenilenir &middot; son olcum: $(echo "$SON" | cut -d' ' -f1) &middot; derin tarama: ${DZAMAN:-bekleniyor}</div>"

    echo '<div class="g">'
    echo "<div class=\"c\"><div class=\"k\">Acik cihaz</div><div class=\"v\" style=\"color:$AR\">$ACIK<span class=\"s\">/156</span></div><div class=\"bar\"><div class=\"fill\" style=\"width:${YUZDE}%;background:$AR\"></div></div></div>"
    echo "<div class=\"c\"><div class=\"k\">ADB bagli</div><div class=\"v\">$ADB</div><div class=\"n\">bayat uc: $OFF</div></div>"
    echo "<div class=\"c\"><div class=\"k\">D-state</div><div class=\"v\" style=\"color:$DR\">$D</div><div class=\"n\">$DT &middot; fren esigi 50</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Kuyrukta</div><div class=\"v\">$KUY</div><div class=\"n\">acilmayi bekliyor</div></div>"
    echo "<div class=\"c\"><div class=\"k\">CPU bosta</div><div class=\"v\">${CPUID:-?}<span class=\"s\">%</span></div><div class=\"n\">load: ${LO:-?}</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Bos RAM</div><div class=\"v\">${RAM:-?}<span class=\"s\">GB</span></div><div class=\"n\">toplam 250 GB</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Agent</div><div class=\"v\" style=\"font-size:19px;color:$AGR\">${AG:-?}</div><div class=\"n\">panel baglantisi</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Fren</div><div class=\"v\" style=\"font-size:19px;color:$FRR\">${FR:-?}</div><div class=\"n\">sisme korumasi</div></div>"
    echo '</div>'

    echo '<h2>Saglik taramasi (2 dakikada bir)</h2><div class="g">'
    echo "<div class=\"c\"><div class=\"k\">IP almis</div><div class=\"v\">${IP:-?}</div><div class=\"n\">IP yok: ${NOIP:-?}</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Android acik</div><div class=\"v\">${BOOT:-?}</div><div class=\"n\">boot tamamlandi</div></div>"
    echo "<div class=\"c\"><div class=\"k\">ADB erisilir</div><div class=\"v\">${ADBOK:-?}</div><div class=\"n\">komut alabilir</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Internet + proxy</div><div class=\"v\" style=\"color:#2ecc71\">${NET:-?}</div><div class=\"n\">disari cikabiliyor</div></div>"
    echo '</div>'
    echo "<div class=\"c\" style=\"margin-bottom:16px\"><div class=\"k\">Proxy cikis IP ornekleri</div><div style=\"font-size:14px;margin-top:6px;font-family:ui-monospace,monospace;color:#3498db\">${CIKIS:-bekleniyor}</div><div class=\"n\">TR residential olmali</div></div>"

    echo '<div class="two">'
    echo "<div><h2>Acik cihaz seyri (son 10 dk)</h2><div class=\"chart\">$BARS</div></div>"
    echo "<div><h2>D-state seyri (son 10 dk)</h2><div class=\"chart\">$DBARS</div></div>"
    echo '</div>'

    echo '<h2>Sorunlu cihazlar</h2><pre>'
    echo "$SORUN"
    echo '</pre>'

    echo '<h2>Fren kaydi (sisme oldu mu)</h2><pre>'
    echo "$FRENLOG"
    echo '</pre>'

    echo '<h2>Son 30 olcum</h2><pre>'
    tail -30 "$L" 2>/dev/null | tac | esc
    echo '</pre></body></html>'
  } > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

  sleep 10
done
