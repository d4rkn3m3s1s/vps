---
name: subnet-tavani-238den-492ye-2026-08-13
description: "🟢★★★ SUBNET TAVANI 238 → 492 (filo büyüsün diye). Subnet no doğrudan IP'nin 3. oktetine yazılıyordu → 192.168.0.0/16 ile sınırlıydı. FIX: S>=240 → 10.10.<S-239> eşlemesi, 3 yerde AYNI mantık (net-head.sh · wd-run.sh · agent.mjs 12 nokta). ★Mevcut cihazlar AYNEN kalır (S<=239 → 192.168.<S>), taşıma YOK. ★Ayrıca 25 hayalet harita kaydı temizlendi: boş subnet 67 → 93."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-13T00:36:34.329Z
---

# Subnet tavanı 238 → 492 + harita temizliği

## Neden (operatör: "subnet için de çözüm üretelim, filo büyüyecek")
Subnet numarası **doğrudan IP'nin 3. oktetine** yazılıyordu:
```
net-head.sh : S=2..239
wd-run.sh   : GW="192.168.$SUBNET.1"; IP="192.168.$SUBNET.112"
agent.mjs   : `192.168.${subnetId}.…`  ← 12 AYRI NOKTA
```
Yani filo **en fazla 238 cihaz** alabilirdi. ÖLÇÜM (13 Ağu): 145 kullanımda, 140 canlı.

## FIX — ikinci /16 bloğuna eşleme
```
S <= 239  ->  192.168.<S>        ← MEVCUT CİHAZLAR AYNEN KALIR (taşıma yok)
S >= 240  ->  10.10.<S-239>      ← 10.10.1.x … 10.10.254.x  (+254 subnet)
S_MAX = 493   (toplam 492 subnet)
```
Aynı mantık **ÜÇ yerde** uygulandı — biri geride kalırsa yeni cihazlar yanlış adrese
kurulur: `net-head.sh: subnet_prefix()` · `wd-run.sh: subnet_prefix()` ·
`agent.mjs: subnetPrefix()`.

★ Eski kod tavana dayanınca **`240` döndürüyordu** (geçerli görünen bir değer!). Artık
240 gerçek bir subnet olduğu için bu sessiz çakışma üretirdi → `exit 1` + net hata.

## ★ ÇAKIŞMA DENETİMİ (canlı, host'un TÜM IPv4'leri okundu)
```
bond0.2  10.0.0.11/24        ← host'un kendi ağı (farklı /16, ETKİLENMEZ)
bond0.3  125.253.73.45/31
docker0  172.17.0.1/16       ← docker
10.10.0.0/16 = TAMAMEN BOŞ
```
Test: 240..493 aralığının hiçbiri 10.0.0.x veya 172.17.x üretmiyor (0 çakışma),
2..493 arası 492 önek **mükerrersiz**.

## TEST
```
JS  : 8/8 eşleme · 0 çakışma · 0 mükerrer
bash: 6/6 eşleme (aynı sonuçlar — iki dil aynı çıktıyı vermeli)
canlı: 140/140 cihaz haritada, subnet+IP birebir tutarlı (192.168.6.112 vb.)
```

## ★ HARİTA TEMİZLİĞİ (aynı turda)
`waydroid-subnets.map`'te **30 hayalet** kayıt vardı (dizin yok). 25'i tamamen ölü
(bridge de yok) → silindi; **5'i bridge'i canlı** olduğu için DOKUNULMADI.
```
öncesi: 171 kullanılan · 67 boş
sonrası: 145 kullanılan · 93 boş   (140 canlı cihaz, 0 kayıp)
```
132 emekli cihazın 28'i haritada duruyordu — `wd-destroy.sh` haritadan siliyor
(satır 98) ama bunlar başka bir yoldan silinmiş olmalı (kök neden ARAŞTIRILMADI).

## ⚠️ TUZAK — ölü instance'a net-head çağırmak KAYIT YAZAR
Doğrulama için `net-head.sh mi244` çalıştırdım; mi244 SİLİNMİŞ olmasına rağmen betik
ona **yeni subnet atadı** (haritaya satır ekledi). Bir an "canlı cihazı bozdum" sandım
— ölçünce ikisi de ölü çıktı (`wd-run=0`, dizin yok), kirlilik temizlendi.
★ `net-head.sh` bir OKUMA aracı DEĞİL, **tahsis** aracıdır — teşhis için çağırma.

## ⚠️ ÖLÇÜM TUZAĞI
`grep "stream channel connected" | tail -1` restart sonrası ESKİ kaydı gösterdi
(satır sıralaması); zaman damgasını agent başlangıcıyla karşılaştırınca yeni bağlantı
(00:35:13 > 00:34:25) göründü. **Damgayı restart saatiyle KARŞILAŞTIR.**

İlgili: [[nokta112-varsayimi-saglam-cihazlari-olduruyordu-2026-08-13]] ·
[[subnet-cakismasi-kurulum-olduruyordu-2026-08-12]] · [[instance-isim-mezarligi-2026-08-04]]
