# VPS Fleet — KVM Android Host

This folder turns a bare-metal Linux server into a **cloud-phone host**: real Android
instances (via [redroid](https://github.com/remote-android/redroid-doc)) backed by
hardware virtualization, controlled by the VPS Fleet API over ADB.

> ⚠️ **A regular VPS will not work.** Android emulators need `/dev/kvm`
> (hardware virtualization). Use a bare-metal / dedicated server. Recommended:
> **Hetzner AX42 / AX52 / AX102**, OVH Advance, or any host exposing nested KVM.

## 1. Provision the server

| Spec | Minimum | Comfortable |
|------|---------|-------------|
| CPU | 6 cores | 12+ cores (Ryzen/EPYC) |
| RAM | 16 GB | 64 GB |
| Disk | 256 GB SSD | 1 TB NVMe |
| OS | Ubuntu 22.04 | Ubuntu 24.04 |
| Phones | ~4 | ~20–40 |

Rule of thumb: **~2 GB RAM + 1 vCPU per running cloud phone.**

## 2. Install

```bash
git clone <your-repo> fleet && cd fleet/deploy/kvm-host
sudo bash install.sh
```

The installer:
1. Verifies `/dev/kvm` exists (aborts if not — that means no virtualization).
2. Installs Docker + Compose.
3. Loads `binder_linux` + `ashmem_linux` kernel modules.
4. Installs `adb`.
5. Brings up the emulator stack from `docker-compose.yml`.

If `binder_linux` is missing:
```bash
sudo apt-get install -y linux-modules-extra-$(uname -r)
sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"
```

## 3. Verify the phones

```bash
adb connect localhost:5555
adb devices            # should list emulator(s) as "device"
adb -s localhost:5555 shell getprop ro.product.model
```

## 4. Connect to the control plane (host agent)

The host runs a small **agent** that long-polls the API for jobs targeting the
phones on *this* host and executes them over local ADB. No inbound ports, no
worker on the host — the agent reaches out. This is what makes the dashboard's
**Screenshot / Install / Open app / Push file / Set proxy / RPA** actions run for
real.

**a. Register the host in the dashboard** → **Hosts → Register**. You get a
**one-time agent key** (`host_…`) shown once — copy it.

**b. Create the phones as Devices** (Profiles → New profile). Each Device's
`ipAddress:adbPort` points at one phone (e.g. `127.0.0.1:5555`).

**c. Assign each Device to this host.** Editing a device with
`{"hostId": "<host id>"}` (the dashboard's host picker, or
`PATCH /devices/:id`) tells the agent that device is its responsibility.

**d. Install & start the agent:**

```bash
cd fleet/deploy/kvm-host/agent
sudo ./install-agent.sh
sudo nano /etc/fleet-agent.env     # FLEET_API_URL, FLEET_API_KEY, FLEET_HOST_KEY
sudo systemctl start fleet-agent
journalctl -u fleet-agent -f       # watch it claim & run jobs
```

The agent calls three endpoints (auth = `x-api-key` **and** `x-agent-key`):

| Endpoint | Purpose |
|----------|---------|
| `GET /agent/jobs/next` | Atomically claim the next PENDING job for this host's devices |
| `POST /agent/jobs/:id/complete` | Report `COMPLETED` / `FAILED` + result; fires webhooks |
| `POST /agent/heartbeat` | Keep the host `ONLINE` + report running phone count |

Secrets stay server-side: the proxy password is decrypted into the claimed job
payload only at claim time, and the agent key is stored as a hash — never returned
in any list.

## 5. Scale up

Add more phones by copying a service block in `docker-compose.yml` with a new
name + port, then `docker compose up -d`. For large fleets, generate the compose
file from the control plane and run multiple hosts behind the same API.

## Security

- Never expose ADB ports (5555+) to the public internet — keep them on a private
  network / WireGuard and let only the API reach them.
- Proxy passwords and social tokens are already encrypted at rest (AES-256-GCM)
  in the control plane.

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `/dev/kvm not found` | Server has no virtualization — switch to bare-metal. |
| redroid container restarts | `binder_linux` not loaded — see step 2. |
| `adb` shows `offline` | Wait ~30s for Android to boot; re-`adb connect`. |
| Black screenshots | Set `androidboot.redroid_gpu_mode=guest` (already default here). |
