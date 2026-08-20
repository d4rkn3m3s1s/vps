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
  # ★2026-08-15: toplam artik SABIT DEGIL -- log satirindaki "acik=N/M" den okunur.
  TOP=$(echo "$SON" | grep -oE "acik=[0-9?]+/[0-9]+" | cut -d/ -f2)
  [ -z "$TOP" ] && TOP=$(wc -l < /opt/fleet-agent/state/all_inst.txt 2>/dev/null)
  # ★2026-08-20: yedek deger artik SABIT DEGIL. "155" bayat bir sabitti; filo
  # buyuyup kuculdukce yanlis payda uretiyordu. Gercek referans: systemd'de
  # ENABLED birim sayisi = "calismasi GEREKEN" cihaz sayisi.
  if [ -z "$TOP" ] || [ "${TOP:-0}" -le 0 ] 2>/dev/null; then
    TOP=$(ls /etc/systemd/system/multi-user.target.wants/ 2>/dev/null | grep -c '^waydroid@')
  fi
  case "$TOP" in ''|*[!0-9]*) TOP=1 ;; esac
  [ "$TOP" -le 0 ] && TOP=1
  ACIK=${ACIK:-0}; D=${D:-0}; ADB=${ADB:-0}; KUY=${KUY:-0}; OFF=${OFF:-0}

  # ★2026-08-17 GERCEK YUK. Panelde ciplak "load" YANILTICIYDI (canli: load 11.6 iken
  # CPU %93 BOSTA). Sebep: Waydroid'de her cihaz yuzlerce UYUYAN Android thread'i tutar;
  # bunlarin anlik uyanmasi load sayacini sisirir ama CPU'yu KULLANMAZ. Dogru okuma:
  # load'u cekirdek sayisina bol -> gercek doluluk %. Idle'i de dogrudan gosteriyoruz.
  CORES=$(nproc 2>/dev/null); CORES=${CORES:-80}
  # load ondalikli -> tam sayi yuzde (awk ile, 100*load/cores)
  YUK=$(awk -v l="${LO:-0}" -v c="$CORES" 'BEGIN{ if(c>0) printf "%d", 100*l/c; else print 0 }')
  # Renk: gercek doluluga gore (idle >70 yesil, >40 sari, altı kirmizi)
  CU=${CPUID:-100}
  if [ "${CU%%.*}" -ge 70 ] 2>/dev/null; then CUR="#2ecc71"; CUT="rahat"
  elif [ "${CU%%.*}" -ge 40 ] 2>/dev/null; then CUR="#f39c12"; CUT="orta"
  else CUR="#e74c3c"; CUT="yogun"; fi

  # Derin tarama verileri
  dg(){ grep "^$1=" "$DETAY" 2>/dev/null | cut -d= -f2-; }
  IP=$(dg ip); NOIP=$(dg noip); BOOT=$(dg boot); ADBOK=$(dg adbok)
  NET=$(dg net); CIKIS=$(dg cikis); DZAMAN=$(dg zaman)
  # ★2026-08-15 proxy sizintisi: cihaz host'un kendi IP'siyle cikiyorsa proxy YOK
  # -> WhatsApp'a datacenter IP'sinden gidiliyor -> BAN riski. Sifir olmali.
  SIZ=$(dg sizinti); SIZ=${SIZ:-?}
  DCIP=$(dg dcip)

  # ★★★2026-08-20 EK OLCUMLER — sayfada eksik olan ve canlida ISIRAN dortlu.
  # (a) ARTIK DIZIN: silinen cihazlardan kalan /var/lib/waydroid.* dizinleri.
  #     SAYIMA (TOP) GIRMEZ. Eskiden giriyordu ve filo EKSIKSIZ iken sayfa
  #     "141/158" deyip surekli turuncu "bazi cihazlar dusuk" uyarisi veriyordu.
  ARTIK=$(wc -l < /opt/fleet-agent/state/artik_inst.txt 2>/dev/null); ARTIK=${ARTIK:-0}
  # (b) Sunucu ayakta suresi: beklenmedik reboot'u tek bakista gorebilmek icin
  #     (20 Agu'de sunucu 09:49'da kendiliginden yeniden basladi ve sayfada bunu
  #     gosteren HICBIR alan yoktu).
  UPS=$(cut -d. -f1 /proc/uptime 2>/dev/null); case "$UPS" in ''|*[!0-9]*) UPS=0 ;; esac
  if   [ "$UPS" -ge 86400 ]; then UPTXT="$((UPS/86400))g $(((UPS%86400)/3600))sa"
  elif [ "$UPS" -ge 3600 ];  then UPTXT="$((UPS/3600))sa $(((UPS%3600)/60))dk"
  else                            UPTXT="$((UPS/60))dk"; fi
  # (c) Disk: kok bolum dolarsa container'lar SESSIZCE bozulur.
  DISK=$(df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}'); DISK=${DISK:-0}
  case "$DISK" in ''|*[!0-9]*) DISK=0 ;; esac
  DISKBOS=$(df -Ph / 2>/dev/null | awk 'NR==2{print $4}')
  if   [ "$DISK" -ge 90 ]; then DISKR="#e74c3c"
  elif [ "$DISK" -ge 75 ]; then DISKR="#f39c12"
  else                          DISKR="#2ecc71"; fi
  RAMTOP=$(free -g 2>/dev/null | awk 'NR==2{print $2}')
  # (d) ★CIKISI YOK: ADB'ye cevap veriyor ama disari cikamiyor. mi277 + mi290 tam
  #     bu durumdaydi; panel onlari "acik" sayiyordu ama WhatsApp'lari CALISMIYORDU.
  CIKSIZ=$(awk -F'|' '$4=="device" && ($6=="-" || $6=="") {printf "%s ", $1}' "$S" 2>/dev/null)
  CIKSIZN=$(echo $CIKSIZ | wc -w); CIKSIZN=${CIKSIZN:-0}
  if [ "$CIKSIZN" -gt 0 ] 2>/dev/null; then CIKR="#e6a23c"; CIKN="disari cikamiyor — WhatsApp calismaz"
  else CIKR="#2ecc71"; CIKN="hepsi disari cikabiliyor"; fi
  # (e) ★YARIM ACILMIS: adb cevap verir (adbd erken kalkar) ama boot bitmemistir.
  #     Bu hal sessizdir: cihaz "device" gorunur, DHCP tamamlanmaz, netd resolver
  #     olmaz -> isim cozulmez. Gozcu artik bunu gorup yeniden baslatiyor.
  BOOTSUZ=$(awk -F'|' '$4=="device" && $3!="1" {printf "%s ", $1}' "$S" 2>/dev/null)
  BOOTSUZN=$(echo $BOOTSUZ | wc -w); BOOTSUZN=${BOOTSUZN:-0}
  if [ "$BOOTSUZN" -gt 0 ] 2>/dev/null; then BOOTR="#e74c3c"; BOOTN="$BOOTSUZN cihaz YARIM ACILMIS"
  else BOOTR="#e8e8ea"; BOOTN="boot tamamlandi"; fi
  # ★2026-08-20: UC DURUM. Eskiden yalnizca ">0 mi" bakiliyordu; DC_IP olculemeyince
  # sizinti "0" gelip YESIL "proxy hepsinde devrede" yaziyordu — hicbir sey
  # olculmemisken. Olculemeyen durum artik AYRI ve TURUNCU gosterilir.
  if [ "$SIZ" = "?" ] || [ -z "$DCIP" ]; then
    SIZR="#e6a23c"; SIZN="OLCULEMEDI — host cikis IP'si alinamadi, sizinti denetimi YOK"
  elif [ "${SIZ:-0}" -gt 0 ] 2>/dev/null; then
    SIZR="#e74c3c"; SIZN="⚠ BAN RISKI — proxy devrede degil"
  else
    SIZR="#2ecc71"; SIZN="proxy hepsinde devrede"
  fi

  # Renkler
  if [ "$D" -ge 50 ]; then DR="#e74c3c"; DT="TEHLIKE"; elif [ "$D" -ge 25 ]; then DR="#f39c12"; DT="dikkat"; else DR="#2ecc71"; DT="normal"; fi
  # Renk esikleri de filo boyutuna GORE (sabit 140/80 farkli filo boyutlarinda yanlisti)
  if [ "$ACIK" -ge $(( TOP * 90 / 100 )) ]; then AR="#2ecc71"
  elif [ "$ACIK" -ge $(( TOP * 50 / 100 )) ]; then AR="#f39c12"
  else AR="#e74c3c"; fi
  if [ "$AG" = "active" ]; then AGR="#2ecc71"; else AGR="#e74c3c"; fi
  if [ "$FR" = "active" ]; then FRR="#2ecc71"; else FRR="#e74c3c"; fi
  YUZDE=$(( ACIK * 100 / TOP ))

  # Mini grafik: son 30 olcumun acik-cihaz seyri
  BARS=""
  while read -r v; do
    [ -z "$v" ] && continue
    H=$(( v * 60 / TOP )); [ "$H" -lt 2 ] && H=2
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

    # ★2026-08-17 Genel saglik ozeti — tek bakista "iyi mi kotu mu". Karar D-state'e
    # gore (asil kilit sinyali); ham load'a DEGIL (o Waydroid'de hep yuksek gorunur).
    if [ "$D" -ge 50 ]; then OZR="#e74c3c"; OZT="&#9888; TEHLIKE — sistem sisiyor, fren devrede olmali"
    elif [ "$D" -ge 25 ]; then OZR="#f39c12"; OZT="&#9888; DIKKAT — I/O baskisi artiyor, izle"
    elif [ "$ACIK" -lt $(( TOP * 90 / 100 )) ]; then OZR="#f39c12"; OZT="&#9888; bazi cihazlar dusuk ($ACIK/$TOP acik)"
    elif [ "${SIZ:-0}" -gt 0 ] 2>/dev/null; then OZR="#e74c3c"; OZT="&#9888; PROXY SIZINTISI — ban riski"
    # ★2026-08-20: ozet artik "acik mi" ile yetinmiyor. mi277 + mi290 ACIK sayiliyordu
    # (bridge var, adb cevap veriyor) ama Android boot bitmemisti ve disari
    # cikamiyorlardi -> WhatsApp'lari CALISMIYORDU, ozet yine de "SAGLIKLI" diyordu.
    elif [ "${BOOTSUZN:-0}" -gt 0 ] 2>/dev/null; then OZR="#e74c3c"; OZT="&#9888; $BOOTSUZN CIHAZ YARIM ACILMIS — acik gorunuyor ama WhatsApp calismaz"
    elif [ "${CIKSIZN:-0}" -gt 0 ] 2>/dev/null; then OZR="#f39c12"; OZT="&#9888; $CIKSIZN cihaz disari cikamiyor — mesaj gonderemez"
    # ★2026-08-20: sizinti OLCULEMIYORSA "SAGLIKLI" DEME. Olcum yokken yesil ozet,
    # 47 cihazin sizintili oldugu 14 Agu gecesinin tekrarina davetiyedir.
    elif [ "${SIZ}" = "?" ] || [ -z "$DCIP" ]; then OZR="#e6a23c"; OZT="&#9888; PROXY SIZINTISI DENETLENEMIYOR — host cikis IP'si olculemedi"
    else OZR="#2ecc71"; OZT="&#10004; SISTEM SAGLIKLI — kilit yok, filo ayakta"; fi
    echo "<div class=\"c\" style=\"margin-bottom:16px;border-left:4px solid $OZR\"><div style=\"font-size:16px;font-weight:650;color:$OZR\">$OZT</div><div class=\"n\" style=\"margin-top:5px\">Karar D-state'e gore verilir (asil kilit sinyali). Ham load Waydroid'de hep yuksek gorunur, aldatmaz.</div></div>"

    echo '<div class="g">'
    echo "<div class=\"c\"><div class=\"k\">Acik cihaz</div><div class=\"v\" style=\"color:$AR\">$ACIK<span class=\"s\">/$TOP</span></div><div class=\"bar\"><div class=\"fill\" style=\"width:${YUZDE}%;background:$AR\"></div></div></div>"
    echo "<div class=\"c\"><div class=\"k\">ADB bagli</div><div class=\"v\">$ADB</div><div class=\"n\">bayat uc: $OFF</div></div>"
    echo "<div class=\"c\"><div class=\"k\">D-state &#9733; asil sinyal</div><div class=\"v\" style=\"color:$DR\">$D</div><div class=\"n\">$DT &middot; I/O bekleyen &middot; fren esigi 50</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Gercek yuk</div><div class=\"v\" style=\"color:$CUR\">${CU%%.*}<span class=\"s\">% bosta</span></div><div class=\"n\">doluluk ~%${YUK} &middot; $CUT</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Ham load</div><div class=\"v\" style=\"font-size:20px;color:#7a7a85\">${LO:-?}</div><div class=\"n\">$CORES cekirdek &middot; <b>yaniltici</b>: Waydroid uyuyan thread'leri sisirir</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Kuyrukta</div><div class=\"v\">$KUY</div><div class=\"n\">acilmayi bekliyor</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Bos RAM</div><div class=\"v\">${RAM:-?}<span class=\"s\">GB</span></div><div class=\"n\">toplam ${RAMTOP:-?} GB</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Agent</div><div class=\"v\" style=\"font-size:19px;color:$AGR\">${AG:-?}</div><div class=\"n\">panel baglantisi</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Fren</div><div class=\"v\" style=\"font-size:19px;color:$FRR\">${FR:-?}</div><div class=\"n\">sisme korumasi</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Sunucu ayakta</div><div class=\"v\" style=\"font-size:20px\">${UPTXT:-?}</div><div class=\"n\">son yeniden baslatmadan beri</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Disk</div><div class=\"v\" style=\"color:$DISKR\">${DISK:-?}<span class=\"s\">% dolu</span></div><div class=\"n\">kok bolum &middot; bos ${DISKBOS:-?}</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Artik dizin</div><div class=\"v\" style=\"font-size:20px;color:#7a7a85\">${ARTIK:-0}</div><div class=\"n\">silinmis cihazdan kalan &middot; sayima girmez</div></div>"
    echo '</div>'

    echo '<h2>Saglik taramasi (2 dakikada bir)</h2><div class="g">'
    echo "<div class=\"c\"><div class=\"k\">IP almis</div><div class=\"v\">${IP:-?}</div><div class=\"n\">IP yok: ${NOIP:-?}</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Android acik</div><div class=\"v\" style=\"color:$BOOTR\">${BOOT:-?}</div><div class=\"n\">$BOOTN</div></div>"
    echo "<div class=\"c\"><div class=\"k\">ADB erisilir</div><div class=\"v\">${ADBOK:-?}</div><div class=\"n\">komut alabilir</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Internet + proxy</div><div class=\"v\" style=\"color:#2ecc71\">${NET:-?}</div><div class=\"n\">disari cikabiliyor</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Proxy sizintisi</div><div class=\"v\" style=\"color:$SIZR\">${SIZ}</div><div class=\"n\">$SIZN</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Cikisi yok</div><div class=\"v\" style=\"color:$CIKR\">${CIKSIZN:-0}</div><div class=\"n\">$CIKN</div></div>"
    echo '</div>'
    # ★2026-08-20 GORUNURLUK: sorunlu cihazlarin ADLARI. mi277 + mi290 SAATLERCE
    # "acik ama disari cikamiyor" durumundaydi ve sayfanin HICBIR yerinde
    # gorunmuyordu (yalnizca gozcu logunda vardi) -> WhatsApp'lari calismiyordu
    # ama panel onlari "acik cihaz" sayiyordu. Artik adlariyla ustte gorunurler.
    if [ -n "$BOOTSUZ$CIKSIZ" ]; then
      echo "<div class=\"c\" style=\"margin-bottom:16px;border-left:4px solid #e6a23c\"><div class=\"k\">Dikkat isteyen cihazlar</div><div style=\"font-size:13px;margin-top:7px;line-height:1.8\">"
      [ -n "$BOOTSUZ" ] && echo "<div><b style=\"color:#e74c3c\">Yarim acilmis (Android boot bitmedi):</b> $(echo "$BOOTSUZ" | esc)</div>"
      [ -n "$CIKSIZ" ] && echo "<div><b style=\"color:#e6a23c\">Cikisi yok (disari ulasamiyor):</b> $(echo "$CIKSIZ" | esc)</div>"
      echo "</div></div>"
    fi
    # ★★★2026-08-17 OTONOM KURTARMA OLCUMU
    # "Dusen cihaz BEN MUDAHALE ETMEDEN kac dk'da kalkiyor?" — health-watch her
    # kurtarmada /var/lib/wd-health/recovery.log'a "<epoch> <inst> <sn> <yontem>"
    # yaziyor; down-<inst> dosyalari da SU AN dusuk olanlari (ve suresini) tutuyor.
    RECLOG=/var/lib/wd-health/recovery.log
    RNOW=$(date +%s); RCUT=$((RNOW - 86400))
    RSTAT=$(awk -v c="$RCUT" '$1>=c && $3 ~ /^[0-9]+$/ {n++; s+=$3; a[n]=$3; if($3>mx)mx=$3}
      END{ if(n==0){print "0 0 0 0"; exit}
           for(i=1;i<n;i++)for(j=i+1;j<=n;j++)if(a[i]>a[j]){t=a[i];a[i]=a[j];a[j]=t}
           md=(n%2)?a[(n+1)/2]:int((a[n/2]+a[n/2+1])/2)
           printf "%d %d %d %d", n, s/n, md, mx }' "$RECLOG" 2>/dev/null || echo "0 0 0 0")
    RN=$(echo "$RSTAT" | awk '{print $1}');  RAVG=$(echo "$RSTAT" | awk '{print $2}')
    RMED=$(echo "$RSTAT" | awk '{print $3}'); RMAX=$(echo "$RSTAT" | awk '{print $4}')
    # yonteme gore dagilim
    RREC=$(awk -v c="$RCUT" '$1>=c && $4=="reconnect"{n++}END{print n+0}' "$RECLOG" 2>/dev/null || echo 0)
    RZOM=$(awk -v c="$RCUT" '$1>=c && $4=="zombie-restart"{n++}END{print n+0}' "$RECLOG" 2>/dev/null || echo 0)
    RKEN=$(awk -v c="$RCUT" '$1>=c && $4=="kendiliginden"{n++}END{print n+0}' "$RECLOG" 2>/dev/null || echo 0)
    # SU AN dusuk olanlar
    DOWNN=0; DOWNL=""
    for _df in /var/lib/wd-health/down-*; do
      [ -e "$_df" ] || continue
      _in=$(basename "$_df" | sed 's/^down-//')
      # ★★★2026-08-20 MEZAR TASI FILTRESI. Silinmis cihazin `down-` damgasi hicbir
      # zaman temizlenmiyordu -> sayfa "su an dusuk: 15" diyordu ve 15'inin de HEPSI
      # SILINMIS cihazdi (hicbiri filo listesinde/enabled degildi, 9'unun dizini bile
      # yoktu; damgalar 2400-4000 dk = 40-67 saatlik). Operator filo 141/141 tam
      # ayaktayken "15 cihaz dusuk" goruyordu. Artik yalnizca GERCEK filo uyeleri.
      grep -qx "$_in" /opt/fleet-agent/state/all_inst.txt 2>/dev/null || continue
      _t0=$(cat "$_df" 2>/dev/null); case "$_t0" in ''|*[!0-9]*) continue ;; esac
      _dk=$(( (RNOW - _t0) / 60 )); DOWNN=$((DOWNN+1))
      DOWNL="$DOWNL<span style=\"display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border-radius:10px;background:#2b2b33;color:#e6a23c;font-size:13px\">$_in &middot; ${_dk}dk</span>"
    done
    [ "$DOWNN" = "0" ] && DOWNL="<span style=\"color:#2ecc71\">su an dusuk cihaz YOK</span>"
    # renk: ortalama 5dk alti yesil, 15dk alti sari, ustu kirmizi
    RAVGDK=$((RAVG / 60)); RMEDDK=$((RMED / 60)); RMAXDK=$((RMAX / 60))
    if [ "$RN" = "0" ]; then RCOL="#7a7a85"; elif [ "$RAVGDK" -lt 5 ]; then RCOL="#2ecc71";
    elif [ "$RAVGDK" -lt 15 ]; then RCOL="#e6a23c"; else RCOL="#e74c3c"; fi

    echo "<h2>Otonom kurtarma (son 24 saat &middot; mudahalesiz)</h2><div class=\"g\">"
    echo "<div class=\"c\"><div class=\"k\">Ortalama kalkis</div><div class=\"v\" style=\"color:$RCOL\">${RAVGDK}<span class=\"s\">dk</span></div><div class=\"n\">${RAVG} sn &middot; kendiliginden toparlanma</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Medyan</div><div class=\"v\">${RMEDDK}<span class=\"s\">dk</span></div><div class=\"n\">tipik cihaz &middot; ${RMED} sn</div></div>"
    echo "<div class=\"c\"><div class=\"k\">En kotu</div><div class=\"v\">${RMAXDK}<span class=\"s\">dk</span></div><div class=\"n\">en uzun suren kurtarma</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Kurtarma sayisi</div><div class=\"v\">${RN}</div><div class=\"n\">reconnect ${RREC} &middot; restart ${RZOM} &middot; kendi ${RKEN}</div></div>"
    echo "<div class=\"c\"><div class=\"k\">Su an dusuk</div><div class=\"v\" style=\"color:$([ "$DOWNN" = "0" ] && echo '#2ecc71' || echo '#e6a23c')\">${DOWNN}</div><div class=\"n\">kurtarilmayi bekliyor</div></div>"
    echo "</div>"
    echo "<div class=\"c\" style=\"margin-bottom:16px\"><div class=\"k\">Su an dusuk cihazlar</div><div style=\"margin-top:6px\">${DOWNL}</div><div class=\"n\">health-watch 7 dk'da bir tarar &middot; D-state esigi asilmadikca BEKLEMEZ</div></div>"

    echo "<div class=\"c\" style=\"margin-bottom:16px\"><div class=\"k\">Proxy cikis IP ornekleri</div><div style=\"font-size:14px;margin-top:6px;font-family:ui-monospace,monospace;color:#3498db\">${CIKIS:-bekleniyor}</div><div class=\"n\">TR residential olmali &middot; host IP: ${DCIP:-?} (bu IP cikarsa SIZINTI)</div></div>"

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
