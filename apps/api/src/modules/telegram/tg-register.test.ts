// tg-register çekirdeği için uçtan uca testler.
//
// Çalıştırma:  cd apps/api && npx tsx --test src/modules/telegram/tg-register.test.ts
//
// Sahte bir "dünya" kurulur: cihazlar, kapasite, hesaplar, kayıt işleri ve bir SAHTE AJAN
// (işler birkaç tur sürer, OTP'ye park eder, kodu kabul/ret eder). Üzerinde canlıdakiyle
// BİREBİR AYNI çekirdek (createTgRegister) çalışır; yalnız dış dünya sahtedir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTgRegister,
  parseEntryLines,
  parsePhoneLine,
  extractOtp,
  fmtPhone,
  looksLikeNumberList,
  cleanName,
  BLOCKING_ACCOUNT_STATUSES,
  DUPLICATE_ACCOUNT_STATUSES,
  type TgRegDeps,
  type RegStatus,
  type Phase
} from './tg-register.core';

// ── Sahte dünya ──────────────────────────────────────────────────────────────

type Outcome = 'otp' | 'method' | 'rate_limited' | 'failed' | 'manual' | 'banned';
type Script = { attempts: Outcome[]; otpResults: boolean[] }; // her kayıt denemesinin sonucu + her kodun kabul/ret'i

const CC: Record<string, string> = { '90': 'TR', '355': 'AL', '49': 'DE' };
const countryFromPhone = (p: string): string | null => {
  const d = p.replace(/\D/g, '');
  for (const len of [3, 2, 1]) if (CC[d.slice(0, len)]) return CC[d.slice(0, len)]!;
  return null;
};

type Msg = { id: number; kind: 'text' | 'photo'; text: string; buttons?: unknown; forceReply?: boolean };

