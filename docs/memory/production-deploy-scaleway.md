---
name: production-deploy-scaleway
description: "★LIVE★ Site Scaleway'de production'da: API+Dashboard+PG+Redis+Caddy+agent hepsi systemd, WSL verisi taşındı, 4 güvenlik katmanı, canlı ekran çalışıyor. Erişim http://51.158.107.121, kritik deploy detayları + tuzaklar"
metadata:
  node_type: memory
  type: project
  originSessionId: b56ece3b
---

**2026-07-04: VPS Fleet sitesi WSL'den Scaleway'e (51.158.107.121) taşındı, LIVE.** Kod `/opt/fleet` (rsync, node_modules hariç). İlişkili: [[wsl-redroid-netstack-route-fix]] [[waydroid-uinput-real-touch-SOLVED]] [[whatsapp-stable-api-inbound]] [[feature-honesty-audit]].

## Erişim
- **Dashboard: http://51.158.107.121** (Caddy :80 reverse proxy, HTTP; domain gelince Caddyfile'da :80→domain + otomatik HTTPS).
- **Admin: admin@fleet.local / mQlglvNVJjnSsVSjIg6ay5kr** (fresh secret). DB pw: `3058d6eac9eb9d518cfa0b5a683cd7e0`. DEFAULT_API_KEY: `07995643a97f6fc808f96ccb29c0af6800fb0bfa145b0118` (DB'de `default-admin-key`).
- SSH: `ssh -i ~/.ssh/scaleway_fleet root@51.158.107.121` (WSL'de key `/home/kali/.ssh/scaleway_fleet` chmod 600 — Windows `/mnt/c/Users/furka/.ssh/` 777 olduğu için SSH reddeder, kopyala).

## Mimari (hepsi systemd, active)
- `fleet-api.service` (:4000 internal, `npm start` → dist/index.js), `fleet-dashboard.service` (:3000, next start), `fleet-agent.service` (localhost:4000'e polling — **tunnel/cloudflared'e GEREK YOK**, agent+API aynı makinede), `caddy` (:80 public).
- PG+Redis: docker (`fleet-postgres`/`fleet-redis`, 127.0.0.1-only bind, restart unless-stopped, volume fleet-pgdata).
- Waydroid + WhatsApp cihazı aynı host'ta yaşıyor (15GB RAM ikisine yetiyor, ~1.6GB kullanım).

## ★KRİTİK DEPLOY TUZAKLARI (tekrar deploy'da lazım)★
1. **Monorepo — npm ci KÖKTEN yapılmalı.** `workspaces: apps/*,packages/*`. `apps/api`'de `npm ci` express'i kurmaz (hoisted) → runtime `Cannot find module 'express'`. Çözüm: `cd /opt/fleet && npm ci` (kök), sonra `apps/api`'de `npx prisma generate`.
2. **NEXT_PUBLIC_WS_URL = `ws://51.158.107.121/ws/devices`** (path DAHİL, WSL çalışan deseni). stream-token route'u `wsBase = WS_URL.replace(/\/ws\/devices$/,'')` yapıp `/ws/stream` ekliyor; fleet-events (live.tsx) URL'yi direkt kullanıp `/ws/devices`'a bağlanıyor. Yanlış değer (`/ws` veya boş) → `/ws/ws/stream` çift-path → Caddy 502. Domain'de `wss://domain/ws/devices` (TLS için wss). **Build-time gömülü → değişince `npm run build` şart.**
3. **WS auth ↔ client uyumu:** device.hub `/ws/devices` upgrade'i JWT token ZORUNLU kılıyor (bu oturumda güvenlik için eklendi, cross-tenant event sızıntısını önler). Dashboard client token GÖNDERMELİ: yeni `/api/ws-token` route (getAccessToken mint) + `live.tsx` connect() async token alıp `?token=` ekliyor. stream zaten `/api/devices/:id/stream-token` kullanıyor. Bunlar olmadan tüm WS 502.
4. **Caddy WS:** basit `reverse_proxy` WS'i geçiriyor (`@ws path /ws/*` → localhost:4000). 101 upgrade + agent frame push doğrulandı.

## Veri taşıma
WSL PG (`vps_emulator`) → `pg_dump --data-only --no-owner --disable-triggers` (6284 satır). Scaleway'de `prisma migrate deploy` (47 tablo) sonra TRUNCATE+restore. **SOCIAL_CRYPTO_KEY AYNI tutuldu** (at-rest şifreli fingerprint/mesajlar okunabilsin — rotate edilmedi). Taşındı: 2 cihaz, 1 user, 2 workspace, 14 WA mesajı.

## Cihaz ONLINE + canlı ekran
- Agent reboot sonrası ADB'ye bağlanmıyordu → cihaz OFFLINE. Fix: `fleet-agent.service.d/override.conf`'a `ExecStartPre=-/usr/bin/adb connect 192.168.240.112:5555` + `Environment=FLEET_API_KEY=<prod>` + `FLEET_API_URL=http://localhost:4000`. Waydroid A13 GApps → ONLINE.
- ("Scaleway ARM Phone 01" 127.0.0.1:5555 = kullanılmayan hayalet kayıt, OFFLINE kalabilir.)

## UYARILAR
- **Brute-force kilit (Katman 4):** çok başarısız login → 30dk kilit (in-memory). Test login'leri RATE_LIMITED yapar; temizlemek için `systemctl restart fleet-api`. service-auth (dashboard) muaf.
- **Kernel:** host 5.15.0-173 (binder modülü SADECE burada). GRUB_DEFAULT=saved + saved_entry=173 pinlendi. 185'e boot → binder yok → Waydroid ölür ([[wsl-redroid-netstack-route-fix]] benzeri kriz). Reboot sonrası Waydroid session ELLE: `env XDG_RUNTIME_DIR=/tmp/xdg WAYLAND_DISPLAY=wayland-1 waydroid session start` (weston + session için systemd unit YOK — eklenebilir).
- **SSH-inline tuzağı:** `ssh root@host "echo (...)"` içinde parantez remote shell'i bozar; çok-katmanlı SQL/curl/heredoc kırılgan → script dosyası yazıp scp+bash ile çalıştır.

## KALAN
#2 tek-tık cihaz kurulum akışı, #4 gerçek cihaz testleri (RPA/fingerprint/snapshot). Çoklu-Waydroid bu host'ta uygun değil (tek-instance mimari); ölçek büyük makine/vendor.
