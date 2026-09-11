---
name: yayin-watchdog-connecting-olu-kilit-2026-08-04
description: "🔴★★★YAYIN 2.5 GÜN ÖLÜYDÜ: watchdog CONNECTING(0)'da SÜRESİZ return ediyordu + connecting bayrağı asılı kalıyordu→connect() ebediyen bloklu=ÖLÜ KİLİT, tek çare elle restart. ★★TEŞHİS SIRASI: API'de 'Stream agent connected' logu HİÇ yoksa sorun AGENT'ta; aynı anahtarla elle WS testi 1sn'de bağlanırsa anahtar/ağ SUÇSUZ. ★TUZAK:`connectStartedAt &&` truthy kontrolü zaman aşımını SESSİZCE atlar."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T00:45:28.119Z
---

# Yayın kendi kendine geri gelmiyordu — watchdog ölü kilidi (4 Ağu 2026)

## Belirti
Panelde `Bağlanıyor…` → *"Sunucu aracısı çevrimdışı görünüyor — yayın
başlatılamadı"*. Operatör notu kritikti: **"restart'tan önce de kopuktu"** —
yani API yeniden başlatması sebep değil, sadece dikkat çeken andı.

## Canlı kanıt
- Agent 1 Ağu 06:19'da bağlandıktan sonra **2.5 GÜN** stream soketi ölü kaldı.
- `/var/log/fleet-agent.log`'da ne `stream channel connected` ne
  `yeniden bağlanılıyor` vardı → **watchdog hiçbir şey yapmadı**.
- API'de `Stream agent connected` logu **30 Tem'den beri 0 kez**.
- Ama agent'ın 4000'e ESTAB soketi VARDI (iş kuyruğu HTTP'si) → "agent ayakta"
  yanılsaması. Filo/heartbeat sağlıklı raporlanıyordu.

## ★★ TEŞHİS SIRASI (bir daha aynı belirtide bunu izle)
1. `journalctl -u fleet-api | grep -c "Stream agent connected"` → **0 ise sorun
   AGENT tarafında**, API'de değil. (API bağlanan agent'ı MUTLAKA loglar.)
2. Aynı `FLEET_HOST_KEY` ile elle WebSocket testi:
   `ws://127.0.0.1:4000/ws/agent-stream?key=<HOST_KEY>`
   **1 sn'de bağlanıp `stream.start` geldiyse** → anahtar, ağ, kimlik doğrulama,
   hub hepsi SUÇSUZ. Kalan tek yer: agent süreci.
3. Anahtar doğrulaması: `FLEET_HOST_KEY`'in sha256'sı = `Host.agentKeyHash`.
   (`/opt/fleet-agent/agent.env`, değişken adı **`FLEET_HOST_KEY`**.)

## KÖK NEDEN — watchdog'da üç kapalı kapı
`agent.mjs` → `startStreamClient()`:
1. `if (stream.readyState !== 1) return;` — soket **CONNECTING(0)**'da asılırsa
   watchdog her turda **süresiz** return.
2. `connecting` bayrağı true kalır; sıfırlanması **yalnızca**
   `onopen`/`onclose`/`onerror`'a bağlı — yarı-açık sokette hiçbiri ateşlenmez.
3. `connect()` de baştaki `if (connecting) return` ile **ebediyen bloklanır**.
→ **Kalıcı ölü kilit.** Tek çare elle `systemctl restart fleet-agent`.

⚠️ 28 Tem'de eklenen ping/pong watchdog bu senaryoyu **kapatmıyordu**: pong
denetimi yalnızca `readyState === OPEN` dalındaydı, CONNECTING oraya hiç ulaşmaz.

## Fix (commit `b86ac4b`)
- `CONNECT_TIMEOUT_MS = 20_000` + `connectStartedAt` → CONNECTING süre sınırına
  tabi; aşarsa `killSocket` → yeniden bağlan. Blok **watchdog'un BAŞINDA**
  (diğer dallar erken return ettiği için sonda çalışmazdı).
- `killSocket()` artık `connecting = false` yapıyor (ölü kilidin ikinci yolu).
- `onopen`/`onclose`/`onerror` → `connectStartedAt = 0` (aksi halde AÇIK soket
  sonraki turda haksız yere kill edilirdi).

## ★ TUZAK — truthy kontrolü zaman aşımını sessizce atlar
İlk yazımda koşul `if (connecting && connectStartedAt && ...)` idi.
`connectStartedAt = 0` hem "sıfırlandı" hem geçerli bir zaman damgası anlamına
gelebildiği için truthy kontrolü zaman aşımını **sessizce atlıyordu**.
İzole test yakaladı → koşul yalnızca `connecting`e bakacak şekilde düzeltildi.
**Ders: bir alanı hem "yok" hem geçerli değer için kullanma.**

## Doğrulama
- İzole regresyon **7/7**: eski kod 1 deneme yapıp ölü kilide giriyor; yeni kod
  10 dk'da 20 kez deniyor; **sağlıklı** ve **15 sn'de bağlanan** soket kill EDİLMİYOR.
- **Canlı**: API restart edildi (yeni PID), agent sürecine DOKUNULMADI
  (PID 1281842 aynı) → agent **5 sn'de kendi kendine** geri bağlandı.

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[on-ucus-yarim-deploy-dist-bayat-2026-08-04]] ·
[[dashboard-canli-liste-aboneliksiz-2026-07-28]]
