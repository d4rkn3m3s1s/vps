---
name: sunucu-yedekleme-recetesi-2026-08-04
description: "🟢★★TAM SİSTEM YEDEĞİ kuruldu: /opt/fleet-backup.sh (9 aşama, ~45sn, 862MB). DB+Redis+kod+sırlar+systemd+iptables+betikler+canlı durum+GERİ-YÜKLEME.md. ⚠️postgres DOCKER'da (host'ta psql/pg_restore YOK→docker exec şart). ⚠️SHA256SUMS'tan BACKUP.log HARİÇ olmalı. Waydroid instance'ları KASITLI dışarıda (48×1.5GB)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T00:31:40.693Z
---

# Sunucu tam yedekleme reçetesi (4 Ağustos 2026'da kuruldu)

## Betik
`/opt/fleet-backup.sh` — sunucuda **kalıcı kurulu**. Kaynak kopyası bu repoda değil,
sadece sunucuda. Kullanım:
```bash
sudo bash /opt/fleet-backup.sh            # -> /opt/backups/fleet-<TS>/
sudo bash /opt/fleet-backup.sh /hedef     # farklı hedef
```
İlk çalıştırma: **862 MB, ~45 saniye**, 128 dosya.

## Kapsam (9 aşama)
| dizin | içerik |
|---|---|
| `db/` | `fleet.dump` (pg_dump -Fc, 136M) + `fleet.sql.gz` + `globals.sql` + `row-counts.txt` + `redis-dump.rdb` |
| `code/` | `fleet-src.tar.gz` (node_modules/.next/dist/.git hariç, 2M) + **`agent.mjs` (ÇALIŞAN kopya)** + `fleet-agent.tar.gz` |
| `config/` | `.env` sırları (0600), Caddy, **iptables.rules**, ufw, `waydroid-subnets.map`, cron, DNS, ip route |
| `systemd/` | tüm unit + drop-in + çalışan/etkin servis listesi |
| `scripts/` | waydroid provision/proxy/destroy/canary toolchain (`.bak*` hariç) |
| `state/` | adb, docker inspect, disk, ram, sürümler, **`cihaz-hesap-haritasi.txt`** |
| `docs/` | CLAUDE.md + repo dokümanları |
| kök | `MANIFEST.txt`, **`GERI-YUKLEME.md`** (10 adımlı sıralı reçete), `SHA256SUMS` |

## ⚠️ Yazarken düşülen tuzaklar
1. **PostgreSQL Docker'da** (`fleet-postgres`, postgres:16-alpine). Host'ta
   `psql`/`pg_restore` **YOK** ve `sudo -u postgres` = "unknown user".
   Her DB işlemi `sudo docker exec fleet-postgres ...` ile.
   → `pg_restore -l` host'ta "0 tablo" der; bu yedeğin bozuk olduğu anlamına GELMEZ.
2. **SHA256SUMS'tan `BACKUP.log` HARİÇ tutulmalı** — özet hesaplanırken log hâlâ
   yazılıyor, kendi özetiyle asla uyuşmaz → yanlış "FAILED".
3. **Kolon adı `Device.ipAddress`** (`adbAddress` DEĞİL).
4. psql `-tAc` içinde `\x27` kaçışı **çalışmaz** (syntax error) — dış tırnağı `"`
   yapıp SQL'de düz `'` kullan.

## Yedekte KASITLI olmayanlar
- `node_modules` / `.next` / `dist` → `npm install` + `npm run build`
- `/var/lib/waydroid.miNN` → **48 × ~1.5GB**; `wd-provision.sh` ile yeniden kurulur.
  Hangi cihazda hangi numara olduğu `state/cihaz-hesap-haritasi.txt`'de.
- `.git` → kod GitHub'da (`feat/cloud-phone-suite`)

## Doğrulama (yedek "alındı" demek yetmez)
```bash
cd /opt/backups/fleet-<TS>
sudo sha256sum -c SHA256SUMS | grep -vc ": OK$"      # 0 olmalı
sudo docker cp db/fleet.dump fleet-postgres:/tmp/v.dump
sudo docker exec fleet-postgres pg_restore -l /tmp/v.dump | grep -c "TABLE DATA"  # 46
```
4 Ağu ölçümü: 128/128 dosya OK · dump'ta 46 tablo verisi / 309 TOC girdisi ·
Device=49, AuditLog=3686.

## Yapılmadı (ileride)
- **Sunucu DIŞINA kopya yok** — yedek aynı diskte. Disk ölürse yedek de ölür.
- Otomatik zamanlama (systemd timer) kurulmadı, elle çalıştırılıyor.
- Rotasyon/temizlik yok (her çalıştırma yeni dizin + 859MB `.tar.gz`).

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[on-ucus-yarim-deploy-dist-bayat-2026-08-04]]
