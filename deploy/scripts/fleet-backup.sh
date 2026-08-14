#!/bin/bash
# fleet-backup.sh — A'dan Z'ye tam sistem yedegi
# Kullanim: sudo bash fleet-backup.sh [hedef-dizin]
# Varsayilan hedef: /opt/backups
set -uo pipefail

DEST="${1:-/opt/backups}"
TS="$(date +%Y%m%d-%H%M%S)"
DIR="$DEST/fleet-$TS"
LOG="$DIR/BACKUP.log"

mkdir -p "$DIR"/{db,code,config,systemd,scripts,state,docs}
exec > >(tee -a "$LOG") 2>&1

say() { echo "[$(date +%H:%M:%S)] $*"; }
ok()  { echo "  ✓ $*"; }
err() { echo "  ✗ $*"; }

say "=== FLEET TAM YEDEK — $TS ==="
say "Hedef: $DIR"

# ── 1. VERITABANI ────────────────────────────────────────────────
say "1/9 PostgreSQL dump..."
if docker exec fleet-postgres pg_dump -U postgres -d fleet -Fc > "$DIR/db/fleet.dump" 2>"$DIR/db/pg_dump.err"; then
  ok "fleet.dump $(du -h "$DIR/db/fleet.dump" | cut -f1)"
else
  err "pg_dump BASARISIZ — $DIR/db/pg_dump.err"
fi
# duz SQL de al (baska surumde de acilsin)
docker exec fleet-postgres pg_dump -U postgres -d fleet --no-owner \
  | gzip > "$DIR/db/fleet.sql.gz" 2>/dev/null && ok "fleet.sql.gz $(du -h "$DIR/db/fleet.sql.gz" | cut -f1)"
# global roller
docker exec fleet-postgres pg_dumpall -U postgres --globals-only > "$DIR/db/globals.sql" 2>/dev/null && ok "globals.sql"
# satir sayilari (dogrulama referansi)
docker exec fleet-postgres psql -U postgres -d fleet -tAc \
  "SELECT relname||'='||n_live_tup FROM pg_stat_user_tables ORDER BY relname;" \
  > "$DIR/db/row-counts.txt" 2>/dev/null && ok "row-counts.txt ($(wc -l < "$DIR/db/row-counts.txt") tablo)"

# ── 2. REDIS ─────────────────────────────────────────────────────
say "2/9 Redis snapshot..."
docker exec fleet-redis redis-cli SAVE >/dev/null 2>&1
docker cp fleet-redis:/data/dump.rdb "$DIR/db/redis-dump.rdb" 2>/dev/null && ok "redis-dump.rdb" || err "redis atlandi"

# ── 3. KOD ───────────────────────────────────────────────────────
say "3/9 Uygulama kodu (node_modules/.next/build haric)..."
tar czf "$DIR/code/fleet-src.tar.gz" \
  --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git \
  --exclude='*.tsbuildinfo' --exclude=.turbo \
  -C /opt fleet 2>/dev/null && ok "fleet-src.tar.gz $(du -h "$DIR/code/fleet-src.tar.gz" | cut -f1)"

cp /opt/agent.mjs "$DIR/code/agent.mjs" 2>/dev/null && ok "agent.mjs (CALISAN — systemd bunu kullanir)"
tar czf "$DIR/code/fleet-agent.tar.gz" --exclude=node_modules -C /opt fleet-agent 2>/dev/null \
  && ok "fleet-agent.tar.gz $(du -h "$DIR/code/fleet-agent.tar.gz" | cut -f1)"

# calisan agent ile repodaki fark (deploy tuzagi kaniti)
if [ -f /opt/fleet-agent/agent.mjs ]; then
  if diff -q /opt/agent.mjs /opt/fleet-agent/agent.mjs >/dev/null 2>&1; then
    ok "agent.mjs: /opt ve /opt/fleet-agent AYNI"
  else
    echo "UYARI: /opt/agent.mjs != /opt/fleet-agent/agent.mjs" | tee "$DIR/code/AGENT-FARKI-VAR.txt"
    diff /opt/agent.mjs /opt/fleet-agent/agent.mjs >> "$DIR/code/AGENT-FARKI-VAR.txt" 2>&1
  fi
