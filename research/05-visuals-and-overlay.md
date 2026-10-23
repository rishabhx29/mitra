# Research 05 — Persona (Avatar/Orb) + Overlay/Hotkey Tech

**Project:** Bolna Buildathon — cross-platform desktop AI voice assistant (Jarvis-like)
**Deadline:** Oct 31 2026 (1-week build) | **Platforms:** Windows / macOS / Linux
**Stack assumption:** Electron or Tauri + React + Three.js (WebGL)
**Researched:** 2026-10-24. All claims cite primary sources (GitHub repos, official docs).

---

## TL;DR

- **Orb persona is the safest, highest-wow/effort ratio.** Multiple MIT-licensed references exist (samantha-ui, my-jarvis); pattern = Three.js `ShaderMaterial` sphere + simplex-noise vertex displacement + fresnel rim + bloom, amplitude from a Web Audio `AnalyserNode`.
- **VRM avatar persona is very doable in a week** with `@pixiv/three-vrm` (MIT) + React Three Fiber + `wawa-lipsync` (MIT) driving VRM expression morphs. **Model sourcing is the only legal minefield** — safest: make our own in VRoid Studio (its guidelines explicitly allow commercial use of created models), or inspect embedded license meta before bundling any downloaded .vrm.
- **Ready Player Me is DEAD** (Netflix acquired Dec 2025; all public services wound down Jan 31 2026). Do not build on it.
- **Live2D Cubism SDK is legally fine for a hackathon demo** (individuals/small-scale < ¥10M/yr exempt) **BUT** an app that lets users *import their own* Live2D models is an "Expandable Application" requiring a signed agreement **even for individuals**, and free apps are "generally ineligible". Defer Live2D.
- **Overlay: choose Electron.** The exact pattern we need (global hotkey → transparent, frameless, always-on-top, skipTaskbar window + tray) is battle-tested and exists as MIT-licensed prior art (Open-LLM-VTuber's Electron pet mode, ueli). Tauri can do it but per-pixel click-through is an open feature request and the click-through API needs an extra capability permission — avoidable risk in 1 week.

---

## 1. 3D Avatar Tech

### 1.1 @pixiv/three-vrm — the VRM renderer

| | |
|---|---|
| **URL** | https://github.com/pixiv/three-vrm |
| **What** | Official pixiv library to load & animate VRM avatars (the standard anime-style 3D avatar format) in Three.js. Modular packages: core, animations (`@pixiv/three-vrm-animation`), spring-bone physics, node constraints, MToon toon shader. |
| **License** | **MIT** ([npm @pixiv/three-vrm-animation shows MIT](https://www.npmjs.com/package/@pixiv/three-vrm-animation); [LICENSE in repo](https://github.com/pixiv/three-vrm)) — covers **code only**, NOT avatar models. |
| **Maturity** | Very high. Actively maintained by pixiv; v3 supports WebGPURenderer (requires three.js r167+) per [MToon module docs](https://pixiv.github.io/three-vrm/docs/modules/three-vrm-materials-mtoon.html). |
| **R3F usage** | No official R3F wrapper needed: load via `GLTFLoader` + `VRMLoaderPlugin` inside R3F (`useLoader`/`useEffect`); community AR/RN discussion: [pixiv/three-vrm#1236](https://github.com/pixiv/three-vrm/discussions/1236), [R3F docs](https://docs.pmnd.rs/react-three-fiber/). |

**Usage skeleton (what we'd copy):**
```js
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const gltf = await loader.loadAsync('/avatar.vrm');
const vrm = gltf.userData.vrm;              // scene, expressions, humanoid
vrm.expressionManager.setValue('aa', 0.7);  // mouth open viseme (lip sync)
vrm.update(delta);                          // each frame (spring bones etc.)
```
VRM has a **standardized expression set** including visemes `aa, ih, ou, ee, oh` — exactly what a lip-sync system writes to.

**Reuse for us:** whole library, MIT, drop-in. Also ships **sample .vrm models** under `packages/three-vrm/examples/models/` (`VRM1_Constraint_Twintail_Sample.vrm`, `AliciaSolid.vrm`) — but those assets are NOT covered by the MIT code license (see §1.2).

### 1.2 VRM model sources & LICENSES (the real minefield)

- **VRoid Hub** ([hub.vroid.com](https://hub.vroid.com)) — every uploaded model carries its own per-model license chosen by the uploader (allowed user, violent/sexual use, commercial use, redistribution). The commercial flag is only set when OK for *both* individuals and corporations ([official help: "About VRoid Hub's conditions of use and VRM license"](https://vroid.pixiv.help/hc/en-us/articles/360016417013-About-VRoid-Hub-s-conditions-of-use-and-VRM-license)). **Bundling a random VRoid Hub model into our installer = redistribution; most models forbid it.** Use their [Download API](https://developer.vroid.com) only with per-model permission.
- **VRM files embed their license as metadata** (`allowedUserName`, `commercialUssageName`, etc.) — we can programmatically read & display it before loading a user-dropped model ([About license data for VRM files](https://vroid.pixiv.help/hc/en-us/articles/360014193033-About-license-data-for-VRM-files)). **Good feature for our settings UI** (show "this model allows commercial use / redistribution").
- **VRoid Studio** (free avatar maker, Windows/macOS/iOS) — its guidelines state **any individual or corporation may sell or commercially use any mesh/texture/preset/models made with VRoid Studio** ([VRoid Studio Guidelines / terms](https://vroid.com), [Steam page](https://store.steampowered.com/app/864060/VRoid_Studio/)). **→ Make our own mascot in VRoid Studio (1–2 h), license-clean to bundle.**
- **BOOTH (booth.pm)** — biggest VRM marketplace; each listing has its own license; some explicitly allow bundling/redistribution. Check per item.
- **Sample models in three-vrm repo** — `AliciaSolid.vrm` is a UniVRM/VRM Consortium sample with its own character license; VRM1 Constraint samples have no clearly stated per-model license. Verify embedded meta or ask pixiv before bundling ([three-vrm repo](https://github.com/pixiv/three-vrm)).

### 1.3 semperai/amica

| | |
|---|---|
| **URL** | https://github.com/semperai/amica |
| **What** | Open-source "chat with a 3D VRM character" app — voice in/out, emotion engine, vision. Fork of pixiv's ChatVRM. Next.js web app **+ Tauri desktop build**. |
| **Stack** | three.js + `@pixiv/three-vrm`; Whisper + Silero VAD; Transformers.js; LLM backends (llama.cpp/Ollama/OpenAI…); TTS (ElevenLabs/OpenAI TTS/Coqui…). |
| **License** | **MIT (code)**; 3D models/images keep original authors' licenses ([README](https://github.com/semperai/amica)). |
| **Maturity** | ~1.6k stars, 965 commits, v1.2 released, active. |

**Borrow:** its VRM loading + expression/lip-sync + blinking + idle-animation wiring in React; the "app settings → persona" architecture; Tauri packaging notes. Skip its LLM/TTS plumbing (we use Bolna).

### 1.4 Open-LLM-VTuber (and the "Lingyan" lineage)

| | |
|---|---|
| **URL** | https://github.com/Open-LLM-VTuber/Open-LLM-VTuber (frontend: `Open-LLM-VTuber-Web` submodule) |
| **What** | Open-source voice-interactive AI companion ("neuro-sama-like"), fully local. Live2D frontend (web + **Electron desktop**), Python backend, LLM/ASR/TTS pluggable (incl. Azure). |
| **Lip sync** | Backend **streams audio + lip-sync params over WebSocket** to the frontend; frontend renders Live2D with mouth params; can also drive VTube Studio ([repo README](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber), [Context7 docs](https://context7.com/open-llm-vtuber/open-llm-vtuber)). |
| **Desktop pet mode** | Electron: transparent background + global always-on-top + **click-through on non-interactive areas**, tray + right-click menu, drag/zoom, subtitles ([official docs — Window & Desktop Pet Mode](https://docs.llmvtuber.com/en/docs/user-guide/frontend/electron)). **This is exactly our "floating persona + overlay" prior art.** |
| **License** | Backend MIT (v1.2.0); project is moving to its own "Open-LLM-VTuber License 1.0" around v1.3–v1.4 ([discussion #258](https://github.com/orgs/Open-LLM-VTuber/discussions/258)) — **check before copying large chunks of code**. Bundled Live2D sample models are **Live2D Inc. assets under the Live2D Free Material License / Cubism Sample Data Terms, NOT the project license**. |
| **Maturity** | 14.3k stars, 1.7k forks, 913 commits; v2 rewrite in planning. |
| **Fork of note** | `ylxmf2005/LLM-Live2D-Desktop-Assitant` — Live2D desktop assistant w/ voice wake-up (linked from their README). |

**Borrow:** the Electron pet-mode window flags/tray/click-through pattern; WebSocket "state + audio" protocol shape (LISTENING/THINKING/SPEAKING); per-state emotion/expression mapping.

### 1.5 Live2D Cubism SDK licensing — CRITICAL READ

Primary sources: [SDK Release License (Publication License Agreement)](https://www.live2d.com/en/sdk/license), [CubismUnityComponents LICENSE.md](https://github.com/Live2D/CubismUnityComponents/blob/develop/LICENSE.md), [Expandable Applications plan](https://www.live2d.com/en/sdk/license/expandable), [help.live2d.com plans](https://help.live2d.com/en/sdk/sdk_001).

- SDK itself is **free to use**; the *publication* of content using it is what's licensed.
- **Individuals and Small-Scale Enterprises are exempt** from the Publication License. "Small-Scale" per the GitHub LICENSE.md = annual revenue **under ¥10,000,000 (~US$65–70k)**.
- **BUT "Expandable Applications" require a signed agreement for ALL publishers, including exempt individuals.** Definition: works that can "use and generate any indefinite numbers of models by adding or combining files or data" — i.e., **an app where users import their own Live2D models**. Per the [expandable plan page](https://www.live2d.com/en/sdk/license/expandable): review + agreement before release; **free apps are generally ineligible** (a valid revenue model is normally required); individuals pay no initial/annual fee but owe revenue share (¥300/sale or 20%, whichever higher).
- Web rendering: the official Cubism Web SDK exists; the popular community lib is `pixi-live2d-display` (PixiJS, MIT code — but rendering is still governed by the Cubism SDK terms above).

**Verdict for us:** a hackathon demo with a bundled sample model is legally low-risk (hobby use). But our product concept ("user chooses/imports avatars") is squarely an **Expandable Application**, and a free app is "generally ineligible" → **Live2D is a legal dead-end for shipping. Defer; use VRM instead** (VRM has no such SDK publication license).

### 1.6 aws-samples/amazon-sumerian-hosts

| | |
|---|---|
| **URL** | https://github.com/aws-samples/amazon-sumerian-hosts |
| **What** | AWS sample: talking 3D human hosts in three.js / Babylon.js — animation state machine, **Amazon Polly TTS with runtime lip-sync (viseme) generation**, Lex chatbot hook. |
| **License** | **MIT-0 (code); example assets CC-BY-4.0** — notably, the CC-BY assets CAN be bundled with attribution. |
| **Maturity** | 210 stars, experimental, effectively archive-level (Sumerian service itself was sunset). three.js tested at v0.127 (old). |

**Borrow:** the **viseme-to-morph mapping design** and "lipsync from TTS audio at runtime" architecture (their `TextToSpeechFeature` emits viseme events timed to speech). Code is dated; port the pattern, not the code.

### 1.7 Ready Player Me — DEAD (do not use)

- Netflix acquired RPM (Wolf3D) Dec 19 2025 ([Variety](https://variety.com/2025/digital/news/netflix-acquires-ready-player-me-games-avatar-creation-1236612915), [TechCrunch](https://techcrunch.com/2025/12/19/netflix-acquires-gaming-avatar-maker-ready-player-me)).
- **All public services ended Jan 31 2026** (avatar creator, Unity SDK, PlayerZero); `readyplayer.me` and `docs.readyplayer.me` no longer resolve (verified 2026-10-24); exported GLB files still work offline but no new avatars ([Wikipedia](https://en.wikipedia.org/wiki/Ready_Player_Me), [competitor migration guide](https://avatarsdk.com/blog/2026/07/07/ready-player-me-migration-guide)).

### 1.8 Lip-sync approaches — what's practical in 1 week

| Approach | How | License | Verdict for 1 week |
|---|---|---|---|
| **`wawa-lipsync`** ([github](https://github.com/wass08/wawa-lipsync)) | Web Audio `AnalyserNode` frequency buckets → current **viseme** per frame; you drive morphs. 3-line API: `connectAudio(el)` → `processAudio()` → read `viseme`. MIT, 211★ | MIT | **Best default.** Works with ANY TTS audio (incl. Bolna/ElevenLabs/Azure) since it listens to the played audio element. Used widely with VRM + R3F ([Wawa Sensei tutorial](https://wawasensei.dev/videos), [Gabber.dev guide](https://gabber.dev/blog/build-a-threejs-3d-avatar-with-realtime-ai-vision-voice-lip-sync-nextjs)). |
| **Azure TTS visemes** ([docs](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme)) | SSML `<mstts:viseme type="FacialExpression"/>` → `visemeReceived` event w/ timed visemes or **52-blendshape animation JSON**; JS SDK supported ([announcement](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/azure-neural-text-to-speech-extended-to-support-lip-sync-with-viseme/2356748)) | Azure terms (no extra fee) | **Best quality if TTS = Azure/Bolna-via-Azure.** Caveats: blendshape bugs reported for some voices ([js sdk #816](https://github.com/microsoft/cognitive-services-speech-sdk-js/issues/816)); ties us to Azure voices; timing alignment details ([Q&A](https://learn.microsoft.com/en-us/answers/questions/1523623/time-of-audio-visemes-and-blendshapes-in-speech-sd)). |
| **Rhubarb Lip Sync** ([github](https://github.com/DanielSWolf/rhubarb-lip-sync)) | Offline CLI: analyze a recording → timed mouth cues (JSON/TSV). Used in Thimbleweed Park. | **GPL** | **No** for bundling in a non-GPL app; also offline-only (wrong for realtime TTS). |
| **uLipSync** (Unity asset) | Realtime spectrum→viseme in Unity | Unity Asset Store terms | **No** — we're not on Unity. |
| **Raw morph targets + smoothing** | Drive `expressionManager.setValue('aa', x)` from amplitude; smooth w/ lerp ([SO: Smooth lipsync with morph targets](https://stackoverflow.com/questions/71951363/smooth-and-efficient-lipsync-with-morph-targets-in-three-js)) | n/a | The 1-hour fallback: single "mouth open" morph from audio amplitude looks surprisingly OK at hackathon demo distance. |
| **Sumerian-hosts pattern** | TTS emits viseme events consumed by morph controller | MIT-0 | Copy the architecture if we do server-side visemes. |

**Recommended:** wawa-lipsync → map its viseme output to VRM expressions (`aa/ih/ou/ee/oh`); fallback to amplitude→`aa`. Defer Azure blendshapes unless we're already on Azure voices.

### 1.9 MetaHuman / realistic humans (note: overkill)

MetaHuman = Unreal Engine proprietary pipeline (Creator license terms, huge asset/toolchain, no WebGL runtime) — weeks of work to get out of UE, zero fit for an Electron/Tauri WebGL app. Other "realistic talking head" options are hosted video APIs (D-ID, HeyGen, Sizzle-style) — API-priced, latency-heavy, and produce *video rectangles*, not an embeddable 3D persona; wrong shape for an always-on-top assistant orb. **Realistic human = defer.** If we want a slightly-more-human persona later: VRoid Studio characters with MToon or poly-count-reasonable CC0 humans from Sketchfab (per-model CC0) rendered via plain three.js GLTF.

---

## 2. Orb / Sphere / Audio-Reactive Visuals

The "Siri/Apple-Intelligence orb" look = glass/translucent sphere with swirling color ribbons + noise-displaced surface + bloom, pulsing with audio. Best open-source references, ranked:

### 2.1 desertcache/samantha-ui — BEST reference (MIT)

| | |
|---|---|
| **URL** | https://github.com/desertcache/samantha-ui |
| **What** | "Her"-inspired voice assistant orb: React 19 + Vite + **@react-three/fiber 9 + drei + three 0.182**, postprocessing (bloom, chromatic aberration, film noise, vignette), custom GLSL (Ashima 3D simplex noise). Orb morphs between "organic blob / thinking pulse / liquid silk" states. |
| **Audio-reactivity** | NOT Web Audio — Python backend pushes normalized amplitude (0–1) + state over WebSocket (`ws://localhost:8765`). Amplitude kept in `useRef` (no re-renders), smoothed by a `SmoothedValue` lerp class (fast ~50–60 for scale, slow ~0.5 for color/noise); 128×128-segment sphere displaced in vertex shader; Fresnel rim + emissive in fragment shader; LISTENING/THINKING/SPEAKING state machine drives uniforms. |
| **License** | **MIT** |
| **Maturity** | 2★, 9 commits — tiny but the shader architecture is exactly our use case. |

**Borrow:** the vertex/fragment shader pair (dual-model displacement + `uShapeMorph`), `SmoothedValue`, per-state uniform config, audio-synced subtitles. **Swap** the WebSocket amplitude source for a local `AnalyserNode` (Bolna audio) — we don't need their backend.

### 2.2 harsh-raj00/my-jarvis (MIT) — closest to our product

https://github.com/harsh-raj00/my-jarvis — React 18 + R3F + Framer Motion + Tone.js + FastAPI/Gemini/ElevenLabs backend. Siri-like orb: 5 morphing blob layers with gradient, conic-gradient halo, **audio-reactive scaling ("breathes with your voice")**, orbiting colored particles, spring-physics enter/exit, and **color-coded states 🔴 listening → 🟡 processing → 🟢 speaking**; separate 8,000-particle hologram sphere. MIT. Hobbyist-grade (14★) but concept-matched; the VoiceOrb component + state colors port directly.

### 2.3 TjardoOrtan/audio-reactive-shaders (MIT)

https://github.com/TjardoOrtan/audio-reactive-shaders — collection of React + three.js + GLSL shaders reacting to **live audio input** (mic/AnalyserNode) in real time. Direct code examples of the AnalyserNode→uniform pipeline we need. See also GitHub topics [audio-reactive](https://github.com/topics/audio-reactive) and [shader-effects](https://github.com/topics/shader-effects).

### 2.4 Tutorials to build it from scratch (often faster than adapting a repo)

- **Codrops 2025: "Coding a 3D Audio Visualizer with Three.js, GSAP & Web Audio API"** — https://tympanus.net/codrops/2025/06/18/coding-a-3d-audio-visualizer-with-three-js-gsap-web-audio-api — glowing orb pulsing/spiking to audio; `ShaderMaterial` + simplex noise displacement. Essentially our orb spec, written out.
- **Codrops 2023: audio-reactive particles** — https://tympanus.net/codrops/2023/12/19/creating-audio-reactive-visuals-with-dynamic-particles-in-three-js
- **clicktorelease: vertex displacement with noise** — https://www.clicktorelease.com/blog/vertex-displacement-noise-3d-webgl-glsl-three-js — the classic fresnel+noise displacement snippet.
- **Codrops 2021: twisted colorful spheres** — https://tympanus.net/codrops/2021/01/26/twisted-colorful-spheres-with-three-js — gradient color techniques.
- **Medium: voice-reactive orb in React** — https://medium.com/@therealmilesjackson/building-a-voice-reactive-orb-in-react-audio-visualization-for-voice-assistants-2bee12797b93 — mic capture → normalization → iridescent shader, assistant-specific.
- Swirl-ribbon fragment shaders: https://github.com/markuslerner/spiral, https://gist.github.com/JMHeartley/88efefbb1aef817f3f65f284cfca55bb

### 2.5 Component libraries (drop-in, non-WebGL)

- **SmoothUI `siri-orb`** — https://github.com/educlopez/smoothui (+ [docs](https://smoothui.dev/docs/components/siri-orb), ~1k★) — MIT, shadcn-registry install (`npx shadcn@latest add @smoothui/siri-orb`). **CSS/Motion-based** (deps: motion, tailwind — no WebGL): animated color-transition orb, props for size/colors/animationDuration. No audio reactivity. **Great for the small overlay bar** (cheap, tiny, no WebGL context in the overlay window); not "3D" enough for the main persona.
- **Wensity "Siri Orb"** — https://ui.wensity.com/components/siri-orb — beautiful raw-WebGL glass sphere, **but it's a PAID "Pro" component** (source lands in your repo under Wensity's commercial terms, not OSS). Avoid for licensing; also not audio-reactive (they sell a separate "Voice Reactive Orb").

### 2.6 Audio-reactive pattern (three.js official)

`THREE.AudioAnalyser` wraps Web Audio: `analyser.getAverageFrequency()` (0–255) per frame → scale/emissive uniforms — official docs + example: https://threejs.org/docs/pages/AudioAnalyser.html. Canonical loop:

```js
const analyser = new THREE.AudioAnalyser(sound, 32);
function tick() {
  const v = analyser.getAverageFrequency();       // 0..255
  uniforms.uAudio.value = v / 255;                // → vertex displacement / emissive
  mesh.scale.setScalar(1 + v / 256);
}
```
For **TTS audio** (Bolna/ElevenLabs streams), attach the `MediaStreamAudioSourceNode`/`MediaElementSourceNode` to an `AnalyserNode` directly and poll `getByteFrequencyData()` — same idea, works for any `<audio>`/stream (this is what wawa-lipsync does internally, and the pattern in the Codrops 2025 tutorial).

---

## 3. Desktop Pets / Mascots (prior art for a floating persona)

| Project | URL | What / Tech | License | Reuse |
|---|---|---|---|---|
| **Shimeji-ee (Kilkakon fork)** — the classic | https://kilkakon.com/shimeji ([repo list](https://github.com/topics/shimeji)) | Java/Swing desktop mascots wandering the screen, Windows (community mac support) | Open source, custom permissive terms (check repo LICENSE) | UX reference only (configurable actions/behavior sets); Java stack ≠ ours |
| **gil/shimeji-ee** | https://github.com/gil/shimeji-ee | Fork fixing macOS compat | same | — |
| **DalekCraft2/Shimeji-Desktop** | https://github.com/DalekCraft2/Shimeji-Desktop | Electron port of Shimeji (Win/macOS/Linux) | check repo | Multi-window transparent mascot window patterns |
| **DesktopMate** | https://store.steampowered.com/app/3301060/Desktop_Mate | Steam mascot app (Unity), paid + licensed-character DLC, Very Positive reviews | **Closed source** | Pure UX reference (how a commercial floating mascot behaves: idle animations, interactions) |
| **Open-LLM-VTuber pet mode** | https://docs.llmvtuber.com/en/docs/user-guide/frontend/electron | Electron desktop-pet: transparent + always-on-top + click-through non-interactive areas, tray, drag/zoom, floating subtitles | MIT (frontend) | **#1 technical prior art for our floating persona window** |
| **OpenPets** | https://openpets.dev/alternatives/shimeji | Free OSS pet app for Win/macOS/Linux (2026) | OSS | Reference/possible bundling competitor research |

**Takeaway:** our "persona floats above apps, draggable, non-focus-stealing" requirement is *exactly* Open-LLM-VTuber's pet mode + Shimeji's behavior model. Copy the Electron window flags and tray/menu UX.

---

## 4. Overlay + Global Hotkey Windows

### 4.1 Electron (recommended)

**Pattern** (all official docs):
- `globalShortcut.register('Alt+Space', …)` — https://www.electronjs.org/docs/latest/api/global-shortcut
- Summon window: `new BrowserWindow({ frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, … })`, then `win.setPosition(center, top)` / `win.show()` + `win.focus()` — window options: https://electronjs.org/docs/latest/api/base-window, https://electronjs.org/docs/latest/api/browser-window
- Keep on top over full-screen apps (macOS): `win.setAlwaysOnTop(true, 'screen-saver')` ([SO](https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac), [medium guide](https://syobochim.medium.com/electron-keep-apps-on-top-whether-in-full-screen-mode-or-on-other-desktops-d7d914579fce))
- Click-through where needed: `win.setIgnoreMouseEvents(true, { forward: true })` (forward is Windows-only) toggled via IPC on hover — official: https://www.electronjs.org/docs/latest/api/browser-window; pattern discussed in [electron#23042](https://github.com/electron/electron/issues/23042)

**Known caveats (official "Custom Window Styles" doc, https://electronjs.org/docs/latest/tutorial/custom-window-styles):**
- Transparent windows are **not resizable** (making them resizable breaks transparency on some platforms).
- No per-pixel click-through of transparent areas → use `setIgnoreMouseEvents` + forward trick.
- Windows GPU/DWM quirks with transparent windows; a recent X11 regression for `setIgnoreMouseEvents` on transparent always-on-top windows: [electron#52456](https://github.com/electron/electron/issues/52456) (Jul 2026) — Linux is our risk platform.
- Always-on-top focus-change bug is old/known: [electron#2097](https://github.com/electron/electron/issues/2097).

**Example repos to copy:**
1. **ueli** — https://github.com/oliverschwendener/ueli (MIT, ~active, Electron keystroke launcher for Win/macOS/Linux; hotkey → centered spotlight bar; unsigned binaries noted). UX reference + main-process window management code.
2. **Open-LLM-VTuber-Web (Electron)** — https://github.com/Open-LLM-VTuber/Open-LLM-VTuber — pet mode implementation (transparent/click-through/always-on-top/tray).
3. Practical overlay write-up (hide from screen-share, always-on-top): https://levelup.gitconnected.com/how-i-made-a-desktop-app-invisible-to-screen-sharing-electron-os-level-tricks-5734513c1e67 ; Windows fullscreen-overlay war story: https://www.reddit.com/r/electronjs/comments/1w7osmi/getting_a_transparent_alwaysontop_electron_window

**Other launcher UX references:** ueli is the best-maintained OSS one; Albert/Zazu/Hain are native/stale — skip.

### 4.2 Tauri (v2)

- **global-shortcut plugin** (official): https://v2.tauri.app/plugin/global-shortcut — register hotkey → `window.show()/hide()/setFocus()`; community pattern for launcher window: [discussion #5281](https://github.com/orgs/tauri-apps/discussions/5281), [SO](https://stackoverflow.com/questions/78056795/how-to-re-open-a-minimized-tauri-application-with-keyboard-shortcuts).
- **Transparent + alwaysOnTop windows**: supported via config (`transparent: true`, `alwaysOnTop`), Windows uses WebView2 composition — window customization guide: https://v2.tauri.app/learn/window-customization
- **Click-through**: `webviewWindow.set_ignore_cursor_events(true)` exists, but the permission `core:window:allow-set-ignore-cursor-events` is **not in `core:window:default`** — must be added to capabilities ([window API reference](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow), [docs.rs](https://docs.rs/tauri/latest/tauri/window/struct.Window.html)); it was historically Window-only and later added to WebviewWindow ([issue #10564](https://github.com/tauri-apps/tauri/issues/10564)). **Per-pixel** click-through is still an open feature request ([issue #13070](https://github.com/tauri-apps/tauri/issues/13070)).
- Proven voice-overlay app on Tauri: **Whispering / Epicenter** (below).

**Tauri vs Electron for THIS project:** Tauri's smaller bundle is nice, but for a 1-week hackathon the risks stack up: click-through permission/quirks, per-pixel click-through missing, WebView2 transparency edge cases, less prior art for "3D WebGL inside a transparent overlay window" (Electron + Chromium is extremely well-trodden — Open-LLM-VTuber, ueli, countless overlays). **Electron wins on risk, not on elegance.**

### 4.3 Open-source "voice assistant overlay" prior art

| Project | URL | What | License | Note |
|---|---|---|---|---|
| **Whispering (Epicenter)** | https://github.com/epicenter-so/epicenter (`apps/whispering`), https://epicenter.so/whispering | Tauri + Svelte dictation app: global shortcut → small overlay → record → transcribe → paste into any app; local-first | **AGPL-3.0** (MIT tier dissolved Aug 2026) | Perfect UX reference for our summon bar. **AGPL = cannot copy code into our app unless we AGPL it; study, don't fork.** ([HN thread](https://news.ycombinator.com/item?id=44942731)) |
| **Whisperi** | https://github.com/xarthurx/whisperi | Fork/variant of Whispering, same concept | check repo | — |
| **Open-LLM-VTuber** | https://github.com/Open-LLM-VTuber/Open-LLM-VTuber | Electron AI companion w/ pet-mode overlay | MIT (moving to custom license) | Closest full product analog (voice + persona + overlay) |

---

## 5. License summary table (what we may ship)

| Asset / SDK | License | Bundlable in our app? |
|---|---|---|
| three.js, R3F, drei | MIT | Yes |
| @pixiv/three-vrm | MIT | Yes (code) |
| wawa-lipsync | MIT | Yes |
| amica code | MIT | Yes |
| Open-LLM-VTuber code | MIT (v1.2; custom license coming) | Yes for now; re-check |
| samantha-ui, my-jarvis, audio-reactive-shaders, ueli, SmoothUI | MIT | Yes |
| Sumerian hosts code / example characters | MIT-0 / CC-BY-4.0 | Yes w/ attribution |
| VRM models from VRoid Hub / Booth | **Per-model** (embedded meta) | Only if that model allows redistribution + commercial use |
| VRM models made in VRoid Studio | Creator retains rights; commercial use allowed | **Yes — make our own** |
| Live2D Cubism SDK + models | Publication License regime; Expandable Apps need signed agreement even for individuals; free apps generally ineligible | **No (for our concept) — defer** |
| Rhubarb Lip Sync | GPL | No (non-GPL app) |
| Ready Player Me | Service dead (Jan 31 2026) | N/A |
| Whispering/Epicenter code | AGPL-3.0 | No (unless we AGPL) — reference only |
| Wensity Siri Orb | Commercial "Pro" component | No |

---

## Recommended UI approach for our 1-week build

1. **Shell: Electron + React + Vite** (not Tauri). Two windows from day 1: (a) **Overlay** — small circular `frame:false, transparent:true, alwaysOnTop, skipTaskbar` window near top-center, summoned by `globalShortcut` (e.g. `Alt+Space`), hidden on Escape/blur; (b) **Main settings window** — normal framed window (persona picker, colors, app-permissions list, hotkey config). Tray icon with menu. Copy window/tray mechanics from ueli + Open-LLM-VTuber pet mode (both MIT). Budget: 1 day. Watch: don't set `resizable:true` on the transparent overlay; on macOS use `setAlwaysOnTop(true,'screen-saver')`.
2. **Persona #1 (ship first): 3D orb.** One R3F canvas, 128-seg icosphere, custom `ShaderMaterial`: simplex-noise vertex displacement + fresnel rim + emissive gradient, `@react-three/postprocessing` bloom. Uniforms: `uAudio` (amplitude), `uState` (LISTENING/THINKING/SPEAKING), `uColorA/B` (user-customizable). Reference implementations: samantha-ui (MIT, steal shaders + `SmoothedValue`) + Codrops 2025 audio-visualizer tutorial. For the **tiny overlay bar**, use SmoothUI's CSS `siri-orb` (MIT, no WebGL needed in the overlay window). Budget: 1–1.5 days. Orb = our demo-safe baseline; it must be done by day 3.
3. **Persona #2: VRM mascot.** `@pixiv/three-vrm` (MIT) in the same canvas behind a persona switch. Model: create one in VRoid Studio (free; its guidelines allow commercial use of created models) and/or bundle three-vrm sample only after reading embedded license meta. Users can drop their own `.vrm`; our settings UI reads and displays the model's embedded license fields (nice "we care about licenses" judge moment). Budget: 1–1.5 days.
4. **Audio-reactivity: local Web Audio `AnalyserNode`** on the TTS output stream (works with Bolna audio regardless of provider): `getByteFrequencyData` → smoothed amplitude → `uAudio` (orb) and mouth morphs (avatar). No network round-trips; same path powers idle breathing animation. Budget: included above.
5. **Lip sync: `wawa-lipsync` (MIT)** → map viseme → VRM expressions (`aa/ih/ou/ee/oh`); fallback single-`aa` amplitude morph if integration slips. Azure blendshape visemes only if we're locked to Azure voices anyway. Defer: Rhubarb (GPL + offline), uLipSync (Unity).
6. **Explicitly deferred (say so in the demo):** Live2D (Expandable-Application license wall for user-imported models), Ready Player Me (service shut down Jan 2026), MetaHuman (Unreal-only, weeks of work), hosted talking-head video APIs (wrong shape for an assistant overlay).

**Fallback plan if 3D slips:** SmoothUI siri-orb + CSS glow rings in both windows is a legitimate Siri-like fallback that ships in hours — so the overlay experience never blocks on WebGL.
