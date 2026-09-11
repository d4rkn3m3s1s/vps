---
name: eventfs-deadlock-ve-host-donmasi-2026-09-03
description: "3 Eylül: unattended-upgrade → 13 konteyner aynı anda restart → Linux 6.8 tracefs/eventfs çekirdek deadlock'u (101 init D-state) → REBOOT'SUZ ÇÖZÜLDÜ (tracefs-guard + taze binderfs + monitor-kill reçetesi, 13/13 geri geldi). Teşhis sırasında nsenter -m ile 131K crash_dump64 fork bombası tetiklendi, toplu kill host'u 9 dk dondurdu — dersler ve drain betiği"
metadata: 
  node_type: memory
  type: project
  originSessionId: a9614e2b-33cb-436b-bb65-298d256a8fb6
  modified: 2026-09-03T18:14:18.462Z
---

# 🔴★★★ 3 EYLÜL: eventfs DEADLOCK — REBOOT'SUZ ÇÖZÜLDÜ (13/13, adb 131→144)

## Zincir (kanıtlı)
```
06:54:22  unattended-upgrades: libgcrypt20 · 06:55:09 dnsmasq SIGTERM · fleet-agent restart
06:55:10  mi177…mi189 (13 konteyner) AYNI SANİYEDE yeniden başladı
07:01:04  kernel: "INFO: task ... blocked for more than 122 seconds"
```
13 Android init aynı anda `init.rc:82` **`mount tracefs tracefs /sys/kernel/tracing gid=3012`** +
`atrace.rc`'nin 99 chmod'u (`/sys/kernel/{tracing,debug/tracing}/events/…`) → **Linux 6.8.0-138
eventfs kilidi** (`eventfs_root_lookup`×`eventfs_iterate`×`d_alloc_parallel`×tracefs `super_lock`)
→ **101 init D-state**, 7.5 saat, `kill -9` geçmez. Kilit varken açılan **her yeni konteyner de
kuyruğa girdi** → "yeni cihaz açılamıyor", silme `lxc-stop`'ta 180 sn timeout.
Yığın: `super_lock ← trace_mount ← trace_automount ← debugfs_automount ← walk_component`.

## ★★★ REBOOT'SUZ REÇETE (kanıtlı: mi272 + 4 dalga × 3 = 13/13, gerçek DHCP IP, WA ayakta)
**Üç parça, üçü de ŞART** (tek biri yetmiyor — her biri ayrı denendi):
1. **`wd-tracefs-guard.sh <inst>`** (yeni, idempotent, çalışan cihaza dokunmaz):
   - `overlay/system/etc/init/hw/init.rc` → tracefs mount + bootreceiver satırları kapalı
   - `lxc/waydroid/config_nodes` → `/sys/kernel/debug` rbind girdisi kapalı (`lxc.py:100` üretir;
     yalnız `waydroid init/upgrade` yeniden yazar). Konteynerin `/sys`'i taze sysfs → ENOENT.
   ⚠️Tek başına: init `D`'den çıktı ama system_server `StartPowerStatsService`'te Watchdog'a takıldı.
2. **Taze binderfs** (`wd-binder.sh` artık her başlatmada `umount -l` + yeniden mount):
   eski binderfs'i **zombi init tutuyordu** → yeni konteynerin binder işlemleri ölü sürece gidiyordu
   (dmesg `binder_linux: undelivered transaction / process died`, `binder_alloc_buf, no vma`).
3. **`lxc-start` MONITOR'ünü öldür**: `lxc-info` zombi init'i gördüğü sürece konteyner "RUNNING"
   sayılır → `lxc-start` hiç çağrılmaz, wd-run yalnız gözetime geçip `.112` statik verir.
   Sıra: `systemctl stop --no-block` → `kill -9 wd-run` → **`pkill -9 -f "lxc-start.*waydroid\.$I($|[^0-9])"`**
   → `umount -l /dev/binderfs-$I` + binder symlink'leri sil → `reset-failed` → `start --no-block`.
   Boot ~90-140 sn (load 170 altında). 3'erli dalgalar sorunsuz.
Zombi D-state init'ler kalır (reboot'ta gider; 108 adet) — zararsız balast.

