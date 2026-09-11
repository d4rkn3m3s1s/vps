---
name: wa-couldnt-connect-proxy-forcestop-2026-07-27
description: "★WhatsApp kayıtta 'Couldn't connect. Please try again later' (numara temiz, BAN DEĞİL). KÖK: cihaz FARKLI-ÜLKE numarası için yeniden kullanılınca proxy ülkesi değişir (AL→TR, sistem doğru çevirir) AMA WhatsApp ESKİ proxy çıkışına kurulmuş bağlantıyı CACHE'ler→yeni ülke-proxy'sinden sonra numara-ekranında 'Couldn't connect'. CANLI: mi12 AL-numara→AL-proxy iken TR-numara denendi→TR-proxy'ye çevrildi ama WA eski-bağlantı→hata. FIX(2-katman, agent.mjs /opt/agent.mjs): (1)EMULATOR_SET_PROXY handler proxy-APPLIED sonrası `adb am force-stop com.whatsapp`(proxy değişince WA soğuk-başlar). (2)registerWhatsapp launch-adımı ÖNCESİ `!isContinuation` ise force-stop+1.2s(continuation=OTP-ekranı kapatma akışı bozar, HARİÇ). CANLI-KANIT: WA-açık(pid15150)+SET_PROXY→pid KAPALI(force-stop çalıştı). ★SET_PROXY payload host+username+password ŞART(sadece country→'country host username required' FAILED). ★DERS:proxy-değişince WA force-stop=temiz-bağlantı. destek1 CHAT_NOT_OPENED farklı(hesap banlı)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-26T21:10:50.128Z
---

# ★ WhatsApp "Couldn't connect" — proxy-değişimi + WA-cache (2026-07-27)

Kullanıcı: WA-kayıtta "Couldn't connect. Please try again later" hata, "numara sıfır
sorunsuz bansız neden". "sorunsuz tek-tık cihaz ve tek-tık whatsapp çalışmalı".

## KÖK NEDEN (ban DEĞİL, proxy-cache)
Cihaz FARKLI-ÜLKE numarası için yeniden kullanılınca:
1. Numara ülkesi değişir (AL→TR). Sistem proxy'yi DOĞRU çevirir (autoAttachCountryProxy →
   SET_PROXY job, AL-proxy→TR-proxy). Proxy zinciri sağlam (redsocks+iptables+upstream OK).
2. ★AMA WhatsApp uygulaması ESKİ proxy çıkışına kurulmuş TCP/DNS bağlantısını CACHE'ler →
   yeni ülke-IP'sinden sonra WA sunucusuna bağlanamaz → "Couldn't connect".
3. CANLI: mi12 (AL→TR), WhatsApp force-stop+restart → EULA/numara-ekranı TEMİZ açıldı, hata gitti.
- ⚠️AYIRT ET: bu proxy-UYUMSUZLUK değil (proxy TR=numara TR uyumlu). Ne de ban (numara temiz).
  Sadece WA'nın eski-bağlantıyı bırakmaması. adb-shell curl/DNS testleri Waydroid'de güvenilmez;
  gerçek kanıt = WA'yı restart edince numara-ekranının hata-dialog'suz açılması.

## FIX (2 katman — agent.mjs, /opt/agent.mjs)
1. **EMULATOR_SET_PROXY handler** (proxy APPLIED sonrası): `adb(serial,['shell','am','force-stop',
   WA_PKG])`. Proxy her değiştiğinde WA soğuk-başlatılır → sonraki açılış yeni-proxy'yle temiz bağlanır.
2. **registerWhatsapp launch adımı ÖNCESİ**: `if(!isContinuation){ force-stop WA; sleep 1200 }`.
   ★SADECE yeni kayıtta — continuation'da (operatör OTP girer, API re-dispatch) WA'yı kapatmak
   OTP-ekranını yok eder, akışı bozar. isContinuation guard ŞART.
- ✅CANLI-KANIT: WA açık(pid 15150) + tam-payload SET_PROXY(TR) → APPLIED → WA pid KAPALI
  (force-stop çalıştı). İki-katman = proxy-değişince WA asla eski-bağlantıyla kalmaz.

## SET_PROXY payload TUZAĞI
`EMULATOR_SET_PROXY` job payload'ı `country` + `host` + `username` + `password` + `port`
ŞART. Sadece `{country:'TR'}` → agent `'country, host and username are required for redsocks
proxy'` FAILED (force-stop koduna hiç ulaşmaz). Gerçek API akışı autoAttachCountryProxy ile
doldurur; ham-test'te env'den (FLEET_PROXY_MOBILE_* TR / FLEET_PROXY_* AL) al.

Detay [[proxy-alarm-undici-forward-fix-2026-07-26]] [[canli-izleme-8bug-sticky-2026-07-22]]
[[eth0-heal-otomatik-kurtarma-2026-07-24]]