fi

# ── 4. SIRLAR / ENV ──────────────────────────────────────────────
say "4/9 .env ve sirlar (0600)..."
mkdir -p "$DIR/config/env"
for f in /opt/fleet/apps/api/.env /opt/fleet/apps/dashboard/.env \
         /opt/fleet/apps/dashboard/.env.local /opt/fleet/.env \
         /etc/fleet-proxy.env /etc/default/fleet-agent; do
  [ -f "$f" ] && cp "$f" "$DIR/config/env/$(echo "$f" | tr '/' '_')" && ok "$f"
done
chmod -R 600 "$DIR/config/env" 2>/dev/null

# ── 5. SYSTEMD ───────────────────────────────────────────────────
say "5/9 systemd unitleri + drop-in'ler..."
# ★2026-08-15: kurtarma katmani birimleri eklendi. Yoksa sunucu bastan
# kurulunca kurtarma sisteminin KENDISI geri gelmez.
for u in fleet-agent fleet-api fleet-dashboard wd-canary wd-health-watch wd-proxy-restore \
         wd-kurtar wd-watchdog wd-izle wd-durum wd-fren wd-adb-tara sshd-acil; do
  cp -r /etc/systemd/system/$u.service* "$DIR/systemd/" 2>/dev/null
  cp -r /etc/systemd/system/$u.timer* "$DIR/systemd/" 2>/dev/null
done
cp /etc/systemd/system/waydroid@.service "$DIR/systemd/" 2>/dev/null
# ★2026-08-15: ACIL SSH KAPISI (port 2222, UsePAM no). Normal SSH'in olduğu
# kilitlerde tek giris yolu buydu; yapilandirmasi yedekte OLMALI.
mkdir -p "$DIR/ssh"
cp /etc/ssh/sshd_acil_config "$DIR/ssh/" 2>/dev/null
cp /etc/ssh/sshd_config "$DIR/ssh/" 2>/dev/null
cp /etc/systemd/system/waydroid-mi5.service "$DIR/systemd/" 2>/dev/null
ls "$DIR/systemd" | wc -l | xargs -I{} ok "{} unit dosyasi"
systemctl list-units --type=service --state=running --no-legend --plain > "$DIR/systemd/RUNNING-services.txt" 2>/dev/null
systemctl list-unit-files --state=enabled --no-legend --plain > "$DIR/systemd/ENABLED-units.txt" 2>/dev/null

# ── 6. BETIKLER (waydroid/proxy toolchain) ───────────────────────
say "6/9 Waydroid/proxy betikleri (.bak haric)..."
if [ -d /opt/fleet-agent/waydroid ]; then
  tar czf "$DIR/scripts/waydroid-scripts.tar.gz" \
    --exclude='*.bak*' --exclude='*.md5-bak' \
    -C /opt/fleet-agent waydroid 2>/dev/null && ok "waydroid-scripts.tar.gz"
fi
cp /opt/agent-rollback.sh "$DIR/scripts/" 2>/dev/null

# ── 7. AG / SISTEM YAPILANDIRMA ──────────────────────────────────
say "7/9 Ag ve sistem yapilandirmasi..."
cp -r /etc/caddy "$DIR/config/caddy" 2>/dev/null && ok "Caddyfile"
cp /var/lib/waydroid-subnets.map "$DIR/config/waydroid-subnets.map" 2>/dev/null && ok "subnets.map"
cp -r /etc/redsocks* "$DIR/config/" 2>/dev/null
iptables-save            > "$DIR/config/iptables.rules" 2>/dev/null && ok "iptables.rules"
ip6tables-save           > "$DIR/config/ip6tables.rules" 2>/dev/null
ufw status verbose       > "$DIR/config/ufw-status.txt" 2>/dev/null && ok "ufw-status.txt"
ip addr                  > "$DIR/config/ip-addr.txt" 2>/dev/null
ip route show table all  > "$DIR/config/ip-route-all.txt" 2>/dev/null
cp /etc/hosts /etc/resolv.conf "$DIR/config/" 2>/dev/null
crontab -l               > "$DIR/config/crontab-ubuntu.txt" 2>/dev/null
sudo crontab -l          > "$DIR/config/crontab-root.txt" 2>/dev/null
cp -r /etc/cron.d "$DIR/config/cron.d" 2>/dev/null

