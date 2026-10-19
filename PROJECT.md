# Project: Celestial Vocab V5 - Cinematic Splendor & GPU Optimization

## Architecture
- **Front-end Core**: Pure Vanilla JavaScript (ES modules) bundled with Vite 5.
- **Styling & Motion**: Pure GPU-accelerated CSS keyframe animations, 2D Canvas `#celestial-canvas` with offscreen sprite caching and DPR=1 pinning, Anime.js for single-shot UI transitions.
- **Theme Transition**: Shipper Curtain / Celestial Eclipse & Dawn (~1.9s: 720ms close, 450ms dwell, 740ms open), zero-gap $\ge 24\text{px}$ overlap across all viewports ($320\text{px}$ to $4\text{K}$), `pointer-events: auto` modal shield.
- **Sound Engine**: Web Audio API synthesizing polyphonic celestial crystal chords (Eclipse nocturne triad & Dawn solar triad) without external audio asset downloads.
- **GPU & Mobile Optimization**: True 0% idle GPU consumption via 1.2s auto-sleep RAF cancellation; automatic suspension on `modal-active`, `window-blurred`, tab hidden, or typing; universal `backdrop-filter: none !important;` on $\le 768\text{px}$; instant 0ms Boost Mode.
- **Cognitive Engine (FSRS-7)**: 34 biological parameters (Dual-Stability DSR), Newton-Raphson interval solver on $\ln(t)$, Heuristics v2 word difficulty classifier.
- **Storage & Synchronization**: `idb` v8.0.3 (IndexedDB) with Firestore 4-Vector Disentangled Sync (Tombstone, SRS Memory, Content, Tags/Flags) and 3-minute clock skew guard.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Custom Topic Dropdown | Tag selector with live counts & keyboard navigation | M1 | Survey |
| F02 | Cloud Sync Button | Manual Firestore synchronization with mutex lock | M1 | Survey |
| F03 | Quiz Mode Shortcut | Direct entry into timed vocabulary challenge | M1 | Survey |
| F04 | Celestial Hub Modal | 4-tab ARIA tablist (Overview, Words, Data, Badges) | M1 | Survey |
| F05 | Active Recall Typing Filter | 7-mode dropdown filter (off, all, leech, hard, etc.) | M1 | Survey |
| F06 | Dedicated 15-Card Typing Session | High-priority active recall queue injection | M1 | Survey |
| F07 | Celestial Curtain & Theme Swap | 1.9s cinematic transition, zero-gap $\ge 24$px, shield | M1 | Survey / R1 |
| F08 | Sound Mode Cycling | 4-state cycle (all -> sfx -> tts -> off) | M1 | Survey |
| F09 | Mobile Taskbar Menu | Responsive hamburger menu for screen widths $\le 768$px | M1 | Survey |
| F10 | 3D Flashcard Flip | 180° Y-axis rotation via Anime.js (Space/F) | M1 | Survey |
| F11 | FSRS-7 Rating Cluster | 4 rating buttons (Again, Hard, Good, Easy) | M1 | Survey |
| F12 | Memory Interval Prediction | Dynamic preview intervals rendered on SRS buttons | M1 | Survey |
| F13 | Native Audio TTS Pronounce | Pronunciation cache with Web Speech fallback | M1 | Survey |
| F14 | Vocabulary Star Bookmark | Neon star toggling with sound feedback | M1 | Survey |
| F15 | Undo Review Snapshot | Full state and review log rollback | M1 | Survey |
| F16 | Active Recall Typing Engine | Neuro-reflex measurement & Vietnamese un-accenting | M1 | Survey |
| F17 | Typing Accuracy Stability Bonus | +25% stability bonus for verified active recall | M1 | Survey |
| F18 | Leech Card Detection | Critical difficulty badge & suspension safeguard | M1 | Survey |
| F19 | Floating Stats Dock | SVG radial HUD & 4-segment progress bar | M1 | Survey |
| F20 | Victory Stage & Confetti | 2D canvas particle celebration & streak summary | M1 | Survey |
| F21 | Smart Cramming Queue | 10 urgent cards appended to review queue | M1 | Survey |
| F22 | Finish & Rest Session | Clean session termination and consolidation | M1 | Survey |
| F23 | Scholar Rank & XP Engine | 5-tier metallic progression & combo multipliers | M1 | Survey |
| F24 | Streak & Rebirth Challenge | Continuous daily streak, Ice Shield, recovery | M1 | Survey |
| F25 | FusionSRS Memory Health HUD | Real-time retention % & natural stability meter | M1 | Survey |
| F26 | 7-Day Forecast & 84-Day Heatmap | SVG forecast bars & 12-week jade heatmap | M1 | Survey |
| F27 | Smart Fuzzy Search | Accent-insensitive & typo-tolerant filter | M1 | Survey |
| F28 | Multi-Dimensional Filtering | Combined Topic & SRS Status filtering | M1 | Survey |
| F29 | Virtualized Infinite Scroll | IntersectionObserver DOM lazy rendering | M1 | Survey |
| F30 | Add & Edit Word Form | Dynamic heuristic difficulty assignment | M1 | Survey |
| F31 | Auto Tag Normalization | Sanitization, capitalization, and deduplication | M1 | Survey |
| F32 | Vietnamese Meaning Dedup | Synonym healing and duplicate phrase removal | M1 | Survey |
| F33 | Semantic Dedup Radar | Inflection/typo duplicate card merger | M1 | Survey |
| F34 | TSV File Dropzone | Drag-and-drop file import with preview | M1 | Survey |
| F35 | TSV Direct Text Paste | Direct clipboard import for mobile users | M1 | Survey |
| F36 | TSV Full Vocabulary Export | Complete card backup in TSV format | M1 | Survey |
| F37 | JSON Review Logs Export | ML-ready review training logs export | M1 | Survey |
| F38 | FSRS-7 34-Param Configuration | Live param array editor with 8-scenario validator | M1 | Survey |
| F39 | Danger Zone Clear All | Double-confirmation wipe for IDB & Cloud | M1 | Survey |
| F40 | 180 Badge Trophy Room | 100 Milestones + 80 Specials across 7 tiers | M1 | Survey |
| F41 | Quiz Setup & Timer Config | Question count & countdown configuration | M1 | Survey |
| F42 | Live Quiz Challenge Arena | Real-time typing challenge with speed bonus | M1 | Survey |
| F43 | Quiz Results Radial HUD | Score percentage & XP rewards breakdown | M1 | Survey |
| F44 | Instant Quiz Mistake Review | Dedicated error queue drill generator | M1 | Survey |
| F45 | Dual-Stability 34-Param FSRS-7 | 34 biological parameters & Newton-Raphson solver | M1 | Survey / R3 |
| F46 | Heuristics v2 & ES Optimizer | Linguistic analysis & background parameter trainer | M1 | Survey / R3 |
| F47 | 4-Vector Disentangled Sync | Multi-device cloud sync with conflict resolution | M1 | Survey / R3 |
| F48 | Empty State & Dev Sandbox | Zero-state guidance & developer cheat engine | M1 | Survey |
| R1-P1 | Curtain Opening CSS Timing | Align slideOut durations from 0.72s to 0.74s | M1 | Survey Explorer 1 |
| R1-P2 | Polyphonic Crystal Chords | Upgrade Web Audio API to rich multi-oscillator chords | M1 | Survey Explorer 1 |
| R1-P3 | Explicit 320px Viewport CDP Test | Add 320x568 (iPhone SE) test to verify_curtain.mjs | M1 | Survey Explorer 1 |
| R2-P1 | GPU Auto-Sleep & Suspension | Validate 0% idle GPU, modal-active & blurred pause | M2 | Survey Explorer 2 |
| R2-P2 | Mobile Zero Backdrop-Filter | Enforce backdrop-filter: none on <= 768px | M2 | Survey Explorer 2 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Motion & Splendor Implementation Polish | Align CSS 0.74s opening, enhance polyphonic crystal chords, add 320px CDP test | None | PLANNED |
| M2 | Independent Verification & Adversarial Audit | Reviewers, Challengers, and Forensic Auditor verification | M1 | PLANNED |
| M3 | Final Victory Verification & Sentinel Report | Full CDP 12/12 tests, npm run build, Victory Audit readiness | M2 | PLANNED |

## Interface Contracts
### Shipper Curtain ↔ Sound Engine
- `events.js` triggers `playSound(targetModeIsDark ? 'themeEclipse' : 'themeDawn')` at Phase 2 apex dwell.
- `sound.js` exports `playSound(soundName)`. Handled asynchronously in try/catch.

### Canvas Engine ↔ App Modals & Lifecycle
- `modal.js` calls `suspendCelestialCanvas()` upon `openModal()` and `resumeCelestialCanvas()` upon `closeModal()`.
- `events.js` toggles `document.body.classList.add('modal-active')` and `window-blurred`.

## Code Layout
- `src/core/`: Application state (`state.js`), FSRS-7 algorithm (`srs/`), sound synthesis (`sound.js`), IndexedDB (`idb.js`), sync (`firebase.js`, `sync.js`).
- `src/ui/`: DOM rendering (`render.js`), modal system (`modal.js`), celestial canvas (`celestial-canvas.js`).
- `src/css/`: Main styles (`style.css`), transition animations (`transition.css`), design tokens (`tokens/celestial-v5.css`).
- `tools/`: Automated CDP test suite (`verify_curtain.mjs`), FSRS-7 trainer (`train_fsrs7.js`).
