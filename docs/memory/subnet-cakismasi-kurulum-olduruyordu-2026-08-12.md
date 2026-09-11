---
name: subnet-cakismasi-kurulum-olduruyordu-2026-08-12
description: "🔴★★★ SUBNET ÇAKIŞMASI kurulumları öldürüyordu: net-head.sh boş subnet'i YALNIZCA haritaya bakarak seçiyordu, harita ile saha KAYMIŞTI. ⚠️Panel 'eth0 IPv4 gecikti—DHCP' der ama DHCP SUÇSUZ (IP alınmış), gerçek hata 'No route to host'. ★8 subnet haritada boş görünüp sahada doluydu. FIX: canlı bridge'leri de tara."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-12T02:11:07.981Z
---

# Subnet çakışması — kurulum "%18'de" sonsuza kadar takılıyordu

## Belirti
Yeni cihaz kurulumu `Cihaz açılışı bekleniyor` adımında **sonsuza kadar** bekliyor.
Panel: `⚠ eth0 IPv4 gecikti — DHCP yeniden tetikleniyor…`

⚠️ **PANEL YANILTIYOR — DHCP SUÇSUZ.** Cihaz IP'yi ALMIŞTI (`192.168.130.112`).
Gerçek hata: `adb connect` → **`No route to host`**.

## KÖK NEDEN
`net-head.sh` boş subnet'i **yalnızca haritaya** (`/var/lib/waydroid-subnets.map`)
bakarak seçiyordu:
```bash
S=2; while [ "$S" -le 239 ]; do
  awk -v s="$S" '$2==s{f=1} END{exit !f}' "$MAP" || break   # sadece HARITA
  S=$((S+1))
done
```
Harita ile gerçek durum **kaymıştı** (zincirleme):
```
mi197: harita=74   canlı=125
mi198: harita=125  canlı=127
mi201: harita=127  canlı=130
mi240: haritada YOK,     canlı=130   ← mi201'in ÜSTÜNE bindi
```
İki instance aynı `/24`'te olunca yönlendirme bozuluyor → cihaza hiç ulaşılamıyor.

## ★ KAPSAM (düşünülenden büyük)
Yeni mantık canlıyı tarayınca **haritada boş görünen ama sahada DOLU 8 subnet**
çıktı: `130,131,132,133,134,136,137,138`. Eski mantık bunların HER BİRİNDE aynı
çakışmayı üretirdi — mi240 tek kurban değil, sırası gelendi.

## FIX
`subnet_live_used()` — haritaya EK OLARAK canlı bridge'leri de tara:
```bash
ip -o -4 addr show | grep -qE "[[:space:]]192\.168\.$1\.1/(24|[0-9]+)([[:space:]]|$)"
```
İki kaynaktan biri bile kullanıyorsa atla + stderr'e not düş. Böylece harita
bozulsa/kaysa bile çakışma **üretilemez**. (`ip -br` KULLANILMADI — betik `sh` ile
de çalışabiliyor ve bazı ortamlarda `-br` yok.)

## KANIT (canlı, yan yana)
```
ESKİ mantık → subnet 130 seçerdi → "CANLIDA DOLU (çakışma üretirdi)"
YENİ mantık → 8 subnet atladı  → subnet 141 (güvenli)
birim test  : 130/127/125 DOLU · 50/52/200 boş ✅
```
Sonra **mi241** kuruldu: 90 sn, İstanbul/TR çıkış. Ardından **mi244**: 82 sn.

## KAPASİTE (operatör sorusu "subnet yeter mi")
**YETER** — 124 kullanımda, **129 boş** (2..254). Sorun kapasite değil, tahsis
tutarsızlığıydı.

## ⚠️ MEVCUT KAYMA BİLEREK DÜZELTİLMEDİ
Haritadaki eski kaymalar (mi197/198/201) düzeltilmedi: çalışan 110+ cihazı riske
atardı ve yeni mantık zaten canlıyı kontrol ettiği için kayma **zararsız**.

## ⚠️ TUZAK — instance adından IP çıkarma
`mi244` subnet 47 aldı ama IP'si `.112` DEĞİL, **`.53`** (DHCP'den). Adresi
`ip addr`/lease'ten OKU; `192.168.<sub>.112` varsayımı yanlış sonuç verir.
(Aynı ders 30 Tem'de mi46 için de yazılmıştı, yine unutuldu.)

## KALICI KORUMA
`fleet-smoke.sh` iki kontrol: **subnet çakışması** (aynı /24'te 2 bridge) ve
**instance↔harita tutarlılığı** (kaydı olmayan instance restart'ta subnet DEĞİŞTİRİR).

İlgili: [[RESUME-kaldigimiz-yer-2026-08-12]] · [[instance-isim-mezarligi-2026-08-04]] ·
[[dbus-baglanti-limiti-kurulum-donuyor-2026-08-05]]
