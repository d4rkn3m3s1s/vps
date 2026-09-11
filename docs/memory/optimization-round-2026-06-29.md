---
name: optimization-round-2026-06-29
description: "2026-06-29 optimizasyon turu: cross-tenant IDOR'lar (bulk + webhooks) kapatıldı, jobs unbounded query take ile sınırlandı, Job hot-path indexleri eklendi. Explore ajanı 25 fırsat buldu."
metadata:
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Audit kod-fixable maddeleri bitince OPTIMIZASYON + YENİLİK turuna geçildi. Explore ajanı 25 fırsat raporladı
(perf/robustness/UX/quick-win). En kritik küme: cross-tenant IDOR'lar ([[hosts-heartbeat-security-fix]] ile aynı sınıf).

YAPILAN (hepsi tsc temiz, canlı doğrulandı):
1. **Bulk cross-tenant IDOR → KAPATILDI** (bulk.service.ts): assertDevices artık workspaceId ile filtreliyor →
   başka tenant'ın cihazına bulk start/stop/install/proxy YAPILAMAZ (yabancı id = 404). setProxy proxy lookup'ı da
   workspace-scoped (findFirst {id, workspaceId}). Controller zaten getWorkspaceId geçiyordu. CANLI: yabancı id→404.
2. **Webhooks update/delete IDOR → KAPATILDI** (webhooks.service.ts): assertExists(id, workspaceId) → findFirst
   workspace filtreli; update+remove imzasına workspaceId eklendi; controller getWorkspaceId geçiyor.
3. **Jobs unbounded query → DÜZELTİLDİ**: listJobs(workspaceId, limit=100, cap 500) artık Prisma `take` kullanıyor
   (eskiden TÜM job'ları çekip JS'te .slice ediyordu). getJobsHandler limit'i DB'ye geçiriyor. CANLI: limit=5→5 döndü.
4. **Job hot-path indexleri → EKLENDİ** (schema + migration 20260629120000_job_hot_path_indexes):
   @@index([status, claimedByHostId, createdAt]) — agent claimNext her ~2s PENDING tarıyor (full-scan→seek);
   @@index([workspaceId, createdAt]) — liste sorgusu. Migration prisma db execute ile uygulandı (IF NOT EXISTS).
   prisma generate API'yi durdurup yapıldı (çalışan process DLL'i kilitler → EPERM).

KALAN Explore FIRSATLARI (sıradaki turlar, ranked): farm.listCampaigns N+1 device count (groupBy'a çevir),
farm.updateCredentials workspace-scope eksik, calendar update/delete workspace optional (zorunlu yap),
caption max-length yok, bulk delete/stop yok (quick win), devices list search/filter yok, fingerprint regenerate
endpoint eksik, jobs page useFleetEvents zaten var (audit yanılmış). 

NOT: Windows-API kuralı [[session-state-live-issues]]: schema değişince API durdur→prisma generate→restart→agent restart.
ADB_BIN tam yol olmalı (konsol). Wall artık DOLU (kullanıcı require2fa/2FA'yı kendi çözdü, o madde kapandı).
