# Local test on Kali (WSL2, custom binder kernel) — step by step

This is the Kali/WSL2 path we actually built: a custom WSL2 kernel with **binder**
compiled in, **native Docker** inside Kali (no Docker Desktop), redroid phones and
all data services on the **host network** (the daemon runs with the bridge
disabled). Use this after a Windows restart.

## What's already done (one-time, don't repeat)
- Custom kernel with binder built → `C:\wsl-kernel\bzImage`
- `C:\Users\<you>\.wslconfig` points WSL at that kernel
- Native Docker Engine installed in Kali (`/usr/bin/dockerd`)
- iptables set to legacy; `/etc/docker/daemon.json` = `{ "iptables": false, "ip6tables": false, "bridge": "none" }`
- adb installed

## 0. Sanity after restart
```bash
uname -r        # must end in a '+'  → custom kernel active
cat /proc/filesystems | grep binder   # must show: nodev binder
```
If `uname -r` does NOT end in `+`, the custom kernel isn't loaded — check
`C:\Users\<you>\.wslconfig` and run `wsl --shutdown` in PowerShell, then reopen Kali.

## 1. Bring the stack up (one command)
```bash
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/boot-kali.sh"
```
This mounts binderfs, starts dockerd, brings up Postgres+Redis and the two
phones, and waits for Android to boot. At the end you should see
`127.0.0.1:5555  device`.

> Internet note: the daemon runs with networking disabled for bridges. If `apt`/
> `npm` can't reach the internet while the phones are up, run the internet step
> (step 2) in a shell BEFORE starting dockerd, or briefly `sudo pkill dockerd`,
> do the download, then re-run boot-kali.sh.

## 2. Node (one-time, needs internet)
If `node --version` says not found:
```bash
# If internet works:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v22.x
```

## 3. API deps + DB migrate/seed (one-time, needs internet)
The Windows-side `node_modules` may have wrong native binaries for Linux, so do a
clean install inside Kali:
```bash
cd "/mnt/c/Yeni klasör/vps/apps/api"
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed          # creates admin@local.dev
```

## 4. Start the API
```bash
cd "/mnt/c/Yeni klasör/vps/apps/api"
npm run dev              # → http://localhost:4000
```
Leave it running. In another Kali tab, check: `curl -s localhost:4000/health`.

## 5. Register the phone + start the agent
```bash
cd "/mnt/c/Yeni klasör/vps"
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
# one phone is enough to prove the flow; ADB endpoint is 127.0.0.1:5555
FLEET_ADB_PORTS=5555 node deploy/local-test/register.mjs admin@local.dev '<ADMIN_PASSWORD>'
```
Copy the `FLEET_HOST_KEY=...` it prints, then in another tab:
```bash
cd "/mnt/c/Yeni klasör/vps"
FLEET_API_URL=http://localhost:4000 \
FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9 \
FLEET_HOST_KEY=<printed key> \
node deploy/kvm-host/agent/agent.mjs
```
Node is 22 here, so live screen / wall streaming works.

## 6. Dashboard
```bash
cd "/mnt/c/Yeni klasör/vps/apps/dashboard"
npm install && npm run dev      # → http://localhost:3000
```
Log in as `admin@local.dev`, open **Profiller** → the phone should be ONLINE.
Try **Canlı ekran → Yayını başlat**, then RPA / Farm.

## Shutting down / restarting
- Stop phones:  `sudo docker compose -f deploy/local-test/docker-compose.hostnet.yml down`
- Stop DB:      `sudo docker compose -f deploy/local-test/db-hostnet.yml down`
- After a Windows restart: just re-run `boot-kali.sh` (step 1).

## Phone-02 note
redroid advertises the 2nd phone as `emulator-5554` rather than `127.0.0.1:5556`.
One phone (5555) is enough to validate everything. To add the 2nd as a proper TCP
endpoint we can run it on a separate ADB port later — ask when you want it.
