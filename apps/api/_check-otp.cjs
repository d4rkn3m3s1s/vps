// Check whether the SMS provider received the WhatsApp OTP for the most recent
// account, and how long ago the number was rented. Helps decide if it's a
// number-quality problem (no code ever) vs a poll-timeout (code came late).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const KEY = process.env.SMS_BUS_API_KEY || '5c597c5f569144a88b42595c333f52b9';
const BASE = 'https://sms-bus.com/api/control';

(async () => {
  const a = await p.generatedAccount.findFirst({ where: { platform: 'whatsapp' }, orderBy: { createdAt: 'desc' } });
  console.log('account:', a?.phoneNumber, 'status:', a?.status, 'requestId:', a?.smsRequestId);
  if (a?.smsRequestId) {
    try {
      const r = await fetch(`${BASE}/get/sms?token=${KEY}&request_id=${a.smsRequestId}`);
      const t = await r.text();
      console.log('sms-bus /get/sms ->', r.status, t.slice(0, 300));
    } catch (e) { console.log('poll err', e.message); }
  }
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
