---
name: dashboard-brand-orbit
description: "Dashboard brand identity \"ORBIT\" — atom indigo→electric blue on near-black; the platinum/grey theme was rejected as washed-out"
metadata: 
  node_type: memory
  type: project
  originSessionId: 27407aa3-afb1-4b1b-8795-dc7f23a050e8
---

The dashboard brand is **"ORBIT"** — metaphor: a fleet of cloud phones orbiting one command core. Canvas is near-black blue-ink (`--bg: #07070d`); the single signature accent is **atom indigo → electric blue** (`--accent: #7c6bff`, `--accent-2: #6a8bff`, `--accent-3: #4f9bff`, gradient `#9d6bff→#6a8bff→#4f9bff`). The user explicitly chose "Atom moru → mavi" over emerald/amber/cyan.

**Why:** the earlier "Obsidian Platinum" (achromatic grey `#c8ccd4`) theme read washed-out/dead — the user said "tasarım rengi co kotu oldu". Greys with no chroma made glass panels blob together. Real color fixed it.

**How to apply:**
- All theme color lives in `apps/dashboard/src/app/globals.css` `:root` tokens; recoloring the token block re-skins all ~109 files. Components use `var(--accent*)`, never hardcode.
- The gradient-accent is LIGHT, so text on a solid `var(--gradient-accent)` background must be DARK (`#0a0a0c`), not `#fff` (that was a contrast bug, fixed in 3 spots: ws-avatar, ws button, a badge).
- Homepage (`/` = `page.tsx`) has a scroll-driven 3D hero: [[../../../../../Yeni klasör/vps/apps/dashboard/src/components/FleetHero3D.tsx]] (orbit rings + command core, framer-motion useScroll/useTransform, GPU-only, reduced-motion safe).
- Status colors stay semantic: success `#2ce29a`, warn `#ffb020`, danger `#f0506e`. Social-brand hexes (Instagram/FB/Reddit) are intentional, leave them.