function makeWorld(o: { idle?: Array<{ id: string; country?: string; hasActiveWa?: boolean }>; capacity?: number; defaultScript?: Script } = {}) {
  let t = 1_750_000_000_000;
  let msgSeq = 100;
  let idSeq = 0;
  const msgs: Msg[] = [];
  const edits: Array<{ id: number; text: string }> = [];
  const photoEdits: number[] = [];
  const captions: Array<{ id: number; caption: string }> = [];
  const devices: Array<{ id: string; name: string; status: string; metadata: Record<string, unknown> }> = [];
  const activeWaDevices = new Set<string>();
  for (const d of o.idle ?? []) {
    devices.push({ id: d.id, name: `wa-${d.id}`, status: 'ONLINE', metadata: { instance: `mi-${d.id}`, provisionStatus: 'READY', proxyCountry: d.country ?? 'TR' } });
    if (d.hasActiveWa) activeWaDevices.add(d.id);
  }
  const accounts = new Map<string, { id: string; deviceId: string; phone: string; status: string; otpChannel: string | null; otpRejected: boolean; attempt: number; otpTry: number; wall?: string }>();
  const jobs: Array<{ id: string; accountId: string; status: string; ticks: number; kind: 'register' | 'otp' | 'method'; code?: string; result: Record<string, unknown> }> = [];
  const provisions = new Map<string, { deviceId: string; ticks: number; fail?: boolean }>();
  const scripts = new Map<string, Script>();
  const live = new Map<string, { shot: string; ts: number; label: string; note: string }>();
  const calls = { createInstance: 0, startRegister: [] as Array<{ deviceId: string; phone: string; name: string | undefined }>, provideOtp: [] as string[], otpTargets: [] as string[], provideMethod: [] as string[], retry: 0, cancel: 0 };
  let failNextProvision = false;
  let capacity = o.capacity ?? 100;
  let store: string | null = null;
  const newId = (p: string) => `${p}${++idSeq}`;
  const scriptFor = (phone: string): Script => scripts.get(phone) ?? o.defaultScript ?? { attempts: ['otp'], otpResults: [true] };
  const SHOT = { label: 'otp_screen', ts: '', png: 'P'.repeat(300) };

  const completeJob = (j: (typeof jobs)[number]) => {
    const acc = accounts.get(j.accountId)!;
    j.status = 'COMPLETED';
    j.result = { shots: [SHOT] };
    if (j.kind === 'register') {
      const sc = scriptFor(acc.phone);
      const out = sc.attempts[Math.min(acc.attempt, sc.attempts.length - 1)]!;
      acc.attempt++;
      acc.otpRejected = false;
      if (out === 'otp') { acc.status = 'AWAITING_OTP'; acc.otpChannel = 'sms'; }
      if (out === 'method') { acc.status = 'AWAITING_OTP'; acc.otpChannel = 'method_select'; }
      if (out === 'rate_limited') { acc.status = 'AWAITING_OTP'; acc.otpChannel = 'rate_limited'; }
      if (out === 'failed') { acc.status = 'FAILED'; acc.otpChannel = null; }
      if (out === 'manual') { acc.status = 'AWAITING_MANUAL'; acc.otpChannel = null; }
      // Canlıdaki birebir hâl (26 Eyl): yanık numarada hesap FAILED, yasak bilgisi wallKind'da.
      if (out === 'banned') { acc.status = 'FAILED'; acc.otpChannel = null; acc.wall = 'BAN'; }
    } else if (j.kind === 'method') {
      acc.status = 'AWAITING_OTP'; acc.otpChannel = 'sms';
    } else {
      const sc = scriptFor(acc.phone);
      const ok = sc.otpResults[Math.min(acc.otpTry, sc.otpResults.length - 1)] ?? true;
      acc.otpTry++;
      if (ok) { acc.status = 'ACTIVE'; acc.otpChannel = null; acc.otpRejected = false; }
      else { acc.status = 'AWAITING_OTP'; acc.otpChannel = 'sms'; acc.otpRejected = true; }
    }
  };

  const agentStep = () => {
    for (const j of jobs) {
      if (j.status === 'PENDING') { j.status = 'RUNNING'; continue; }
      if (j.status !== 'RUNNING') continue;
      live.set(j.accountId, { shot: `L${t}`.padEnd(200, 'x'), ts: t, label: 'Kayıt adımı', note: '🎥 canlı' });
      if (--j.ticks <= 0) completeJob(j);
    }
    for (const [jobId, p] of provisions) {
      if (p.ticks > 0 && --p.ticks === 0) {
        const d = devices.find((x) => x.id === p.deviceId)!;
        d.metadata.provisionStatus = 'READY';
      }
      void jobId;
    }
  };

  const pushJob = (accountId: string, kind: 'register' | 'otp' | 'method', code?: string) => {
    jobs.push({ id: newId('job'), accountId, status: 'PENDING', ticks: 2, kind, ...(code ? { code } : {}), result: {} });
  };

  const deps: TgRegDeps = {
    now: () => t,
    log: () => undefined,
    countryFromPhone,
    async send(_tok, _chat, text, buttons) { const id = ++msgSeq; msgs.push({ id, kind: 'text', text, ...(buttons ? { buttons } : {}) }); return id; },
    async edit(_tok, _chat, id, text, buttons) {
      edits.push({ id, text });
      const m = msgs.find((x) => x.id === id);
      if (m) { m.text = text; m.buttons = buttons ?? []; } // gerçek Telegram'da düzenleme butonları da değiştirir
      return !!m;
    },
    async sendPhoto(_tok, _chat, _b64, caption, opts = {}) {
      const id = ++msgSeq;
      msgs.push({ id, kind: 'photo', text: caption, ...(opts.buttons ? { buttons: opts.buttons } : {}), ...(opts.forceReply ? { forceReply: true } : {}) });
      return id;
    },
    async editPhoto(_tok, _chat, id) { photoEdits.push(id); return msgs.some((m) => m.id === id) ? 'ok' : 'gone'; },
    async editCaption(_tok, _chat, id, caption) { captions.push({ id, caption }); },
    async occupiedDeviceIds() {
      return [...accounts.values()].filter((a) => BLOCKING_ACCOUNT_STATUSES.includes(a.status)).map((a) => a.deviceId);
    },
    async onlineDevices(_ws, exclude) { return devices.filter((d) => d.status === 'ONLINE' && !exclude.includes(d.id)); },
    async busyJobCount() { return 0; },
    async duplicateAccounts(_ws, phones) {
      return [...accounts.values()].filter((a) => phones.includes(`+${a.phone}`) && DUPLICATE_ACCOUNT_STATUSES.includes(a.status)).map((a) => ({ phoneNumber: `+${a.phone}`, status: a.status }));
    },
    async latestRegisterJob(accountId) {
      const js = jobs.filter((j) => j.accountId === accountId);
      const j = js[js.length - 1];
      return j ? { id: j.id, status: j.status, result: j.result } : null;
    },
    async findAwaitingAccountByPhone(_ws, phone) {
      const a = [...accounts.values()].find((x) => `+${x.phone}` === phone && x.status === 'AWAITING_OTP');
      return a ? { id: a.id, deviceId: a.deviceId } : null;
    },
    async createInstance() {
      if (capacity <= 0) throw Object.assign(new Error('Sunucu kapasitesi doldu — test'), { code: 'HOST_CAPACITY_EXHAUSTED' });
      capacity--;
      calls.createInstance++;
      const id = newId('new');
      devices.push({ id, name: `wa-${id}`, status: 'ONLINE', metadata: { instance: `mi-${id}`, provisionStatus: 'PROVISIONING', proxyCountry: 'TR' } });
      const jobId = newId('prov');
      provisions.set(jobId, { deviceId: id, ticks: 3, ...(failNextProvision ? { fail: true } : {}) });
      failNextProvision = false;
      return { jobId, deviceId: id, name: `wa-${id}` };
    },
    async provisionStatus(jobId) {
      const p = provisions.get(jobId);
      if (!p) return null;
      if (p.fail && p.ticks === 0) return { phase: 'failed', percent: 38, log: [], lastProgress: null, error: 'Root / Magisk kurulamadı (test)' };
      return { phase: p.ticks === 0 ? 'ready' : 'provisioning', percent: p.ticks === 0 ? 100 : 40, log: [{ label: 'Proxy (ülke eşleşmeli)' }], lastProgress: { label: 'Proxy' }, error: null };
    },
    async startRegister(_ws, deviceId, phoneE164, name) {
      if (activeWaDevices.has(deviceId)) throw Object.assign(new Error('Bu cihazda zaten aktif hesap var'), { code: 'DEVICE_HAS_ACTIVE_WHATSAPP' });
      calls.startRegister.push({ deviceId, phone: phoneE164, name });
      const id = newId('acc');
      accounts.set(id, { id, deviceId, phone: phoneE164.replace(/\D/g, ''), status: 'REGISTERING', otpChannel: null, otpRejected: false, attempt: 0, otpTry: 0 });
      pushJob(id, 'register');
      return { accountId: id };
    },
    async registerStatus(accountId): Promise<RegStatus | null> {
      const a = accounts.get(accountId);
      if (!a) return null;
      const awaitingMethod = a.otpChannel === 'method_select';
      return {
        status: a.status, percent: 50, log: [{ label: 'Numara girildi' }], lastProgress: { label: 'Numara' },
        note: a.otpChannel === 'rate_limited' ? '1 saat bekleyin' : a.wall === 'BAN' ? '⛔ NUMARA/HESAP YASAKLI — WhatsApp bu numarayı kalıcı olarak reddetti.' : null,
        action: a.wall === 'BAN' ? 'Bu numarayı ÇÖPE atın, yeni numara girin.' : null,
        wallKind: a.wall ?? null, otpChannel: a.otpChannel,
        awaitingMethod, awaitingOtp: a.status === 'AWAITING_OTP' && !awaitingMethod && a.otpChannel !== 'rate_limited',
        otpRejected: a.otpRejected, waitUntil: null
      };
    },
    // ★Gerçekçi: kod iletilince hesap durumu HEMEN değişmez (bayat AWAITING_OTP kalır), yalnız yeni iş açılır.
    async provideOtp(_ws, accountId, code) { calls.provideOtp.push(code); calls.otpTargets.push(accountId); pushJob(accountId, 'otp', code); },
    async provideMethod(_ws, accountId, m) { calls.provideMethod.push(m); pushJob(accountId, 'method'); },
    async retryRegister(_ws, accountId) { calls.retry++; const a = accounts.get(accountId)!; a.status = 'REGISTERING'; pushJob(accountId, 'register'); },
    async cancelAccount(_ws, accountId) { calls.cancel++; accounts.get(accountId)!.status = 'FAILED'; },
    liveShot: (accountId) => live.get(accountId) ?? null,
    async save(d) { store = d; },
    async load() { return store; }
  };

  return {
    deps, msgs, edits, photoEdits, captions, calls, scripts, accounts, devices,
    setCapacity(n: number) { capacity = n; },
    failProvision() { failNextProvision = true; },
    advance(ms: number) { t += ms; },
    agentStep,
    get store() { return store; }
  };
}

