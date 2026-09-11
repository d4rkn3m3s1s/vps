---
name: proc-taramasi-systemd-kilidi-2026-08-14
description: "SSH/systemd kilidinin KÖKÜ: ps -eo stat / top -bn1 gibi /proc TARAYAN komutlar. 14 Ağu'da 3 kilit, hepsi bundan. Fix: /proc/stat procs_blocked"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-14T20:39:10.908Z
---

**14 Ağustos 2026** — sistem **BİR GÜNDE ÜÇ KEZ** kilitlendi (sabahki kilit **5 SAAT** sürdü, 4 kez power cycle gerekti). Üçünün de kökü **TEK** ve beklenmedikti.

## Kilidin imzası (bunu görürsen bu sorundur)

- `systemctl` yanıt vermez → `Failed to retrieve unit state: Connection timed out`
- **SSH girişi açılmaz** ama port 22 AÇIK görünür (`Test-NetConnection` = True)
- **API 200 dönmeye DEVAM EDER** (0.40 sn) — zaten çalışan süreç, `/proc`'a dokunmuyor
- Cihazlar çalışmaya devam eder (WhatsApp mesajı bile geldi)

## ★★★ KÖK SEBEP

Yük frenim (`wd-boot-gate.sh`) her 12 saniyede **`ps -eo stat | grep -c "^D"`** çalıştırıyordu.
`ps -e` **`/proc` altındaki TÜM süreçleri tarar** — bu hostta on binlerce.
76-156 cihaz aynı anda kapıda beklerken = **76-156 eşzamanlı `/proc` taraması**.

`/proc` tıkanınca zincir: systemd tıkanır (o da `/proc` okur) → `systemctl` ölür →
**SSH girişi ölür** (PAM → `pam_systemd` → logind D-Bus) → yönetim tamamen kör kalır.

**Yani "yük freni"nin KENDİSİ yükü yaratıyordu.**

⚠️ **KANIT:** 22:22:37'de sistem **BOMBOŞ**tu (D=2, load=33, CPU %85 boşta). 76 cihaz
tetiklendi → **90 saniyede** SSH tamamen kilitlendi.

## Aynı hata İKİNCİ yerde: `top -bn1`

`ps`'i temizledim ama izleyicide (`wd-izle.sh`) `top -bn1` kalmıştı — o da `/proc`'un
tamamını tarar. İzleyici her 20 sn bunu çalıştırınca **kendisi tıkanma kaynağı oldu**
ve 22:57'de kayıt durdu (sayfa bayatladı, kör kaldık).

## FIX

Çekirdek bu sayıyı zaten tutuyor: **`/proc/stat` → `procs_blocked`** = D-state sayısı.
Tek küçük dosya okuması, tarama YOK (~1000× ucuz).

```bash
dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat; }
```

CPU boşta oranı da `/proc/stat` iki ölçüm farkından hesaplanır (`top` gerekmez).

**KURAL:** Bu hostun betiklerinde `/proc` TARAYAN hiçbir komut olmayacak —
`ps -e`, `top`, `pgrep -f`, `lsof` **YASAK** (tek seferlik acil kullanım hariç).

## ★★ ASIL SİNYAL: systemd yanıt süresi

D-state ve load **YANILTICI** — kilit anlarında D=1-6 ve CPU %60-85 BOŞTA idi.
Frenim D-state'e bakıyordu, bu yüzden hiç tetiklenmedi.

Doğru ölçüm:
```bash
S=$(date +%s%N); timeout 8 systemctl is-system-running >/dev/null 2>&1; E=$(date +%s%N)
MS=$(( (E-S)/1000000 ))   # sağlıklı: 8-30ms | tıkalı: 5000ms+ / timeout
```

## İkinci tuzak: load eşiği

Kapıda `load ≤ 110` şartı vardı. **load=118.74 iken D=0 ve CPU %60.4 BOŞTA** —
37 cihaz boşuna bekliyordu, filo **88'de takılmıştı**. Load bu hostta anlamsız
(Waydroid uyuyan thread'leri load'a sayar). Load kapıdan çıkarılınca filo **156/156** oldu.

İlgili: [[cpu-alarm-load-yaniltici-2026-08-05]] · [[kurtarma-sistemi-ssh-siz-2026-08-14]]