# ── 8. CANLI DURUM (kurtarma referansi) ───────────────────────────
say "8/9 Canli filo durumu (kurtarma referansi)..."
adb devices -l           > "$DIR/state/adb-devices.txt" 2>/dev/null && ok "adb-devices.txt"
ls -d /var/lib/waydroid.* > "$DIR/state/waydroid-instances.txt" 2>/dev/null
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' > "$DIR/state/docker-ps.txt" 2>/dev/null
docker inspect fleet-postgres fleet-redis > "$DIR/state/docker-inspect.json" 2>/dev/null && ok "docker-inspect.json"
df -h                    > "$DIR/state/disk.txt" 2>/dev/null
free -g                  > "$DIR/state/ram.txt" 2>/dev/null
uname -a                 > "$DIR/state/uname.txt" 2>/dev/null
node --version           > "$DIR/state/versions.txt" 2>/dev/null
{ echo "npm: $(npm --version 2>/dev/null)"; echo "docker: $(docker --version 2>/dev/null)";
  echo "psql: $(docker exec fleet-postgres psql --version 2>/dev/null)"; } >> "$DIR/state/versions.txt" 2>/dev/null
dpkg -l                  > "$DIR/state/dpkg-list.txt" 2>/dev/null
# cihaz -> IP -> hesap eslesmesi (en kritik kurtarma tablosu)
docker exec fleet-postgres psql -U postgres -d fleet -tAc \
  "SELECT d.name||'|'||coalesce(d.\"ipAddress\",'-')||'|'||d.status||'|'||coalesce(g.\"phoneNumber\",'-')||'|'||coalesce(g.status::text,'-') FROM \"Device\" d LEFT JOIN \"GeneratedAccount\" g ON g.\"deviceId\"=d.id ORDER BY d.name;" \
  > "$DIR/state/cihaz-hesap-haritasi.txt" 2>/dev/null && ok "cihaz-hesap-haritasi.txt ($(wc -l < "$DIR/state/cihaz-hesap-haritasi.txt") satir)"

# ── 9. MANIFEST + DOGRULAMA ──────────────────────────────────────
say "9/9 Manifest ve saglama toplamlari..."
cp /opt/fleet/CLAUDE.md "$DIR/docs/" 2>/dev/null
cp -r /opt/fleet/docs "$DIR/docs/repo-docs" 2>/dev/null
# BACKUP.log HARIC — bu dosya checksum hesaplanirken hala yaziliyor,
# kendi ozetiyle asla uyusmaz (yanlis "FAILED" verir).
(cd "$DIR" && find . -type f ! -name SHA256SUMS ! -name BACKUP.log \
   -exec sha256sum {} \; > SHA256SUMS 2>/dev/null)

cat > "$DIR/GERI-YUKLEME.md" <<'EOF'
# Geri Yükleme Reçetesi

## Sıra ÖNEMLİ — bu sırayla yap

### 1. Altyapı (Docker)
```bash
docker run -d --name fleet-postgres --restart unless-stopped \
  -e POSTGRES_PASSWORD=<config/env/..._api_.env içindeki DATABASE_URL'den> \
  -p 127.0.0.1:5432:5432 -v fleet-pgdata:/var/lib/postgresql/data postgres:16-alpine
docker run -d --name fleet-redis --restart unless-stopped \
  -p 127.0.0.1:6379:6379 redis:7-alpine
```
Tam parametreler için `state/docker-inspect.json`'a bak.

### 2. Veritabanı
```bash
docker exec -i fleet-postgres psql -U postgres -c "CREATE DATABASE fleet;"
docker exec -i fleet-postgres pg_restore -U postgres -d fleet --no-owner < db/fleet.dump
# veya: gunzip -c db/fleet.sql.gz | docker exec -i fleet-postgres psql -U postgres -d fleet
```
Doğrula: satır sayıları `db/row-counts.txt` ile uyuşmalı.

### 3. Redis (opsiyonel — BullMQ kuyruğu, kritik değil)
```bash
docker cp db/redis-dump.rdb fleet-redis:/data/dump.rdb && docker restart fleet-redis
```

