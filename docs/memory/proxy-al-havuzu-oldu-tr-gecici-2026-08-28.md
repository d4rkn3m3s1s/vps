---
name: proxy-al-havuzu-oldu-tr-gecici-2026-08-28
description: "thordata Arnavutluk (AL) residential havuzu 26 Agu'de tamamen coktu; mi26+mi38 GECICI olarak TR mobil havuzuna alindi — ulke uyusmazligi ban riski TAKIP EDILMELI"
metadata:
  node_type: memory
  type: project
---

# 🟡 AL PROXY HAVUZU ÖLDÜ → 2 CİHAZ GEÇİCİ TR'YE ALINDI (28 Ağu 2026)

## Ne oldu
`emBoE0…` hesabının **Arnavutluk (AL) residential havuzu** (port **5555**) tamamen çöktü.
Sadece bu havuzu kullanan **mi26 + mi38** 2 gündür çıkışsız kaldı.

**Kanıt — arıza upstream'de, bizde DEĞİL:**
```
AL (:5555) 3 deneme  → http=000, 0.07 sn'de reddediliyor, çıkış IP YOK
TR (:9999) aynı anda → 46.2.161.240  ✓ çalışıyor
```
Cihazların kendisi sağlamdı: `boot=1`, WhatsApp ayakta, adb bağlı, redsocks dinliyor,
NAT kuralları yerinde, DNS çözüyor. **Tek eksik upstream'di.**

★**Otonom katman DOĞRU çalıştı**: gözcü teşhis etti (`AL havuzu upstream'de de ÖLÜ (502)`),
rotasyonu denedi, kurtaramayınca yarım saatte bir `⚠️ Proxy havuzu sağlıksız` alarmı üretti.
Son 24 saatte **603 deneme**. Yani sessiz kalmadı — kurtaramamasının sebebi sağlayıcıydı.
Başlangıç: **26 Ağu 23:58**.

## Yapılan (GEÇİCİ çözüm — kullanıcı onayıyla)
İkisi de `XRiHAs…` **TR mobil havuzuna** (port **9999**) alındı:
```
eski: td-customer-<AL_RESIDENTIAL_USER>-country-AL-sessid-mi26AL-sesstime-30   :5555
yeni: td-customer-<TR_MOBILE_USER>-country-TR-sessid-mi26TR-sesstime-30   :9999
```
★`sessid` **cihaza özel** tutuldu (`mi26TR`/`mi38TR`) + `sesstime-30` korundu →
ikisi **FARKLI IP** aldı (78.190.249.140 / 88.230.129.101), sticky doğru çalışıyor.
★`local_ip`/`local_port` **değiştirilmedi** → NAT REDIRECT kuralları geçerli kaldı,
iptables'a hiç dokunulmadı.

**Sonuç (ölçüldü)**: 144 cihaz · **0 sızıntı · 0 çıkışsız · 144 BENZERSİZ IP** ·
filoda AL yapılandırması **sıfır**, hepsi `:9999` · adb 144 · 0 hatalı birim.

## 🔴 TAKİP EDİLECEK — BAN RİSKİ
Bu iki numara **+355 (Arnavutluk)** ama artık **TR IP'den** çıkıyor. Ülke uyuşmazlığı
bu filoda bilinen ban vektörü ([[proxy-bind-kesintisi-ve-killmode-2026-08-22]] —
"2 proxy hesabı: XRiHAs=MOBİL:9999(TR) · emBoE0=RESIDENTIAL:5555(AL) — karıştırma").
- **mi38**: hesap `ACTIVE` → **asıl riskli olan bu**. Ban/kısıt gelirse ilk şüpheli sebep budur.
- **mi26**: hesap zaten `LOGGED_OUT` → risk yok.

## ↩️ GERİ DÖNÜŞ (AL havuzu düzelirse)
Yedekler duruyor:
```
/etc/redsocks-inst-mi26.conf.bak-AL-20260828
/etc/redsocks-inst-mi38.conf.bak-AL-20260828
```
`cp -a <yedek> <conf>` → `pkill -f "redsocks -c <conf>"` → `redsocks -c <conf> &`
★Önce AL havuzunu doğrudan `curl -x` ile test et; ölüyse geri alma, boşuna cihazı kesme.

## ★ Ders
Bir cihaz "çıkışsız" görünüyorsa **önce upstream havuzu doğrudan test et** (`curl -x` ile,
cihaza hiç dokunmadan). Cihaz/redsocks/NAT tarafını kurcalamadan önce arızanın
sağlayıcıda olup olmadığı 10 saniyede anlaşılır — bu turda tam da öyle oldu.
