---
name: dashboard-canli-liste-aboneliksiz-2026-07-28
description: "Dashboard cihaz listesi canlı güncellenmiyordu: yeni kurulan cihaz listeye anında düşmüyor, ancak sayfa yenilenince görünüyordu. KÖK: ProfilesView listeyi SADECE 20s'lik setInterval yoklamasıyla güncelliyordu; dosyadaki yorum 'Real-time changes arrive over the WebSocket (useFleetEvents ...)' diyordu ama kod HİÇ abone değildi — `useFleetEvents` o dosyada YALNIZCA YORUMDA geçiyordu. WS altyapısı sağlamdı (tokenlı upgrade=101). ⚠️YANLIŞ ALARM: tokensiz WS handshake 502/000 döner — bu TASARIM GEREĞİ (tenant izolasyonu, 'ws rejected: missing token'), arıza değil. FIX: device.created/updated/deleted + provision.progress aboneliği + 400ms debounce; 20s yoklama güvenlik ağı olarak kalır. ⚠️DEPLOY: sunucuda git YOK — dosya scp ile kopyalanır, sonra `npm run build` + servis restart ŞART (NEXT_PUBLIC_* derleme anında gömülür). commit 8071edc"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-28T00:14:04.928Z
---

# Dashboard cihaz listesi CANLI değildi (2026-07-28)

Operatör: *"anında kurulan cihaz düşmüyor, sayfayı yenileyince düşüyor kuruluyor diye"*.

## KÖK NEDEN
`apps/dashboard/src/app/profiles/ProfilesView.tsx` cihaz listesini **sadece 20 saniyelik
`setInterval` yoklamasıyla** güncelliyordu. Dosyadaki yorum
*"Real-time changes arrive over the WebSocket (useFleetEvents → device/job/alert events)"*
diyordu **ama kod hiç abone olmuyordu** — `useFleetEvents` o dosyada **yalnızca yorumda**
geçiyordu. Yani altyapı hazırdı, tek eksik abonelikti.

## ⚠️ YANLIŞ ALARM (buna takılma)
`/ws/devices`'e **tokensiz** WS handshake **502 (Caddy) / 000 (doğrudan)** döner ve API
`[devices] ws rejected: missing token` loglar. Bu **tasarım gereğidir** (JWT ile
workspace-scope, cross-tenant sızıntı engeli) — **arıza değil**.
Doğru test: `curl -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13'
-H 'Sec-WebSocket-Key: ...' "http://127.0.0.1/ws/devices?token=$JWT"` → **101** olmalı.
Tarayıcı token'ı `/api/ws-token` (POST, server-side `getAccessToken`) üzerinden alır;
tarayıcıda JWT tutulmaz.

## FIX (commit 8071edc)
`ProfilesView` artık `device.created` / `device.updated` / `device.deleted` /
`provision.progress` olaylarına abone; olay gelince `/api/devices`'i hemen çeker
(**400ms debounce** ile olay fırtınasına karşı). 20s yoklama **güvenlik ağı olarak kalır**
(WS koparsa liste yine güncellenir). `sameDeviceList` karşılaştırması korundu → içerik
değişmediyse yeniden render yok.

## ★ DEPLOY TUZAĞI
Sunucuda **git YOK** (`/opt/fleet` kopyalanarak dağıtılmış). Değişiklik için:
`scp <dosya> ubuntu@...:/tmp/` → `cp` yerine koy → `chown ubuntu:ubuntu` →
`cd /opt/fleet/apps/dashboard && sudo -u ubuntu npm run build` → `systemctl restart
fleet-dashboard`. `NEXT_PUBLIC_*` değişkenleri **derleme anında** paketlenir; env'i
sonradan değiştirmek yeniden build olmadan etkisizdir.

Bağlantılı: [[dashboard-redirect-localhost3000-fix-2026-07-24]] [[firewall-ipv6-regresyon-test-2026-07-24]]