const CTX = { token: 'T', workspaceId: 'W', chatId: 'C' };

type Core = ReturnType<typeof createTgRegister>;
type World = ReturnType<typeof makeWorld>;

/** n tur: saat 4 sn ilerler, ajan bir adım atar, çekirdek bir tur döner. */
async function run(core: Core, w: World, n: number, each?: () => Promise<void> | void): Promise<void> {
  for (let i = 0; i < n; i++) {
    w.advance(4_000);
    w.agentStep();
    await core.tick();
    if (each) await each();
  }
}

/** Operatörü taklit eder: kod bekleyen her oturumun EN SON istemine yanıt olarak kod yazar. */
async function answerAllOtps(core: Core, w: World, code = '123 456'): Promise<number> {
  let n = 0;
  for (const s of core._inspect().sessions.filter((x) => x.phase === 'awaiting_otp')) {
    const promptId = s.otpPromptMsgIds[s.otpPromptMsgIds.length - 1];
    if (!promptId) continue;
    const prompt = w.msgs.find((m) => m.id === promptId)!;
    const used = await core.handleReply(CTX, { message_id: promptId, caption: prompt.text }, code);
    if (used) n++;
  }
  return n;
}

const phases = (core: Core) => core._inspect().sessions.map((s) => s.phase);
const lastText = (w: World) => w.msgs[w.msgs.length - 1]?.text ?? '';
const hasButton = (m: Msg | undefined, data: string) => JSON.stringify(m?.buttons ?? []).includes(`"${data}"`);

// ── 1) Saf ayrıştırma ────────────────────────────────────────────────────────

test('ayrıştırma: tek numara, boşluklu biçim', () => {
  const r = parseEntryLines('+90 555 111 22 33', countryFromPhone);
  assert.deepEqual(r.entries, [{ phone: '905551112233', name: undefined }]);
  assert.equal(r.problems.length, 0);
});

test('ayrıştırma: satır başına isim, yerel numara düzeltilir, geçersiz/çift satırlar raporlanır', () => {
  const r = parseEntryLines('905551112233 Destek\n+90 555 111 22 34\n0555 111 22 35\nabc\n905551112233\n905551112236, 905551112237', countryFromPhone);
  assert.deepEqual(r.entries.map((e) => [e.phone, e.name]), [
    ['905551112233', 'Destek'], ['905551112234', undefined], ['905551112235', undefined], ['905551112236', undefined], ['905551112237', undefined]
  ]);
  assert.ok(r.fixes.some((f) => f.includes('baştaki 0')), 'yerel 0555… düzeltilip RAPORLANMALI');
  assert.ok(r.problems.some((p) => p.includes('numara bulunamadı')), 'abc reddedilmeli');
  assert.ok(r.problems.some((p) => p.includes('iki kez')), 'çift numara bildirilmeli');
});

// ── 🧠 Akıllı numara tanıma ──────────────────────────────────────────────────

test('AKILLI: her yazım biçimi aynı numaraya çözülür ve düzeltme raporlanır', () => {
  const want = '905551112233';
  const cases: Array<[string, boolean]> = [
    // [girdi, düzeltme raporlanmalı mı]
    ['+90 555 111 22 33', false],
    ['+905551112233', false],
    ['905551112233', false],
    ['0555 111 22 33', true],
    ['05551112233', true],
    ['555 111 22 33', true],
    ['5551112233', true],
    ['0090 555 111 22 33', true],
    ['+90 0555 111 22 33', true],
    ['(0555) 111-22-33', true],
    ['+90-555-111-2233', false],
    ['555.111.22.33', true],
    ['٠٥٥٥١١١٢٢٣٣', true]            // Arapça-Hint rakamları
  ];
  for (const [input, expectFix] of cases) {
    const p = parsePhoneLine(input, countryFromPhone);
    assert.ok(!('error' in p), `"${input}" çözülmeli: ${'error' in p ? p.error : ''}`);
    if (!('error' in p)) {
      assert.equal(p.digits, want, `"${input}"`);
      assert.equal(p.fixes.length > 0, expectFix, `"${input}" düzeltme raporu: ${p.fixes.join(',')}`);
    }
  }
});

test('AKILLI: isim numaranın önünde/arkasında, etiketli ya da sekmeli olabilir', () => {
  const cases: Array<[string, string]> = [
    ['Ahmet 0555 111 22 33', 'Ahmet'],
    ['0555 111 22 33 Destek', 'Destek'],
    ['Destek Ekibi - 0555 111 22 33', 'Destek Ekibi'],
    ['Tel: 0555 111 22 33 Ayşe', 'Ayşe'],
    ['Mehmet\t05551112233', 'Mehmet']   // Excel'den yapıştırma
  ];
  for (const [input, name] of cases) {
    const p = parsePhoneLine(input, countryFromPhone);
    assert.ok(!('error' in p), input);
    if (!('error' in p)) { assert.equal(p.digits, '905551112233', input); assert.equal(p.name, name, input); }
  }
});

test('AKILLI: emin olunamayan numara TAHMİN EDİLMEZ, açık hata verir', () => {
  const bad: Array<[string, RegExp]> = [
    ['90555111223', /eksik/],           // 1 hane eksik
    ['9055511122334', /fazla/],         // 1 hane fazla
    ['555 111 22', /kısa|eksik|bulunamadı/],
    ['merhaba', /bulunamadı/],
    ['+999 123 456 789', /ülke kodu/]
  ];
  for (const [input, re] of bad) {
    const p = parsePhoneLine(input, countryFromPhone);
    assert.ok('error' in p, `"${input}" reddedilmeli`);
    if ('error' in p) assert.match(p.error, re, input);
  }
  // Yabancı numara ülke koduyla yazılırsa olduğu gibi kalır (+90 EKLENMEZ).
  const al = parsePhoneLine('+355 69 123 4567', countryFromPhone);
  assert.ok(!('error' in al) && al.digits === '355691234567');
  const de = parsePhoneLine('0049 151 2345 6789', countryFromPhone);
  assert.ok(!('error' in de) && de.digits === '4915123456789');
});

test('AKILLI: sabit hat uyarısı (5 ile başlamayan TR numarası)', () => {
  const p = parsePhoneLine('0212 555 11 22', countryFromPhone);
  assert.ok(!('error' in p));
  if (!('error' in p)) assert.ok(p.fixes.some((f) => f.includes('cep numarası değil')));
});