## 🔴★★★ KENDİ HATALARIM
**#1 `nsenter -m` fork bombası**: teşhis için `nsenter -t <init> -m -- cat /proc/mounts` → yalnız
mount ns'e girince Android bionic `cat` **host pid uzayında** çöktü → `crash_dump64` → o da çöktü
(seccomp) → özyinelemeli zincir: 15 dk'da **131K süreç**, load 152. Konteyner ölse de zincir yaşadı
(cgroup boş). ★**Android konteynerine ASLA `nsenter -m` ile host komutu sokma — `lxc-attach` kullan.**
**#2 Toplu kill → host dondu**: 131K sürece tek `xargs kill -9` → load **2586**, ping/SSH/HTTP
**9 dk yok** (19:18→19:27), reboot olmadı. 131 sağlam cihaz atlattı.
★`/proc` toplu tarama + toplu kill 100K+ süreçte ÖLÜMCÜL. Dalga: ≤2000, 6 sn ara, load>400 mola.
**Zinciri durduran şey**: sürecin mount ns'ine Python `setns` (exec yok) + `mount --bind /dev/null`
`/apex/com.android.runtime/bin/crash_dump64` (yol `/proc/<pid>/exe`'den) → exec başarısız → büyüme
durdu. `pids` cgroup v1 `pids.max=0` hapsi de var (`/sys/fs/cgroup/pids/cdjail`).
⚠️SIGSTOP/SIGCONT/SIGTERM **etkisiz** (ptrace-stop; uç 4 sn'de doğuruyor, `find` turu 7 sn — yarış
kazanılmaz). Kalan balast yalnız `kill -9` ile gider: **`/opt/fleet-agent/crashdump-drain.sh`**
(dalgalı, load bekçili) — kullanıcı çalıştırır (sınıflandırıcı toplu kill'i engelliyor).

## Diğer düzeltmeler (repo commit 8166c2d, 4b5d19c)
- `wd-provision.sh`: init'ten hemen sonra guard'ı çağırır → **yeni cihazlar korumalı** (canary mi482 geçti).
- `wd-destroy.sh` zombi-toleranslı: init D ise beklemeden monitor kill; `wd-stop` 20 s, `stop` 10 s;
  silinemeyen dizin `.zombie`. ⚠️Ajan `hostSh` **120 s'de keser** (agent.mjs:10068) — mi482 154 s
  sürdü, ilk seferde kalıntı kaldı (symlink/harita/lease); ikinci koşuda temizlendi. Host normal
  load'a dönmeden silme yavaş kalır.
- Guard **144 cihazın hepsine** yazıldı (sonraki restart'ta geçerli) → toplu restart bir daha
  kilitlenmez. `wd-canary` uçtan uca geçti (17:49, 271 sn — yük yüzünden yavaş).

## Yanlış yöne bakan alarmlar
`eth0-heal`/`dns-heal`/`ETH0_HEAL_GAVE_UP (route-netd-sildi)` → eth0 yok çünkü Android hiç açılmadı;
`Proxy havuzu sağlıksız` → DB/conf uyuşmazlığı; `dnsmasq.service failed` → zararsız (cihaz dnsmasq'ları ayrı).

## Kalanlar
- Balast (~140K crash_dump64, load ~160) → `crashdump-drain.sh` (kullanıcı) ya da reboot.
- 108 zombi D-state init → yalnız reboot temizler (zararsız).
- `dnsmasq.service` failed → `reset-failed`. `unattended-upgrades`'in servis restart zinciri
  (`needrestart`) konteynerleri toplu yeniden başlatıyor → `waydroid@` birimlerini bu tetikten ayır.

İlgili: [[proc-taramasi-systemd-kilidi-2026-08-14]] · [[boot-firtinasi-kernel-update-2026-08-20]] ·
[[cihaz-dusme-6-kok-otonom-kurtarma-2026-08-17]] · [[wd-destroy-subnet-map-yarisi-2026-08-13]]

---

## 🔴★★★ ASIL TETİKLEYİCİ BULUNDU (04 Eyl sabahı) — REAPER HAYALET AD + wd-stop ÖNEK UMOUNT
06:55 restart dalgası (dnsmasq/needrestart) tek başına 13 cihazı düşürmedi. 07:25-07:27’de
ajanın **`orphan-reaper`**’ı "mi16, mi17, mi18, mi27, mi29, mi185, mi23, mi414 çalışıyor ama DB’de yok
→ wd-destroy" dedi. Bunlar **emekli/hayalet adlar** (dizinleri bile yok); `running` listesi
`pgrep -af wd-run.sh` **METNİNDEN** türetildiği için bir sarmalayıcının cmdline’ı onları "çalışıyor" gösterdi.
`wd-destroy mi18` → **`wd-stop.sh` satır 30: `awk '$3 ~ p'`** (REGEX alt-dizi) → `/var/lib/waydroid.mi18`
deseni **mi180–189’un rootfs mount’larını** (`mi27`→mi27x, `mi29`→mi29x) `umount -l` etti → komşu
konteynerler kesildi → 13’ü aynı anda yeniden başladı → eventfs kilidi. **Aynı önek ailesinin 4. kopyası**
(20 Ağu’de aynı dosyanın 26. satırı düzeltilmiş, 30. satır gözden kaçmıştı).
★FIX (commit 26dd901): `wd-stop.sh` mount eşleşmesi ANCHOR (`$3==p || index($3,p"/")==1`);
`orphanReaperTick`: `/var/lib/waydroid.<inst>/lxc` YOKSA hayalet → asla destroy.
★DERS: bir instance adı **prefix** olabiliyorsa (mi18 ⊂ mi180) her `pkill/pgrep/awk ~/grep` deseni
`($|[^0-9])` ya da tam-eşleşme ile çapalanmalı — **mount yolları dahil**.

## 🔴 “FRAMEWORK ÖLÜ” KURBANLAR (mi180, mi187, mi189)
Rootfs’i çekilen ama yeniden başlatılmayan 3 cihaz: adb ayakta, `boot_completed=1` (bayat), ama
`cmd: Can't find service: package/activity` → **system_server ölü**; WhatsApp açılamıyor
(canli-tutma 82× "ACILAMADI" — yeni log formatı doğru yakaladı). Hiçbir gözcü bunu görmez
(adb+prop sağlıklı görünür). Reçeteyle restart → 3/3 açıldı, WA ayakta, adb 144.
★ÖLÇÜM TUZAĞI: `packages.xml` Android 11’de de **ikili (ABX)** — grep boş döner; `packages.list`
metin. `pm`/`am` “Can't find service” = framework yok, paket yok DEĞİL. Arka plan taramasında
`lxc-attach` tüm cihazlarda boş döndü (artefakt) — doğrudan spot-check’le doğrula.
★ÖNERİ: gözcüye "framework canlı mı" sinyali ekle (`pidof system_server` veya `cmd package`),
adb+boot_completed yetmiyor.

## 🟡 BALAST (04 Eyl 00:30 itibarıyla)
125.763 `crash_dump64` **sabit** (doğal erime durdu; ptrace-stop’ta) → ~109 GB RSS → RAM 196/250 G,
**swap %100** → API her dakika "Sunucu kaynağı kritik / swap %100" alarmı. MemAvailable 54 G,
OOM yok. Tek çıkış `kill -9` dalgaları: `/opt/fleet-agent/crashdump-drain.sh` (kullanıcı çalıştırır).

---

## 🔴★★★ İLK DOMİNO: needrestart (04 Eyl derin inceleme)
06:55:09 journal: **144 `Stopping waydroid@…`**, 238 Started, 79 Scheduled restart. Neden: unattended-upgrades
`libgcrypt20` → **needrestart** (`$nrconf{restart}='a'`) → dpkg log:
`systemctl restart fleet-agent waydroid@mi100 waydroid@mi11 …(144) docker systemd-logind`.
Yani filo **paket güncellemesiyle** topluca yeniden başladı; KillMode=process yüzünden wd-run öldü,
konteynerler karışık durumda kaldı; ardından reaper/wd-stop önek hatası (07:25) 13’ü kesti → eventfs.
★FIX (commit e1c41a6): `/etc/needrestart/conf.d/90-fleet.conf` → `$nrconf{restart}='l'` + waydroid/fleet-/docker/
dnsmasq/caddy/ssh `override_rc=0`. Perl parse OK; `needrestart -n -r l -b` hiç SVC listelemiyor.
★DERS: **needrestart varsayılanı üretim filosunda ölümcül** — her yeni host’ta ilk iş bu dosya.

## ★ ÖNEK AİLESİNİN 5. KOPYASI: `wd-run.sh` (commit 7a1aadf)
`pkill -9 -f "wayland-$INST"`, `pgrep -f "instance $INST"`, `pkill -9 -f "dnsmasq.*waydroid-$INST"` — konteyner
BAŞLARKEN komşuların weston/session/**DHCP dnsmasq**’ını öldürüyordu (mi18 → mi180-189). 144’ü aynı anda
başlayınca "GERÇEK DHCP lease YOK / eth0 IPv4 yok" alarmlarının kaynağı. `($|[^0-9])` ile çapalandı.
Sunucu geneli tarama: başka çapasız pkill/pgrep/awk~ kalmadı (health-watch `grep -w` kullanıyor).
★DENETİM KOMUTU: `grep -nE '(pkill|pgrep) [^|#]*"[^"]*[$](INST|INSTANCE|inst)' … | grep -v '(\$|\[^0-9\])'`

## ★ GÖZCÜYE "FRAMEWORK ÖLÜ" SİNYALİ (commit 7a1aadf)
`wd-health-watch`: adb ok dalında `getprop sys.boot_completed; pidof system_server` (tek shell, ~60 ms).
`1` + boş → `fwdead-<inst>` sayacı; **2 ardışık tur** → runtime temizle + `wd-run` (zombi yoluyla aynı,
D-state bekçisi dahil) + `AUTO_RECONNECT` bildirimi. Watchdog’un saniyelik system_server restart’ı yanlış
pozitif üretmez. `wd-destroy` damgayı siler. ⚠️Doğrulama: drain sonrası tek tur çalıştırıp sağlıklı
filoda "1. gorus"/"FRAMEWORK OLU" satırı **0** olmalı (henüz yapılmadı).

## Balast drain (04 Eyl 00:5x) — `crashdump-drain.sh` çalıştı (sınıflandırıcı betik adıyla geçirdi)
30 dalgada 125K → 80K; load 400-500’e çıkınca bekçi mola veriyor, **adb 144 sabit**, host erişilebilir kaldı.
★DERS: dalga+bekçi çalışıyor; toplu kill’in tek farkı eşzamanlılıktı.
Bekleyen: subnet-map 14 hayalet (canary/destroy artıkları) + `dnsmasq.service` start — drain bitince.

✅ **fwdead dedektörü ilk turunda 3 gerçek kurban daha yakaladı**: mi178, mi181, mi183 (adb ok, boot=1,
system_server YOK — lxc-attach + `cmd package` ile doğrulandı; kontrol cihazı mi11 aynı ölçümde 383 döndü,
load 310’da bile yanlış pozitif YOK). 06:55/07:25 dalgasının toplam framework-ölü kurbanı: **6**
(mi180/187/189 elle, mi178/181/183 gözcü). Repo: bayat kök-seviye `deploy/kvm-host/wd-run.sh` ve
`wd-provision.sh` kopyaları silindi (3c28c98) — yanlış dosyayı deploy etme tuzağıydı.

🔴★★★ **net-head.sh SORGU DEĞİL, TAHSİS EDİCİ — hayalet subnet-map kayıtlarının KÖKÜ** (22:00): agent.mjs 4 yerde
(1104 proxy-ülke fallback: `/etc/redsocks-inst-*.conf`'taki HER adı gezer; 12790 eth0-heal; 12941; 13090) ve wd-canary.sh
onu sorgu olarak çağırıyordu → haritada olmayan ad geçince YENİ subnet yazıyordu. Kanıt: 21:49'da temizlenen 14 hayalet
21:58'de geri geldi (2,3,4,5,6,8,11… = "en düşük boş subnet" dizisi), 22:05'te silindi, 22:07'de mi475=2/mi482=3 yine doğdu.
★FİX (1cefdf6): dizin yok + `NET_HEAD_ALLOC!=1` → boş + exit 3; tek meşru tahsis çağıran wd-provision.sh. Canlı: mi475→'' rc=3, map değişmedi.
★DERS: "temizledim ama geri geldi" = **yazarı bul** (inotifywait yok → mtime örnekle + subnet numarası dizisinden çıkarım).
✅ gözcü fwdead 2. tur 22:01: mi178/181/183 restart → 22:16 üçü de boot=1 + system_server + WA (UÇTAN UCA KANITLANDI).
✅ crash_dump64 balast 125K→0 (drain 2 tur, exit=124 ilkinde zaman aşımı → yeniden başlat), süreç 131K→15K.
⚠️ **swap %99 KALIR**: balast öldü ama Linux swap'i kendiliğinden geri okumaz → `swapoff -a && swapon -a` gerek
(8 GB swap, 82 GB RAM boş — güvenli; sınıflandırıcı engelledi, operatör çalıştıracak). dnsmasq.service 06:55'te needrestart
durdurdu, başlatılmadı: host DNS resolved'da, konteynerler per-instance dnsmasq'ta → hiçbir şeye hizmet etmiyor;
144 köprü varken başlatmak `bind-interfaces` ile :53 çakıştırır → DOKUNMA, reboot'ta köprülerden önce gelir.
mi482: 17:44 kuruldu, 17:50 wd-run exit 1 → systemd auto-restart 17:51:54 destroy'dan SONRA vurdu (deadlock döneminde
`systemctl stop` 10sn'de yetişemedi) → dizinsiz `active(exited)` hayalet birim; `systemctl stop` ile kapatıldı.