### 4. Kod
```bash
tar xzf code/fleet-src.tar.gz -C /opt
cd /opt/fleet && npm install
cd apps/api && npx prisma generate && npm run build
cd ../dashboard && npm run build
```

### 5. Sırlar
`config/env/` altındakileri orijinal yollarına geri koy (dosya adındaki `_` → `/`).
⚠️ `_etc_fleet-proxy.env` API'ye systemd `EnvironmentFile` ile gelir — bunu
OLDUĞU GİBİ verme, host `FLEET_API_KEY` API .env'ini EZER.

### 6. Agent (DEPLOY TUZAĞI)
```bash
cp code/agent.mjs /opt/agent.mjs     # systemd BUNU çalıştırır, fleet-agent/agent.mjs DEĞİL
tar xzf code/fleet-agent.tar.gz -C /opt
tar xzf scripts/waydroid-scripts.tar.gz -C /opt/fleet-agent
chmod +x /opt/fleet-agent/waydroid/*.sh
```

### 7. systemd
```bash
cp -r systemd/*.service systemd/*.timer systemd/*.service.d /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fleet-api fleet-dashboard fleet-agent
systemctl enable --now wd-canary.timer wd-health-watch.timer
```
⚠️ Servis adı `fleet-dashboard` — `fleet-web` DEĞİL.

### 8. Ağ
```bash
iptables-restore < config/iptables.rules
cp config/waydroid-subnets.map /var/lib/waydroid-subnets.map
cp -r config/caddy/Caddyfile /etc/caddy/ && systemctl reload caddy
```
⚠️ ufw: DHCP ilk isteği 0.0.0.0'dan BROADCAST gelir — `allow from 192.168.0.0/16`
KAPSAMAZ. `config/ufw-status.txt`'deki kuralları birebir uygula.

### 9. Cihazlar (Waydroid instance'ları)
Instance'lar YEDEKTE DEĞİL (her biri ~1.5GB, 48 adet). Yeniden kurulum:
```bash
/opt/fleet-agent/waydroid/wd-provision.sh <instance>
```
`state/cihaz-hesap-haritasi.txt` hangi cihazda hangi numara olduğunu gösterir.
`state/waydroid-instances.txt` instance adlarını listeler.

### 10. Doğrulama
```bash
systemctl is-active fleet-agent fleet-api fleet-dashboard   # 3× active
adb devices | grep -c ":5555.*device$"                      # state/adb-devices.txt ile karşılaştır
sha256sum -c SHA256SUMS                                      # yedek bütünlüğü
```
EOF

cat > "$DIR/MANIFEST.txt" <<EOF
FLEET TAM SISTEM YEDEGI
Zaman  : $TS
Sunucu : $(hostname) / $(hostname -I | awk '{print $1}')
Uptime : $(uptime -p)
Boyut  : $(du -sh "$DIR" | cut -f1)

ICERIK
  db/       PostgreSQL (custom + plain SQL + globals + row-counts), Redis RDB
  code/     fleet kaynak, agent.mjs (CALISAN kopya), fleet-agent
  config/   .env sirlari (0600), Caddy, iptables, ufw, subnets.map, cron, DNS
  systemd/  tum unit + drop-in + calisan/etkin servis listesi
  scripts/  waydroid provision/proxy/destroy/canary toolchain
  state/    adb, docker, disk, ram, surumler, CIHAZ-HESAP HARITASI
  docs/     CLAUDE.md + repo dokumanlari

YEDEKTE OLMAYAN (kasitli)
  - node_modules / .next / dist  → npm install + build ile uretilir
  - /var/lib/waydroid.miNN       → 48 × ~1.5GB; wd-provision.sh ile yeniden kurulur
  - .git                         → kod GitHub'da (feat/cloud-phone-suite)

GERI YUKLEME: GERI-YUKLEME.md
BUTUNLUK   : sha256sum -c SHA256SUMS
EOF

say "=== BITTI ==="
say "Konum: $DIR"
say "Boyut: $(du -sh "$DIR" | cut -f1)"
echo
cat "$DIR/MANIFEST.txt"
