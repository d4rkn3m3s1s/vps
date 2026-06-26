// Cancel any rented sms-bus numbers from failed auto-register attempts and
// delete the orphan REGISTERING account rows, so the next test starts clean.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const KEY = process.env.SMS_BUS_API_KEY || '5c597c5f569144a88b42595c333f52b9';
const BASE = 'https://sms-bus.com/api/control';

(async () => {
  const stuck = await p.generatedAccount.findMany({
    where: { platform: 'whatsapp', status: { in: ['REGISTERING', 'AWAITING_OTP', 'FAILED'] } }
  });
  console.log('stuck accounts:', stuck.length);
  for (const a of stuck) {
    if (a.smsRequestId) {
      try {
        const url = `${BASE}/cancel?token=${KEY}&request_id=${a.smsRequestId}`;
        const r = await fetch(url);
        console.log(`  cancel ${a.smsRequestId} (${a.phoneNumber}):`, r.status);
      } catch (e) { console.log('  cancel err', e.message); }
    }
    await p.generatedAccount.delete({ where: { id: a.id } }).catch(() => {});
  }
  console.log('cleaned.');
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
