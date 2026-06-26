// Wire "Local Phone 01" to the Windows AVD emulator (127.0.0.1:5585) and make sure
// its host is the one our Windows agent will authenticate as. Prints the state so
// we can confirm the agent key matches.
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const HOST_KEY = process.env.WIRE_HOST_KEY || 'host_6bbbbfe1fd292aa80f2aa1b7ab1a0326';
const DEVICE_ID = 'cmqlrf4ni000gj50fjimgvk4u'; // Local Phone 01
const IP = '127.0.0.1';
const ADB_PORT = 5585;

(async () => {
  const keyHash = crypto.createHash('sha256').update(HOST_KEY).digest('hex');
  // Which host owns this agent key?
  const hostByKey = await p.host.findFirst({ where: { agentKeyHash: keyHash } });
  console.log('HOST matching FLEET_HOST_KEY:', hostByKey ? `${hostByKey.id} (${hostByKey.name})` : 'NONE');

  const dev = await p.device.findUnique({ where: { id: DEVICE_ID } });
  console.log('DEVICE before:', JSON.stringify({ id: dev?.id, name: dev?.name, hostId: dev?.hostId, ip: dev?.ipAddress, port: dev?.adbPort, status: dev?.status }));

  // Point the device at the AVD emulator. If a host matches the key, bind the device to it.
  const data = { ipAddress: IP, adbPort: ADB_PORT };
  if (hostByKey) data.hostId = hostByKey.id;
  const updated = await p.device.update({ where: { id: DEVICE_ID }, data });
  console.log('DEVICE after :', JSON.stringify({ id: updated.id, name: updated.name, hostId: updated.hostId, ip: updated.ipAddress, port: updated.adbPort, status: updated.status }));

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
