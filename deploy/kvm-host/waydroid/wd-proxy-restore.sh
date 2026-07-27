#!/usr/bin/env bash
# Boot'ta (ve manuel) TÜM aktif-WhatsApp cihazlarına ülke-eşleşmeli proxy'yi yeniden
# uygular. iptables REDIRECT kuralları reboot'ta silinir → bu servis onları geri kurar,
# böylece cihazlar datacenter IP yerine doğru ülke proxy'sinden çıkmaya devam eder.
#
# ÜLKE KAYNAĞI (öncelik sırası, en güvenilir önce):
#   1) device.metadata.proxyCountry  — register-time'da auto-proxy.ts'in TAM E.164→ISO
#      haritasıyla çözüp yazdığı ISO-2 ülke. TEK GERÇEK KAYNAK budur; numaradan yeniden
#      türetmek yerine bunu kullan (aksi halde DE/GB/FR/... hepsi AL'e düşerdi → ban).
#   2) numaranın ülke kodu → cc_from_phone (metadata yoksa geri-düşüş).
# Her ülke kendi redsocks portunda (wd-proxy.sh rs_port_for ile eşleşir).
set -uo pipefail

WP="/opt/fleet-agent/waydroid/wd-proxy.sh"
LOG="/var/log/wd-proxy-restore.log"

# ── Credentials: env'den (systemd EnvironmentFile ile enjekte edilir), koda gömme.
# fleet-api ile AYNI env adları — tek gerçek kaynak. Env yoksa (elle çalıştırma)
# aşağıdaki değerler geriye-uyum için varsayılan kalır ama commit'te secret tutmamak
# için üretimde /etc/fleet-proxy.env üzerinden gelmeli.
# ★ `.pr` RESMİ endpoint (`.eu` DEĞİL). `.eu` kısmen çalışır ama ~%15 istekte
# `Resource_203 / "resource IP is incorrect"` → 502 döner (ölçüm: eu 34/40, pr 40/40).
H="${FLEET_PROXY_HOST:-ncx9yhrx.pr.thordata.net}"
U_RES="${FLEET_PROXY_USER:-}"; P_RES="${FLEET_PROXY_PASS:-}"; PORT_RES="${FLEET_PROXY_PORT:-5555}"
U_MOB="${FLEET_PROXY_MOBILE_USER:-$U_RES}"; P_MOB="${FLEET_PROXY_MOBILE_PASS:-$P_RES}"
PORT_MOB="${FLEET_PROXY_MOBILE_PORT:-9999}"
# Hangi ülkeler mobil hesabı kullanır — fleet-api'deki FLEET_PROXY_MOBILE_COUNTRIES ile
# AYNI env. app 'TR,XX' derse restore de aynısını uygular (eski hali 'TR' hardcode'du).
MOBILE_CCS=" $(echo "${FLEET_PROXY_MOBILE_COUNTRIES:-TR}" | tr ',' ' ' | tr '[:lower:]' '[:upper:]') "

if [ -z "$U_RES" ]; then
  echo "$(date '+%F %T') HATA: FLEET_PROXY_USER boş (env yüklenmedi) — restore güvenli değil, DURDU" | tee -a "$LOG"
  exit 1
fi

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

is_mobile_cc() { case "$MOBILE_CCS" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Numaranın ülke kodundan ISO-2 ülke çıkar — SADECE metadata.proxyCountry yoksa kullanılır.
# TAM E.164→ISO haritası (auto-proxy.ts CC_TO_ISO ile eşleşir): eksik ülke sessizce AL'e
# düşmez; en uzun-önek eşleşir (355 önce 35 önce 3, +1 en son).
cc_from_phone() {
  local d; d="$(echo "${1#+}" | tr -cd '0-9')"
  [ -z "$d" ] && { echo ""; return; }
  local three two one; three="${d:0:3}"; two="${d:0:2}"; one="${d:0:1}"
  local k
  for k in "$three" "$two" "$one"; do
    case "$k" in
      355) echo AL;return;; 90) echo TR;return;; 49) echo DE;return;; 44) echo GB;return;;
      33) echo FR;return;;  39) echo IT;return;; 34) echo ES;return;; 31) echo NL;return;;
      351) echo PT;return;; 30) echo GR;return;; 359) echo BG;return;; 40) echo RO;return;;
      48) echo PL;return;;  380) echo UA;return;; 7) echo RU;return;; 46) echo SE;return;;
      47) echo NO;return;;  45) echo DK;return;; 358) echo FI;return;; 43) echo AT;return;;
      41) echo CH;return;;  32) echo BE;return;; 353) echo IE;return;; 1) echo US;return;;
      55) echo BR;return;;  52) echo MX;return;; 54) echo AR;return;; 91) echo IN;return;;
      62) echo ID;return;;  63) echo PH;return;; 84) echo VN;return;; 66) echo TH;return;;
      60) echo MY;return;;  65) echo SG;return;; 880) echo BD;return;; 92) echo PK;return;;
      971) echo AE;return;; 966) echo SA;return;; 20) echo EG;return;; 27) echo ZA;return;;
      234) echo NG;return;; 61) echo AU;return;; 64) echo NZ;return;; 81) echo JP;return;;
      386) echo SI;return;; 385) echo HR;return;; 381) echo RS;return;; 389) echo MK;return;;
      382) echo ME;return;; 383) echo XK;return;; 387) echo BA;return;; 420) echo CZ;return;;
      421) echo SK;return;; 36) echo HU;return;; 370) echo LT;return;; 371) echo LV;return;;
      372) echo EE;return;;
    esac
  done
  echo "" # bilinmeyen → BOŞ (asla somut bir ülkeye varsayma; satır atlanır)
}