test('AKILLI: SMS metninin tamamından kod çekilir, belirsizse sorulur', () => {
  assert.equal(extractOtp('123456'), '123456');
  assert.equal(extractOtp('123 456'), '123456');
  assert.equal(extractOtp('WhatsApp kodunuz: 123-456. Bu kodu kimseyle paylaşmayın.'), '123456');
  assert.equal(extractOtp('Your WhatsApp code: 987654'), '987654');
  assert.equal(extractOtp('kod 123456 ya da 654321'), null, 'iki farklı aday → tahmin yok');
  assert.equal(extractOtp('selam nasılsın'), null);
});

test('ayrıştırma: 100 numara sınırı', () => {
  const text = Array.from({ length: 120 }, (_, i) => `90555${String(1000000 + i)}`).join('\n');
  const r = parseEntryLines(text, countryFromPhone);
  assert.equal(r.entries.length, 100);
  assert.ok(r.problems.some((p) => p.includes('en fazla 100')));
});

test('isim temizleme ve numara listesi algılama', () => {
  assert.equal(cleanName('  Destek   Ekibi '), 'Destek Ekibi');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('A'.repeat(26)), null);
  assert.equal(cleanName('123456'), null, 'yalnız rakam isim olamaz (yanlış yere yazılmış kod)');
  assert.equal(cleanName('<b>X</b>')?.includes('<'), false);
  assert.equal(looksLikeNumberList('905551112233', countryFromPhone), true);
  assert.equal(looksLikeNumberList('905551112233\n0555 111 22 34', countryFromPhone), true);
  assert.equal(looksLikeNumberList('Destek 0555 111 22 33', countryFromPhone), true);
  assert.equal(looksLikeNumberList('merhaba', countryFromPhone), false);
  assert.equal(looksLikeNumberList('123456', countryFromPhone), false, 'OTP kodu numara sanılmamalı');
  assert.equal(looksLikeNumberList('yarın sabah 0555 111 22 33 numarasını mutlaka arayıp bilgi ver', countryFromPhone), false,
    'sohbet cümlesi numara listesi sayılmamalı');
});

// ── 2) Tekli akış: boşta cihaz → kayıt → OTP → kod → tamam ───────────────────

test('tekli: boşta cihaz kullanılır, OTP istemi force_reply ile gelir, yanıtla kod girilir, hesap açılır', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  assert.equal(await core.handleText(CTX, '/wakayit', true), true);
  assert.equal(await core.handleText(CTX, '+90 555 111 22 33', true), true);
  assert.match(lastText(w), /profil adını/);
  assert.equal(await core.handleText(CTX, 'Ahmet Yılmaz', true), true);
  assert.equal(core._inspect().sessions.length, 1, 'tekli kayıtta ek onay sorulmaz');

  await run(core, w, 6);
  assert.equal(w.calls.createInstance, 0, 'boşta cihaz varken yeni cihaz AÇILMAMALI');
  assert.deepEqual(w.calls.startRegister[0], { deviceId: 'd1', phone: '+905551112233', name: 'Ahmet Yılmaz' });
  assert.deepEqual(phases(core), ['awaiting_otp']);
  const prompt = w.msgs.find((m) => m.forceReply);
  assert.ok(prompt, 'OTP istemi force_reply ile gönderilmeli');
  assert.match(prompt!.text, /KOD BEKLENİYOR/);
  assert.match(prompt!.text, /Cihaz: <b>wa-d1<\/b>/, 'istem hangi cihaz olduğunu söylemeli');
  assert.ok(w.msgs.some((m) => m.kind === 'photo' && m.text.includes('Canlı ekran')), '📺 canlı ekran açılmalı');

  assert.equal(await answerAllOtps(core, w), 1);
  assert.deepEqual(w.calls.provideOtp, ['123456'], 'kod boşluklardan arındırılıp iletilmeli');
  await run(core, w, 5);
  assert.deepEqual(phases(core), ['done']);
  assert.ok(w.msgs.some((m) => m.text.includes('HESAP AÇILDI')));
  assert.ok(w.captions.some((c) => c.caption.includes('son kare')), 'canlı ekran son kareyle mühürlenmeli');
  assert.ok(w.photoEdits.length > 0, 'canlı ekran yerinde güncellenmeli (editMessageMedia)');
});

test('tekli: boşta cihaz yoksa yeni cihaz açılır, kurulum bitince kayıt başlar', async () => {
  const w = makeWorld();
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905551112233 Destek', true);
  await run(core, w, 1);
  assert.equal(w.calls.createInstance, 1);
  assert.equal(phases(core)[0], 'provisioning');
  await run(core, w, 2);
  assert.ok(w.msgs.some((m) => m.text.includes('Kurulum logu')), 'kurulum logu durum mesajında görünmeli');
  await run(core, w, 8);
  assert.equal(w.calls.startRegister.length, 1);
  assert.equal(w.calls.startRegister[0]!.name, 'Destek');
  assert.equal(phases(core)[0], 'awaiting_otp');
});

// ── 3) Toplu kayıt: 10 numara, hepsine "Destek", aynı anda en fazla 4 ─────────

