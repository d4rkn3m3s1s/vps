// Wire all 3 Local Phones to the 3 AVD emulators (TCP serials) and bind them to
// the Windows agent's host so a single agent drives all three in parallel.
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const HOST_KEY = 'host_6bbbbfe1fd292aa80f2aa1b7ab1a0326';
const MAP = [
  { id: 'cmqlrf4ni000gj50fjimgvk4u', name: 'Local Phone 01', port: 5585 },
  { id: 'cmqlvzpvs000ij5lmibhtqx5u', name: 'Local Phone 02', port: 5587 },
  { id: 'cmqn45mfe000lj5my8gz5nr2j', name: 'Local Phone 03', port: 5589 }
];

(async () => {
  const keyHash = crypto.createHash('sha256').update(HOST_KEY).digest('hex');
  const host = await p.host.findFirst({ where: { agentKeyHash: keyHash } });
  console.log('host for agent key:', host ? `${host.id} (${host.name})` : 'NONE');
  for (const m of MAP) {
    const data = { ipAddress: '127.0.0.1', adbPort: m.port };
    if (host) data.hostId = host.id;
    const u = await p.device.update({ where: { id: m.id }, data });
    console.log(`${m.name} -> 127.0.0.1:${m.port} host=${u.hostId} status=${u.status}`);
  }
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
