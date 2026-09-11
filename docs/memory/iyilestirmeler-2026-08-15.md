---
name: iyilestirmeler-2026-08-15
description: "15 Ağu iyileştirmeleri: yeni cihaz reboot'ta açılmıyordu (provision enable eksik) · izleyici çift tarama + ps -eo · proxy sızıntısı panelde · work sahte instance"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-14T22:14:57.165Z
---

14 Ağustos gecesinin kurtarma çalışmasının ardından yapılan iyileştirmeler
(bkz. [[proc-taramasi-systemd-kilidi-2026-08-14]] · [[kurtarma-sistemi-ssh-siz-2026-08-14]]).

## 🔴 En kritik: yeni cihaz REBOOT'ta kayboluyordu

`wd-provision.sh` instance'ı hazırlıyor ama **`systemctl enable waydroid@<inst>`
yapmıyordu**. Cihaz kurulduğu gün çalışıyor, sunucu yeniden başlayınca systemd onu
**hiç başlatmıyor** — sessizce kayboluyor.

14 Ağu'da 156 cihazın **126'sı** bu yüzden açılmadı. O boşluğu `wd-boot-toparla`
kapatıyordu ama o servis toplu `systemctl` çağırdığı için sistemi kilitliyordu ve
devre dışı bırakıldı → boşluk yeniden açıldı.

**Fix:** kurulumun sonunda enable. Doğru yer orası — periyodik tarama gerekmez.

## 🔴 İzleyicinin kendisi hâlâ yük kaynağıydı

`wd-adb-tara` **`ps -eo stat`** çalıştırıyordu — kilitleri yaratan komut sınıfı,
her 2 dakikada bir. Ayrıca **kendi derin taramasını** yapıyordu, oysa `wd-izle` de
aynı taramayı aynı aralıkla yapıp **aynı dosyaya** yazıyordu:
- 40 paralel `lxc-attach` iki kez
- iki süreç aynı `saglik.out`'a yazıyor → yarış

**Fix:** `procs_blocked` + paylaşılan veri (veri >5 dk bayatsa kendi taraması, ayrı
dosyaya). Her iki betiğe **sağlık kapısı**: systemd >3000 ms veya D-state >35 ise
pahalı tarama atlanır, ucuz sayımlar yazılmaya devam eder (kayıt hiç kesilmesin —
14 Ağu 22:57'de izleyici tamamen susmuş ve kör kalınmıştı).

## 🟢 Proxy sızıntısı artık panelde

Cihazın çıkış IP'si host'un kendi IP'siyse proxy devrede değildir → WhatsApp'a
datacenter IP'sinden gidilir → **ban**. 14 Ağu gecesi reboot sonrası **47 cihaz**
böyle çıktı ve hiçbir yerde görünmedi (health-watch tespit eder ama durdurulmuştu).

`/durum` sayfasında kart: sıfırdan büyükse kırmızı + "BAN RİSKİ". Host IP'si de
yazılı, karşılaştırma yapılabilsin diye.

## 🟢 `work` sahte instance

`/var/lib/waydroid.work/` gerçek instance yapısına sahip ama **DB'de karşılığı yok**
(DB 155, panel 156 diyordu). Sürekli "sorunlu cihaz" listesinde, systemd'ye
kaydedilince her boot'ta boşuna açılmaya çalışıyordu.

`waydroid@work` **disable** edildi (silinmedi — şablon olabilir),
`/opt/fleet-agent/state/instance-haric.txt` ile listeden çıkarıldı.
Filo boyutu artık **sabit değil**, listeden okunuyor; renk eşikleri de orana çevrildi.

## ⚠️ Repo haftalardır bayattı

`wd-provision.sh`'in **4 Ağustos** düzeltmesi (her kurulumda 1 GB imaj indirme —
init 5-10 dk → 1 sn) hiç commit edilmemişti. Sunucu sürümü repoya alındı.

**Ders:** sunucuda yamalanan betik aynı gün repoya alınmalı; yoksa bir sonraki
deploy haftalarca eski koda döner.

⚠️ `deploy/kvm-host/waydroid/wd-health-watch.sh` ikinci bir kopya ve bayat —
hangisi geçerli, tekilleştirilmeli (yapılmadı).

## Panelden/Telegram'dan müdahale

- Panel: Hosts → **"Agent'ı sıfırla"** → `POST /hosts/:id/agent/reset`
- Telegram: **`/kilitdurum`** · **`/agentsifirla`** · **`/panik`**
- İkisi de host'taki kurtarma ucuna gider (root, systemd'siz `pkill` tabanlı).