test('TOPLU: 10 numara, hepsine aynı isim, eşzamanlı ≤4, sıra korunur, hepsi açılır', async () => {
  const w = makeWorld({ capacity: 50 });
  const core = createTgRegister(w.deps, { concurrency: 4 });
  const numbers = Array.from({ length: 10 }, (_, i) => `+90 555 200 00 ${String(i).padStart(2, '0')}`);

  await core.handleText(CTX, '/wakayit', true);
  await core.handleText(CTX, numbers.join('\n'), true);
  assert.ok(hasButton(w.msgs[w.msgs.length - 1], 'wr:g:same'), 'isim seçenekleri sunulmalı');
  await core.handleCallback(CTX, 'wr:g:same');
  await core.handleText(CTX, 'Destek', true);
  assert.ok(hasButton(w.msgs[w.msgs.length - 1], 'wr:ok'), 'toplu başlatmadan önce ONAY istenmeli');
  assert.equal(core._inspect().sessions.length, 0, 'onaydan önce hiçbir şey başlamamalı');

  const before = w.msgs.length;
  await core.handleCallback(CTX, 'wr:ok');
  const sessions = core._inspect().sessions;
  assert.equal(sessions.length, 10);
  assert.ok(sessions.every((s) => s.name === 'Destek'), 'hepsinin adı Destek olmalı');
  // 10 numara için 10 ayrı mesaj değil: onay + toplu özet (+ ilk turda başlayanların durumları).
  const statusMsgsForQueued = w.msgs.slice(before).filter((m) => m.text.includes('WhatsApp Kaydı') && m.text.includes('Sırada'));
  assert.equal(statusMsgsForQueued.length, 0, 'sıradaki numaralar için ayrı mesaj açılmamalı');
  assert.ok(w.msgs.some((m) => m.text.includes('Toplu kayıt') && m.text.includes('10 numara')), 'toplu özet mesajı olmalı');

  let maxActive = 0;
  await run(core, w, 400, async () => {
    maxActive = Math.max(maxActive, core._inspect().activeCount);
    await answerAllOtps(core, w);
  });
  assert.ok(maxActive <= 4, `eşzamanlı kayıt 4'ü aşmamalı (ölçülen ${maxActive})`);
  assert.equal(maxActive, 4, 'sınır tam kullanılmalı');
  assert.deepEqual(phases(core), Array(10).fill('done'));
  assert.equal(w.calls.startRegister.length, 10);
  assert.deepEqual(w.calls.startRegister.slice(0, 4).map((c) => c.phone), numbers.slice(0, 4).map((n) => `+${n.replace(/\D/g, '')}`), 'ilk 4 numara sıradaki ilk 4 olmalı');
  const batch = core._inspect().batches[0]!;
  const summary = w.msgs.find((m) => m.id === batch.msgId)!;
  assert.match(summary.text, /✅ 10 tamam/, 'toplu özet son hâli 10 tamam göstermeli');
});

test('TOPLU: kod bekleyenler yuvayı tutar — kod girilmeden sıradaki başlamaz', async () => {
  const w = makeWorld({ capacity: 50 });
  const core = createTgRegister(w.deps, { concurrency: 2 });
  await core.handleText(CTX, '/wakayit 905553000001 A\n905553000002 B\n905553000003 C', true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 30);
  assert.deepEqual([...phases(core)].sort(), ['awaiting_otp', 'awaiting_otp', 'queued']);
  assert.equal(w.calls.startRegister.length, 2);
  await answerAllOtps(core, w);
  await run(core, w, 30, async () => { await answerAllOtps(core, w); });
  assert.deepEqual(phases(core), ['done', 'done', 'done']);
});

test('TOPLU: sıradakiler toplu iptal edilir, kayıttakiler sürer', async () => {
  const w = makeWorld({ capacity: 50 });
  const core = createTgRegister(w.deps, { concurrency: 2 });
  const list = Array.from({ length: 6 }, (_, i) => `90555400000${i} X`).join('\n');
  await core.handleText(CTX, `/wakayit ${list}`, true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 2);
  const b = core._inspect().batches[0]!;
  await core.handleCallback(CTX, `wr:bx:${b.id}`);
  const ph = phases(core);
  assert.equal(ph.filter((p) => p === 'cancelled').length, 4);
  assert.equal(ph.filter((p) => p !== 'cancelled').length, 2);
});

// ── 4) Kapasite ──────────────────────────────────────────────────────────────

test('KAPASİTE: dolunca TEK uyarı, sıra bekler; yer açılınca devam eder', async () => {
  const w = makeWorld({ capacity: 1 });
  const core = createTgRegister(w.deps, { concurrency: 3 });
  await core.handleText(CTX, '/wakayit 905556000001 A\n905556000002 B\n905556000003 C', true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 5);
  const warnings = w.msgs.filter((m) => m.text.includes('Kapasite uyarısı'));
  assert.equal(warnings.length, 1, 'toplu kayıtta kapasite uyarısı tek kez gelmeli');
  assert.ok(phases(core).includes('waiting_capacity'));
  assert.equal(w.calls.createInstance, 1);

  w.setCapacity(5);
  w.advance(2 * 60_000 + 1);
  await run(core, w, 60, async () => { await answerAllOtps(core, w); });
  assert.deepEqual(phases(core), ['done', 'done', 'done']);
  assert.equal(w.calls.createInstance, 3);
});

// ── 5) Cihaz seçimi ──────────────────────────────────────────────────────────

test('CİHAZ: "boşta" sanılan cihazda aktif WA çıkarsa ona dokunulmaz, başka cihaz seçilir', async () => {
  const w = makeWorld({ idle: [{ id: 'dA', hasActiveWa: true }, { id: 'dB' }] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905557000001 A', true);
  await run(core, w, 6);
  assert.equal(w.calls.startRegister.length, 1);
  assert.equal(w.calls.startRegister[0]!.deviceId, 'dB');
  assert.ok(core._inspect().sessions[0]!.excludedDevices.includes('dA'));
});

test('CİHAZ: aynı boşta cihaz iki numaraya birden verilmez', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }], capacity: 5 });
  const core = createTgRegister(w.deps, { concurrency: 2 });
  await core.handleText(CTX, '/wakayit 905558000001 A\n905558000002 B', true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 12);
  const devs = w.calls.startRegister.map((c) => c.deviceId);
  assert.equal(new Set(devs).size, devs.length, 'iki kayıt aynı cihaza düşmemeli');
  assert.equal(w.calls.createInstance, 1, 'ikinci numara için yeni cihaz açılmalı');
});

// ── 6) WhatsApp durumları ────────────────────────────────────────────────────

test('BEKLETME: rate_limited → başarısız + Tekrar dene; tekrar denenince kayıt sürer', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905559000001', { attempts: ['rate_limited', 'otp'], otpResults: [true] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559000001 A', true);
  await run(core, w, 6);
  const s = core._inspect().sessions[0]!;
  assert.equal(s.phase, 'failed');
  assert.ok(w.msgs.some((m) => m.text.includes('WHATSAPP BEKLETİYOR')));
  const status = w.msgs.find((m) => m.id === s.statusMsgId)!;
  assert.ok(hasButton(status, `wr:r:${s.id}`), 'Tekrar dene butonu olmalı');
  await core.handleCallback(CTX, `wr:r:${s.id}`);
  assert.equal(w.calls.retry, 1);
  await run(core, w, 6);
  assert.equal(core._inspect().sessions[0]!.phase, 'awaiting_otp');
});

