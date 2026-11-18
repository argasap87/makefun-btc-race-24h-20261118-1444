[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/argasap87/makefun-btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/argasap87/makefun-btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# Triple-Lock Trend Ride — btc-race-24h-20261118-1444

A bot that trades cbBTC/USDC on 1-minute Orca Whirlpool bars, long only,
$1,000 paper, speaking `agent-fun/bars-replay/v1`.

## Strategy

**One sentence:** it buys only when three independent locks agree — price
above its 2-hour mean (regime), the last hour up over 0.40% (ignition), and
the latest bar closing up (confirmation) — then rides the move with an
adaptive trailing stop instead of a fixed target.

- **Entry (all three locks):** close > 120-bar SMA, 60-min return > +0.40%,
  close > previous close. Full size (100% of equity), 30-bar cooldown after
  each exit.
- **Exit:** 0.80% trailing stop below the running peak since entry, 1.20%
  hard stop below the actual fill price (read back from the fill the next
  batch reports), or a 6-hour time stop — whichever comes first.
- **What it deliberately does NOT do:** no mean-reversion dip-buying, no
  fixed take-profit (it would cut the multi-hour grinds short), no
  trend-break exit (grading showed it churns: selling every time the close
  dips below its own mean produced 5 round trips and −$12.63), and no
  flat-bar breakout trigger (tested — flat clusters are everywhere on this
  day and breakouts after them are noise).

The dev window fell 2.8% in a choppy bleed, so a bot that trades every
wiggle pays ~26 bps per round trip and bleeds out. This one stays flat
through the waterfall hours and fires only twice, on the genuine rallies.

## Dev-window grade (local, kit grader, `--driver process`)

| Metric | Value |
|---|---|
| Net PnL | **+10.28 USDC** (+1.03%) |
| Trades | 4 (2 round trips, 50% win rate) |
| Max drawdown | 1.10% |
| Fees | $1.61 (net PnL at 2x fees: +$8.66) |
| Determinism | L1 regrade reproduced byte for byte (action log `633df2a6…`) |

Perturbation checks (single-parameter, real grader): ignition 0.30–0.40%
and trail 0.80–1.00% all reproduce the identical +$10.28; trail 0.60%
(−$13.22) and hold 240 bars (−$4.03) / 480 bars (+$3.18) are worse, so the
chosen values sit on a plateau, not a knife edge. Honest caveat: the profit
comes from just 2 round trips, so the race result depends on whether the
unseen 24h window has a similar multi-hour grind — in a flat/choppy race
window this bot will likely sit in cash and score ~$0.

## How to run

```sh
# grade locally against the kit's frozen dev window
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

`main.ts` runs under Node 22 type stripping, stdlib only, no network, no
clock, no environment reads. `vendor/makefun-bars.ts` is a byte-identical
copy of the kit SDK shim. Every line of `main.ts` was authored in the
build session.
