---
name: run-commands-on-kali-host
description: "All runtime commands (docker, adb, api, agent, dashboard, curl) must run on the Kali WSL host, not the assistant's Windows Bash tool"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2081351c-b595-4abe-a7a4-8341d8fdd198
---

The assistant's Bash tool runs on **Windows (Git Bash)**, but the runtime stack lives in **WSL2**. The WSL distro is named **`Ubuntu`** (NOT "Kali" — the shell user is `kali@furkan`, which is why it looks like Kali; `wsl -l -v` shows `Ubuntu` as the only running distro). The assistant CAN reach it directly:

```
wsl -d Ubuntu bash -lc 'COMMAND'
```

**Why:** The whole runtime (docker daemon, redroid containers, ADB, postgres, API on :4000, agent, Next dashboard on :3000) lives in WSL2 Ubuntu at `/mnt/c/Yeni klasör/vps`. Running commands directly in the Windows Bash shell fails (`setsid: command not found`) — but wrapping them in `wsl -d Ubuntu bash -lc '...'` runs them in the right place.

**How to apply:** Run stack/runtime/curl/adb/docker commands via `wsl -d Ubuntu bash -lc '...'` — the assistant does NOT need to hand commands to the user. CAVEAT: each `wsl` invocation is a separate short-lived session; background services started in one call (dockerd, `npx tsx`, `next dev`) die when that call returns unless detached with `nohup ... >log 2>&1 & disown` (or `setsid`). Always launch long-running services detached and verify with a follow-up `wsl` call. Use local Read/Write/Edit/Grep for code. See [[local-android-test-stack]].

**CRITICAL (learned 2026-06-25):** `/tmp` in WSL does NOT reliably persist across separate `wsl.exe` invocations — a file written to `/tmp` in one `wsl bash -lc` call is often invisible/empty in the next call (the API/dashboard/dockerd survive because they were started in the persistent main session, but per-call `/tmp` scratch files and logs do NOT). This silently breaks any script that writes a log/dump to `/tmp` and reads it in a later call (agent.log, uiautomator dumps, etc.). **FIX: write logs/scratch that must survive across calls to `/mnt/c/...` (the Windows-backed mount, which DOES persist and is readable from the Windows-side Read tool too).** Also `bash -lc` mangles inline `$VAR`, `$(...)`, multi-word grep patterns with spaces, and arithmetic `$(( ))` — always put non-trivial logic in a `.sh` script FILE under deploy/local-test and run `bash "/mnt/c/.../_script.sh" args`. The agent "keeps dying" symptom was actually `/tmp/agent.log` not persisting + pkill races, not the agent crashing.