test('YÖNTEM: method_select → butonlu ekran; SMS seçilince OTP istemi gelir', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905559000002', { attempts: ['method'], otpResults: [true] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559000002 A', true);
  await run(core, w, 6);
  const s = core._inspect().sessions[0]!;
  assert.equal(s.phase, 'awaiting_method');
  assert.ok(w.msgs.some((m) => m.kind === 'photo' && hasButton(m, `wr:m:${s.id}:sms`)), 'yöntem butonları ekran görüntüsünde olmalı');
  await core.handleCallback(CTX, `wr:m:${s.id}:sms`);
  assert.deepEqual(w.calls.provideMethod, ['sms']);
  await run(core, w, 5);
  assert.equal(core._inspect().sessions[0]!.phase, 'awaiting_otp');
});

test('KOD REDDİ: yanlış kod → yeni istem "reddedildi" der; doğru kod → tamam', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905559000003', { attempts: ['otp'], otpResults: [false, true] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559000003 A', true);
  await run(core, w, 6);
  await answerAllOtps(core, w, '111111');
  await run(core, w, 5);
  assert.equal(core._inspect().sessions[0]!.phase, 'awaiting_otp');
  const prompts = w.msgs.filter((m) => m.forceReply);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!.text, /REDDEDİLDİ/);
  await answerAllOtps(core, w, '222222');
  await run(core, w, 5);
  assert.equal(core._inspect().sessions[0]!.phase, 'done');
  assert.deepEqual(w.calls.provideOtp, ['111111', '222222']);
});

test('BAYAT DURUM: kod iletildikten sonra iş sürerken yeni/bayat istem GÖNDERİLMEZ', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559000004 A', true);
  await run(core, w, 6);
  await answerAllOtps(core, w);
  // İş PENDING/RUNNING iken hesap hâlâ AWAITING_OTP görünür (sahte ajan gerçekçi davranıyor).
  await core.tick();
  assert.equal(w.msgs.filter((m) => m.forceReply).length, 1, 'bayat AWAITING_OTP yeni istem doğurmamalı');
  assert.equal(core._inspect().sessions[0]!.phase, 'verifying');
});

test('ELLE MÜDAHALE: AWAITING_MANUAL takılı kalmaz, hemen bildirilir', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905559000005', { attempts: ['manual'], otpResults: [true] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559000005 A', true);
  await run(core, w, 6);
  assert.equal(core._inspect().sessions[0]!.phase, 'failed');
  assert.ok(w.msgs.some((m) => /elle müdahale/i.test(m.text)));
});

// ── 7) Kod girme yolları ─────────────────────────────────────────────────────

test('KOD: tek kayıt beklerken çıplak kod kabul edilir; iki kayıt beklerken hangisi diye sorulur', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }, { id: 'd2' }] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905551110001 A', true);
  await run(core, w, 6);
  assert.equal(await core.handleText(CTX, '654321', true), true);
  assert.deepEqual(w.calls.provideOtp, ['654321']);

  const w2 = makeWorld({ idle: [{ id: 'd1' }, { id: 'd2' }] });
  const core2 = createTgRegister(w2.deps, { concurrency: 2 });
  await core2.handleText(CTX, '/wakayit 905551110002 A\n905551110003 B', true);
  await core2.handleCallback(CTX, 'wr:ok');
  await run(core2, w2, 8);
  assert.equal(await core2.handleText(CTX, '654321', true), true);
  assert.deepEqual(w2.calls.provideOtp, [], 'iki kayıt beklerken çıplak kod HİÇBİRİNE gitmemeli');
  assert.match(lastText(w2), /yanıt olarak/);
  assert.equal(await core2.handleText(CTX, '/kod 905551110003 777777', true), true);
  assert.deepEqual(w2.calls.provideOtp, ['777777']);
});

test('KOD: bellek kaybında bile istemdeki numaradan doğru hesaba eşlenir', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905551110004 A', true);
  await run(core, w, 6);
  const prompt = w.msgs.find((m) => m.forceReply)!;
  const fresh = createTgRegister({ ...w.deps, load: async () => null }); // durum dosyası kayboldu
  assert.equal(await fresh.handleReply(CTX, { message_id: prompt.id, caption: prompt.text }, '333 333'), true);
  assert.deepEqual(w.calls.provideOtp, ['333333']);
});

// ── 8) Mevcut bot akışlarını BOZMADIĞININ kanıtı ─────────────────────────────

test('REGRESYON: kayıtla ilgisiz mesajlara dokunulmaz (bot eskisi gibi çalışır)', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  for (const t of ['/menu', '/gonder', '/durum', 'merhaba', 'hesaplar', '/kayit']) {
    assert.equal(await core.handleText(CTX, t, true), false, `"${t}" tüketilmemeli`);
  }
  assert.equal(await core.handleText(CTX, '123456', true), false, 'kod bekleyen yokken 6 hane tüketilmemeli');
  // Botun başka bir adım-adım akışı açıkken (ör. /gonder numara bekliyor) numara ÇALINMAMALI.
  assert.equal(await core.handleText(CTX, '905551112233', false), false);
  // Sohbet yanıtı gibi kod olmayan yanıtlar da tüketilmemeli.
  assert.equal(await core.handleReply(CTX, { message_id: 1, text: 'Ahmet +90 555 111 22 33' }, 'selam nasılsın'), false);
  assert.equal(await core.handleReply(CTX, { message_id: 1, text: 'sohbet listesi +90 555 111 22 33' }, '123456'), false, 'kod istemi olmayan mesaja yazılan sayı kod sayılmamalı');
  assert.equal(w.msgs.length, 0, 'hiçbir mesaj gönderilmemeli');
  assert.equal(core._inspect().sessions.length, 0);
});

test('REGRESYON: komutsuz numara mesajı ONAYSIZ kayıt başlatmaz', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  assert.equal(await core.handleText(CTX, '905551112233 Merhaba', true), true);
  assert.equal(core._inspect().sessions.length, 0, 'onay gelmeden oturum açılmamalı');
  assert.ok(hasButton(w.msgs[w.msgs.length - 1], 'wr:y'));
  await core.handleCallback(CTX, 'wr:c');
  assert.equal(core._inspect().sessions.length, 0);
  // Evet denirse başlar.
  await core.handleText(CTX, '905551112233 Destek', true);
  await core.handleCallback(CTX, 'wr:y');
  assert.equal(core._inspect().sessions.length, 1);
  assert.equal(core._inspect().sessions[0]!.name, 'Destek');
});

