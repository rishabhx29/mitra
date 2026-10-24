# Mitra UI Polish — Design Brief (v1)

> Direction set by the orchestrator after an Awwwards inspiration pass (nominees `peri-a-i-pet-care-assistant`, `orbyt` — cached evidence thin, so tokens below are first-principles). References in spirit: Raycast spotlight aesthetics, Linear-style dark surfaces, Apple-Intelligence orb language.

## Design tokens (apply everywhere)

- **Base**: near-black `#0a0a0f`; settings bg with a faint radial gradient tinted by the user's orb colors (read from `settings.orbColors` → CSS vars `--orb-a/--orb-b`).
- **Surfaces**: cards `bg-white/[0.04]` + `backdrop-blur-xl` + `border border-white/[0.08]` + subtle top inner-highlight (`shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`). Rounded-2xl.
- **Accent system**: gradient `linear-gradient(135deg, var(--orb-a), var(--orb-b))` for active states, primary buttons, the sidebar indicator, hero headline highlight. State colors: listening `#38bdf8`, thinking `#fbbf24`, speaking `#a78bfa`, error `#f87171` (already in overlay ring — reuse in settings status).
- **Type**: micro-labels uppercase `text-[11px] tracking-[0.14em] text-zinc-500`; headings `font-semibold text-zinc-50`; body `text-zinc-400`.
- **Motion**: 150–250ms `ease-out` on hover/collapse; card hover = `translateY(-1px)` + border-glow to 25% orb-a; entrance stagger ≤ 60ms/item; **respect `prefers-reduced-motion`** (static, no translate).
- **KBD chips**: `rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px]` for hotkeys (Ctrl+Shift+Space).

## Home / landing (first settings page)

1. **Hero**: gradient headline ("Your desktop, on voice." / hi equivalent), one-line sub, a `KBD Ctrl+Shift+Space` "Try it — summon Mitra" button that shows the overlay via existing IPC (tray toggle handler), provider-mode badge (Mock/Live).
2. **Feature grid** (6 glass cards, icon + title + 1-liner, en+hi): Voice control · Permission-gated apps · Notion actions · opencode coding agent · Hindi & Hinglish · 3D persona (orb/avatar).
3. **Status strip**: bridge health (fetch `/api/health`), provider mode, app version, hotkey.
4. **How it works**: 3 steps (Summon → Speak → Granted apps only) as a horizontal strip.

## Overlay (220×220 circle — declutter)

- **No captions list, no scrollbar**: `overflow:hidden` enforced; content must fit.
- **Status pill** under the orb: state word + animated dots (Listening… / सोच रहा हूँ… etc via i18n), pill tinted with state color.
- **Last reply**: single line, `text-[11px] text-zinc-400`, fades to 0 after ~6s, truncates mid-line (no wrap).
- **Orb shape**: softer organic blob — dual-frequency simplex (add slow low-freq component), inner additive-glow core sphere (~0.5 scale), gentle continuous rotation drift, state-specific pulse amplitude; bloom stays.
- **Inactivity timeout**: `listening` with no speech for **12s** → system note "No speech detected" → auto stop + dismiss; `thinking` > **30s** → error note + dismiss. Constants at top of module; unit-test the timer reducer.

## Avatar (upload fixes)

- File input `accept=".vrm"` (drop the MIME — it grays files out in Windows dialogs) + extension validation + friendly error.
- **Drag-and-drop** zone with hover state.
- **Persistence** (approved contract change): `Settings.avatarVrmPath?: string`; new IPC copies the picked file to `userData/avatars/current.vrm` and stores the path; loaded on startup.
- **Bundled sample**: `app/assets/avatars/Seed-san.vrm` (VRM Consortium spec sample — evaluation use, attribution kept in-app via existing license display + README note). One-click "Use sample avatar".
- Empty state: dashed drop-zone card with CTA, not a bare paragraph.

## Process rules

- Agents: TypeScript strict, `npm run typecheck && npm run build && npx vitest run` green before done; i18n en+hi for ALL new copy; no new deps (no framer-motion — Tailwind transitions + CSS keyframes only); don't commit — the orchestrator makes thematic commits.
