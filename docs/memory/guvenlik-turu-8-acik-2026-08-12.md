---
name: guvenlik-turu-8-acik-2026-08-12
description: "🔴★★★ 8 GERÇEK AÇIK kapatıldı: host'ta ROOT dosya yazma (path traversal, agent root çalışıyor), cihazda komut enjeksiyonu (4 noktada shArg eksik), wd-run.sh KÖK SİLME riski, admin JWT'si tarayıcıya veriliyordu, public retry'da yazma kapsamı yok, motor/fatura uçlarında rol yok. ⚠️Çoğu tek-kullanıcılı kurulumda ETKİSİZ ama kullanıcı eklenince aktifleşir."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-12T02:11:59.646Z
---

# Güvenlik turu — 8 gerçek açık (12 Ağu)

Çok-ajanlı tarama 29 ham bulgu üretti; doğrulama ajanları oturum limitine takıldığı
için **hepsi elle, kodda + canlıda** doğrulandı. Gerçek çıkanlar:

## 🔴 1. Host'ta ROOT yetkisiyle keyfi dosya yazma (EN CİDDİ)
`download(url, name)` içinde `join(dir, name)` **ham** `name` ile çağrılıyordu.
Zincir uçtan uca doğrulandı:
```
files.controller.ts : fileName yalnızca z.string().optional() — İÇERİK DENETİMİ YOK
agent.mjs:1360      : ham değer okunuyor
agent.mjs:9695      : join(dir, name) → dizin DIŞINA çıkılabiliyor
systemd fleet-agent : User= YOK → ps doğrulaması: root
```
`fileName:"../../../etc/cron.d/x"` = kök dosya sistemine yazma = **tam ele geçirme**.
FIX: `safeFileName()` — basename + ters-slash normalizasyonu + kontrol karakteri
temizliği + 120 karakter. Bilerek `download()` İÇİNDE (6 çağrının hepsi korunur).
⚠️ İlk yazdığım regex `/[ -<>:"|?*]/` HATALIYDI — bu bir ARALIK (0x20-0x3C), noktayı
ve rakamları da siliyordu (`foto.jpg` → `foto_jpg`). Test yakaladı. 9/9 geçti.

## 🔴 2. Cihazda komut enjeksiyonu — 4 noktada `shArg()` eksik
Agent'ın KENDİ yorumu tehlikeyi zaten belgeliyordu:
> "adbd joins the args and re-parses them through the phone's sh — so `a;reboot`,
> `a$(id)` or `` a`id` `` would EXECUTE on the device."
Eksik olan yerler: `am broadcast -d file://${dest}` (×2), `settings put global
http_proxy ${host}`, `am start -n ${comp}` / `monkey -p`, `am force-stop ${pkg}`.
★ `safeFileName` yol ayracını temizler ama **kabuk metakarakterlerini DEĞİL** —
iki koruma farklı katman, biri diğerinin yerine geçmez.
Denetim: shArg'lı 9 · sabit 5 · **korumasız 0** (önce 5).

## 🔴 3. `wd-run.sh` — tırnaksız `$INST` ile KÖK SİLME
`rm -rf /run/wd-$INST` ve 22 benzeri kullanım tırnaksız. `metadata.instance`
API'de `z.unknown()` — içerik denetimi YOK. ★`execFile` argv'yi korur ama betiğin
İÇİNDEKİ tırnaksızlık bash'te yeniden kelime ayrıştırmasına uğrar: `INST="x /"` →
`rm -rf /run/wd-x /`. FIX: adı KAPIDA doğrula (wd-destroy.sh'taki desenin aynısı).
Canlı test: `"x /"` · `"a;rm -rf /"` · `".."` → 3/3 reddedildi.

## 🔴 4. Admin JWT'si tarayıcıya veriliyordu
`/api/ws-token` `getAccessToken()` (ADMIN servis kimliği) token'ını **olduğu gibi**
tarayıcıya dönüyordu — 2 saatlik, `typ:'access'`, yani TÜM REST yüzeyinde geçerli.
Mimari kural: "panel tarayıcıda ASLA JWT tutmaz". FIX: yeni `POST /auth/ws-token`
ucu — çağıranın oturumunu doğrulayıp **10 dakikalık** token üretir, rolü aynen taşır.
Ölçüm: oturum 120 dk (değişmedi) · ws 10 dk · tokensiz 401.

## 🔴 5. Public API retry'da yazma kapsamı yok
`registerWhatsappRetryHandler`'da `requireScope('write')` YOKTU. ★Teorik değildi:
canlıda `{read}` kapsamlı AKTİF anahtar var ("API Dokümantasyonu") → salt-okunur
anahtar cihaz sürebiliyordu. Kapsam: 28 yazma ucunun 27'sinde vardı → izole unutma.

## 🔴 6. Motor/fatura uçlarında rol kontrolü yok
`POST /farm/tick` ve `/schedules/run-due` platform genelinde çalışıyor (ticker için
doğru) ama HTTP ucu herkese açıktı. `/billing/{checkout,portal,cancel,resume}` —
en düşük yetkili üye aboneliği iptal edebiliyordu. FIX: `requireAdmin`.
Canlı: admin → 200 · tokensiz → 401 (panel akışı kırılmadı).

## 🟡 7-8. Yayın token'ı 2 saatlik + rate limit yokluğu
Stream token "short-lived" deniyordu ama env varsayılanı = 2 saat → 10 dk.
`provision/snapshots/bulk/emulators`'ta rate limit hiç yoktu → en pahalı 12 uca
`heavyOperationRateLimiter` (20/dk) eklendi (toplu kurulumu engellemez).

## ⚠️ MEVCUT KURULUMDA ETKİSİZ OLANLAR
Sistemde **1 kullanıcı (admin), 1 workspace, 0 webhook** var. Bu yüzden 4, 6 ve
`doc-key`/webhook-sırrı bulguları şu an sömürülebilir DEĞİL — **ikinci kullanıcı
eklendiği anda** aktifleşir. 1, 2, 3, 5 ise şimdi de geçerliydi.

## ⚠️ TARAMA DERSİ
Statik tarama çok yanlış pozitif verdi: "snapshot rotaları korumasız" (router
seviyesinde `use()` vardı), "152 sorguda workspace filtresi yok" (yardımcı
fonksiyonlarda vardı), "69 public uç 404" (POST uçları GET'le yoklanmıştı; doğru
metotla **72/72 mevcut**). ★Her bulgu canlıda doğrulanmadan raporlanmamalı.

İlgili: [[RESUME-kaldigimiz-yer-2026-08-12]] · [[guvenlik-denetim-10fix-2026-07-21]] ·
[[public-api-kategori-mimarisi-2026-07-29]]
