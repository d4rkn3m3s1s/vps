---
name: instance-isim-mezarligi-2026-08-04
description: "🟢★★SİLİNEN instance ADI bir daha kullanılmaz: nextInstanceName SADECE canlı Device'lara bakıyordu→silinen ad 'boş' görünüp YENİDEN kullanılıyordu(=28 Tem bayat-ADB-ucu arızasının kaynağı). FIX:RetiredInstance tablosu + wd-destroy.sh'ta /var/lib/waydroid-retired.list. ★★TUZAK:geriye-dönük tohumlamada 43 adayın 22'si SİLİNİP YENİDEN KURULMUŞ ve CANLIydı→NOT EXISTS guard'ı şart. ⚠️SUBNET geri kazanılmaya devam eder."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T01:46:03.455Z
---

# Instance isim mezarlığı — silinen ad geri dönmez (4 Ağustos 2026)

Operatör: *"mi47'yi silersem sonra bir daha kurulmasın, hep farklı olsun —
silsek geri yeri açılsa da"*.

## Kök neden
`provision.service.ts → nextInstanceName` **yalnızca canlı `Device` satırlarına**
bakıyordu. Cihaz silinince `metadata.instance` ile birlikte satır gidiyor, ad
"boş" görünüyor ve bir sonraki kurulumda **yeniden kullanılıyordu**.
Üstelik `wd-destroy.sh` `subnets.map` satırını da siliyordu → ad hem DB'de hem
sunucuda serbest kalıyordu.

**Neden tehlikeli:** ad geri dönünce eski cihazın izleri (bayat ADB ucu, dnsmasq
lease, ARP/route kaydı) yeni cihaza karışır — bu, 28 Tem'deki
[[bayat-adb-ucu-kurulum-oldurur-2026-07-28]] arızasının tam kaynağı.

## Çözüm — iki BAĞIMSIZ katman
1. **DB:** `RetiredInstance` tablosu (`hostId`+`instance` UNIQUE). Satır,
   cihaz silinirken `DEVICE_DESTROY` işi açıldıktan **hemen sonra ve DB
   silmesinden ÖNCE** yazılır — sonraya bırakılsaydı, silme ile yazma arasındaki
   pencerede gelen bir provision aynı adı kapabilirdi.
2. **Host:** `wd-destroy.sh` → `/var/lib/waydroid-retired.list`.

`nextInstanceName` artık **canlı + emekli adların birleşimini** atlıyor.

⚠️ **SUBNET geri kazanılmaya DEVAM EDER** (aralık 2..239 sınırlı, dolabilir).
Geri dönmeyen tek şey **İSİM**.

## ★★ TUZAK — geriye dönük tohumlama
Tablo yokken silinmiş adlar `DEVICE_DESTROY` işlerinin payload'ında duruyor;
migration onları emekliye alıyor → **43 aday**. Ama bu 43'ün **22'si**
(`mi12`/`mi13`/`mi30`/`mi47`…) **silinip SONRA yeniden kurulmuş** ve o an
**ONLINE cihazlarda kullanımdaydı**. Emekli saymak tabloyu yanıltıcı yapardı.

→ Sorguya `NOT EXISTS (Device.metadata->>'instance' = t.instance)` guard'ı
eklendi; canlıda yanlış yazılan 22 satır silindi. Kalan **21** (`mi51`..`mi72`)
gerçekten silinmiş ve geri dönmemiş adlar.

**Ders:** "geçmişte silindi" ≠ "şu an boş". Tohumlamadan önce **mevcut durumu**
kontrol et.

## ⚠️ Şema notu
`Job` tablosunda **`hostId` kolonu YOK** — doğrusu **`claimedByHostId`**
(ilk migration bu yüzden hata verdi). Talep edilmemiş işler için tek host'a düşülür.

## Canlı kanıt
```
canli ad 51 · emekli ad 21
ESKI kod bir sonraki cihaza -> mi51   (EMEKLI AD, GERI DONERDI)
YENI kod bir sonraki cihaza -> mi74
```
`mi47` şu an canlı (`wa-mjfb`) — silinirse emekliye ayrılacak.

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]] ·
[[mi46-netd-resolver-adb-uc-karisikligi-2026-07-30]]