test('REGRESYON: taslak açıkken başka komut yazılırsa taslak kapanır ve komut bota geçer', async () => {
  const w = makeWorld();
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit', true);
  assert.equal(await core.handleText(CTX, '/menu', true), false, '/menu bota geçmeli');
  assert.equal(core._inspect().drafts.size, 0);
});

// ── 9) Çift kayıt, sınır ayarı, kalıcılık, çift basış ────────────────────────

test('ÇİFT KAYIT: aktif hesabı olan ya da zaten sırada olan numara reddedilir', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905552220001 A', true);
  await core.handleText(CTX, '/wakayit 905552220001 A', true);
  assert.match(w.msgs.map((m) => m.text).join('\n'), /zaten Telegram sırasında/);
  assert.equal(core._inspect().sessions.length, 1);
});

test('SINIR: /kayitlimit 1-8 aralığına sıkıştırılır ve kalıcıdır', async () => {
  const w = makeWorld();
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/kayitlimit 5', true);
  assert.equal(core._inspect().limit, 5);
  await core.handleText(CTX, '/kayitlimit 50', true);
  assert.equal(core._inspect().limit, 8);
  const again = createTgRegister(w.deps); // yeniden başlatma
  await again.restore();
  assert.equal(again._inspect().limit, 8, 'sınır yeniden başlatmada korunmalı');
});

test('KALICILIK: API yeniden başlarsa oturumlar kaldığı yerden sürer', async () => {
  const w = makeWorld({ capacity: 10 });
  const core = createTgRegister(w.deps, { concurrency: 2 });
  await core.handleText(CTX, '/wakayit 905553330001 A\n905553330002 B\n905553330003 C', true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 3);
  const snapshot = core._inspect().sessions.map((s) => [s.phone, s.phase]);
  const restarted = createTgRegister(w.deps, { concurrency: 2 });
  await restarted.restore();
  assert.deepEqual(restarted._inspect().sessions.map((s) => [s.phone, s.phase]), snapshot);
  await run(restarted, w, 80, async () => { await answerAllOtps(restarted, w); });
  assert.deepEqual(phases(restarted), ['done', 'done', 'done']);
});

test('ÇİFT BASIŞ: "Başlat"a iki kez basmak numaraları iki kez sıraya koymaz', async () => {
  const w = makeWorld({ capacity: 10 });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905554440001 A\n905554440002 B', true);
  await core.handleCallback(CTX, 'wr:ok');
  await core.handleCallback(CTX, 'wr:ok');
  assert.equal(core._inspect().sessions.length, 2);
});

test('İPTAL: tekli kayıt iptal edilince hesap iptal edilir ve yuva boşalır', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905554440003 A', true);
  await run(core, w, 6);
  const s = core._inspect().sessions[0]!;
  await core.handleCallback(CTX, `wr:x:${s.id}`);
  assert.equal(core._inspect().sessions[0]!.phase as Phase, 'cancelled');
  assert.equal(w.calls.cancel, 1);
  assert.equal(core._inspect().activeCount, 0);
});

// ── 10) 🎯 YANLIŞ CİHAZA KOD GİTMEMELİ ────────────────────────────────────────

/** Toplu kayıtta 3 cihazı aynı anda kod beklemeye getirir. */
async function threeWaiting() {
  const w = makeWorld({ idle: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }] });
  const core = createTgRegister(w.deps, { concurrency: 3 });
  await core.handleText(CTX, '/wakayit 905551230001 Bir\n905551230002 Iki\n905551230003 Uc', true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 8);
  const ss = core._inspect().sessions;
  assert.deepEqual(ss.map((s) => s.phase), ['awaiting_otp', 'awaiting_otp', 'awaiting_otp']);
  return { w, core, ss };
}

test('🎯 force_reply YALNIZ tek cihaz beklerken; ikinci bekleyen gelince otomatik yanıt modu KAPALI', async () => {
  const { w } = await threeWaiting();
  const prompts = w.msgs.filter((m) => m.kind === 'photo' && /KOD BEKLENİYOR/.test(m.text));
  assert.equal(prompts.length, 3);
  assert.equal(prompts.filter((p) => p.forceReply).length, 1, 'yalnız İLK istem otomatik yanıt modu açabilir');
  assert.equal(prompts[0]!.forceReply, true);
  for (const p of prompts.slice(1)) {
    assert.ok(!p.forceReply, 'birden fazla cihaz beklerken otomatik yanıt modu yanlış cihaza kilitlenebilir');
    assert.match(p.text, /SAĞA KAYDIRIP/);
    assert.match(p.text, /birden fazla cihaz kod bekliyor/);
  }
});

test('🎯 her kod istemi kendi numarasını + cihazını + ismini gösterir', async () => {
  const { w, ss } = await threeWaiting();
  for (const s of ss) {
    const prompt = w.msgs.find((m) => m.id === s.otpPromptMsgIds[0])!;
    assert.ok(prompt.text.includes(fmtPhone(s.phone)), `numara (${fmtPhone(s.phone)})`);
    assert.ok(prompt.text.includes(`Cihaz: <b>${s.deviceName}</b>`), 'cihaz adı');
    assert.ok(prompt.text.includes(`👤 ${s.name}`), 'isim');
  }
});

test('🎯 ortadaki cihazın istemine yanıtlanan kod YALNIZ o cihaza gider (diğerlerine asla)', async () => {
  const { w, core, ss } = await threeWaiting();
  const middle = ss[1]!;
  const prompt = w.msgs.find((m) => m.id === middle.otpPromptMsgIds[0])!;
  assert.equal(await core.handleReply(CTX, { message_id: prompt.id, caption: prompt.text }, '424242'), true);
  assert.deepEqual(w.calls.otpTargets, [middle.accountId], 'kod yalnız ortadaki cihazın hesabına gitmeli');
  // Onay mesajı hangi cihaza gittiğini söyler.
  const echo = w.msgs.find((m) => m.text.includes('KOD GÖNDERİLDİ'))!;
  assert.ok(echo.text.includes(middle.deviceName!) && echo.text.includes('424242'));
  // İstem "KOD ALINDI" olarak işaretlenir.
  assert.ok(w.captions.some((c) => c.id === prompt.id && c.caption.includes('KOD ALINDI')));
  // Diğer ikisi hâlâ kod bekliyor.
  assert.deepEqual(core._inspect().sessions.map((s) => s.phase), ['awaiting_otp', 'verifying', 'awaiting_otp']);
});

