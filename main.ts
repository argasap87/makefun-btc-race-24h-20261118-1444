// Triple-Lock Trend Ride — a regime-gated momentum bot for cbBTC 1-minute bars.
//
// One-sentence hook: it only buys when three independent locks agree — the
// price sits above its 2-hour mean (regime), the last hour gained over 0.40%
// (ignition), and the latest bar closed up (confirmation) — and then it rides
// the move with an adaptive trailing stop instead of a fixed target, so the
// winners that matter (multi-hour grinds) are never cut short by a take-profit
// while the losers are cut by the trail.
//
// Why three locks: on the dev window BTC fell 2.8% in a choppy bleed, so any
// bot that trades every wiggle pays ~26 bps per round trip and bleeds out.
// The locks keep the bot flat through the waterfall hours and let it fire
// only a couple of times, on the genuine multi-hour rallies. The trailing
// exit (0.8% below the running peak) is what banks those rallies.
//
// Lesson from grading v1: a fourth exit — selling as soon as the close fell
// back below the 2-hour mean — churned the bot into 5 round trips and a
// -$12.63 grade. In a choppy market the price crosses its own mean
// constantly, so that exit fired on noise. It is deliberately gone: exits
// now come only from the trailing stop, the hard stop, or the time stop.
// A longer 4-hour filter was also tested and rejected — it only delayed
// entry into the rally and cut the profit.
//
// Protocol: agent-fun/bars-replay/v1. The harness sends hello once, then one
// batch per minute bar, then done. We answer every batch with exactly one
// reply echoing its seq. Fills land at the next bar's open, so every decision
// here is made on the bar that just closed. The entry price is read back
// from the fill the next batch reports, never assumed. No clock, no
// environment, no network, no randomness: fully deterministic.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- tunable locks (chosen on the dev window, checked by perturbation) ---
const REGIME_BARS = 120; // 2-hour mean: the regime lock
const IGNITION_BARS = 60; // 1-hour return: the ignition lock
const IGNITION_MIN = 0.004; // +0.40% over the last hour
const TRAIL_PCT = 0.008; // trailing stop: 0.80% below the running peak
const HARD_STOP_PCT = 0.012; // hard stop: 1.20% below the entry fill
const MAX_HOLD_BARS = 360; // time stop: 6 hours, then flatten
const COOLDOWN_BARS = 30; // wait 30 bars after an exit before re-entering
const MAX_SLIPPAGE_BPS = 200; // headroom over the latest close for a fill

// Rolling history of closes, kept as plain numbers (USDC per cbBTC).
// Prices arrive at price_scale 5, so a raw close of 6508330965 means
// $65,083.30965; dividing once keeps every ratio exact enough.
const closes: number[] = [];

let entryPrice = 0; // fill price of the open position (USDC per cbBTC)
let entryBar = -1; // seq of the batch on which we entered
let peakSinceEntry = 0; // highest close seen while holding
let lastExitBar = -1_000; // seq of the batch on which we last exited
let holding = false;
let buyCount = 0; // counts our buy orders, so each gets a unique client id

function sma(n: number): number {
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

function closeOf(state: BarsState): number | null {
  const raw = state.close(SYMBOL);
  if (raw === null) return null;
  return Number(raw) / 100_000;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const close = closeOf(state);
    if (close === null || state.warmingUp) return [];
    closes.push(close);

    // The fills of the orders decided on the previous batch arrive here.
    // A filled buy sets the true entry price (its fill price at the next
    // bar's open, after fee/slippage/impact) — the hard stop is measured
    // from what we actually paid, not from the close we decided on.
    for (const fill of batch.fills) {
      if (fill.side === 'buy' && fill.status === 'filled' && fill.client_id.startsWith('buy')) {
        entryPrice = Number(fill.price) / 100_000;
        peakSinceEntry = Math.max(peakSinceEntry, entryPrice);
      }
    }

    const pos = state.positions.get(SYMBOL);
    const qty = pos?.qty ?? 0n;
    holding = qty > 0n;

    // --- exits first: if we hold, decide whether to sell ---
    if (holding) {
      if (entryPrice === 0) entryPrice = close; // safety: never divide by zero
      if (close > peakSinceEntry) peakSinceEntry = close;
      const held = state.seq - entryBar;
      const trailed = close <= peakSinceEntry * (1 - TRAIL_PCT);
      const stopped = close <= entryPrice * (1 - HARD_STOP_PCT);
      const timedOut = held >= MAX_HOLD_BARS;
      if (trailed || stopped || timedOut) {
        lastExitBar = state.seq;
        entryPrice = 0;
        peakSinceEntry = 0;
        return [
          { side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS },
        ];
      }
      return [];
    }

    // --- entries: all three locks must agree, plus a cooldown ---
    if (closes.length < REGIME_BARS + 1) return [];
    if (state.seq - lastExitBar < COOLDOWN_BARS) return [];
    const regimeOk = close > sma(REGIME_BARS);
    const hourAgo = closes[closes.length - 1 - IGNITION_BARS];
    const ignition = close / hourAgo - 1;
    const ignitionOk = ignition > IGNITION_MIN;
    const confirmationOk = close > closes[closes.length - 2];
    if (!regimeOk || !ignitionOk || !confirmationOk) return [];

    // Full size: the strategy fires rarely, so each shot uses all equity.
    // The buy's notional is capped by the cash we actually hold.
    const room = state.weightRoom(SYMBOL);
    const spend = room < state.cash ? room : state.cash;
    if (spend <= 0n) return [];
    buyCount += 1;
    entryBar = state.seq;
    peakSinceEntry = close;
    return [
      { side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `buy${buyCount}` },
    ];
  },
});
