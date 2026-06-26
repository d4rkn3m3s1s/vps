// Clear stale PENDING/RUNNING jobs left over from the redroid era so the agent
// stops re-running old WhatsApp registration attempts. Reports what was cleared.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const pending = await p.job.groupBy({ by: ['status'], _count: true });
  console.log('BEFORE:', JSON.stringify(pending));
  const res = await p.job.updateMany({
    where: { status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', error: 'cleared (redroid-era stale job)', finishedAt: new Date() }
  });
  console.log('CLEARED:', res.count);
  const after = await p.job.groupBy({ by: ['status'], _count: true });
  console.log('AFTER:', JSON.stringify(after));
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
