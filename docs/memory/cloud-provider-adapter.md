---
name: cloud-provider-adapter
description: "Satış için: harici cloud-phone vendor'larını (GeeLark/VMOS/...) panele bağlayan provider-adapter katmanı eklendi. Kiralık ARM telefonları Device satırı olarak yönet. GeeLark+VMOS adapter iskeleti hazır, gerçek endpoint'ler TODO (anahtar+doküman gelince)."
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**Karar (2026-06-29):** Proje SATIŞA hazırlanıyor. Hedef 100-300 eşzamanlı cihaz,
"her şey çalışmalı" (WhatsApp dahil) → **native ARM şart** (x86 emülatör WA/IG'yi
yakıyor — memory'de de kayıtlı). Kullanıcı fiziki sunucu ALMIYOR → bulut hizmeti
kiralayıp panele entegre edecek. En uygun yol: **cloud-phone vendor API'sini kirala,
kendi panelimizi (VPS Fleet) white-label sat.** Vendor'a kilitlenmemek için
**provider-adapter katmanı** eklendi.

**Mimari karşılaştırma (araştırma sonucu):**
- Cloud-phone API kirala (GeeLark ~$29.9/cihaz/ay liste, VMOS, DuoPlus, UGPhone) →
  native ARM, API+white-label, donanım yok, AMA root KISITLI + kira marjı. **Önerilen başlangıç.**
- Kendi ARM (Ampere Altra + Canonical Anbox Cloud) → 100-128 ARM instance/sunucu, TAM
  root, en düşük cihaz-başı maliyet, AMA sunucu yönetimi + ön yatırım. (Hetzner AX162 EPYC
  ~€199/ay x86 redroid = en ucuz ama WA/IG yanar — sadece oyun/test.)
- Hibrit önerildi: GeeLark ile başla → talep gelince kendi ARM'a geç (panel değişmez).

**EKLENEN KOD (hepsi tsc-clean, uçtan uca test edildi: ekle→check→sil dashboard'tan çalışıyor):**
- Prisma: `CloudPhoneProvider` modeli + `CloudProviderKind` enum (SELF/GEELARK/VMOS/DUOPLUS/UGPHONE)
  + Device'a `cloudProvider`/`cloudProviderId`/`externalId` alanları. Migration
  20260629000000_cloud_phone_providers (uygulandı). Secret'lar AES-GCM encrypted (apiKeyEnc/apiSecretEnc).
- `apps/api/src/modules/cloud-providers/`: adapters/types.ts (CloudProviderAdapter interface),
  geelark.adapter.ts, vmos.adapter.ts, registry.ts (kind→adapter), service+controller+routes.
  Mounted at `/cloud-providers`. Ops: provider CRUD, /check (connectivity), /:id/sync (vendor
  telefonlarını Device satırı olarak içe aktar), /:id/phones (yeni telefon), /devices/:id/{action,shell,proxy,screenshot}.
- Dashboard: app/cloud-providers/{page,CloudProvidersView}.tsx + api proxy routes +
  Sidebar 'nav.cloudProviders' (Cloud ikon, Sunucular grubu) + i18n TR/EN.

**ADAPTER'LAR ARTIK GERÇEK API'YE BAĞLI (2026-06-29, ultracode workflow ile yazıldı+adversarial doğrulandı):**
Kullanıcı resmi dokümanları verdi (geelark.com/glossary/api → open.geelark.com + github.com/GeeLark/geelark-openapi;
cloud.vmoscloud.com/vmoscloud/doc). Gerçek endpoint+auth implement edildi, ikisi de tsc-clean:
- **GeeLark** (https://openapi.geelark.com/open/v1): auth KEY modu sign=SHA256(appId+traceId+ts+nonce+apiKey)
  UPPERCASE hex (nonce=traceId ilk 6, ts=ms) — doküman örneğiyle nonce birebir doğrulandı; Bearer fallback.
  Envelope code===0 başarı. Endpoints: /phone/list(data.items[],status 0/1/2), /start /stop /delete /status
  /addNew /app/install /shell/execute(data.output) /network(proxy). restart yok→stop+start. screenshot ASENKRON
  (taskId)→NotSupported dürüstçe. CRED EŞLEME: creds.apiKey=GeeLark API Key, creds.apiSecret=GeeLark App ID.
- **VMOS** (https://api.vmoscloud.com): auth V2 sign=SHA256(secretKey+ts+path+rawBody) lowercase hex,
  ts=unix saniye 10hane, header X-Access-Key/X-Timestamp/X-Sign; imzalanan body===gönderilen body (byte-identical).
  Envelope code===200. Endpoints: /vcpcloud/api/padApi/{userPadList(data.pageData[],online 0/1),restart,installApp,
  asyncCmd(shell async),setProxy,screenshot}. create/stop/delete VMOS'ta YOK→NotSupported; start=no-op (pad always-on);
  reset=wipe (delete için KULLANILMADI). CRED EŞLEME: creds.apiKey=Access Key, creds.apiSecret=Secret Key.
Dashboard KINDS'e apiKeyLabel/apiSecretLabel eklendi (hangi alana ne girileceği net).
Adversarial verdict: ikisi de signature/endpoints/mapping/typeSafe/honest = TRUE, 0 defect.

NOT: WSL'den dışarı internet YOK → check "fetch failed" verir (Google Fonts gibi). Bu ortam sorunu, KOD DEĞİL.
Gerçek müşteri sunucusunda (internetli) + gerçek API anahtarıyla çalışır. SONRAKI: reseller fiyat + white-label anlaşması.

**Root durumu netleşti:** cloud-phone API'de proxy/parmak-izi/app/ADB var ama Magisk-seviyesi
root genelde YOK. Tam root sadece kendi ARM (Anbox/redroid) ile. Hesap-farming için API katmanı yeterli.