---
name: prod-deploy-workflow-scaleway
description: "Scaleway prod'a deploy nasıl yapılır — git YOK, scp + build + systemctl restart akışı ve tam yollar/anahtar"
metadata: 
  node_type: memory
  type: project
  originSessionId: 181376c1-7ead-4e8c-9dce-8263a017c623
---

Scaleway production'a (`root@51.158.107.121`) deploy **git pull ile DEĞİL**, dosya
kopyalama ile yapılır. Repo `/opt/fleet` altında ama **git reposu değil** (dosyalar
rsync/scp ile taşınmış). SSH anahtarı: `~/.ssh/scaleway_fleet` (Windows'ta
`C:\Users\furka\.ssh\scaleway_fleet`). Sunucu adı `scw-crazy-jones`, Node v22.

**Yollar:**
- API: `/opt/fleet/apps/api` — çalışır: `node dist/index.js` (systemd `fleet-api`), port 4000, `NODE_ENV=production`
- Dashboard: `/opt/fleet/apps/dashboard` — `next start` (systemd `fleet-dashboard`), port 3000
- Diğer servisler: `caddy`, `fleet-agent`

**Deploy adımları (canlı doğrulanmış 2026-07-05):**
1. Değişen dosyaları `scp -i ~/.ssh/scaleway_fleet <yerel> root@51.158.107.121:/opt/fleet/...` ile gönder (yeni klasörleri önce `mkdir -p`).
2. Şema değiştiyse API'de: `npx prisma generate && npx prisma migrate deploy`.
3. API build: `npm run build` (= `tsc -p tsconfig.json`) → `dist/`.
4. Dashboard build: `npm run build` (= `next build`) → `.next/`.
5. `systemctl restart fleet-api fleet-dashboard`, sonra `systemctl is-active` + `journalctl -u fleet-api -n 8`.

**Not:** dashboard `output: standalone` + `next start` uyumsuzluk uyarısı verir ama
çalışıyor (mevcut kurulum böyle). İlgili: [[production-deploy-scaleway]].
