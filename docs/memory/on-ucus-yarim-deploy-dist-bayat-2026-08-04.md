---
name: on-ucus-yarim-deploy-dist-bayat-2026-08-04
description: "🔴★★★ON-UÇUŞ YARIM DEPLOY: agent.mjs(1 Ağu) uyarı ÜRETİYORDU, API kaynağı yazacak kodu İÇERİYORDU ama dist 30 Tem'den BAYATTI→uyarılar SESSİZCE ÇÖPE. 3 Ağu'da 11 kaydın 10'u FAILED, hiçbirinde ağ koşulu YOK. FIX: npm run build + restart. DERS: kaynakta grep BULMASI deploy edildiği ANLAMINA GELMEZ — dist'te ara."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T00:31:11.908Z
---

# Ön-uçuş özelliği YARIM deploy edilmişti (4 Ağustos 2026 tespit)

## Belirti
3 Ağustos'ta operatörün yaptığı 11 kayıt denemesinin **10'u FAILED** (8'i
"Zaman aşımı — kayıt/OTP akışı tamamlanmadı"), yalnızca 1 ACTIVE.
`GeneratedAccount.error` alanında **hiçbir ön-uçuş uyarısı YOKTU** —
`error ILIKE '%uyar%'` sorgusu **0** döndü.

Oysa 1 Ağustos'ta commit `7bb9a54` tam da bunu eklemişti: ön-uçuş uyarıları
(çıkış-ülke uyuşmazlığı, DNS, cihaz kararlılığı, çıkış IP çakışması)
`GeneratedAccount.error`'a iliştirilecekti.

## KÖK NEDEN — üç katmanın ikisi canlıydı
| katman | durum |
|---|---|
| `/opt/agent.mjs` (1 Ağu 02:24) | ✅ `preflightWarnings` **3 kez** — uyarıları ÜRETİYOR |
| `apps/api/src/.../batch.service.ts` | ✅ `preflightWarnings` **2 kez** — kaynak DOĞRU |
| `apps/api/dist/.../batch.service.js` | ❌ **0 kez** — dist 30 Tem 04:17'den BAYAT |

`fleet-api` servisi `node dist/index.js` çalıştırır. Agent uyarıları üretip
API'ye gönderiyordu, **API onları sessizce çöpe atıyordu**. Hiçbir hata logu
yok, hiçbir belirti yok — özellik "yapıldı" sanılıyordu.

## Fix
```bash
cd /opt/fleet/apps/api
sudo npx tsc --noEmit     # temiz (exit 0)
sudo npm run build        # dist yenilendi -> preflightWarnings 2 kez
sudo systemctl restart fleet-api
```
Doğrulandı: `/health` = 200, üç servis de `active`.

## ★★★ DERS (genelleştirilebilir)
**Kaynak dosyada `grep` bulması, kodun ÇALIŞTIĞI anlamına GELMEZ.**
Sunucuda git yok → dosyalar elle kopyalanıyor → `.ts` kopyalanıp `npm run build`
UNUTULABİLİR ve hiçbir hata vermez. Bir özelliğin canlı olduğunu doğrularken:

```bash
grep -c "<yeniSembol>" /opt/fleet/apps/api/dist/**/<dosya>.js   # KAYNAK değil, DIST
stat -c %y /opt/fleet/apps/api/dist/index.js                    # build tarihi
```

Build tarihi son kod değişikliğinden ESKİYSE → o özellik canlı DEĞİL.
Aynı tuzağın kardeşi: `/opt/agent.mjs` vs `/opt/fleet-agent/agent.mjs`
(systemd **birincisini** çalıştırır — bkz. [[eth0-heal-otomatik-kurtarma-2026-07-24]]).

## Bağlantılı
- Aynı "sessiz devre dışı" sınıfı: [[proxy-env-api-surecine-aktarilmiyordu-2026-07-30]]
  (orada da belirti yoktu, sonuç doğru göründüğü için fix'in çalıştığı sanılmıştı)
- [[RESUME-kaldigimiz-yer-2026-08-04]]
