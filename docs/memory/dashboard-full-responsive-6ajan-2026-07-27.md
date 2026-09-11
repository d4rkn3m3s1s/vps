---
name: dashboard-full-responsive-6ajan-2026-07-27
description: "★Dashboard TAM-RESPONSIVE yapıldı (iPhone 16 Pro/iPad/tablet/telefon/Mac). ★★EN KRİTİK KÖK: layout.tsx'te `viewport` export EKSİKTİ (Next.js 15 viewport'u metadata'dan AYRI export ister) → mobil tarayıcılar sayfayı ~980px masaüstü-genişlikte render edip küçültüyordu → 66 mevcut @media query'nin HİÇBİRİ tetiklenmiyordu → site telefon/tablette bozuktu. FIX: `export const viewport: Viewport = {width:'device-width', initialScale:1, maximumScale:5, viewportFit:'cover', themeColor:[#050204]}`. +globals.css sonuna RESPONSIVE-HARDENING katmanı (global box-sizing:border-box, overflow-wrap:anywhere, html/body overflow-x:clip, iPhone safe-area env(safe-area-inset-*), pointer:coarse dokunma-hedefi 40px, breakpoint ≤1200/1024/820/560/380px, modal max-width:min(96vw,640px)). +6 AJAN PARALEL tüm 43 sayfa+bileşen tarayıp düzeltti. ★AJAN KÖK-BULGU: modal inline `style={{maxWidth:640}}` hardening'i EZİYORDU→`min(96vw,640px)`. WallView inline grid→--wall-cols CSS-değişkeni(media-query ezebilsin). AppChrome/Sidebar mobil-drawer(hamburger,880px) ZATEN VARDI. login kısa-ekran kırpılma→overflow-y:auto. CANLI:viewport-meta render✓, brace-denge 2511/2511, tsc-temiz, build BUILD=0, deploy OK, 4 servis active."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-26T22:39:02.443Z
---

# ★ DASHBOARD TAM-RESPONSIVE (6-AJAN PARALEL) — 2026-07-27

Kullanıcı: "full responsive olmalı sitesin, iPhone 16 Pro/Mac/tablet/telefon hepsinde
kutular/div/modal/buton eksiksiz" + "çoklu ajanlarla tara bak düzelt".

## ★★ EN KRİTİK KÖK NEDEN: viewport meta EKSİKTİ
`src/app/layout.tsx`'te `metadata` vardı ama **`viewport` export YOKTU**. Next.js 15'te
viewport AYRI export ister (metadata içinde çalışmaz). Bu olmadan mobil tarayıcılar
sayfayı ~980px masaüstü-genişlikte render edip küçültüyor → mevcut 66 @media query'nin
HİÇBİRİ tetiklenmiyor → site telefon/tablette bozuk görünüyordu. TEK bu düzeltme en büyük
etkiyi yaptı.
- FIX: `export const viewport: Viewport = { width:'device-width', initialScale:1,
  maximumScale:5, viewportFit:'cover', themeColor:[{color:'#050204'}...] }`.
- viewportFit:cover = iPhone çentik/dynamic-island tam-ekran + safe-area desteği.
- CANLI KANIT: `<meta name="viewport" content="width=device-width...viewport-fit=cover">`
  HTML'de render ediliyor.

## RESPONSIVE-HARDENING KATMANI (globals.css sonu)
Mevcut kuralları BOZMAZ (dosya sonunda, sadece eksik kapatır):
- (0) global `*{box-sizing:border-box}` + `img/video{max-width:100%}` + metin
  `overflow-wrap:anywhere` + `html,body{overflow-x:clip}` + `.table-wrap{overflow-x:auto}`.
- (1) iPhone safe-area: `@supports(padding:max(0px))` → body + topbar + modal-overlay
  `env(safe-area-inset-*)` padding.
- (2) `@media(pointer:coarse)` dokunma-hedefi min 40px + form-input iOS 16px (auto-zoom önle).
- (3) breakpoint'ler: ≤1200(laptop/iPad-yatay) ≤1024(iPad-dikey) ≤820(tablet) ≤560(telefon/
  iPhone-16-Pro-393px) ≤380(küçük telefon). Grid'ler daralır→tek-kolon, flex-wrap, modal 94vw.

## 6 AJAN PARALEL (Agent tool, general-purpose) — 43 sayfa
Sayfa grupları: (1)profiles-ekosistemi (2)iletişim&otomasyon (3)admin&yönetim
(4)veri&izleme (5)giriş+shell (6)görsel&api-docs. Her ajan kendi grubunu tarayıp düzeltti.
★AJAN KÖK-BULGULARI:
- **modal inline `style={{maxWidth:640}}` hardening'i EZİYORDU** → hepsi `min(96vw,640px)`
  (ProvisionModal/WhatsappRegisterModal/InstagramRegisterModal/DeviceProxyModal). iPhone'da
  modal-taşmanın gerçek kökü buydu.
- **WallView** inline `gridTemplateColumns:repeat(cols,1fr)` → `--wall-cols` CSS-değişkeni
  (media-query tavan koyabilsin: ≤1024=4, ≤820=3, ≤560=2, ≤380=1 kolon).
- **AppChrome/Sidebar mobil-drawer ZATEN VARDI** (hamburger MobileMenuButton +
  `fleet:toggle-sidebar` event + 880px'te off-canvas translateX). Düzeltme gerekmedi.
- **login** kısa/yatay-ekranda kart kırpılıyordu → `.lg-root overflow-y:auto` + `.lg-split
  min-height:100%`.
- analytics bar-chart overflow-x, farm hesap-defteri yatay-scroll, accounts flex-taşma
  (minWidth:0), api-docs kod-blokları zaten overflow-x, images/app kart-grid mobilde 1-2 kolon.

## DEPLOY + DOĞRULAMA
- globals.css 8607→8850 satır, brace-denge 2511/2511 (paralel-yazım çakışması YOK).
- tsc-temiz (yerel+host), build BUILD=0 (43 sayfa+CSS derlendi), 12 dosya deploy.
- Değişen: layout.tsx + globals.css + 10 .tsx (profiles×5, wall, accounts, health, hosts, images).
- fleet-dashboard restart, viewport-meta render doğrulandı, 4 servis active.
- ★DEPLOY: değişen dosyalar `/tmp/dash/`(yapı-korumalı scp)→`cp -r src/*`→build→restart.
  .next chown ubuntu şart.

## DERS
Next.js 15 mobil-bozuk ise İLK viewport export'a bak (metadata≠viewport). Inline
`style={{maxWidth:N}}` global CSS'i ezer → responsive-kritik yerlerde `min(96vw,Npx)` kullan.
6-ajan-paralel aynı globals.css'e yazınca: her ajan mevcut-kuralı-in-place-düzelt +
kendi-işaretli-blok-dosya-sonuna → çakışma olmadı (brace-denge korundu).

Detay [[dashboard-redirect-localhost3000-fix-2026-07-24]] [[mega-audit3-tasarim-2026-07-16]]
