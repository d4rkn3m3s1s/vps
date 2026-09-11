---
name: tracefs-kilidi-kurulum-yavaslamasi-2026-09-04
description: Kurulum 100sn -> 185sn yavaslamasinin KOKU = 3 Eyl cekirdek oops'undan kalan KALICI tracefs superblok kilidi (host'ta `mount -t tracefs` sonsuza asili); ayrica wd-run BOOT YARISI kurulumu tamamen COKERTIYORDU (6890d18 ile duzeldi)
metadata:
  type: project
---

# 4 Eylul 2026 — kurulum yavaslamasi: IKI AYRI SEBEP

## 1) wd-run BOOT YARISI (kod hatasi — DUZELTILDI, 6890d18)
Kurulumda wd-run.sh'i **iki yer** basliyor: `wd-provision.sh` (`systemctl start`, gozetimi
systemd'ye devretmek icin, 2026-08-18'de eklendi) ve `agent.mjs` (`hostShDetached wd-run.sh`).
Ikinci kopya "temizle" blogunu calistirinca birincinin container/session/dnsmasq sureclerini
olduruyor; systemd `Restart=on-failure` ucuncuyu aciyor; zincir buyuyor.
KANIT (mi484): run log'da **4 WATCHDOG_START**, satir 83/87 `kill -9 966863` + `kill -9 968864`,
journal `waydroid-mi484: Link DOWN` (+8sn) -> veth konteynerle gitti -> DHCP oldu
(9 re-kick, 142sn, statik-IP fallback) -> boot 360sn'de TIMEOUT, **canary "kurulum tamamlanmadi"**.
FIX: damga `/run/wd-boot-<inst>` EZILMEDEN once okunur; kilidi CANLI bir kardes wd-run tutuyorsa
ve damga <240sn ise yikim ATLANIR, yalnizca gozetim ustlenilir.
SONUC: `kill9` 2 -> **0**, boot 360sn(FAIL) -> 59sn; canary #3 ve #4 **GECTI**.
⚠️Yama sirasinda 2 tuzak: (a) tirnakli heredoc ters boluyu YIYOR -> satir devami `
` metnine
donusuyor ve **`bash -n` YAKALAMIYOR** (koruma sessizce hic calismazdi) -> kosulu TEK SATIR yaz,
regex'te `waydroid[.]` kullan; (b) ilk kosulum "konteyner ayakta" idi ama ikinci kopya +5sn'de
geliyor, konteyner HENUZ YOK -> dogru sinyal **canli kardes wd-run sureci**.

## 2) KALICI TRACEFS KILIDI (asil yavaslatan — REBOOT SART)
3 Eyl 07:29:26 cekirdek oops'u (`eventfs_set_attrs <- eventfs_remount <- tracefs_remount`)
tracefs superblok kilidini **kalici olarak tutulu** biraktı.
★★★CANLI KANIT (4 Eyl): host'ta `timeout 5 mount -t tracefs tracefs /tmp/tfs` **SONSUZA
ASILI** — `timeout` bile olduremiyor (D-state). Kiyas ayni anda: `lxc-attach` 26-39ms,
`mount --bind` 22-24ms, `adb shell` 24-28ms, `adb devices` 11ms — yani **sadece tracefs bozuk**.
**95 surec** bu kilitte asili (hepsi `init`, 3 Eyl 07:59-09:00 dogumlu),
`/proc/<pid>/stack` = `super_lock <- grab_super <- sget <- mount_single <- trace_mount`.
★Load bu yuzden sisti: 3 Eyl 06:30=16.8 -> 07:02=82.2 -> 09:30=129.4 -> o gunden beri 140-230.
**Hizli kurulumlarin HEPSI (99-116sn) load 9-19 iken olculdu.** CPU %84 BOSTA, io-wait %0,
`procs_blocked=0` (bunlar iowait DEGIL, duz kesintisiz bekleme — **hicbir alarm gormuyor**).
Faz kiyasi: mi479 (2 Eyl) 99sn = boot34/root8/vtouch7/proxy11/apks19 ·
mi486 (4 Eyl) 176sn = boot59/root14/vtouch11/proxy21/apks33 — **hepsi ~%75 buyudu**.
Yeni cihazin init.rc'sinde tracefs mount guard ile kapali olsa da Android'in tracefs'e dokunan
diger bilesenleri kilidin arkasina giriyor.
★★★**TEK COZUM REBOOT** (cekirdek kilidi kodla acilmaz).
✅REBOOT GUVENLIK DENETIMI YAPILDI (4 Eyl 03:20): **143 canli instance'in 143'unde de aktif
`mount tracefs` satiri YOK**, config_nodes debug 142/142 kapali -> reboot kilidi GERI GETIRMEZ.
⚠️mi272 elle yamanmis, isareti farkli (`FLEET:` vs `FLEET(tracefs-guard)`) — denetimi
isarete gore degil **aktif `mount tracefs` satirina** gore yap.
⚠️Reboot'ta 20 Agu boot firtinasini onleyen `wd-boot-gate.sh` var (yalnizca uptime<900sn
penceresinde kademelendirir) — reboot sonrasi filo hizasini DB ile dogrula.

Ilgili: [[eventfs-deadlock-ve-host-donmasi-2026-09-03]] · [[api-deploy-yolu-ve-swap-alarmi-2026-09-03]]
