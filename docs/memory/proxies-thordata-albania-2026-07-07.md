---
name: proxies-thordata-albania-2026-07-07
description: "★thordata Albania proxy'leri dashboard Proxy'ler'e eklendi 2026-07-07★ İki AL residential proxy DB'de: (1) <PROXY_HOST_ID>.eu.thordata.net:5555 user=td-customer-<AL_RESIDENTIAL_USER>-country-al (mi5 için, çıkış 79.106.42.82), (2) 43.157.66.4:9999 user=td-customer-<TR_MOBILE_USER>-cc-AL (work/mi3, çıkış 77.247.88.154). İkisi de curl'de ÇALIŞIYOR (Albania IP) ama API proxyService.check() YANLIŞ FAILED veriyor (undici ProxyAgent↔thordata uyumsuzluğu, false-negative) → status elle OK+exportIp yazıldı. mi5 subnet(253) redsocks:12346 + iptables REDIRECT ile Albania proxy'ye yönlendi (work/mi3=12345, ayrı). WhatsApp: numara-ülke=proxy-ülke ŞART (AL numara +355 → AL proxy)."
metadata: 
  node_type: memory
  type: reference
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-07 — Kullanıcı thordata proxy verdi ("iki proxyi de dashboarda proxy kısmına göm" + "başka cihazlara ata + çalıştığını görelim"). İlgili: [[one-click-whatsapp-integration-2026-07-07]], [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]] (redsocks/proxy config detayı), [[whatsapp-otonom-kayit-hardening-2026-07-07]] (#3 Albania proxy).

═══════════════════════════════════════════════════
# İKİ ALBANIA PROXY (Proxy tablosunda, workspace cmqlrdynh0002...)
═══════════════════════════════════════════════════
1. **thordata AL (mi5)**: host `<PROXY_HOST_ID>.eu.thordata.net` port 5555, user `td-customer-<AL_RESIDENTIAL_USER>-country-al`, pass `<PROXY_PASS>`. DNS→43.157.66.4. Çıkış IP curl-doğrulandı: **79.106.42.82** (Albania). cc=AL.
2. **thordata AL (work/mi3)**: host `43.157.66.4` port 9999, user `td-customer-<TR_MOBILE_USER>-cc-AL`, pass <PROXY_PASS>. Çıkış: **77.247.88.154** (Albania). cc=AL. (work/mi3'ün mevcut redsocks'u zaten bunu kullanıyordu.)
- ★thordata username formatı: `<user>-country-<cc>` VEYA `<user>-cc-<CC>` (iki hesap iki format kullanmış — verilen username'i AYNEN kullan, wd-proxy.sh'in `-cc-` eklemesine güvenme).

═══════════════════════════════════════════════════
# ★API proxyService.check() FALSE-NEGATIVE BUG★
═══════════════════════════════════════════════════
- İki proxy de `curl -x http://user:pass@host:port https://api.ipify.org` ile ÇALIŞIYOR (Albania IP döner). AMA API `check()` (proxy.service.ts:227, undici ProxyAgent + fetch ipify) ikisine de **FAILED** verdi (score 25). undici ProxyAgent'ın thordata residential ile HTTP-CONNECT handshake'i tutmuyor (curl tutuyor) = false-negative.
- ÇÖZÜM (geçici): DB'de status=OK, exportIp=gerçek IP, score=80 ELLE yazıldı (updateMany). Panelde "OK"+IP görünür.
- ★KALAN BUG: proxy.service check() undici→thordata uyumu düzeltilmeli (curl gibi çalışan bir yöntem, ya da undici tunnel opts). Aksi halde revalidation ticker tekrar FAILED'a çevirir.

═══════════════════════════════════════════════════
# mi5 PROXY KURULUMU (host tarafı, cihaza girmeden)
═══════════════════════════════════════════════════
- mi5 subnet=253. Kuruldu: `/etc/redsocks-mi5-al.conf` (ip=43.157.66.4 port=5555 login=emBoE0o264he-country-al) → `redsocks -c` port **12346** (work/mi3=12345, çakışmasın). iptables: `192.168.253.0/24 -p tcp -j REDIRECT --to-ports 12346` + RETURN kuralları (local net + 43.157.66.4/32 loop önle).
- ★TUZAK: mi5 boot/wd-run route eklerse iptables PREROUTING kuralı KALABİLİR (kontrol et: `iptables -t nat -L PREROUTING -n | grep 253`). Yoksa tekrar ekle. redsocks systemd DEĞİL (elle başlatıldı, reboot'ta gider — kalıcı için wd-proxy.sh veya systemd unit gerek).
- Panelden cihaza proxy ata: Profiller → cihaz seç → "Proxy ata" modal (mevcut) → ama bu Device.proxyId'yi yazar, redsocks/iptables'ı KURMAZ (o host tarafı wd-proxy.sh işi). Panel-atama şu an sadece kayıt, ağ yönlendirme AYRI.

═══════════════════════════════════════════════════
# ★NUMARA GİRİNCE PROXY OTO-AYAR (task #17, KODLANDI+DEPLOY)★
═══════════════════════════════════════════════════
Kullanıcı "numara yazınca numaraya gire proxy ayarla" dedi. batch.service startOperatorRegister'a eklendi:
- `CC_TO_ISO` haritası + `isoFromPhone(digits)` (355→AL, 90→TR, longest-prefix). API'de yoktu, eklendi.
- Numara ülkesi → o ülkenin proxy'sini bul (workspace + countryCode + status!=FAILED, score desc) → **EMULATOR_SET_PROXY job** (payload: deviceId, instance[metadata'dan], country, host, port, username, password DEŞİFRE). claimNext instance folding YAPMAZ → payload'a ELLE koy. + Device.proxyId persist. REGISTER_WHATSAPP ÖNCESİ. Best-effort (proxy yoksa/instance yoksa atla).
- Dönüş `{...account, proxyAssigned:{proxyId,country}}`. Dashboard startWhatsapp mesajı "AL proxy'si ayarlandı" gösterir.
- ★wd-proxy.sh FIX: `login="$PUSER-cc-$CC"` → username zaten `-cc-`/`-country-` içeriyorsa OLDUĞU GİBİ kullan (case match), yoksa ekle. thordata username `-country-al` içerdiği için çift-ekleme bug'ı önlendi.
- ★TUZAK: EMULATOR_SET_PROXY agent'ta `payload.instance` ŞART ama API claimNext bunu foldlamıyor → payload'a ELLE koymak zorunlu (yaptım).

═══════════════════════════════════════════════════
# ★proxy check() FALSE-NEGATIVE tekrar (revalidation FAILED'a çeviriyor)★
═══════════════════════════════════════════════════
proxyService.check() (undici) thordata'ya FAILED verir (curl OK) → revalidation ticker proxy'yi tekrar FAILED yapar → #17 eşleşme "YOK" döner. GEÇİCİ ÇÖZÜM: elle status=OK + score=90 + **checksDue=+7gün** (revalidation ertelendi). KALICI: check() undici→thordata uyumu düzeltilmeli (memory yukarıda). Eşleşme sorgusu `status:{not:FAILED}` filtreli → FAILED proxy görünmez.

═══════════════════════════════════════════════════
# WHATSAPP TEST İÇİN
═══════════════════════════════════════════════════
- Numara-ülke = proxy-ülke ŞART. AL proxy → AL numara (+355). Kullanıcı numara +355682342382 (Albania) verdi. TR numara (+90) verilmişti ama proxy AL → uyumsuz, AL numaraya geçildi.
- mi5 ADB KRONİK KARARSIZ (her su/shell/curl hang) → wd-stop+wd-run TEMİZ RESTART kurtarır. Test öncesi ŞART.
