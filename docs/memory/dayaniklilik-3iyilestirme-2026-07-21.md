---
name: dayaniklilik-3iyilestirme-2026-07-21
description: ★WhatsApp API DAYANIKLILIK 3 İYİLEŞTİRME (2026-07-21, kullanıcı "daha stabil/kırılgan olmaktan çıkar" dedi). (1)MESAJ OTOMATİK-RETRY: reaper WHATSAPP_SEND timeout→kalıcı-FAILED yerine 2 kez re-dispatch(sendAttempt sayacı, broadcast-muaf), geçici agent-busy/proxy-blip kurtarılır. (2)AGENT SELF-WATCHDOG: dispatch-loop donarsa(çökmeden takılırsa, systemd-Restart=always göremez)→loopAlive damgası 5dk eskirse process.exit(1)→systemd restart. (3)KAYIT OTOMATİK-RETRY: register job1(numara-giriş) altyapı-FAILED(DEVICE_BUSY/timeout)→2 kez tekrar, ban/wall/SMS-red DENENMEZ(numara yakmaz). +reaper dedupeKey-null bug fix(mesaj-kayıt bug'ın kaçan ikizi). Hepsi tsc+build+restart+CANLI(agent restart=0, watchdog yanlış-tetiklemedi).
metadata:
  node_type: memory
  type: reference
---

# ★ WHATSAPP API DAYANIKLILIK — 3 İYİLEŞTİRME (2026-07-21) ★

Kullanıcı "whatsapp apisi stabil/daha kırılgan hale nasıl getiririz" dedi→3 alan seçti
(mesaj-güvenilirliği + cihaz/agent-dayanıklılığı + kayıt-başarı). Baseline canlı-ölçüldü:
OUT mesaj %37 FAILED(retry yok), agent Restart=always ama watchdog YOK, kayıt-FAILED retry-yok.
Detay [[denetim-24bug-fix-2026-07-21]] (aynı oturum, önce 24-bug denetimi).

## ✅ 0) BONUS BUG: reaper dedupeKey-null (mesaj-kayıt bug'ın kaçan ikizi)
- Canlı-tarama: 84 OUT-mesaj dedupeKey=NULL, bugün bile 9 üretilmiş→mesaj-kayıt fix'i(agent.service) TÜM OUT'u kapsamıyordu. KAÇAN YOL: jobs.service.ts reaper(takılı-send→FAILED-bubble) dedupeKey set-etmiyordu + `.catch(()=>undefined)` yutuyordu(agent.service'de düzelttiğim desenin eksik-ikizi). FIX: reaper create'e dedupeKey=sha256(out|dev|peer|body|ts) + logger.warn. sha256+logger import eklendi.

## ✅ 1) MESAJ OTOMATİK-RETRY (jobs.service.ts reaper)
- reaper bir WHATSAPP_SEND/MEDIA'yı timeout(stale)→FAILED yaparken: kalıcı-FAILED-bubble YERİNE önce re-dispatch(payload.sendAttempt+1, retryOfJobId, skipBusyCheck). attempt<MAX_SEND_RETRY(=2, 3 toplam deneme) iken retry, sonra kalıcı-FAILED. `continue`→bubble yazmadan sonraki job. broadcast MUAF(1000 mesaj re-queue yük-patlatır). Reaper-timeout doğası-gereği GEÇİCİ(agent-busy/proxy-blip); hard-reject(ban/no-chat) reaper'a değil agent-complete()'e gelir→retry sadece geçici-hatada.

## ✅ 2) AGENT SELF-WATCHDOG (agent.mjs)
- ★KÖK: systemd Restart=always sadece EXIT/crash yakalar, DONMA'yı(process-canlı ama dispatch-loop hung-await'te asılı: ölü-ADB-socket/proxy-blackhole/asılı-fetch) GÖREMEZ→agent "active" görünür ama hiç-job-çalıştırmaz, sahip-olduğu cihazlar sessizce durur.
- FIX: loop her iterasyonda `loopAlive=Date.now()` damgalar. Ayrı 30sn-timer(unref) damga>5dk(WATCHDOG_STALL_MS) eskiyse→`process.exit(1)`→systemd temiz-restart. Timer bağımsız(wedged-loop bloklayamaz). systemd Type=notify DEĞİŞTİRİLMEDİ(riskli)→self-watchdog daha güvenli+iş-ilerlemesini(sadece process-canlı değil) ölçer.

## ✅ 3) KAYIT OTOMATİK-RETRY (batch.service.ts autoRegisterWhatsApp job1)
- job1(numara-giriş→OTP-ekranı) altyapı-FAILED(DEVICE_BUSY/timeout/adb/ulaşılamadı)→2 kez tekrar(regAttempt sayacı, skipBusyCheck). OTP-ÖNCESİ olduğu için güvenli(numara-tüketilmedi, re-run numara-yeniden-girer).
- ★isTransientReg(): wall/not_installed/banned/reddet/engellendi/resmi-uygulama/couldn/sms-gönder→FALSE(retry-YOK, numara-yakmaz+ban-riski). busy/meşgul/timeout/command-failed/ulaşılamadı→TRUE. null(awaitJob-timeout)→transient.
- reachedOtp(status!=FAILED && (!res.status||OTP_WAIT))→başarı, retry-durur.

## 🔧 DEPLOY (hepsi CANLI 2026-07-21)
- 2 TS(jobs.service+batch.service)→host+build(tsc temiz)+fleet-api restart(health 200). agent.mjs→host+restart. dist'te MAX_SEND_RETRY/isTransientReg + agent WATCHDOG teyit. Yedekler *.bak.<ts>.
- CANLI: agent restart=0(watchdog yanlış-tetiklemedi), runtime-hata yok, job-akışı normal.

## ⚠️ NOT / KALAN
- Baseline: OUT %37-FAILED, 22-FAILED-hesap(7 altyapı-retry-ok/5 ban/10 diğer). Retry'ler yeni-kayıtlarda etki gösterecek(eski FAILED geri-gelmez).
- Ban'a-karşı-dayanıklılık(rate-limit/warm-up/insan-benzeri/günlük-limit) YAPILMADI(kullanıcı seçmedi, 4. seçenekti).
- HÂLÂ git commit edilmedi(bu iş de dahil).
