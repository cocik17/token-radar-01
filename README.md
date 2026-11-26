# token-radar-01 — Pre-token protocol radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/cocik17/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/cocik17/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the make.fun **token-radar-01** bounty: a web dashboard that ranks the
pre-token protocols in a sealed DefiLlama snapshot by what their launch would be
worth, with a concrete farm plan for each one.

<sub>Entered on [make.fun](https://make.fun/?ref=ydyxtegc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## Model — "radar-2"

`implied = round(TVL × category_multiple × growthMult × maturityMult)`, minimum 1.

- **category_multiple** — median market-cap/TVL of live-token peers in the same
  category (each peer ratio winsorized at 3.0). Categories with fewer than 3 live
  peers fall back to the global median (**0.2049**). Shrinkage
  `(n·median + 5·global) / (n + 5)` keeps small categories honest.
  Key multiples: Basis Trading 0.467, Dexs 0.299, RWA 0.250, Yield 0.188,
  Lending 0.151, Liquid Staking 0.099; most categories fall back to 0.205.
- **growthMult** = `1 + (clamp(change_7d, -50, +100) / 100) × 0.5` → range [0.75, 1.5].
- **maturityMult** = `0.7 + min(age_days, 1095) / 1095 × 0.3`, age from `listed_at`
  to the snapshot date (2026-11-14); unknown age → 365 days.
- No protocol name is ever special-cased. One function scores every row.

**Board:** 198 rows — all 40 watchlist protocols plus every other pre-token
protocol that passes the watchlist's own product test (no CEX, bridge, liquid
staking/restaking, wrapped/staked product, versioned name, or exchange prefix).
That is the entire eligible universe. Top 3: Steakhouse Financial $473.7M,
Sentora Curator $464.0M, Gauntlet $282.1M.

**Farm plans:** 6 steps per row, parameterized by category, chains, TVL and age
(capital $50–$250, hold 30–60 days, Ethereum vs other-chain gas). Each step
carries its cost and time.

## Run

```sh
# Node 22+, stdlib only. Snapshot lives in the kit (not in this repo).
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/` (3 files, 35,814 bytes),
`out/screenshots/` (3 PNGs, 1280×800) and `out/dossier.json`. Two runs produce
byte-identical output.

## Verify

```sh
node ../verify-gates.js   # all 7 competition gates (run from the project root)
```

## Layout

- `main.ts` — program entry: reads the snapshot, writes board/data/dashboard/screenshots/dossier.
- `lib/model.ts` — the radar-2 model, board selection, farm plans.
- `dashboard/` — `index.html` + `app.css` + `app.js` (sortable/filterable board,
  detail view with model breakdown and recompute check, methodology panel).
- `vendor/makefun-board.ts` — house board library (verbatim).
- `screenshots/` — 1-board, 2-detail, 3-filtered (1280×800 PNG).
