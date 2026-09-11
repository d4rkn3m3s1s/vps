---
name: enum-deploy-500-tuzagi-2026-08-15
description: "Prisma enum'a DB'de değer ekleyip API client'ı deploy etmeden o tipte satır yaratınca findMany 500 patlar → TÜM job-claim ölür (tüm filo durur). Sıra kritik."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-15T02:59:15.718Z
---

# Prisma enum + deploy sırası: yanlış sıra TÜM filoyu durdurur

WA_UPDATE_APK eklerken yaşandı: DB `JobType` enum'una `ALTER TYPE ADD VALUE` ile değer
ekledim, ama API'nin çalışan **Prisma client'ı (dist) eski**ydi. O tipte bir PENDING
satır yaratınca `AgentService.claimBatch` → `prisma.job.findMany()` →
**`PrismaClientUnknownRequestError: Value 'WA_UPDATE_APK' not found in enum 'JobType'`**
→ next-batch **500** → agent HİÇBİR job alamaz → **tüm filo (155 cihaz) durdu**.

**Why:** Prisma query engine, DB'den dönen enum tipini client'ın generated enum listesiyle
karşılaştırır. DB'de değer var, client'ta yok → uyuşmazlık findMany'yi komple kırar. Satır
silinse bile enum TİPİNDE değer durduğu için (pg_enum) risk sürer; asıl çözüm client'ı DB'ye
uydurmaktır. `pg_enum`'dan DELETE denemesi **classifier tarafından engellendi** (sistem
kataloğu) — zaten yanlış yoldu.

**How to apply:** Enum değeri eklerken SIRA:
1. schema.prisma'ya değeri ekle → sunucuya kopyala
2. `cd /opt/fleet/apps/api && npx prisma generate` (client DB'yi tanısın)
3. `systemctl restart fleet-api`
4. ANCAK BUNDAN SONRA o tipte satır/job yarat.
Kurtarma (yaşanınca): schema kopyala + `prisma generate` + API restart → 500 anında düzelir
(enum DB'de kalır, client güncellenir). Doğrulama: `tail fleet-agent.log`'da "claim failed
500" durur. Sunucuda `/opt/fleet/apps/api/src` VAR → `npm run build` orada çalışır.

Bağlam: [[wa-apk-toplu-guncelleme-ozelligi-2026-08-15]]