# DB'den aktif/kısıtlı WA hesabı olan cihazları al. LEFT JOIN: hesabı henüz oluşmamış
# ama proxy'si uygulanmış (metadata.proxyCountry dolu) cihazlar da kapsanır — INNER JOIN
# onları reboot'ta proxy'siz bırakırdı. 3 kolon: instance | proxyCountry(ISO) | phone.
# psql başarısızsa (DB down) ROWS boş olur AMA aşağıda exit-code'u ayrıca kontrol ederiz.
SQL="SELECT d.metadata->>'instance',
            COALESCE(d.metadata->>'proxyCountry',''),
            COALESCE(g.\"phoneNumber\",'')
     FROM \"Device\" d
     LEFT JOIN \"GeneratedAccount\" g
       ON g.\"deviceId\"=d.id AND g.platform='whatsapp'
          AND g.status IN ('ACTIVE','RESTRICTED','AWAITING_OTP','AWAITING_MANUAL')
     WHERE d.metadata->>'instance' IS NOT NULL
       AND ( g.id IS NOT NULL OR (d.metadata->>'proxyCountry') IS NOT NULL )"

ROWS=$(docker exec -i fleet-postgres psql -U postgres -d fleet -t -A -F'|' -c "$SQL")
RC=$?
if [ "$RC" -ne 0 ]; then
  # DB erişilemedi/sorgu patladı — SESSİZCE 0 cihazla "başarı" raporlama (eski bug).
  log "HATA: DB sorgusu başarısız (rc=$RC) — restore atlandı, cihazlar reboot proxy'siz kalmış olabilir!"
  exit 1
fi
ROWS=$(echo "$ROWS" | grep -v '^$')
if [ -z "$ROWS" ]; then log "aktif-WA cihazı yok — restore atlanıyor"; exit 0; fi

# Aynı instance için birden fazla satır dönebilir (çok hesap) → dedup (ilk satır kazanır),
# aksi halde aynı subnet'e üst üste REDIRECT kurulur ve son yazan kazanır (yarış).
declare -A DONE
OK=0; FAIL=0; SKIP=0
while IFS='|' read -r inst meta_cc phone; do
  [ -z "$inst" ] && continue
  [ -n "${DONE[$inst]:-}" ] && continue
  DONE[$inst]=1
  # 1) metadata.proxyCountry (register-time doğru ISO) — 2) numaradan türet.
  cc="$(echo "$meta_cc" | tr '[:lower:]' '[:upper:]')"
  if ! echo "$cc" | grep -qE '^[A-Z]{2}$'; then cc="$(cc_from_phone "$phone")"; fi
  if [ -z "$cc" ]; then
    log "⤼ $inst: ülke belirlenemedi (meta='$meta_cc' phone-prefix bilinmiyor) — ATLANDI (yanlış ülke riskine girmez)"
    SKIP=$((SKIP+1)); continue
  fi
  if is_mobile_cc "$cc"; then U="$U_MOB"; P="$P_MOB"; PORT="$PORT_MOB"; else U="$U_RES"; P="$P_RES"; PORT="$PORT_RES"; fi
  r=$(bash "$WP" "$inst" "$cc" "$U" "$P" "$H" "$PORT" 2>&1 | grep -oE 'PROXY_RESULT.*redsocks=[0-9]+|PROXY_FAIL.*' | head -1)
  if echo "$r" | grep -q PROXY_RESULT; then
    log "✓ $inst ($cc): $r"; OK=$((OK+1))
  else
    log "✗ $inst ($cc): ${r:-no-result}"; FAIL=$((FAIL+1))
  fi
done <<< "$ROWS"

log "TAMAM: $OK proxy geri-uygulandı, $FAIL başarısız, $SKIP atlandı (ülke belirsiz)"
# Başarısız varsa non-zero dön ki systemd 'failed' işaretlesin (sessiz kısmi başarı olmasın).
[ "$FAIL" -eq 0 ]
