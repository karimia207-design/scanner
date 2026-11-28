import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'web/app.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Function ${name} was not found`);
  const next = source.slice(start).search(/\nfunction\s+[A-Za-z_$][\w$]*\s*\(/);
  return source.slice(start, next < 0 ? source.length : start + next);
}
const names = ['emaSeries','rsiSeries','trueRangeSeries','atrSeries','macdSeries','adxSeries','ichimokuCalc','runIndicatorParityChecks'];
const context = vm.createContext({ console, Math, Array, Number, String, Object });
vm.runInContext(names.map(extract).join('\n\n') + '\nthis.__result = runIndicatorParityChecks();', context);
const result = context.__result;
if (!result?.pass) {
  for (const row of result?.results || []) console.error(`${row.name}: max ${row.max} across ${row.count}`);
  throw new Error('Indicator parity test failed');
}
console.log(`Indicator formula parity passed: ${result.results.length} series checked (internal reference, deterministic synthetic data).`);

// Deterministic unit check for the performance statistics used by the historical backtest UI.
const metricsContext = vm.createContext({ console, Math, Array, Number, String, Object });
vm.runInContext(extract('backtestMetrics') + `\nthis.__metrics = backtestMetrics([
  { pnl: 100, rMultiple: 2, pnlPercent: 10 },
  { pnl: -50, rMultiple: -1, pnlPercent: -5 },
  { pnl: -25, rMultiple: -0.5, pnlPercent: -2.5 }
], 1000);`, metricsContext);
const m = metricsContext.__metrics;
const near = (actual, expected, tolerance = 1e-9) => Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
const expectedMetrics = {
  trades: 3,
  winRate: 100 / 3,
  profitFactor: 4 / 3,
  maxDrawdown: (75 / 1100) * 100,
  expectancyR: 1 / 6,
  expectancyPct: 5 / 6,
  netPnl: 25,
  finalEquity: 1025
};
for (const [key, expected] of Object.entries(expectedMetrics)) {
  if (typeof expected === 'number' && !near(m[key], expected, 1e-8)) {
    throw new Error(`Backtest metric ${key}: expected ${expected}, got ${m[key]}`);
  }
}
console.log('Backtest metrics unit check passed: Win Rate, Profit Factor, Maximum Drawdown, Expectancy and net P/L.');

// Net-risk model must include both fee/slippage sides and the exit half-spread.
const riskContext = vm.createContext({
  console, Math, Array, Number, String, Object,
  prefs: { slippageRate: 0.0015, feeRate: 0.001 }
});
vm.runInContext(extract('levelsFor') + `\nthis.__zeroSpread = levelsFor(100, 2, 96, 0);\nthis.__spread = levelsFor(100, 2, 96, 0.004);`, riskContext);
const zeroSpread = riskContext.__zeroSpread;
const withSpread = riskContext.__spread;
if (!zeroSpread || !withSpread || !(withSpread.netRisk > zeroSpread.netRisk) || !(withSpread.stopProceeds < zeroSpread.stopProceeds)) {
  throw new Error('Risk-cost model did not include the exit half-spread conservatively');
}
console.log('Risk model unit check passed: exit half-spread increases net stop risk and reduces stop proceeds.');

// Conservative stop fills: a gap below the stop must fill at the worse open, not at the stop.
const stopFillContext = vm.createContext({ Math, Number });
vm.runInContext(extract('backtestStopFillPrice') + '\nthis.__gap = backtestStopFillPrice(80, 75, 85); this.__touch = backtestStopFillPrice(90, 84, 85); this.__noHit = backtestStopFillPrice(90, 86, 85);', stopFillContext);
if (stopFillContext.__gap !== 80 || stopFillContext.__touch !== 85 || stopFillContext.__noHit !== null) {
  throw new Error(`Conservative stop fill failed: gap=${stopFillContext.__gap}, touch=${stopFillContext.__touch}, noHit=${stopFillContext.__noHit}`);
}
console.log('Backtest stop-fill checks passed: gap-through stop fills at open; intrabar touch fills at stop.');

// Portfolio aggregation: overlapping symbols share a fixed total risk budget and respect concurrency cap.
const portfolioContext = vm.createContext({ Math, Array, Number, Set });
vm.runInContext(extract('backtestMetrics') + '\n' + extract('aggregatePortfolioTrades') + `
this.__portfolio = aggregatePortfolioTrades([
  { symbol: 'AAAUSDT', trades: [{ entryAt: 1, exitAt: 3, rMultiple: 2, pnl: 0, pnlPercent: 0 }] },
  { symbol: 'BBBUSDT', trades: [{ entryAt: 2, exitAt: 4, rMultiple: -1, pnl: 0, pnlPercent: 0 }] },
  { symbol: 'CCCUSDT', trades: [{ entryAt: 5, exitAt: 6, rMultiple: 1, pnl: 0, pnlPercent: 0 }] }
], 1000, 2, 0.02);`, portfolioContext);
const portfolio = portfolioContext.__portfolio;
if (portfolio.metrics.trades !== 3 || portfolio.maxConcurrentSeen !== 2 || portfolio.skippedByConcurrency !== 0 || !near(portfolio.metrics.netPnl, 20.1, 1e-8)) {
  throw new Error(`Portfolio aggregation failed: ${JSON.stringify({ metrics: portfolio.metrics, maxConcurrent: portfolio.maxConcurrentSeen, skipped: portfolio.skippedByConcurrency })}`);
}
console.log('Multi-symbol portfolio aggregation unit check passed: concurrency cap and shared equity risk budget.');

// Readiness hysteresis: never confirms from one quote; requires a second fresh quote after six seconds.
const gateSourceStart = source.indexOf('const readyGateStability = new Map();');
const gateSourceEnd = source.indexOf('function finalizeRecord(', gateSourceStart);
if (gateSourceStart < 0 || gateSourceEnd < 0) throw new Error('Ready-gate hysteresis source missing');
class FakeDate extends Date { static value = 10000; static now() { return this.value; } }
const gateContext = vm.createContext({ Map, Number, Date: FakeDate, FakeDate });
vm.runInContext(source.slice(gateSourceStart, gateSourceEnd) + `
this.__coin = { id: 'AAA', quoteAt: 100 };
this.__record = { tfMap: { '1h': { candles: [{ t: 1000 }] }, '4h': { candles: [{ t: 2000 }] } } };
this.__first = confirmReadyGateStability(this.__coin, this.__record);
this.__sameQuote = confirmReadyGateStability(this.__coin, this.__record);
FakeDate.value = 16001;
this.__confirmed = confirmReadyGateStability({ ...this.__coin, quoteAt: 200 }, this.__record);
this.__frameReset = confirmReadyGateStability({ ...this.__coin, quoteAt: 300 }, { tfMap: { '1h': { candles: [{ t: 3000 }] }, '4h': { candles: [{ t: 2000 }] } } });`, gateContext);
if (gateContext.__first !== false || gateContext.__sameQuote !== false || gateContext.__confirmed !== true || gateContext.__frameReset !== false) {
  throw new Error('Ready-gate hysteresis did not require two fresh observations over six seconds on the same candle frame');
}
console.log('Ready-gate hysteresis check passed: distinct fresh quotes, six-second confirmation and candle-frame reset.');