test('🎯 her üç cihaza sırayla doğru kod — her kod doğru hesaba, karışma yok', async () => {
  const { w, core, ss } = await threeWaiting();
  // Operatör ters sırayla yanıtlıyor (3 → 1 → 2).
  const order = [2, 0, 1];
  for (const i of order) {
    const s = ss[i]!;
    const p = w.msgs.find((m) => m.id === s.otpPromptMsgIds[0])!;
    await core.handleReply(CTX, { message_id: p.id, caption: p.text }, `${i}${i}${i}${i}${i}${i}`);
  }
  assert.deepEqual(w.calls.otpTargets, order.map((i) => ss[i]!.accountId));
  assert.deepEqual(w.calls.provideOtp, ['222222', '000000', '111111']);
  await run(core, w, 6);
  assert.deepEqual(core._inspect().sessions.map((s) => s.phase), ['done', 'done', 'done']);
});

test('🎯 artık kod BEKLEMEYEN cihazın eski istemine yanıt → kod gönderilmez, durum söylenir', async () => {
  const { w, core, ss } = await threeWaiting();
  const s = ss[0]!;
  const p = w.msgs.find((m) => m.id === s.otpPromptMsgIds[0])!;
  await core.handleReply(CTX, { message_id: p.id, caption: p.text }, '111111');
  await run(core, w, 6); // kabul edildi → done
  const before = w.calls.provideOtp.length;
  assert.equal(await core.handleReply(CTX, { message_id: p.id, caption: p.text }, '999999'), true);
  assert.equal(w.calls.provideOtp.length, before, 'bitmiş kayda ikinci kod GÖNDERİLMEMELİ');
  assert.match(lastText(w), /kod beklemiyor/);
});

test('🎯 SMS metninin tamamı yanıt olarak yapıştırılsa da doğru kod doğru cihaza gider', async () => {
  const { w, core, ss } = await threeWaiting();
  const s = ss[2]!;
  const p = w.msgs.find((m) => m.id === s.otpPromptMsgIds[0])!;
  await core.handleReply(CTX, { message_id: p.id, caption: p.text }, 'WhatsApp kodunuz: 314-159. Bu kodu kimseyle paylaşmayın.');
  assert.deepEqual(w.calls.provideOtp, ['314159']);
  assert.deepEqual(w.calls.otpTargets, [s.accountId]);
});

// ── 11) Hata kartları: hangi cihaz, ne oldu, ne yapmalı ──────────────────────

test('HATA KARTI: kayıt hatası ekran görüntüsüyle + cihaz adı + ne yapmalı + Tekrar dene', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905559990001', { attempts: ['failed'], otpResults: [true] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559990001 Destek', true);
  await run(core, w, 6);
  const s = core._inspect().sessions[0]!;
  const errShot = w.msgs.find((m) => m.kind === 'photo' && m.text.includes('KAYIT DURDU'))!;
  assert.ok(errShot, 'hata ekran görüntüsü gelmeli');
  assert.ok(errShot.text.includes('Cihaz: <b>wa-d1</b>'));
  assert.match(errShot.text, /Ne oldu:/);
  assert.match(errShot.text, /Ne yapmalı:/);
  assert.ok(hasButton(errShot, `wr:r:${s.id}`), 'ekran görüntüsünün altında Tekrar dene olmalı');
});

test('YANIK NUMARA (canlı senaryo): FAILED + wallKind BAN → "Tekrar dene" HİÇBİR yerde sunulmaz', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905350223839', { attempts: ['banned'], otpResults: [true] });
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905350223839 Destek', true);
  await run(core, w, 6);
  const s = core._inspect().sessions[0]!;
  assert.equal(s.phase, 'failed');
  assert.equal(s.banned, true);
  const errShot = w.msgs.find((m) => m.kind === 'photo' && m.text.includes('KAYIT DURDU'))!;
  assert.ok(!hasButton(errShot, `wr:r:${s.id}`), 'hata ekranında Tekrar dene OLMAMALI');
  assert.match(errShot.text, /TEKRAR DENEMEYİN/);
  const status = w.msgs.find((m) => m.id === s.statusMsgId)!;
  assert.ok(!hasButton(status, `wr:r:${s.id}`), 'durum mesajında Tekrar dene OLMAMALI');
  assert.match(status.text, /NUMARA YANIK/);
  // Eski bir mesajdaki butona basılsa bile yeniden denenmez.
  await core.handleCallback(CTX, `wr:r:${s.id}`);
  assert.equal(w.calls.retry, 0);
  assert.match(lastText(w), /yanık/);
});

test('YANIK NUMARA sonrası aynı cihaz sıradaki numaraya verilebilir (yasak numaraya ait, cihaza değil)', async () => {
  const w = makeWorld({ idle: [{ id: 'd1' }] });
  w.scripts.set('905350223839', { attempts: ['banned'], otpResults: [true] });
  const core = createTgRegister(w.deps, { concurrency: 1 });
  await core.handleText(CTX, '/wakayit 905350223839 A\n905301016860 B', true);
  await core.handleCallback(CTX, 'wr:ok');
  await run(core, w, 14);
  assert.deepEqual(core._inspect().sessions.map((x) => x.phase), ['failed', 'awaiting_otp']);
  assert.deepEqual(w.calls.startRegister.map((c) => c.deviceId), ['d1', 'd1']);
  assert.equal(w.calls.createInstance, 0);
});

test('HATA KARTI: cihaz AÇILIRKEN hata → görüntü yok ama cihaz adı + sebep + Baştan dene', async () => {
  const w = makeWorld();
  w.failProvision();
  const core = createTgRegister(w.deps);
  await core.handleText(CTX, '/wakayit 905559990002 Destek', true);
  await run(core, w, 6);
  const s = core._inspect().sessions[0]!;
  assert.equal(s.phase, 'failed');
  const card = w.msgs.find((m) => m.text.includes('KAYIT BAŞLATILAMADI'))!;
  assert.ok(card, 'kurulum hatası ayrı bir kartla bildirilmeli');
  assert.ok(card.text.includes(`Cihaz: <b>${s.deviceName}</b>`));
  assert.match(card.text, /Root \/ Magisk kurulamadı/);
  assert.ok(hasButton(card, `wr:q:${s.id}`));
  await core.handleCallback(CTX, `wr:q:${s.id}`);
  await run(core, w, 10);
  assert.ok(core._inspect().sessions.some((x) => x.phase === 'awaiting_otp'), 'Baştan dene yeni cihazla kaydı sürdürmeli');
});
