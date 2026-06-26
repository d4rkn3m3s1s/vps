// Real WhatsApp test with a pre-bought Indonesia number: dispatch the number to
// the device, then poll sms-bus for up to 6 minutes to settle whether the OTP
// EVER arrives (vs the number going released/timeout). This is the definitive
// test of whether sms-bus delivers WhatsApp OTPs at all.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const KEY = process.env.SMS_BUS_API_KEY || '5c597c5f569144a88b42595c333f52b9';
const BASE = 'https://sms-bus.com/api/control';

const NUMBER = '6287766452578';
const REQ_ID = '260626053833336376704';
const DEVICE_ID = 'cmqlrf4ni000gj50fjimgvk4u';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1) Create a REGISTER_WHATSAPP job so the agent enters the number + submits.
  const job = await p.job.create({
    data: {
      type: 'REGISTER_WHATSAPP',
      status: 'PENDING',
      payload: { deviceId: DEVICE_ID, phoneNumber: `+${NUMBER}`, fullName: 'Budi Santoso' }
    }
  });
  console.log('dispatched REGISTER_WHATSAPP job', job.id, 'number +' + NUMBER);

  // 2) Wait for the agent to finish entering the number (reach OTP_WAIT).
  for (let i = 0; i < 40; i++) {
    const j = await p.job.findUnique({ where: { id: job.id } });
    if (j && (j.status === 'COMPLETED' || j.status === 'FAILED')) {
      console.log('number-entry job', j.status, JSON.stringify(j.result));
      break;
    }
    await sleep(3000);
  }

  // 3) Poll sms-bus for the OTP for up to 6 minutes (longer than the 3-min default).
  console.log('--- polling sms-bus for OTP (6 min max) ---');
  let prev = '';
  for (let i = 0; i < 72; i++) {
    try {
      const r = await fetch(`${BASE}/get/sms?token=${KEY}&request_id=${REQ_ID}`);
      const t = (await r.text()).slice(0, 200);
      if (t !== prev) { console.log(`t=${i * 5}s:`, t); prev = t; }
      const j = JSON.parse(t);
      if (j.code === 200 && j.data) { console.log('*** OTP RECEIVED ***', j.data); break; }
      if (j.code === 50102) { console.log('*** NUMBER RELEASED/TIMEOUT — sms-bus gave up ***'); break; }
    } catch (e) { /* keep polling */ }
    await sleep(5000);
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
