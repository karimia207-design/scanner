import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFile(path.join(root, name), 'utf8');
const fail = (message) => { throw new Error(message); };
const checkNode = (file) => {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${file}: syntax check failed\n${result.stderr || result.stdout}`);
};
const app = await read('web/app.js');
const account = await read('web/nobitex-account.js');
const bridge = await read('src/native-bridge.js');
const native = await read('native/android/NobitexNativePlugin.java');
const buildWeb = await read('scripts/build-web.mjs');
const prepareAndroid = await read('scripts/prepare-android.mjs');
const workflow = await read('.github/workflows/build-android.yml');
const pkg = JSON.parse(await read('package.json'));
if (pkg.version !== '7.6.0') fail(`package.json version must be 7.6.0, got ${pkg.version}`);

for (const file of [
  'web/app.js', 'web/nobitex-account.js', 'web/pwa-register.js',
  'src/native-bridge.js', 'scripts/build-web.mjs', 'scripts/prepare-android.mjs',
  'scripts/test-indicators.mjs', 'scripts/test-indicator-reference-vectors.mjs'
]) checkNode(file);

if ((app.match(/function\s+computeRisk\s*\(/g) || []).length !== 1) fail('computeRisk must have exactly one definition');
if (!/record\.risk=computeRisk\(/.test(app) || !/record\.snapshotId=record\.snapshotMeta\.id/.test(app)) fail('finalizeRecord must bind a single risk object to a Snapshot');
if (!/riskSnapshot\s*=\s*record\.risk\.snapshot/.test(app)) fail('riskSnapshot is not derived from the canonical risk object');
if (!/validateRiskSnapshot\(record\.risk,coin\)/.test(app) || !/integrityValid:record\.risk\.integrity\.valid/.test(app)) fail('Canonical risk integrity check is missing');
if (!/runId\+'\|'\+coin\.nobitexSymbol\+'\|'\+\(record\?\.snapshotId/.test(app)) fail('Diagnostics keys must include runId, symbol and snapshotId');
const riskFieldChecks = [['entry','entry'],['stopLoss','stopLoss'],['target','takeProfit'],['ceiling','ceiling'],['spread','spread'],['rrNet','rrNet']];
for (const [field, source] of riskFieldChecks) {
  if (!app.includes(`${field}:record.risk.${source}`) && !app.includes(`${field}:r?.${source}`)) fail(`Risk snapshot field ${field} was not found`);
}
if (!/function\s+analysisSnapshotMeta\(/.test(app) || !/last1h/.test(app) || !/last4h/.test(app) || !/barSignature/.test(app) || !/record\?\.stopTf/.test(app)) fail('Snapshot metadata must include closed-candle values and stop model');
if (!/decisionValidCount:valid\.filter\(k=>MANDATORY_TFS\.includes\(k\)\)\.length/.test(app)) fail('Primary timeframe counter must use mandatory frames only');
if (!/function\s+runHistoricalBacktest\(/.test(app) || !/function\s+backtestMetrics\(/.test(app)) fail('Historical backtest or metrics function missing');
for (const metric of ['winRate', 'profitFactor', 'maxDrawdown', 'expectancyR', 'netPnl']) if (!app.includes(`${metric}:`)) fail(`Backtest metric ${metric} missing`);
if (!/async\s+function\s+runHistoricalBacktest\(/.test(app) || !/await new Promise\(resolve=>setTimeout\(resolve,0\)\)/.test(app)) fail('Historical backtest must yield periodically to the UI');
if (!/backtestStopFillPrice/.test(app) || !/Math\.min\(openPrice,stopPrice\)/.test(app)) fail('Conservative gap-through-stop fill model missing');
if (!/function\s+aggregatePortfolioTrades\(/.test(app) || !/function\s+runPortfolioBacktest\(/.test(app)) fail('Multi-symbol portfolio backtest is missing');
if (!/DIVERGENCE_MAX_AGE_BARS/.test(app) || !/freshPivot/.test(app)) fail('Divergence maximum age guard missing');
if (!/ENTRY_CONFIRMATION_MS\s*=\s*6000/.test(app) || !/candidateSince/.test(app) || !/candidateCandleAt/.test(app)) fail('Entry hysteresis confirmation is missing');
if (!/costAssumptionsConfirmed/.test(app) || !/دروازه ورود نهایی و آلارم خرید فعال نمی‌شود/.test(app)) fail('Fee/slippage/volume assumptions confirmation gate is missing');
if (!/function\s+runIndicatorParityChecks\(/.test(app)) fail('Internal indicator test missing');
for (const method of ['emaSeries', 'rsiSeries', 'atrSeries', 'macdSeries', 'adxSeries', 'ichimokuCalc']) if (!app.includes(method)) fail(`Indicator implementation ${method} missing`);
if (!/function\s+addManualWatchSymbol\(/.test(app) || !/latestMarketStats\.get\(/.test(app) || !/augmentUniverseWithWatchlist\(/.test(app)) fail('Manual watchlist support beyond Top 150 is incomplete');
if (!/function\s+addFilteredResultsToWatchlist\(/.test(app)) fail('Bulk add-filter-results action missing');
if (/\b(?:window\.)?(?:alert|prompt)\s*\(/.test(app)) fail('Native alert()/prompt() call remains in app.js');
if (/PUBLIC_PROXIES|function\s+withTimeout\s*\(/.test(app)) fail('Removed proxy/timeout dead code reappeared');
if (!/networkNext/.test(app) || !/navigator\.locks/.test(app) || !/Retry-After/.test(app) || !/backOff/.test(app)) fail('Shared request queue / 429 handling is incomplete');
if (!/NOBITEX_OHLC_INTERVAL_MS\s*=\s*1600/.test(app)) fail('OHLC initial cadence must remain 1600ms');
if (!/id="costAssumptionsConfirmed"/.test(app)) fail('User cost assumption confirmation UI missing');
if (!/واسط اختصاصی HTTPS/.test(app) || !/connect-src همین CSP/.test(app)) fail('Custom proxy CSP allowlist warning missing');
if (!/await run\('npm', \['run', 'build:web'\]\)/.test(prepareAndroid) || !/NOBITEX_ANDROID_KEYSTORE_PATH/.test(prepareAndroid)) fail('Android preparation or fixed release signing config is missing');
if (!/NobitexScanner\/7\.6\.0 Android/.test(native)) fail('Android user-agent version is inconsistent');
if (/httpRequest/.test(native) || /call\.getString\("privateKey"/.test(native)) fail('Native bridge exposes a generic HTTP or private-key input method');
if (!/signedWalletRequest\(PluginCall call\)/.test(native) || !/\/users\/wallets\/list/.test(native)) fail('Native wallet signer is missing or not tied to the wallet-list route');
if (!/Signature\.getInstance\("Ed25519", signingProvider\)/.test(native)) fail('Ed25519 signing is not executed by the explicit native provider');
if (!/if \(!PUBLIC_KEY\.equals\(key\)\)/.test(native)) fail('Native secureGet must expose only the public key');
if (/async\s+httpRequest|httpRequest\s*\(/.test(bridge) || /exitApp\s*\(/.test(bridge)) fail('Native bridge exposes generic HTTP or app termination');
if (!/App\.addListener\('backButton'/.test(bridge) || !/nobitex:back/.test(bridge)) fail('Android Back listener is missing');
if (!/npm ci/.test(workflow) || !/npm install --package-lock-only/.test(workflow)) fail('Lockfile bootstrap + npm ci workflow is missing');
if (!/assembleDebug/.test(workflow) || !/nobitex-v7\.6\.0-android-debug-apk/.test(workflow) || /ANDROID_KEYSTORE_BASE64/.test(workflow)) fail('No-secret Debug APK workflow is missing or requests signing secrets');
if (!/uses:\s*actions\/checkout@[0-9a-f]{40}/.test(workflow) || !/uses:\s*actions\/setup-node@[0-9a-f]{40}/.test(workflow) || !/uses:\s*actions\/setup-java@[0-9a-f]{40}/.test(workflow) || !/uses:\s*android-actions\/setup-android@[0-9a-f]{40}/.test(workflow)) fail('Third-party build actions are not pinned by full commit SHA');

const htmlFiles = ['web/index.html', 'web/mobile-index.html'];
const requiredIds = [
  'tableBody', 'tableContainer', 'loadingState', 'detailModal', 'modalTitle', 'modalSub',
  'decisionReport', 'modalGrid', 'riskGrid', 'fibGrid', 'monitorCandidatesPanel',
  'monitorCandidatesDetails', 'monitorCandidateList', 'monitorRawCount',
  'monitorQualifiedCount', 'monitorTriggerCount', 'watchlistBody', 'watchManualSymbol',
  'watchManualAddBtn', 'watchAddFilteredBtn', 'runBacktestBtn', 'indicatorParityBtn',
  'portfolioBacktestBtn', 'portfolioBacktestResults'
];
for (const file of htmlFiles) {
  const html = await read(file);
  const csp = html.match(/<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])(?=[^>]*content="([^"]+)")[^>]*>/i)?.[1] || '';
  if (!csp.includes("script-src 'self'") || !csp.includes("object-src 'none'") || !csp.includes('https://apiv2.nobitex.ir') || !csp.includes('wss://ws.nobitex.ir') || csp.includes('connect-src \'self\' https: wss:')) fail(`${file}: CSP must restrict network connections to required origins`);
  if (csp.includes('fonts.googleapis.com') || csp.includes('fonts.gstatic.com')) fail(`${file}: unused remote Google Fonts should not be allowlisted`);
  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/i.test(html)) fail(`${file}: inline script block found, incompatible with the configured CSP`);
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail(`${file}: inline event handler found, incompatible with the configured CSP`);
  for (const id of requiredIds) {
    const count = [...html.matchAll(new RegExp(`\\bid=["']${id}["']`, 'g'))].length;
    if (count !== 1) fail(`${file}: expected exactly one #${id}, found ${count}`);
  }
  const details = html.match(/<details\b([^>]*)id=["']monitorCandidatesDetails["']([^>]*)>([\s\S]*?)<\/details>/i);
  if (!details || /\bopen(?:\s|=|$)/i.test(details[1] + details[2])) fail(`${file}: monitor panel must be collapsed by default`);
  const summary = details[3].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || '';
  for (const id of ['monitorRawCount', 'monitorQualifiedCount', 'monitorTriggerCount']) if (!summary.includes(`id="${id}"`)) fail(`${file}: ${id} must remain visible while collapsed`);
  const mainTable = html.match(/<div\s+id=["']tableContainer["'][\s\S]*?<table>[\s\S]*?<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>/i)?.[1] || '';
  const mainColumns = [...mainTable.matchAll(/<th\b/g)].length;
  if (mainColumns !== 20) fail(`${file}: expected 20 market table headers, found ${mainColumns}`);
  const watchTable = html.match(/<section\s+id=["']watchlistPanel["'][\s\S]*?<table>[\s\S]*?<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>/i)?.[1] || '';
  if ([...watchTable.matchAll(/<th\b/g)].length !== 10) fail(`${file}: expected 10 watchlist columns`);
  if (!/id=["']tableBody["'][^>]*>[\s\S]*?colspan=["']20["']/.test(html)) fail(`${file}: market table does not have a 20-column neutral placeholder`);
  if (/DEXE \/ USDT|0\.332٪|1\.2865|CHIPUSDT/.test(html)) fail(`${file}: stale baked-in demo market values remain in the HTML`);
  if (/62\/150|request 60s: 40|2026-11-19 23:06:15|2026\/11\/19/.test(html)) fail(`${file}: stale baked-in market status or request counters remain in the HTML`);
  const selectedSignalOptions = [...(html.match(/<select id="signalFilter">([\s\S]*?)<\/select>/i)?.[1] || '').matchAll(/<option[^>]*selected(?:=|\s|>)/gi)];
  if (selectedSignalOptions.length !== 1) fail(`${file}: signal filter must have exactly one initial selected option`);
  if (/نسخه ۷\.۴|v7\.5\.[0-9]|v7\.6\.0/.test(html) && !/نوبیتکس v7\.6\.0/.test(html)) fail(`${file}: stale visible version or missing current title`);
  console.log(`${file}: CSP, external scripts, unique DOM IDs, collapsed monitor, portfolio backtest panel and table structure verified`);
}
console.log('v7.6.0 source, risk snapshot, hysteresis, backtest, watchlist, native signing and no-secret Debug APK checks passed.');
