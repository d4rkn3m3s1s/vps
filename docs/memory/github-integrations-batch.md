---
name: github-integrations-batch
description: "7 techniques ported from researched GitHub repos (2026-06-27) — H.264 stream, inbucket mail, prompt-cache/pruning, reflection+grid, proxy scoring, warmup cadence, fingerprint/integrity jobs"
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

After a multi-agent workflow surveyed 59 GitHub repos (58 verified) for our cloud-phone/farm
platform, ported 7 techniques (NOT whole repos — technique-only, respecting zero-dep agent +
secrets-server-side + multi-tenant). All tsc-clean (api+dashboard exit 0). Builds on [[ai-device-agent]].

1. **Low-latency H.264 stream** (ya-webadb/scrcpy): opt-in `FLEET_STREAM_H264_RAW=1` → agent
   `startCaptureH264Raw` emits raw Annex-B from `screenrecord` (NO ffmpeg transcode), framed
   `H264`(4)+deviceId(36)+flag(1)+NAL. `classifyH264Chunk` sets flag bit0=IDR/bit1=SPS-PPS.
   `stream.hub` caches the config chunk per device (`h264Config` map) + replays to late viewers,
   forwards flag+bytes. `LiveScreen.tsx` decodes via WebCodecs `VideoDecoder`→`<canvas>`; JPEG
   `<img>` stays the fallback (detect H.264 by start-code after flag byte). `toDevice` reads the
   visible surface (canvas vs img). Default path unchanged (FFMPEG MJPEG, then PNG).
2. **Inbucket self-hosted mail** (replaces catchmail SaaS): `mail.provider.ts` got a `provider`
   field ('catchmail'|'inbucket') branching `listMessages`/`getMessage` endpoint shapes
   (inbucket: `/api/v1/mailbox/{name}` + `/{name}/{id}`). `accounts.service mailCfg()` reads
   `MAIL_PROVIDER=inbucket`. agent `fetchEmailCode` honors `FLEET_MAIL_PROVIDER=inbucket`.
3. **Anthropic loop hygiene** (anthropic-quickstarts): `ai.service callToolLoop` now sends
   `system` + last tool with `cache_control:{type:'ephemeral'}` (prompt caching). `device-agent
   driveRun` calls `pruneOldImages(messages,3)` before each turn — strips stale base64 screenshots.
4. **Reflection + grid fallback** (MobileAgent/AppAgent): `driveRun` compares post-action tree to
   the acted-on tree; if unchanged on a tap, appends a "screen DID NOT CHANGE" note. New `tap_grid`
   action (AGENT_TOOLS + agent `execAgentAction`); `buildScreenTree` returns a grid hint on empty screens.
5. **Proxy scoring** (proxy_pool, lifecycle only): `Proxy` gained `score`/`failCount`/`checksDue`
   (migration `20260627100000_proxy_scoring`). `proxy.service check()` rewards/penalizes score,
   schedules next check by health; new `revalidateDue(limit)` + a 600s ticker in `index.ts`.
   `autoAssignGeoMatched` orders by score desc. (Did NOT import free-proxy scraping.)
6. **Human-cadence warmup** (tiktok-warmup): `farm.service` `humanDispatchChance(actionsToday,cap,
   hour,from,to)` (fatigue × time-of-day bell) gates each tick — on skip logs `cadence_skip` +
   reschedules sooner. `shadowBanProbe` (~8%/dispatch) flags healthy-looking-but-stalled accounts.
7. **Fingerprint→device + integrity** (AndroidFaker/PlayIntegrityFix): new JobTypes `APPLY_FINGERPRINT`
   + `PROVISION_INTEGRITY` (3 places + migration `20260627110000_fingerprint_integrity_jobs`). agent
   `applyFingerprint` setprops model/build/serial + android_id; `provisionIntegrity` sets BASIC
   integrity props + reports STRONG impossible on emulator. API: `fingerprintService.applyToDevice`/
   `provisionIntegrity` → routes `POST /fingerprints/:deviceId/apply` + `/provision-integrity`.

**Legal:** #6 (engagement automation), #7 (identifier spoofing / integrity bypass) are platform-ToS
violations / legally risky — own consented fleet + workspace quota only. Migrations apply on stack
start ([[local-stack-startup]]); DB was down at build time so they're pending-but-idempotent.
