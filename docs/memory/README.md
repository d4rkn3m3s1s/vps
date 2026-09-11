# Proje Hafızası (Claude Code memory arşivi)

Bu dizin, bu filoyu işleten Claude Code oturumlarının **kalıcı hafızasının** repoya
alınmış kopyasıdır. Amaç: repoyu başka bir makinede klonladığında tüm operasyonel
birikim (kök nedenler, tuzaklar, reçeteler) yanında gelsin.

## Bu nedir, neden değerli

207 not dosyası, Temmuz–Eylül 2026 arası yaşanan **gerçek arızaların** kayıtları.
Her not şu kalıpta: belirti → yanlış hipotezler → ölçüm → kök neden → düzeltme → ders.

Kod okumakla öğrenilemeyecek şeyler burada. Örnekler:

- `eventfs-deadlock-ve-host-donmasi-2026-09-03.md` — Linux 6.8 tracefs çekirdek
  oops'u; `kill -9` neden işe yaramaz, hangi üç parçalı reçete 13 cihazı reboot'suz
  kurtardı.
- `reboot-iki-kilit-temizlendi-2026-09-11.md` — ikinci kilit sınıfı (`path_mount`),
  `nohup systemctl reboot`'un SSH kapanınca ölmesi, doğrusu `shutdown -r +1`.
- `proxy-bind-kesintisi-ve-killmode-2026-08-22.md` — `KillMode=control-group`
  141 redsocks'u öldürdü; daemon başlatan her oneshot'a `KillMode=process`.
- `derin-inceleme-gonderim-quic-hayalet-2026-08-25.md` — QUIC/UDP sızıntısı:
  Waydroid kuralları **legacy** iptables'ta, koruma **nft**'ye yazılıyordu.
- `ban-koku-cevapsizlik-2026-08-15.md` — ban kökü hacim/yaş/proxy değil,
  **cevapsızlık oranı**.

`MEMORY.md` bu arşivin indeksidir — önce onu okuyun.

## Tekrar eden tuzaklar (bu projede defalarca ısırdı)

- **Önek eşleşmesi**: `mi18` deseni `mi180-189`'u da yakalar. Altı ayrı kopyası
  felakete yol açtı. Desenleri `($|[^0-9])` ile çapala.
- **Tırnaklı heredoc ters bölüyü yiyor**: satır devamı `\n` metnine dönüşür ve
  `bash -n` bunu YAKALAMAZ. Tek satır yaz, `cat -A` ile bayt denetimi yap.
- **`systemctl start` bu birimlerde NO-OP** (`active(exited)`) → `restart` gerekir.
- **`procs_blocked` mount kilitlerini göstermez** — CPU boşta görünürken sistem kilitli
  olabilir.
- **`ps -eo` / `top -bn1` / `lsof` yasak** — bu makinede SSH'ı ve systemd'yi kilitler.

## ⚠️ Sırlar maskelendi

Bu kopyadaki **gerçek kimlik değerleri yer tutucularla değiştirilmiştir**:

| Maskelenen | Yer tutucu |
|---|---|
| thordata kullanıcı adları | `td-customer-<TR_MOBILE_USER>` / `<AL_RESIDENTIAL_USER>` |
| proxy şifreleri | `<PROXY_PASS>` |
| API anahtarları | `flk_<API_KEY>` / `API_KEY=<API_KEY>` |
| Telegram bot token | `<TELEGRAM_BOT_TOKEN>` |
| proxy host kimliği | `<PROXY_HOST_ID>` |

Notların **öğretici değeri korundu** (hangi hesap, hangi port, hangi mekanizma
yazıyor kaldı); yalnızca kullanılabilir sır değerleri çıkarıldı.

Gerçek değerler sunucuda durur: `/opt/fleet-agent/agent.env`,
`/etc/systemd/system/fleet-api.service.d/proxy.conf`, `/etc/redsocks-inst-*.conf`.
Bunlar haftalık yapılandırma yedeğine dahildir (`fleet-config-backup.sh`).

## Başka bir makinede kullanmak

Claude Code'un hafızayı okuyabilmesi için dosyaların proje hafıza dizininde olması
gerekir. Klondan geri yüklemek için:

```bash
# Linux / macOS
mkdir -p ~/.claude/projects/<proje-dizin-adi>/memory
cp docs/memory/*.md ~/.claude/projects/<proje-dizin-adi>/memory/
```

```powershell
# Windows
$dst = "$env:USERPROFILE\.claude\projects\<proje-dizin-adi>\memory"
New-Item -ItemType Directory -Force $dst
Copy-Item docs\memory\*.md $dst
```

`<proje-dizin-adi>` Claude Code'un proje yolundan türettiği addır (bu projede
`c--Yeni-klas-r-vps`). Doğrusunu görmek için `~/.claude/projects/` içine bakın.

Geri yükledikten sonra maskelenmiş değerleri kendi ortamınızdakilerle değiştirmeniz
gerekmez — notlar referans amaçlıdır, çalıştırılabilir yapılandırma değildir.

## Güncel tutma

Bu kopya **anlık görüntüdür**, otomatik senkron değildir. Oturumlar ilerledikçe
canlı hafıza değişir. Tazelemek için yukarıdaki kopyalamayı ters yönde yapın ve
**commit'ten önce sır taramasını tekrarlayın** — yeni notlar yeni sır içerebilir.
