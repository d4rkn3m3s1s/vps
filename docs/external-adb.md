# External ADB Access

Connect to a cloud phone from your own machine using `adb`, `scrcpy`, or any
ADB-based tooling. Three layers, from safest to most powerful:

1. **Connect info** — get the `adb connect host:port` command + serial from the API.
2. **Remote exec** — run a shell command through the API without opening any port.
3. **Public exposure** — forward the device's ADB port to a public host:port (admin, IP-allowlisted).

All endpoints require the `x-api-key` header **and** a workspace-scoped JWT
(`Authorization: Bearer …`). Exposure additionally requires an admin role.

---

## 1. Get connection info

```
GET /devices/:id/adb/connect-info
```

Returns the internal serial, exposure status, and copy-paste commands:

```json
{
  "serial": "172.16.4.12:5557",
  "exposed": false,
  "allowlist": [],
  "commands": {
    "connect": "adb connect 172.16.4.12:5557",
    "shell":   "adb -s 172.16.4.12:5557 shell",
    "scrcpy":  "scrcpy -s 172.16.4.12:5557",
    "disconnect": "adb disconnect 172.16.4.12:5557"
  }
}
```

The dashboard surfaces these on each profile's detail page ("External ADB access").
The internal serial is reachable from the **host network**. To reach a phone from
outside that network, expose it (step 3) or run the commands from a machine on
the host network / VPN.

### Connect from your machine

```bash
adb connect 172.16.4.12:5557        # or the public host:port if exposed
adb devices                          # confirm it shows up
adb -s 172.16.4.12:5557 shell        # interactive shell
scrcpy -s 172.16.4.12:5557           # mirror + control the screen
```

---

## 2. Remote shell exec (no open port)

Run a command on the device through the API and get stdout/stderr back
synchronously — useful for automation and the dashboard console.

```
POST /devices/:id/adb/exec
{ "command": "getprop ro.product.model" }
```

```json
{ "command": "getprop ro.product.model", "stdout": "sdk_gphone_x86\n", "stderr": "", "exitCode": 0 }
```

---

## 3. Public exposure (admin)

Opens the device's ADB to a public `host:port`. **Unauthenticated ADB grants full
root-level control of the device** — always set an IP allowlist (CIDR or plain IPs).

```
POST /devices/:id/adb/expose
{ "publicHost": "203.0.113.10", "publicPort": 5557, "allowlist": ["1.2.3.4", "10.0.0.0/24"] }
```

Stop exposing:

```
DELETE /devices/:id/adb/expose
```

The API records the exposure intent + allowlist; the **host agent** sets up the
actual TCP forward (and should enforce the allowlist at the firewall). Disable
exposure as soon as you're done.

### Security checklist
- Prefer **step 1 or 2** over public exposure whenever possible.
- Always provide an `allowlist`; never expose ADB to `0.0.0.0/0`.
- Exposure and exec are **audit-logged** (`device.adb.expose`, `device.adb.exec`).
- Revoke the API key (Admin → API keys) if a credential leaks.
