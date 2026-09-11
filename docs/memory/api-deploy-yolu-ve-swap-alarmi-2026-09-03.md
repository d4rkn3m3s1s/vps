---
name: api-deploy-yolu-ve-swap-alarmi-2026-09-03
description: fleet-api sunucuda git checkout DEGIL (/opt/fleet/apps/api, npm start=node dist/index.js); guvenli deploy recetesi (src kopyala, tsc --outDir /tmp/dist.new, overlay, restart 4sn, stream kendiliginden baglanir) + swap alarmi yanlis "RAM tukeniyor" diyordu (a7958c4)
metadata:
  type: project
---

# fleet-api deploy yolu (3 Eyl 2026'da olculdu)

- Sunucuda **/opt/fleet git checkout DEGIL** — `/opt/fleet/apps/api` yalnizca dosya kopyasi. `systemctl cat fleet-api`:
  WorkingDirectory=/opt/fleet/apps/api, ExecStart=`npm start` (= `node dist/index.js`), node v22. Sirlar (proxy
  kullanici/sifre, thordata token) **drop-in `Environment=` satirlarinda** — `systemctl cat` ciktisina DUSER, dikkat.
- Sunucudaki `src/index.ts` md5'i repo'daki HEAD ile birebir esti (senkron); ama eski `dist/`'te src'si olmayan
  **22 olu .js** (cloud-providers/costs/library/referral/trends/usage, 15 Tem) duruyor — tsc ciktisi 204 dosya.
- ★RECETE (kanitli, kesinti ~4 sn): (1) `scp src/x.ts → /tmp/x.new`, md5 esle; (2) `.new + mv` ile src'ye koy;
  (3) `npx tsc -p tsconfig.json --outDir /tmp/dist.new` (23 sn, canli dist'e DOKUNMADAN); (4) `grep` ile yeni mantigin
  dist.new'de oldugunu kanitla; (5) `cp -r /tmp/dist.new/. dist/` (overlay — olu dosyalari silme, referans yok ama risk alma);
  (6) suren WA kaydi YOKSA `systemctl restart fleet-api` → 4 sn'de saglikli; (7) **agent stream kanali 2 sn'de
  KENDILIGINDEN baglandi** (`stream channel connected`) — 12 Agu'daki "agent restart gerek" notu artik gecerli DEGIL.
- ⚠️ load>100 iken `docker exec ... psql` 30-70 sn asiyor/asiliyor → `timeout -s KILL`, SQL'i heredoc dosyadan ver
  (tirnak kacislari `'` ile BOZULUYOR). Enum degerleri: DeviceStatus'ta `DELETED` YOK, JobStatus'ta `PROCESSING` YOK,
  AlertEvent'te `type` sutunu YOK (title/detail/ruleId).

# Swap alarmi yanlis "RAM tukeniyor" diyordu (a7958c4)

`index.ts` HOST_SATURATED: `swapping = swapPct >= 20` TEK BASINA → crash_dump64 balasti 8 GB swap'i doldurdu,
balast temizlenince RAM 82/250 GB bosken swap %99 kaldi (Linux geri okumaz) → her dakika "YENI CIHAZ KURMAYI
DURDURUN". FIX: `&& (ramPctFree === null || ramPctFree < 30)`; mesaja RAM yuzdesi eklendi. Kanit: restart oncesi
her 60 sn'de 1 alarm, restart sonrasi 0. Bayat swap'i temizlemek: `swapoff -a && swapon -a` (siniflandirici
engelledi → operator calistirir). Ilgili: [[eventfs-deadlock-ve-host-donmasi-2026-09-03]]
