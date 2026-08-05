#!/bin/bash
# ★2026-08-05 FLEET KURTARMA — D-Bus restart / reboot SONRASI filoyu geri getirir.
#
# NEDEN VAR: cihazlar systemd ile YÖNETİLMİYOR (0 unit) — hepsi elle `wd-run.sh` ile
# başlatılmış. iptables REDIRECT kuralları da kalıcı DEĞİL (iptables-persistent kurulu
# değil). Yani bir restart/reboot sonrası:
#   • 127 cihaz süreci ÖLÜR ve kendiliğinden GELMEZ
#   • 136 REDIRECT kuralı KAYBOLUR → cihazlar DATACENTER IP'sinden çıkar → BAN RİSKİ
#     (21 Tem'de tam bu yaşandı: "iptables reboot-persist DEĞİLdi → ban salgını")
# WhatsApp hesapları GÜVENDE: /data fiziksel diskte (ext4/LVM), restart onu korur.
#
# KULLANIM:
#   fleet-restore.sh check     → sadece RAPORLA, hiçbir şey yapma (önce BUNU çalıştır)
#   fleet-restore.sh proxy     → yalnızca proxy/iptables geri uygula
#   fleet-restore.sh devices   → yalnızca cihazları başlat
#   fleet-restore.sh all       → proxy + cihazlar (tam kurtarma)
#
# ⚠️ Cihazları PARTİLER hâlinde başlatır — 127 boot aynı anda host'u boğar.
set -u
REC=/opt/fleet-recovery
WD=/opt/fleet-agent/waydroid
BATCH="${FLEET_RESTORE_BATCH:-4}"      # aynı anda kaç cihaz boot etsin
GAP="${FLEET_RESTORE_GAP:-25}"         # partiler arası bekleme (sn)
MODE="${1:-check}"

log() { echo "$(date '+%F %T') $*"; }

need() {
  [ -f "$REC/inst-country-latest.txt" ] || { log "❌ $REC/inst-country-latest.txt YOK — önce yedek al"; exit 1; }
  [ -f "$REC/iptables-nft-latest.rules" ] || { log "❌ iptables yedeği YOK"; exit 1; }
}

# ── DURUM RAPORU ────────────────────────────────────────────────────────────────
do_check() {
  log "── FİLO DURUMU ──"
  local running want redirect dbusconn
  running=$(pgrep -c -f "wd-run.sh" 2>/dev/null || echo 0)
  want=$(wc -l < "$REC/inst-country-latest.txt" 2>/dev/null || echo 0)
  redirect=$(iptables-nft-save 2>/dev/null | grep -c REDIRECT || echo 0)
  dbusconn=$(ss -x 2>/dev/null | grep -c system_bus_socket || echo 0)
  log "cihaz süreci     : $running (beklenen ~$want)"
  log "REDIRECT kuralı  : $redirect (yedekte $(grep -c REDIRECT "$REC/iptables-nft-latest.rules" 2>/dev/null))"
  log "redsocks süreci  : $(pgrep -c redsocks 2>/dev/null || echo 0)"
  log "D-Bus bağlantı   : $dbusconn"
  log "D-Bus limiti     : $(grep -oE 'max_connections_per_user\">[0-9]+' /etc/dbus-1/system.conf 2>/dev/null | grep -oE '[0-9]+$' || echo 'varsayılan 256')"
  [ "$redirect" -lt 50 ] && log "⚠️ REDIRECT kuralları EKSİK — proxy koruması YOK, cihazlar datacenter IP'den çıkıyor olabilir!"
  [ "$running" -lt $((want / 2)) ] && log "⚠️ Cihazların yarısından azı çalışıyor"
  return 0
}

# ── PROXY / IPTABLES GERİ YÜKLE ────────────────────────────────────────────────
# ÖNCE iptables'ı toptan geri yükleriz (hızlı, 136 kural bir seferde), SONRA
# redsocks süreçlerini config'lerinden ayağa kaldırırız.
do_proxy() {
  need
  log "── PROXY GERİ YÜKLEME ──"
  local before after
  before=$(iptables-nft-save 2>/dev/null | grep -c REDIRECT || echo 0)
  log "mevcut REDIRECT: $before"
  if [ "$before" -lt 50 ]; then
    log "iptables geri yükleniyor (nft)…"
    iptables-nft-restore < "$REC/iptables-nft-latest.rules" 2>&1 | head -3
    after=$(iptables-nft-save 2>/dev/null | grep -c REDIRECT || echo 0)
    log "REDIRECT: $before → $after"
  else
    log "REDIRECT kuralları yerinde ($before) — iptables'a DOKUNULMADI"
  fi
  # redsocks: her config için süreç yoksa başlat (config'ler diskte kalıcı)
  local started=0 alive=0
  for f in /etc/redsocks-inst-*.conf; do
    [ -f "$f" ] || continue
    local inst; inst=$(basename "$f" .conf | sed 's/redsocks-inst-//')
    if pgrep -f "redsocks-inst-$inst.conf" >/dev/null 2>&1; then
      alive=$((alive+1)); continue
    fi
    redsocks -c "$f" >/dev/null 2>&1 && started=$((started+1))
  done
  log "redsocks: $alive zaten ayakta, $started yeniden başlatıldı"
}

# ── CİHAZLARI BAŞLAT ───────────────────────────────────────────────────────────
do_devices() {
  need
  log "── CİHAZ BAŞLATMA (parti=$BATCH, ara=${GAP}sn) ──"
  local total=0 skipped=0 started=0 n=0
  while read -r inst cc port; do
    [ -n "${inst:-}" ] || continue
    total=$((total+1))
    if pgrep -f "wd-run.sh $inst\$" >/dev/null 2>&1; then
      skipped=$((skipped+1)); continue
    fi
    setsid "$WD/wd-run.sh" "$inst" >/dev/null 2>&1 < /dev/null &
    started=$((started+1)); n=$((n+1))
    if [ "$n" -ge "$BATCH" ]; then
      log "  …$started/$total başlatıldı, ${GAP}sn bekleniyor"
      sleep "$GAP"; n=0
    fi
  done < "$REC/inst-country-latest.txt"
  log "toplam=$total zaten-çalışan=$skipped başlatılan=$started"
  log "⏳ Boot ~90sn sürer; sonra 'fleet-restore.sh check' ile doğrulayın."
}

case "$MODE" in
  check)   do_check ;;
  proxy)   do_proxy; do_check ;;
  devices) do_devices ;;
  all)     do_proxy; do_devices; log "→ ~2dk sonra 'fleet-restore.sh check' çalıştırın" ;;
  *) echo "kullanım: $0 {check|proxy|devices|all}"; exit 2 ;;
esac
