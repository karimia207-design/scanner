

(function(){
'use strict';
function uiToast(message){let host=document.getElementById('appToastHost');if(!host){host=document.createElement('div');host.id='appToastHost';host.setAttribute('aria-live','polite');host.style.cssText='position:fixed;z-index:30000;bottom:74px;left:12px;right:12px;display:flex;justify-content:center;pointer-events:none';document.body.append(host);}const item=document.createElement('div');item.textContent=String(message||'');item.style.cssText='pointer-events:auto;max-width:560px;background:#182638;color:#f1f5f9;border:1px solid #49617a;border-radius:12px;padding:11px 15px;box-shadow:0 8px 24px #0008;font-size:.85rem;line-height:1.7';host.append(item);setTimeout(()=>item.remove(),4200);}
function uiAlert(message){const d=document.createElement('dialog');d.className='v4-dialog';d.innerHTML='<p class="app-dialog-message"></p><div class="v4-actions"><button type="button">متوجه شدم</button></div>';d.querySelector('.app-dialog-message').textContent=String(message||'');document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();}
function uiConfirm(message){return new Promise(resolve=>{const d=document.createElement('dialog');d.className='v4-dialog';d.innerHTML='<p class="app-dialog-message"></p><div class="v4-actions"><button type="button" data-result="yes">تأیید</button><button type="button" data-result="no">انصراف</button></div>';d.querySelector('.app-dialog-message').textContent=String(message||'');document.body.append(d);d.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{const answer=b.dataset.result==='yes';d.close();resolve(answer)});d.addEventListener('cancel',()=>resolve(false));d.addEventListener('close',()=>d.remove());d.showModal();});}
function uiPrompt(label,defaultValue=''){return new Promise(resolve=>{const d=document.createElement('dialog');d.className='v4-dialog';d.innerHTML='<form method="dialog" class="app-prompt-form"><label class="app-dialog-message"></label><input type="text" class="app-prompt-input" autocomplete="off"><div class="v4-actions"><button value="ok">ثبت</button><button value="cancel">انصراف</button></div></form>';const form=d.querySelector('form'),input=d.querySelector('input');d.querySelector('label').textContent=String(label||'');input.value=String(defaultValue??'');document.body.append(d);form.addEventListener('submit',e=>{if(e.submitter?.value==='cancel'){resolve(null);return;}resolve(input.value)});d.addEventListener('close',()=>{if(!d.returnValue)resolve(null);d.remove()},{once:true});d.showModal();input.focus();input.select();});}
window.NobitexDialogs=Object.freeze({alert:uiAlert,confirm:uiConfirm,prompt:uiPrompt,toast:uiToast});


// =========================================================
// CONFIG
// =========================================================
const NOBITEX_API = 'https://apiv2.nobitex.ir';
const COINGECKO_API = 'https://api.coingecko.com';
const WS_URL = 'wss://ws.nobitex.ir/connection/websocket';
const CG_TTL_MS = 6*3600*1000;
const TOP_LIMIT = 150;
const TICKER_REFRESH_MS = 60000; // REST recovery + market-universe refresh; live prices arrive by WebSocket
const RENDER_THROTTLE_MS = 800;
const DIRECT_TIMEOUT_MS = 12000;
// OHLC endpoint: cautious initial cadence; dynamic 429/backOff handling can widen it.
const NOBITEX_DEFAULT_INTERVAL_MS = 3200;
const NOBITEX_OHLC_INTERVAL_MS = 1600;
const NOBITEX_MAX_INTERVAL_MS = 10000;

const TIMEFRAMES = {
  '5m':  { label:'5m',  nobitex:'5',   seconds:300,   candles:500, weight:0.00 },
  '15m': { label:'15m', nobitex:'15',  seconds:900,   candles:500, weight:0.00 },
  '1h':  { label:'1H',  nobitex:'60',  seconds:3600,  candles:500, weight:0.40 },
  '4h':  { label:'4H',  nobitex:'240', seconds:14400, candles:500, weight:0.60 },
  '1d':  { label:'1D',  nobitex:'D',   seconds:86400, candles:500, weight:0.00 }
};
const MANDATORY_TFS = ['1h','4h'];
// آستانه‌های مشترک بین جدول اصلی، گزارش تصمیم و بک‌تست
const RULES = { trend:60, rsiMin:50, rsiMax:68, adxMin:20, adxPreferredMax:35 };

const STABLES = new Set([
  'USDT','USDC','DAI','FDUSD','PYUSD','TUSD','USDE','USDD','RLUSD','GHO','BFUSD','BUSD','USTC',
  'FRAX','USDP','GUSD','SUSD','LUSD','MIM','ALUSD','USDS','USD1','XAUT','PAXG','EURT','EURS'
]);

// =========================================================
// DOM
// =========================================================
const $ = id => document.getElementById(id);
const tableBody=$('tableBody'), loadingState=$('loadingState'), tableContainer=$('tableContainer');
const statusDot=$('statusDot'), statusText=$('statusText'), lastUpdateEl=$('lastUpdate');
const countBadge=$('countBadge'), analysisBadge=$('analysisBadge');
const trendFilter=$('trendFilter'), minScoreInput=$('minScore'), minRRInput=$('minRR');
const searchInput=$('searchInput'), hideStable=$('hideStable'), onlyConfirmed=$('onlyConfirmed');
const ichiFilter=$('ichiFilter');
const visibleCount=$('visibleCount'), refreshBtn=$('refreshBtn'), analysisStatus=$('analysisStatus');
const modalOverlay=$('detailModal'), modalClose=$('modalClose'), modalTitle=$('modalTitle');
const modalSub=$('modalSub'), modalGrid=$('modalGrid'), analysisText=$('analysisText');
const signalBadge=$('signalBadge'), tfDetailHost=$('tfDetailHost'), gateInfo=$('gateInfo');
const modalChart=$('modalChart'), chartTfLabel=$('chartTfLabel'), tfSelectors=$('tfSelectors');
const riskCard=$('riskCard'), riskGrid=$('riskGrid');
const fibCard=$('fibCard'), fibGrid=$('fibGrid');
const signalFilter=$('signalFilter'), diagBar=$('diagBar'), proxyBtn=$('proxyBtn');
const notifBtn=$('notifBtn'), testSoundBtn=$('testSoundBtn'), errorBar=$('errorBar');

// =========================================================
// STATE
// =========================================================
let allCoins = [];
let refreshInFlight = false;
let tickerTimer = null;
let analysisLoopRunning = false;
let analysisLoopShouldRun = false;
const analysisCache = new Map();
const opportunityState = new Map();
const opportunityInflight = new Map();
let opportunityRefreshBusy = false;
let opportunityRefreshTimer = null;
// Monitor snapshots use fresh market quotes plus cached 1h/4h candles; they do not generate OHLC requests.
const monitorPulseMap = new Map();
const monitorDiagnosticAt = new Map();
let triggerProbeBusy = false;
let dailyMonitorBusy = false;
let nextDailyMonitorAt = 0;
const TRIGGER_PROBE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MONITOR_REFRESH_MS = 30000; // quote-only monitoring; no OHLC call
const MONITOR_DIAGNOSTIC_MS = 5 * 60 * 1000;
const MAX_BACKGROUND_TRIGGER_JOBS = 1;
const DAILY_MONITOR_COOLDOWN_MS = 5 * 60 * 1000;
let sortState = { key:'rank', dir:'asc' };
let renderScheduled = false;
let modalChartInstance = null, modalChartResizeObserver = null;
let modalCurrentCoin = null, modalCurrentTf = null;
let lastAnalysisError = '';

// =========================================================
// HELPERS
// =========================================================
function num(v,fb=0){if(v===null||v===undefined||v==='')return fb;const n=Number(v);return Number.isFinite(n)?n:fb;}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function escapeHTML(v){
  return String(v??'').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function formatPrice(p){
  if(!Number.isFinite(p)) return '—';
  if(p===0) return '0';
  if(p>=1000) return p.toLocaleString('en-US',{maximumFractionDigits:2});
  if(p>=1) return p.toFixed(4);
  if(p>=0.01) return p.toFixed(6);
  if(p>=0.0001) return p.toFixed(8);
  const exp=Math.floor(Math.log10(p));
  return (p/Math.pow(10,exp)).toFixed(3)+'e'+exp;
}
function formatChange(v){
  if(!Number.isFinite(v)) return '—';
  return (v>=0?'+':'')+v.toFixed(2)+'%';
}
function changeClass(v){
  if(!Number.isFinite(v)) return 'unknown';
  if(v>0.01) return 'positive';
  if(v<-0.01) return 'negative';
  return 'neutral';
}
function trendLabel(score){
  if(!Number.isFinite(score)) return { label:'در دسترس نیست', css:'pending' };
  if(score>=78) return { label:'صعودی قوی', css:'strong-bull' };
  if(score>=62) return { label:'صعودی', css:'bull' };
  if(score>=38) return { label:'خنثی', css:'neutral' };
  if(score>=22) return { label:'نزولی', css:'bear' };
  return { label:'نزولی قوی', css:'strong-bear' };
}
function scoreTone(s){
  if(!Number.isFinite(s)) return 'neutral';
  if(s>=62) return 'bull';
  if(s<=38) return 'bear';
  return 'neutral';
}
function ichiTone(s){
  if(!Number.isFinite(s)) return 'neutral';
  if(s>=62) return 'bull';
  if(s<=38) return 'bear';
  return 'neutral';
}
function tfBadge(data,key){if(!data)return `<span class="tf-badge pending" title="۵ دقیقه و روزانه هنگام بازکردن جزئیات دریافت می‌شوند">${key} · در صف/عندالطلب</span>`;const problem=data.networkError||data.error;const label=data.ready?Math.round(data.trendScore):data.candles?.length?'داده ناقص':'خطای داده';const cls=data.ready&&isTimeframeValid(data,data.tf)?trendLabel(data.trendScore).css:'pending';return `<span class="tf-badge ${cls}" title="${escapeHTML(problem||(()=>{const q=computeDataQuality(data.candles||[],data.tf||key);return `${q.bars} کندل؛ پوشش ${q.coveragePercent}٪؛ بیشترین شکاف ${q.maxGap}`})())}">${key} · ${label}${problem?' ⚠':''}</span>`;}
function ageBadge(updatedAt){
  if(!updatedAt) return `<span class="age-badge">—</span>`;
  const sec=Math.floor((Date.now()-updatedAt)/1000);
  let cls='fresh', label;
  if(sec<60) label=`${sec}s`; else if(sec<3600) label=`${Math.floor(sec/60)}m`; else label=`${Math.floor(sec/3600)}h`;
  if(sec>900) cls='old'; else if(sec>400) cls='stale';
  return `<span class="age-badge ${cls}">${label}</span>`;
}
async function fetchJSON(url,options={},timeoutMs=DIRECT_TIMEOUT_MS){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store',credentials:'omit'});let data=null;try{data=await response.json()}catch(parseError){if(response.ok)throw new ApiError('پاسخ منبع JSON معتبر نیست',response.status||0,30)}const bodyCode=String(data?.code||data?.errorCode||'');const bodyMessage=String(data?.message||data?.error||'');const bodyRateLimit=/TooManyRequests/i.test(bodyCode)||(/too many requests|تعداد درخواست.*بیش از/i.test(bodyMessage));if(!response.ok||response.status===429||bodyRateLimit){let retry=Number(data?.backOff);if(!Number.isFinite(retry)||retry<=0)retry=Number(response.headers.get('Retry-After'));if(!Number.isFinite(retry)||retry<=0){const t=Date.parse(response.headers.get('Retry-After')||'');retry=Number.isFinite(t)?Math.ceil((t-Date.now())/1000):30}retry=Math.max(1,Math.min(3600,retry));const status=(response.status===429||bodyRateLimit)?429:response.status;const detail=bodyMessage?': '+bodyMessage.slice(0,240):'';throw new ApiError(`${bodyCode||'HTTP '+status}${detail}`,status,retry,bodyCode||null)}return data}catch(e){if(e.name==='AbortError')throw new ApiError('مهلت پاسخ منبع تمام شد',0,30);if(e instanceof ApiError)throw e;throw new ApiError('ارتباط شبکه یا دسترسی مرورگر به منبع برقرار نشد',0,30)}finally{clearTimeout(timer)}}
function debounce(fn, ms){ let t; return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}; }

function isNativeAndroid(){return window.NobitexNativeBridge?.isAndroid===true;}
function mayRunWhenHidden(){return backgroundMonitorEnabled===true;}
function updateBackgroundMonitorButton(){
  const b=$('backgroundMonitorBtn');if(!b)return;
  b.textContent=backgroundMonitorEnabled?'⏱ پایش پس‌زمینه فعال':'⏱ پایش پس‌زمینه خاموش';
  b.classList.toggle('active',backgroundMonitorEnabled);
  b.setAttribute('aria-pressed',backgroundMonitorEnabled?'true':'false');
  b.title=isNativeAndroid()
    ?'پایش اندروید با سرویس فعال و اعلان دائمی ادامه می‌یابد؛ برای توقف از همین دکمه یا اعلان دائمی استفاده کنید.'
    :'پایش وب تا وقتی همین صفحه باز و مرورگر فعال باشد ادامه می‌یابد؛ پس از بستن تب یا توقف مرورگر متوقف می‌شود.';
}
function backgroundStatusText(){
  const processed=typeof scanProgress!=='undefined'?scanProgress.size:0;
  const total=typeof allCoins!=='undefined'?allCoins.length:0;
  const rate=typeof scanCompletedAt!=='undefined'?scanCompletedAt.filter(t=>Date.now()-t<60000).length:0;
  return analysisPaused?'اسکن متوقف شده است':`اسکن ${processed}/${total} بازار؛ سرعت ${rate} نماد در دقیقه`;
}
async function restoreBackgroundMonitor(){
  const saved=LS(BACKGROUND_MONITOR_PREF)==='1';
  if(isNativeAndroid()){
    try{
      const nativeState=await window.NobitexNativeBridge.getBackgroundMonitorStatus();
      const active=nativeState?.active===true,userStopped=nativeState?.userStopped===true;
      const LN=window.Capacitor?.Plugins?.LocalNotifications;
      const permission=LN?.checkPermissions?await LN.checkPermissions():{display:'prompt'};
      if(userStopped){LS(BACKGROUND_MONITOR_PREF,'0');backgroundMonitorEnabled=false;}
      else if(active&&permission.display==='granted'){backgroundMonitorEnabled=true;notif.enabled=true;}
      else if(active&&!saved){await window.NobitexNativeBridge.stopBackgroundMonitor();backgroundMonitorEnabled=false;}
      else if(saved&&permission.display==='granted'){
        if(!active)await window.NobitexNativeBridge.startBackgroundMonitor();
        backgroundMonitorEnabled=true;notif.enabled=true;
      }else{
        if(active)await window.NobitexNativeBridge.stopBackgroundMonitor();
        LS(BACKGROUND_MONITOR_PREF,'0');backgroundMonitorEnabled=false;
      }
    }catch(error){backgroundMonitorEnabled=false;LS(BACKGROUND_MONITOR_PREF,'0');eventLog('بازیابی پایش اندروید ناموفق بود؛ '+(error?.message||error),'info');}
  }else if(saved){
    if('Notification'in window&&Notification.permission==='granted'){
      backgroundMonitorEnabled=true;notif.enabled=true;
    }else{
      backgroundMonitorEnabled=false;LS(BACKGROUND_MONITOR_PREF,'0');
    }
  }
  updateBackgroundMonitorButton();
}
async function setBackgroundMonitorEnabled(enabled){
  enabled=!!enabled;
  if(enabled===backgroundMonitorEnabled)return;
  if(enabled){
    const granted=await notif.enable();
    if(!granted){uiAlert('برای آلارم ورود، ابتدا مجوز اعلان را فعال کنید.');return;}
    try{
      if(isNativeAndroid())await window.NobitexNativeBridge.startBackgroundMonitor();
      backgroundMonitorEnabled=true;LS(BACKGROUND_MONITOR_PREF,'1');notif.enabled=true;
      if(analysisPaused){analysisPaused=false;$('pauseBtn').textContent='⏸ توقف اسکن';}
      updateBackgroundMonitorButton();
      if(!document.hidden){refreshData();wsConnect();}
      eventLog(isNativeAndroid()
        ?'پایش پس‌زمینه اندروید فعال شد؛ اعلان دائمی تا زمان توقف سرویس نمایش داده می‌شود.'
        :'پایش پس‌زمینه وب فعال شد؛ برای ادامه پایش باید تب باز بماند و مرورگر آن را متوقف نکند.','info');
      if(!isNativeAndroid())uiAlert('پایش وب فعال شد. تا وقتی این تب باز است و مرورگر اجرای آن را متوقف نکرده، پایش ادامه می‌یابد؛ با بستن تب یا خروج از مرورگر، پایش و آلارم متوقف می‌شود.');
    }catch(error){backgroundMonitorEnabled=false;LS(BACKGROUND_MONITOR_PREF,'0');updateBackgroundMonitorButton();uiAlert('فعال‌سازی پایش پس‌زمینه ناموفق بود: '+(error?.message||error));}
  }else{
    try{if(isNativeAndroid())await window.NobitexNativeBridge.stopBackgroundMonitor();}
    catch(error){eventLog('توقف سرویس پس‌زمینه ناموفق بود: '+(error?.message||error),'info');}
    backgroundMonitorEnabled=false;LS(BACKGROUND_MONITOR_PREF,'0');updateBackgroundMonitorButton();
    if(document.hidden)wsStop();
    eventLog('پایش پس‌زمینه متوقف شد.','info');
  }
}
async function syncBackgroundMonitor(){
  if(!isNativeAndroid()||!backgroundMonitorEnabled)return;
  try{
    const nativeState=await window.NobitexNativeBridge.getBackgroundMonitorStatus();
    if(nativeState?.active!==true){backgroundMonitorEnabled=false;LS(BACKGROUND_MONITOR_PREF,'0');updateBackgroundMonitorButton();eventLog(nativeState?.userStopped?'پایش از اعلان دائمی متوقف شد.':'سرویس پایش اندروید متوقف شده است؛ برای ادامه دوباره آن را فعال کنید.','info');return;}
    await window.NobitexNativeBridge.updateBackgroundMonitorStatus(backgroundStatusText());
  }catch(error){eventLog('ارتباط با سرویس پس‌زمینه قطع شد: '+(error?.message||error),'info');}
}


// =========================================================
// NOTIFICATION + SOUND
// =========================================================
const notif={enabled:false,soundEnabled:false,audioCtx:null,
 async enable(){const LN=window.Capacitor?.Plugins?.LocalNotifications;if(LN){try{const p=await LN.requestPermissions();this.enabled=p.display==='granted'}catch(e){this.enabled=false;eventLog('مجوز اعلان بومی داده نشد','info')}return this.enabled}if(!('Notification'in window)){eventLog('این مرورگر اعلان را پشتیبانی نمی‌کند','info');return false}try{this.enabled=(await Notification.requestPermission())==='granted'}catch{this.enabled=false}return this.enabled;},
 disable(){this.enabled=false;},
 async enableSound(){try{this.audioCtx??=new(window.AudioContext||window.webkitAudioContext)();await this.audioCtx.resume();this.soundEnabled=true;return true}catch(e){eventLog('فعال‌سازی صدا ناموفق بود: '+e.message);return false}},
 beep(type='buy',test=false){if(!this.audioCtx||(!this.soundEnabled&&!test))return;try{const ctx=this.audioCtx,now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.type='sine';osc.frequency.setValueAtTime(type==='buy'?660:440,now);osc.frequency.setValueAtTime(type==='buy'?880:330,now+.12);gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(.06,now+.02);gain.gain.exponentialRampToValueAtTime(.001,now+.4);osc.start(now);osc.stop(now+.45)}catch(e){eventLog('پخش صدا مسدود شد','info')}},
 async notify(title,body,tag,type){if(this.enabled&&window.NobitexNativeBridge?.isAndroid&&window.NobitexNativeBridge.notifyEntry){try{await window.NobitexNativeBridge.notifyEntry({title,body,tag});if(this.soundEnabled)this.beep(type);return}catch(e){eventLog('اعلان بومی ارسال نشد','info')}}const LN=window.Capacitor?.Plugins?.LocalNotifications;if(this.enabled&&LN){try{await LN.schedule({notifications:[{id:Math.floor(Date.now()%2147483000),title,body}]})}catch(e){eventLog('اعلان بومی ارسال نشد','info')}if(this.soundEnabled)this.beep(type);return}if(this.enabled&&'Notification'in window&&Notification.permission==='granted'){try{const n=new Notification(title,{body,tag,silent:false,requireInteraction:true});n.onclick=()=>{window.focus();n.close()}}catch(e){eventLog('اعلان مرورگر ساخته نشد','info')}}if(this.soundEnabled)this.beep(type)}
};

// =========================================================
// DATA LAYER — دریافت مستقیم و واسط اختصاصی
// =========================================================
const LS=(k,v)=>{try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v); }catch(e){ return null; }};
let PROXY=(LS('proxyUrl')||'').trim().replace(/\/+$/,'');
const BASES={nobitex:NOBITEX_API,coingecko:COINGECKO_API};
const diag={nobitex:'—',coingecko:'—',ws:'—',idb:'—'};
let coinById=new Map(), coinBySym=new Map();
let latestMarketStats=new Map();
function renderDiag(){netTimes=netTimes.filter(t=>Date.now()-t<60000);diagBar.textContent=`نوبیتکس REST: ${diag.nobitex} • رتبه: ${prefs.useCoinGecko?diag.coingecko:'حجم تتری'} • WS: ${diag.ws} • کندل زنده: ${live?.lastCandleAt?new Date(live.lastCandleAt).toLocaleTimeString('fa-IR'):'—'} • معاملات زنده: ${live?.lastTradeAt?new Date(live.lastTradeAt).toLocaleTimeString('fa-IR'):'—'} • کش: ${diag.idb} • درخواست ۶۰ثانیه: ${netTimes.length} • حداقل فاصله OHLC: ${Math.round(Math.max(NOBITEX_OHLC_INTERVAL_MS,circuits.nobitex.intervalMs||0))}ms • صف: ${networkQueue.length}${netCooldown>Date.now()?' • وقفه: '+Math.ceil((netCooldown-Date.now())/1000)+'s':''}`;}
function setUniverse(list){
  allCoins=list;
  // Scanner priority follows 24h quote volume; the visible table order is unchanged.
  scanOrder=list.slice().sort((a,b)=>(num(b.volume,0)-num(a.volume,0)));
  scanTier=0;scanAttempted.clear(); // Keep rolling 60-second completion samples across market-stat refreshes.
  const liveIds=new Set(list.map(c=>c.id));
  for(const id of scanProgress.keys())if(!liveIds.has(id))scanProgress.delete(id);
  for(const id of scanRetryAt.keys())if(!liveIds.has(id))scanRetryAt.delete(id);
  for(const id of scanFailureCount.keys())if(!liveIds.has(id))scanFailureCount.delete(id);
  coinById=new Map(list.map(c=>[c.id,c]));
  coinBySym=new Map(list.map(c=>[c.nobitexSymbol,c]));
}
async function apiReq(svc,path,opt={}){if(!BASES[svc])throw new ApiError('منبع داده نامعتبر است',400);const via=PROXY?'واسط اختصاصی':isLocalMode()?'محلی':'مستقیم';const url=PROXY?`${PROXY}/${svc}${path}`:isLocalMode()?`/api/exchange?source=${svc}&path=${encodeURIComponent(path)}`:BASES[svc]+path;const key=opt.key||svc+':'+path;const intervalMs=Number.isFinite(opt.intervalMs)?opt.intervalMs:(svc==='nobitex'&&path.startsWith('/market/udf/history')?NOBITEX_OHLC_INTERVAL_MS:(svc==='nobitex'?NOBITEX_DEFAULT_INTERVAL_MS:1000));return requestJob(key,async()=>{try{const d=await fetchJSON(url,{},DIRECT_TIMEOUT_MS);diag[svc]='✓ '+via;renderDiag();return d}catch(error){diag[svc]='✗ '+via;eventLog(`${svc}: ${error?.message||error}`);renderDiag();throw error}},opt.priority||0,svc,intervalMs);}

// ---------- IndexedDB ----------
let idb=null; // Database key names remain on the legacy v4 namespace to preserve existing local data.
const memStore={candles:new Map(),meta:new Map(),scan_runs:new Map(),symbol_scans:new Map(),gate_events:new Map(),alert_events:new Map()};
function idbOpen(){return new Promise(resolve=>{let settled=false;const finish=(db)=>{if(settled){db?.close();return}settled=true;clearTimeout(timer);idb=db||null;diag.idb=db?'✓':'حافظه موقت';resolve()};const timer=setTimeout(()=>finish(null),2500);try{const request=indexedDB.open('nobitex-scalp-v4',3);request.onupgradeneeded=()=>{for(const s of ['candles','meta','scan_runs','symbol_scans','gate_events','alert_events'])if(!request.result.objectStoreNames.contains(s))request.result.createObjectStore(s,{keyPath:'key'})};request.onsuccess=()=>finish(request.result);request.onerror=request.onblocked=()=>finish(null)}catch{finish(null)}})}
function idbReq(store,mode,fn){
  return new Promise(res=>{
    try{
      const tx=idb.transaction(store,mode); const rq=fn(tx.objectStore(store));
      tx.oncomplete=()=>res(rq?rq.result:true); tx.onerror=tx.onabort=()=>res(undefined);
    }catch(e){ res(undefined); }
  });
}
async function dbGet(store,key){if(idb){const value=await idbReq(store,'readonly',o=>o.get(key));if(value!==undefined)return value}return memStore[store].get(key);}
async function dbPut(store,value){memStore[store].set(value.key,value);if(idb)return idbReq(store,'readwrite',o=>o.put(value));}
async function dbAll(store){if(idb){const values=await idbReq(store,'readonly',o=>o.getAll());if(Array.isArray(values))return values}return [...(memStore[store]?.values()||[])];}
async function dbPrune(){
  if(!idb) return;
  const limit=Date.now()-14*86400000;
  idbReq('candles','readwrite',o=>{ const c=o.openCursor(); c.onsuccess=()=>{ const cur=c.result; if(cur){ if((cur.value.fetchedAt||0)<limit) cur.delete(); cur.continue(); } }; return c; });
}

// ---------- Nobitex stats ----------
async function fetchNobitexMarketStats(){const data=await apiReq('nobitex','/market/stats?dstCurrency=usdt',{key:'nobitex:stats',priority:4});if(data?.status!=='ok'||!data.stats)throw new ApiError('قالب آمار نوبیتکس نامعتبر است');return statsMap(data.stats,Date.now());}

async function fetchTopCoins(){if(!prefs.useCoinGecko){diag.coingecko='غیرفعال؛ فهرست با حجم تتری';return null}const cached=await dbGet('meta','cgList');if(cached?.list&&Date.now()-cached.ts<CG_TTL_MS){diag.coingecko='✓ کش';return cached.list}try{const data=await apiReq('coingecko',`/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${TOP_LIMIT}&page=1&sparkline=false`,{priority:-1,key:'cg:rank'});if(!Array.isArray(data))throw new Error('رتبه‌بندی نامعتبر است');const list=data.map((c,i)=>({id:String(c.id),rank:c.market_cap_rank||i+1,symbol:String(c.symbol||'').toUpperCase(),name:String(c.name||c.symbol),marketCap:num(c.market_cap)}));await dbPut('meta',{key:'cgList',list,ts:Date.now()});return list}catch(e){diag.coingecko=cached?'کش قدیمی':'ناموفق؛ فهرست با حجم';return cached?.list||null}}

function coinFromMarketStat(s,rank=1,name=null){return{id:'nobitex:'+s.symbol,rank,symbol:s.base,name:name||s.base,marketRank:null,rankSource:'افزوده‌شده از بازار فعال نوبیتکس',price:s.lastPrice,dayOpen:s.dayOpen,change24h:s.change24h,volume:s.volumeQuote,high24h:s.high,low24h:s.low,bestBid:s.bestBid,bestAsk:s.bestAsk,nobitexSymbol:s.symbol,quoteAt:s.quoteAt||0,priceAt:s.priceAt||0}}
function buildUniverse(globalCoins,stats){const bySymbol=new Map(),duplicates=new Set();for(const c of globalCoins||[]){if(bySymbol.has(c.symbol))duplicates.add(c.symbol);else bySymbol.set(c.symbol,c)}const ranked=[...stats.values()].filter(s=>!s.isClosed&&s.lastPrice>0&&s.volumeQuote>0).sort((a,b)=>{const ga=duplicates.has(a.base)?null:bySymbol.get(a.base),gb=duplicates.has(b.base)?null:bySymbol.get(b.base);return (ga?.rank??Infinity)-(gb?.rank??Infinity)||b.volumeQuote-a.volumeQuote}).slice(0,TOP_LIMIT);return ranked.map((s,i)=>{const g=duplicates.has(s.base)?null:bySymbol.get(s.base);return{...coinFromMarketStat(s,i+1,g?.name||null),marketRank:g?.rank||null,rankSource:g?'رتبه جهانی؛ تکمیل با حجم':'حجم تتری نوبیتکس'}})}
function augmentUniverseWithWatchlist(baseList,stats){const out=baseList.slice(),seen=new Set(out.map(c=>c.nobitexSymbol));for(const item of watchlist){const symbol=String(item.symbol||'').toUpperCase();if(seen.has(symbol))continue;const stat=stats.get(symbol.replace(/USDT$/,''));if(!stat||stat.isClosed||!(stat.lastPrice>0&&stat.volumeQuote>0))continue;out.push(coinFromMarketStat(stat,out.length+1,item.name||item.base));seen.add(symbol);}return out;}

// =========================================================
// OHLCV
// =========================================================
async function fetchNobitexOHLCV(symbol,tfKey,fromSec,priority=0){if(!/^[A-Z0-9]{1,24}USDT$/.test(symbol)||!TIMEFRAMES[tfKey])throw new ApiError('نماد یا تایم‌فریم نامعتبر است',400);const now=Math.floor(Date.now()/1000),range=fromSec?`from=${fromSec}&to=${now}`:`countback=500&to=${now}`;const data=await apiReq('nobitex',`/market/udf/history?symbol=${symbol}&resolution=${TIMEFRAMES[tfKey].nobitex}&${range}`,{key:`N:${symbol}:${tfKey}`,priority});return normalizeNobitex(data,tfKey);}

function normalizeNobitex(data,tfKey){if(!data||data.s!=='ok')throw new Error(data?.s==='no_data'?'منبع برای این بازه داده ندارد':data?.errmsg||'پاسخ UDF نامعتبر است');if(!['t','o','h','l','c','v'].every(k=>Array.isArray(data[k])&&data[k].length===data.t.length))throw new Error('طول آرایه‌های OHLCV برابر نیست');const now=Date.now(),map=new Map();let invalid=0,duplicates=0;for(let i=0;i<data.t.length;i++){const b={t:num(data.t[i],NaN)*1000,o:num(data.o[i],NaN),h:num(data.h[i],NaN),l:num(data.l[i],NaN),c:num(data.c[i],NaN),v:num(data.v[i],NaN),tf:tfKey};if(![b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||!Number.isInteger(b.t)||b.t<=0||b.t>now+5000||b.l<=0||b.v<0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c)){invalid++;continue}if(map.has(b.t))duplicates++;map.set(b.t,b)}const out=[...map.values()].sort((a,b)=>a.t-b.t);Object.defineProperty(out,'validation',{value:{invalid,duplicates},enumerable:false});return out;}

function dropOpenCandleStrict(candles, tfKey){
  if(!candles.length) return [];
  const interval=TIMEFRAMES[tfKey].seconds*1000;
  const now=Date.now();
  return candles.filter(c => c.t + interval <= now);
}

function aggregate4hFrom1h(hourly){
  const bars=dropOpenCandleStrict(hourly,'1h'),groups=new Map(),H=3600000,Q=4*H;
  for(const b of bars){const start=Math.floor(b.t/Q)*Q;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(b)}
  const out=[];
  for(const [start,items] of [...groups.entries()].sort((a,b)=>a[0]-b[0])){
    items.sort((a,b)=>a.t-b.t);
    if(items.length!==4||items.some((b,i)=>b.t!==start+i*H)||start+Q>Date.now())continue;
    out.push({t:start,o:items[0].o,h:Math.max(...items.map(x=>x.h)),l:Math.min(...items.map(x=>x.l)),c:items[3].c,v:items.reduce((n,x)=>n+x.v,0),tf:'4h'});
  }
  return out.slice(-600);
}
async function fetchTimeframe(coin,tfKey,priority=0,force=false){
  const symbol=coin.nobitexSymbol,key=symbol+'|'+tfKey,ms=TIMEFRAMES[tfKey].seconds*1000,now=Date.now();
  let rec=await dbGet('candles',key),raw=[],validation={invalid:0,duplicates:0},networkError=rec?.networkError||null;
  try{raw=validateCachedCandles(rec?.candles||[],tfKey);validation=rec?.validation||raw.validation||validation}catch(e){eventLog(`${symbol} ${tfKey}: کش نامعتبر پاک‌سازی شد`)}
  let meta=frameMeta.get(key)||{},dq=computeDataQuality(raw,tfKey);
  // Compare the 1h-derived series with the cached direct 4h series.
  // Never overwrite a better direct 4h history with a sparse derived series.
  if(tfKey==='4h'){
    const oneHour=await dbGet('candles',symbol+'|1h');
    const hourly=validateCachedCandles(oneHour?.candles||[],'1h');
    const derived=aggregate4hFrom1h(hourly),derivedQuality=computeDataQuality(derived,'4h');
    const directCandles=!rec?.derivedFrom?raw:[];
    const directQuality=computeDataQuality(directCandles,'4h');
    const useDerived=derivedQuality.usable&&(!directCandles.length||!directQuality.usable||derivedQuality.quality>directQuality.quality||
      (derivedQuality.quality===directQuality.quality&&derivedQuality.bars>directQuality.bars));
    if(useDerived){raw=derived;dq=derivedQuality;validation={invalid:0,duplicates:0};networkError=null;rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:oneHour?.fetchedAt||Date.now(),validation,networkError:null,derivedFrom:'1h',retryAt:0};await dbPut('candles',rec);meta={...meta,fetchedAt:rec.fetchedAt,retryAt:0,derivedFrom:'1h'};}
    else if(directCandles.length){raw=directCandles;dq=directQuality;}
    else if(derived.length){raw=derived;dq=derivedQuality;rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:oneHour?.fetchedAt||0,validation,networkError:null,derivedFrom:'1h'};}
  }
  // Request cadence is based on last successful fetch, not on candle timestamp alone.
  // Illiquid markets may legitimately omit no-trade intervals; do not refetch them on every scan cycle.
  const refreshMs=ms; // Each timeframe refreshes only when its own latest closed interval is due.
  const lastFetchAt=Math.max(Number(meta.fetchedAt)||0,Number(rec?.fetchedAt)||0);
  const retryAt=Math.max(Number(meta.retryAt)||0,Number(rec?.retryAt)||0);
  const needDirect4h=tfKey==='4h'&&!dq.usable&&(!rec?.candles?.length||!!rec?.derivedFrom);
  const due=force||!rec||!raw.length||needDirect4h||(!!networkError&&retryAt<=now)||(!networkError&&now-lastFetchAt>=refreshMs);
  if(due&&retryAt<=now){
    try{
      if(tfKey==='4h'){
        const oneHour=await dbGet('candles',symbol+'|1h');const derived=aggregate4hFrom1h(validateCachedCandles(oneHour?.candles||[],'1h'));const q=computeDataQuality(derived,'4h');
        const currentQ=computeDataQuality(raw,'4h');
        if(q.usable&&(!currentQ.usable||q.quality>currentQ.quality||(!rec?.derivedFrom&&q.quality===currentQ.quality&&q.bars>currentQ.bars))){raw=derived;dq=q;validation={invalid:0,duplicates:0};networkError=null;rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:oneHour?.fetchedAt||Date.now(),validation,networkError:null,derivedFrom:'1h',retryAt:0};await dbPut('candles',rec);meta={fetchedAt:rec.fetchedAt,retryAt:0,derivedFrom:'1h'};}
        else throw new ApiError('داده ۱ساعته برای به‌روزرسانی ۴ساعته کافی یا بهتر نیست؛ دریافت مستقیم ۴ساعته انجام می‌شود');
      } else {
        const full=force||raw.length<80||dq.coveragePercent<dq.minCoverage||dq.maxGap>dq.maxGapAllowed||dq.misaligned>0||validation.invalid>0;
        const fresh=await fetchNobitexOHLCV(symbol,tfKey,full?null:Math.floor((raw.at(-1).t-2*ms)/1000),priority);
        if(!fresh.length)throw new ApiError('منبع کندلی در این بازه برنگرداند');
        validation=fresh.validation||validation;const merged=new Map((full?[]:raw).map(c=>[c.t,c]));
        for(const c of fresh)if(c.t+ms<=Date.now())merged.set(c.t,c);
        raw=[...merged.values()].sort((a,b)=>a.t-b.t).slice(-600);networkError=null;
        rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:Date.now(),validation,networkError:null,retryAt:0};await dbPut('candles',rec);meta={fetchedAt:rec.fetchedAt,retryAt:0};
      }
    }catch(e){
      // Fallback to direct 4h only when 1h aggregation cannot provide enough continuous history.
      if(tfKey==='4h'&&String(e.message).includes('دریافت مستقیم ۴ساعته')){
        try{const fresh=await fetchNobitexOHLCV(symbol,'4h',null,priority);if(!fresh.length)throw new ApiError('داده مستقیم ۴ساعته موجود نیست');raw=fresh.filter(c=>c.t+ms<=Date.now()).slice(-600);validation=fresh.validation||validation;networkError=null;rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:Date.now(),validation,networkError:null,retryAt:0};await dbPut('candles',rec);meta={fetchedAt:rec.fetchedAt,retryAt:0};}
        catch(fallbackError){networkError=fallbackError.message;const retryAt=Date.now()+Math.max(5000,(fallbackError.retryAfter||30)*1000);rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:rec?.fetchedAt||Date.now(),networkError,retryAt,validation};await dbPut('candles',rec);meta={...meta,retryAt,fetchedAt:rec.fetchedAt};eventLog(`${coin.symbol} ${tfKey}: ${fallbackError.message}`)}
      }else{networkError=e.message;const retryAt=Date.now()+Math.max(5000,(e.retryAfter||30)*1000);rec={key,sym:symbol,tf:tfKey,candles:raw,fetchedAt:rec?.fetchedAt||Date.now(),networkError,retryAt,validation};await dbPut('candles',rec);meta={...meta,retryAt,fetchedAt:rec.fetchedAt};eventLog(`${coin.symbol} ${tfKey}: ${e.message}`)}
    }
  }
  frameMeta.set(key,meta);raw=dropOpenCandleStrict(raw,tfKey);dq=computeDataQuality(raw,tfKey);const ready=dq.usable&&validation.invalid===0;
  const problems=[networkError,...(validation.invalid?[`${validation.invalid} کندل نامعتبر حذف شد`]:[]),...(!dq.usable?[dataQualityMessage(dq)]:[])].filter(Boolean);
  return{candles:raw,source:networkError?'Nobitex / کش با خطا':tfKey==='4h'&&rec?.derivedFrom?'Nobitex / تجمیع ۱ساعته':'Nobitex',pair:symbol,ready,stale:!!networkError,networkError,validation,fetchedAt:rec?.fetchedAt||0,error:problems.join('؛ '),quality:dq};
}

// =========================================================
// INDICATORS
// =========================================================
function sma(values, period){
  if(!Array.isArray(values) || values.length<period) return null;
  let s=0; for(let i=values.length-period;i<values.length;i++) s+=values[i];
  return s/period;
}
function smaSeries(values, period){
  const out=Array(values.length).fill(null);
  if(values.length<period) return out;
  let s=0;
  for(let i=0;i<values.length;i++){ s+=values[i]; if(i>=period) s-=values[i-period]; if(i>=period-1) out[i]=s/period; }
  return out;
}
function emaSeries(values, period){
  const out=Array(values.length).fill(null);
  if(values.length<period) return out;
  let seed=0; for(let i=0;i<period;i++) seed+=values[i];
  let ema=seed/period; out[period-1]=ema;
  const k=2/(period+1);
  for(let i=period;i<values.length;i++){ ema=values[i]*k+ema*(1-k); out[i]=ema; }
  return out;
}
function rsiSeries(values,period=14){const out=Array(values.length).fill(null);if(values.length<=period)return out;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d)}gain/=period;loss/=period;const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);out[period]=value();for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;out[i]=value()}return out;}
function trueRangeSeries(candles){
  const tr=Array(candles.length).fill(null);
  for(let i=0;i<candles.length;i++){
    if(i===0) tr[i]=candles[i].h-candles[i].l;
    else tr[i]=Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
  }
  return tr;
}
function atrSeries(candles, period=14){
  const tr=trueRangeSeries(candles);
  const out=Array(candles.length).fill(null);
  if(candles.length<period) return out;
  let atr=0; for(let i=0;i<period;i++) atr+=tr[i]; atr/=period;
  out[period-1]=atr;
  for(let i=period;i<candles.length;i++){ atr=((atr*(period-1))+tr[i])/period; out[i]=atr; }
  return out;
}
function macdSeries(values){
  const e12=emaSeries(values,12), e26=emaSeries(values,26);
  const macd=Array(values.length).fill(null);
  let first=-1;
  for(let i=0;i<values.length;i++) if(e12[i]!==null&&e26[i]!==null){macd[i]=e12[i]-e26[i]; if(first===-1)first=i;}
  const signal=Array(values.length).fill(null);
  if(first>=0){
    const trimmed=macd.slice(first).map(v=>v??0);
    const sig=emaSeries(trimmed,9);
    for(let i=0;i<sig.length;i++) signal[first+i]=sig[i];
  }
  const hist=Array(values.length).fill(null);
  for(let i=0;i<values.length;i++) if(macd[i]!==null&&signal[i]!==null) hist[i]=macd[i]-signal[i];
  return {macd,signal,hist};
}
function adxSeries(candles,period=14){const n=candles.length,out=Array(n).fill(null);out.plusDI=Array(n).fill(null);out.minusDI=Array(n).fill(null);if(n<period*2)return out;let trs=0,ps=0,ms=0;const dx=[];for(let i=1;i<n;i++){const up=candles[i].h-candles[i-1].h,dn=candles[i-1].l-candles[i].l,tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c)),p=up>dn&&up>0?up:0,m=dn>up&&dn>0?dn:0;if(i<=period){trs+=tr;ps+=p;ms+=m}else{trs=trs-trs/period+tr;ps=ps-ps/period+p;ms=ms-ms/period+m}if(i>=period){const a=trs?ps/trs*100:0,b=trs?ms/trs*100:0;out.plusDI[i]=a;out.minusDI[i]=b;dx.push({i,v:a+b?100*Math.abs(a-b)/(a+b):0})}}if(dx.length<period)return out;let a=dx.slice(0,period).reduce((s,x)=>s+x.v,0)/period;out[dx[period-1].i]=a;for(let j=period;j<dx.length;j++){a=(a*(period-1)+dx[j].v)/period;out[dx[j].i]=a}return out;}
function bollinger(values, period=20, mult=2){
  const mid=smaSeries(values,period);
  const upper=Array(values.length).fill(null), lower=Array(values.length).fill(null);
  for(let i=period-1;i<values.length;i++){
    const m=mid[i]; let v=0;
    for(let j=i-period+1;j<=i;j++) v+=(values[j]-m)**2;
    const sd=Math.sqrt(v/period);
    upper[i]=m+mult*sd; lower[i]=m-mult*sd;
  }
  return {mid,upper,lower};
}

// =========================================================
// ✅ ICHIMOKU (ادغام‌شده و اصلاح‌شده)
// =========================================================
function ichimokuCalc(candles, tenkanP=9, kijunP=26, senkouBP=52){
  const n = candles.length;
  const H = candles.map(c=>c.h), L = candles.map(c=>c.l);
  const midLine = (period) => {
    const out = Array(n).fill(null);
    for(let i=period-1; i<n; i++){
      let hi=-Infinity, lo=Infinity;
      for(let j=i-period+1; j<=i; j++){
        if(H[j]>hi) hi=H[j];
        if(L[j]<lo) lo=L[j];
      }
      out[i] = (hi+lo)/2;
    }
    return out;
  };
  const tenkan = midLine(tenkanP);
  const kijun = midLine(kijunP);
  const senkouB = midLine(senkouBP);
  const senkouA = Array(n).fill(null);
  for(let i=0; i<n; i++){
    if(tenkan[i]!=null && kijun[i]!=null) senkouA[i] = (tenkan[i]+kijun[i])/2;
  }
  return { tenkan, kijun, senkouA, senkouB };
}

function ichimokuSignal(candles,ichi){const n=candles.length,i=n-1,j=i-26;if(n<78||ichi.senkouA[j]==null||ichi.senkouB[j]==null)return{score:50,labels:['برای ابر فعلی حداقل ۷۸ کندل لازم است'],cloudTop:null,cloudBot:null};const tk=ichi.tenkan[i],kj=ichi.kijun[i],pt=ichi.tenkan[i-1],pk=ichi.kijun[i-1],sa=ichi.senkouA[j],sb=ichi.senkouB[j],price=candles[i].c;const cloudTop=Math.max(sa,sb),cloudBot=Math.min(sa,sb);let score=50;const labels=[];if(pt<=pk&&tk>kj){score+=22;labels.push('تقاطع صعودی TK')}else if(pt>=pk&&tk<kj){score-=22;labels.push('تقاطع نزولی TK')}if(price>cloudTop){score+=15;labels.push('قیمت بالای ابر فعلی')}else if(price<cloudBot){score-=15;labels.push('قیمت زیر ابر فعلی')}else labels.push('قیمت داخل ابر فعلی');if(tk>kj)score+=8;else if(tk<kj)score-=8;if(sa>sb){score+=7;labels.push('ابر فعلی صعودی')}else if(sa<sb){score-=7;labels.push('ابر فعلی نزولی')}return{score:Math.max(0,Math.min(100,score)),labels,cloudTop,cloudBot,tenkan:tk,kijun:kj,senkouA:sa,senkouB:sb,futureA:ichi.senkouA[i],futureB:ichi.senkouB[i]};}

// =========================================================
// ✅ ZIGZAG + FIBONACCI (ادغام‌شده)
// =========================================================
function zigzagFib(candles,strength=3){if(candles.length<strength*2+4)return null;const pivots=[];for(let i=strength;i<candles.length-strength;i++){let high=true,low=true;for(let j=1;j<=strength;j++){if(candles[i].h<=candles[i-j].h||candles[i].h<=candles[i+j].h)high=false;if(candles[i].l>=candles[i-j].l||candles[i].l>=candles[i+j].l)low=false}if(high===low)continue;const p={i,price:high?candles[i].h:candles[i].l,type:high?'H':'L',confirmedAt:i+strength},last=pivots.at(-1);if(!last||last.type!==p.type)pivots.push(p);else if(p.type==='H'?p.price>last.price:p.price<last.price)pivots[pivots.length-1]=p;}if(pivots.length<2)return null;const a=pivots.at(-2),b=pivots.at(-1),hi=Math.max(a.price,b.price),lo=Math.min(a.price,b.price),range=hi-lo;if(range<=0)return null;const levels=[0,.236,.382,.5,.618,.786,1].map(p=>({p,label:(p*100).toFixed(p===0||p===1?0:1)+'%',price:b.price+(a.price-b.price)*p}));const last=candles.at(-1).c;let nearest=levels[0],dist=Infinity;for(const lv of levels){const d=Math.abs(last-lv.price)/last;if(d<dist){dist=d;nearest=lv}}return{pivots:pivots.slice(-12),hi,lo,range,levels,nearest,distToNearest:dist,dirUp:b.price>a.price,anchorStart:a,anchorEnd:b,nearestLabel:`${nearest.label} (${(dist*100).toFixed(2)}٪)`};}

// =========================================================
// PIVOTS & STRUCTURE (existing)
// =========================================================
function pivotIndices(candles, left=2, right=2){
  const highs=[],lows=[];
  for(let i=left;i<candles.length-right;i++){
    let hi=true,lo=true;
    for(let j=1;j<=left;j++){if(candles[i].h<=candles[i-j].h)hi=false;if(candles[i].l>=candles[i-j].l)lo=false;}
    for(let j=1;j<=right;j++){if(candles[i].h<=candles[i+j].h)hi=false;if(candles[i].l>=candles[i+j].l)lo=false;}
    if(hi)highs.push(i); if(lo)lows.push(i);
  }
  return {highs,lows};
}
function structureState(candles){
  const {highs,lows}=pivotIndices(candles,2,2);
  const h=highs.slice(-2), l=lows.slice(-2);
  if(h.length<2||l.length<2) return {state:'mixed',score:50,highs:h,lows:l};
  const hh=candles[h[1]].h>candles[h[0]].h;
  const hl=candles[l[1]].l>candles[l[0]].l;
  const lh=candles[h[1]].h<candles[h[0]].h;
  const ll=candles[l[1]].l<candles[l[0]].l;
  if(hh&&hl)return{state:'bullish',score:100,highs:h,lows:l};
  if(lh&&ll)return{state:'bearish',score:0,highs:h,lows:l};
  return{state:'mixed',score:50,highs:h,lows:l};
}
const DIVERGENCE_MAX_AGE_BARS={ '5m':144, '15m':96, '1h':48, '4h':42, '1d':60 };
function detectDivergence(candles, osc, tfKey='1h'){
  const {lows,highs}=pivotIndices(candles,2,2);
  const maxAge=DIVERGENCE_MAX_AGE_BARS[tfKey]||60;
  const freshPivot=i=>i>=Math.max(0,candles.length-1-maxAge);
  const vL=lows.filter(i=>osc[i]!==null&&freshPivot(i)).slice(-3);
  const vH=highs.filter(i=>osc[i]!==null&&freshPivot(i)).slice(-3);
  let bull=false,bear=false;
  if(vL.length>=2){const a=vL[vL.length-2],b=vL[vL.length-1];if(b-a>=5&&candles[b].l<candles[a].l&&osc[b]>osc[a])bull=true;}
  if(vH.length>=2){const a=vH[vH.length-2],b=vH[vH.length-1];if(b-a>=5&&candles[b].h>candles[a].h&&osc[b]<osc[a])bear=true;}
  return {bull,bear};
}
function candleReversal(candles){
  if(candles.length<3)return{score:0,labels:[]};
  const a=candles[candles.length-2],b=candles[candles.length-1];
  const body=Math.abs(b.c-b.o),range=Math.max(1e-12,b.h-b.l);
  const lower=Math.min(b.o,b.c)-b.l, upper=b.h-Math.max(b.o,b.c);
  const labels=[];let score=0;
  const hammer=b.c>b.o&&lower>=body*2&&upper<=body*0.8&&(body/range)<0.45;
  const engulf=b.c>b.o&&a.c<a.o&&b.o<=a.c&&b.c>=a.o;
  if(hammer){score=Math.max(score,65);labels.push('چکش');}
  if(engulf){score=Math.max(score,90);labels.push('پوشای صعودی');}
  return {score,labels};
}

// =========================================================
// DATA QUALITY
// =========================================================
function computeDataQuality(candles,tfKey,asOf=Date.now()){
  const interval=TIMEFRAMES[tfKey].seconds*1000,now=Number.isFinite(asOf)?asOf:Date.now();
  const bars=Array.isArray(candles)?candles:[];
  let gaps=0,maxGap=0,tail=bars.length?1:0,misaligned=0;
  for(let i=1;i<bars.length;i++){
    const delta=bars[i].t-bars[i-1].t;
    const steps=Math.max(1,Math.round(delta/interval));
    const deviation=Math.abs(delta-steps*interval);
    if(deviation>Math.max(60000,interval*.10))misaligned++;
    const missing=Math.max(0,steps-1);
    gaps+=missing;maxGap=Math.max(maxGap,missing);
    tail=missing===0&&deviation<=Math.max(60000,interval*.10)?tail+1:1;
  }
  const expected=bars.length>1?Math.max(bars.length,Math.round((bars.at(-1).t-bars[0].t)/interval)+1):bars.length;
  const coverage=expected?Math.min(1,bars.length/expected):0;
  const coveragePercent=Math.round(coverage*100);
  const ageSec=bars.length?Math.max(0,(now-(bars.at(-1).t+interval))/1000):Infinity;
  const freshnessLimitSec=TIMEFRAMES[tfKey].seconds*1.75;
  const freshness=ageSec<=freshnessLimitSec?100:0;
  const adequacy=Math.min(100,Math.round(bars.length/80*100));
  const structScore=coveragePercent;
  const quality=Math.round(adequacy*.40+structScore*.35+freshness*.25);
  const minCoverage=70,minBars=80,maxGapAllowed=4;
  const usable=bars.length>=minBars&&coveragePercent>=minCoverage&&maxGap<=maxGapAllowed&&misaligned===0&&freshness===100;
  let reason='';
  if(bars.length<minBars)reason=`فقط ${bars.length} از ${minBars} کندل معتبر دریافت شده است`;
  else if(coveragePercent<minCoverage)reason=`پوشش زمانی کندل‌ها ${coveragePercent}٪ است و حداقل ${minCoverage}٪ لازم است`;
  else if(maxGap>maxGapAllowed)reason=`بزرگ‌ترین فاصله تاریخچه ${maxGap} کندل است؛ حداکثر ${maxGapAllowed} کندل مجاز است`;
  else if(misaligned>0)reason=`${misaligned} فاصله زمانی نامنظم در تاریخچه وجود دارد`;
  else if(freshness===0)reason=`آخرین کندل بسته‌شده ${Math.round(ageSec/60)} دقیقه از زمان مورد انتظار عقب است`;
  return{quality,adequacy,structScore,freshness,gaps,maxGap,tail,bars:bars.length,expected,coverage,coveragePercent,misaligned,ageSec:Math.round(ageSec),freshnessLimitSec,minBars,minCoverage,maxGapAllowed,usable,reason};
}
function dataQualityMessage(dq){
  if(!dq)return 'کیفیت تاریخچه قابل محاسبه نیست';
  const bits=[`${dq.bars??0}/${dq.minBars||80} کندل معتبر`,`پوشش ${dq.coveragePercent??0}٪`,`بزرگ‌ترین شکاف ${dq.maxGap??0} کندل`];
  if(dq.freshness===0)bits.push('آخرین کندل قدیمی است');
  if(dq.misaligned)bits.push(`${dq.misaligned} فاصله نامنظم`);
  return (dq.reason||'تاریخچه برای محاسبه کافی نیست')+'؛ '+bits.join('؛ ');
}

// =========================================================
// TIMEFRAME ANALYSIS (با Ichimoku و Fibonacci)
// =========================================================
function analyzeTimeframe(candles, tfKey, source, asOf=Date.now()){
  const allCandles=dropOpenCandleStrict(candles,tfKey);candles=allCandles;const initialDQ=computeDataQuality(allCandles,tfKey,asOf);if(!initialDQ.usable)return{ready:false,tf:tfKey,candles:allCandles,candlesCount:allCandles.length,error:dataQualityMessage(initialDQ),dataQuality:initialDQ.quality,dataQualityDetail:initialDQ,analysisAsOf:asOf};
  const closes=candles.map(x=>x.c), volumes=candles.map(x=>x.v);
  const ema9=emaSeries(closes,9), ema20=emaSeries(closes,20), ema50=emaSeries(closes,50);
  const rsi=rsiSeries(closes,14), macd=macdSeries(closes), atr=atrSeries(candles,14);
  const adx=adxSeries(candles,14), bb=bollinger(closes,20,2);
  const struct=structureState(candles);
  const last=candles[candles.length-1], prev=candles[candles.length-2];
  const lastRsi=rsi.at(-1)??50, lastMacd=macd.macd.at(-1)??0;
  const lastSignal=macd.signal.at(-1)??0, lastHist=macd.hist.at(-1)??0;
  const lastADX=adx.at(-1)??0;
  const volumeSma=sma(volumes.slice(0,-1),20)||0;
  const volRatio=volumeSma>0?last.v/volumeSma:1;

  // ✅ Ichimoku
  const ichi = ichimokuCalc(candles);
  const ichiSig = ichimokuSignal(candles, ichi);

  // ✅ ZigZag + Fibonacci
  const fib = zigzagFib(candles, 3);

  const emaAlignment=(ema9.at(-1)>ema20.at(-1)&&ema20.at(-1)>ema50.at(-1))?100:
    (ema9.at(-1)<ema20.at(-1)&&ema20.at(-1)<ema50.at(-1))?0:50;
  const adxDirection=lastADX<20?50:(adx.plusDI?.at(-1)>adx.minusDI?.at(-1)?100:adx.plusDI?.at(-1)<adx.minusDI?.at(-1)?0:50);
  const rsiTrend=lastRsi>=60?100:(lastRsi<=40?0:50);
  const macdTrend=lastMacd>lastSignal?100:lastMacd<lastSignal?0:50;

  // ✅ وزن‌دهی جدید با ایچیموکو (۲۰٪)
  const trendScore=Math.round(
    emaAlignment*0.25 + struct.score*0.25 + adxDirection*0.10 +
    rsiTrend*0.10 + macdTrend*0.10 + ichiSig.score*0.20
  );

  const rsiDiv=detectDivergence(candles,rsi,tfKey);
  const macdDiv=detectDivergence(candles,macd.hist.map(v=>v??0),tfKey);
  const candle=candleReversal(candles);
  const recentLows=candles.slice(-40).map(x=>x.l);
  const pvLows=pivotIndices(candles,2,2).lows.slice(-8).map(i=>candles[i].l).filter(p=>p<=last.c);
  const support=pvLows.length?Math.max(...pvLows):Math.min(...recentLows);
  const supportDist=support>0?(last.c-support)/support:999;
  const supportSignal=supportDist<=0.015?100:(supportDist<=0.03?60:0);
  const ema20Last=ema20.at(-1), ema20Prev=ema20.at(-2);
  const reclaim=ema20Last&&ema20Prev&&prev&&prev.c<=ema20Prev&&last.c>ema20Last;
  const structureShift=struct.highs.length?last.c>candles[struct.highs.at(-1)].h:false;
  const volumeSignal=volRatio>=2?100:(volRatio>=1.5?70:(volRatio>=1.2?40:0));
  const bbLower=bb.lower.at(-1), bbMid=bb.mid.at(-1);
  const bandSignal=(bbLower&&last.c<=bbLower*1.015)?70:(bbMid&&last.c<bbMid?25:0);

  // سیگنال فیبوناچی: نزدیکی به 61.8٪ یا 78.6٪ حمایت
  let fibSignal = 0;
  if(fib && fib.nearest){
    if((fib.nearest.p === 0.618 || fib.nearest.p === 0.786) && fib.dirUp){
      fibSignal = fib.distToNearest <= 0.02 ? 70 : (fib.distToNearest <= 0.04 ? 40 : 0);
    } else if(fib.nearest.p === 0.5 && fib.distToNearest <= 0.02){
      fibSignal = 30;
    }
  }

  const reversalScore=Math.round(
    (rsiDiv.bull?100:0)*0.20 + (macdDiv.bull?100:0)*0.16 + candle.score*0.16 +
    volumeSignal*0.10 + supportSignal*0.10 + (structureShift?100:0)*0.10 +
    (reclaim?100:0)*0.05 + bandSignal*0.03 +
    fibSignal*0.05 + (ichiSig.score>=60?100:0)*0.05
  );
  const bearishReversalScore=Math.round(
    (rsiDiv.bear?100:0)*0.22 + (macdDiv.bear?100:0)*0.18 + (last.c<last.o?65:0)*0.18 +
    volumeSignal*0.12 + (supportDist>0.06?60:0)*0.12 + (struct.state==='bearish'?100:0)*0.10 +
    (last.c<ema20Last?60:0)*0.05 + (bb.upper.at(-1)&&last.c>=bb.upper.at(-1)*0.985?70:0)*0.03
  );

  const dq = computeDataQuality(allCandles, tfKey, asOf);
  const labels=[];
  // Ichimoku labels
  if(ichiSig.labels) labels.push(...ichiSig.labels);
  // Fib labels
  if(fib && fib.distToNearest <= 0.02 && fib.dirUp){
    if(fib.nearest.p === 0.618) labels.push('حمایت ۶۱.۸٪');
    if(fib.nearest.p === 0.786) labels.push('حمایت ۷۸.۶٪');
  }
  // سایر
  if(rsiDiv.bull)labels.push('واگرایی مثبت RSI');
  if(macdDiv.bull)labels.push('واگرایی مثبت MACD');
  if(candle.labels.length)labels.push(...candle.labels);
  if(volRatio>=1.5)labels.push('افزایش حجم');
  if(supportSignal>=60)labels.push('نزدیکی به حمایت');
  if(reclaim)labels.push('بازپس‌گیری EMA20');
  if(structureShift)labels.push('شکست ساختار');
  if(lastHist>0&&prev&&(macd.hist.at(-2)??0)<=0)labels.push('چرخش MACD');

  return {
    ready:true, tf:tfKey, candlesCount:candles.length, analysisAsOf:asOf,
    dataQuality:dq.quality, dataQualityDetail:dq,
    trendScore, trend:trendLabel(trendScore), reversalScore, bearishReversalScore,
    source, metrics:{
      rsi:lastRsi, adx:lastADX, plusDI:adx.plusDI?.at(-1)??null, minusDI:adx.minusDI?.at(-1)??null, atr:atr.at(-1)??0, volRatio,
      ema9:ema9.at(-1)??0, ema20:ema20Last??0, ema50:ema50.at(-1)??0,
      macd:lastMacd, signal:lastSignal, histogram:lastHist,
      structure:struct.state, structureScore:struct.score,
      bbUpper:bb.upper.at(-1)??0, bbMid:bbMid??0, bbLower:bb.lower.at(-1)??0,
      lastClose:last.c, lastHigh:last.h, lastLow:last.l,
      support, resistance: Math.max(...candles.slice(-40).map(x=>x.h)),
      // Ichimoku metrics
      ichimokuScore: ichiSig.score,
      ichimokuLabels: ichiSig.labels,
      tenkan: ichiSig.tenkan ?? 0,
      kijun: ichiSig.kijun ?? 0,
      cloudTop: ichiSig.cloudTop,
      cloudBot: ichiSig.cloudBot,
      // Ichimoku series (for chart)
      ichimokuSeries: ichi,
      // Fibonacci
      fib: fib
    },
    labels:labels.slice(0,10), lastTime:last.t, lastCandleTime:last.t, candles
  };
}

// =========================================================
// V7.0 DIAGNOSTICS: observer-only, does not alter strategy gates
// =========================================================
let diagnosticRunId='';
let diagnosticRunInitialized=false;
let diagnosticRunPending=false;
const diagnosticMemory=new Map();
const DIAGNOSTIC_LIMIT=1200;
function beginDiagnosticRun(){
  diagnosticRunId='scan-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  const row={key:diagnosticRunId,runId:diagnosticRunId,at:Date.now(),appVersion:'7.6.0',universeSize:allCoins.length,source:'local'};
  dbPut('scan_runs',row).catch(error=>eventLog('ثبت تاریخچه اجرای اسکن ناموفق بود: '+String(error?.message||error).slice(0,120),'info'));
  return diagnosticRunId;
}
function timeframeQualitySnapshot(tfMap,key,required=false){
  const frame=tfMap?.[key];
  if(!frame)return {tf:key,required,status:required?'not_loaded':'not_requested',valid:false,bars:0,minBars:80,coveragePercent:0,maxGap:null,misaligned:null,ageSec:null,freshnessLimitSec:TIMEFRAMES[key].seconds*1.75,quality:null,source:null,error:required?'تایم‌فریم اجباری هنوز دریافت نشده است':'این تایم‌فریم در این مرحله درخواست نشده است'};
  const candles=dropOpenCandleStrict(Array.isArray(frame.candles)?frame.candles:[],key);
  const q=computeDataQuality(candles,key,Number.isFinite(frame.analysisAsOf)?frame.analysisAsOf:Date.now());
  const valid=isTimeframeValid(frame,key);
  const status=valid?'valid':frame.networkError?'network_error':frame.stale?'stale':frame.validation?.invalid?'invalid_candles':!frame.ready?'quality_rejected':'invalid';
  return {tf:key,required,status,valid,bars:q.bars,minBars:q.minBars,expected:q.expected,coveragePercent:q.coveragePercent,gaps:q.gaps,maxGap:q.maxGap,misaligned:q.misaligned,ageSec:q.ageSec,freshnessLimitSec:q.freshnessLimitSec,quality:q.quality,usable:q.usable,source:frame.source||null,fetchedAt:frame.fetchedAt||0,lastCandleAt:candles.at(-1)?.t||null,error:frame.networkError||frame.error||q.reason||null};
}
function diagnosticGateRows(decision){
  return [...(decision?.rows||[]),...(decision?.risks||[])].map((g,i)=>({
    gateId:String(g.name||('gate-'+i)),orderIndex:i,value:g.val??null,threshold:g.need??'',
    passed:g.ok===true,known:g.ok===true||g.ok===false,hard:g.hard!==false
  }));
}
function blockerCategory(name){
  const s=String(name||'');
  if(/اعتبار داده|کیفیت داده|تایم.?فریم|کندل|دریافت داده/.test(s))return 'data';
  if(/نسبت سود|فضای سود|مقاومت|حمایت|هدف سود|محاسبه ریسک/.test(s))return 'risk_reward';
  if(/اسپرد|حجم|نقدشوندگی|بازار بسته|آمار خرید/.test(s))return 'liquidity';
  if(/روند|EMA|RSI|ADX|DI|MACD|ایچیموکو|ابر/.test(s))return 'trend_momentum';
  return 'other';
}
function recordDiagnosticSnapshot(coin,record){
  try{
    const runId=diagnosticRunId||beginDiagnosticRun();
    const decision=computeDecision(coin,record);
    const gates=diagnosticGateRows(decision);
    let hardChain=true;
    const events=gates.map(g=>{
      const independentPassed=g.known&&g.passed;
      // Soft gates remain visible as independent evidence but never break the hard-gate chain.
      let cumulativePassed=null;
      if(g.hard){hardChain=hardChain&&g.known&&g.passed;cumulativePassed=hardChain;}
      return {...g,runId,symbol:coin.nobitexSymbol,snapshotId:record?.snapshotId||null,at:Date.now(),independentPassed,cumulativePassed,reasonCode:g.known?(g.passed?'PASS':'FAIL'):'DATA_MISSING'};
    });
    const tfMap=record?.tfMap||{};
    const q1=timeframeQualitySnapshot(tfMap,'1h',true),q4=timeframeQualitySnapshot(tfMap,'4h',true),q1d=timeframeQualitySnapshot(tfMap,'1d',false);
    const triggerAssessment=computeEntryOpportunity(coin,record),triggerStage=triggerAssessment.baseReady===true;
    const q15=tfMap['15m']?timeframeQualitySnapshot(tfMap,'15m',true):null,q5=tfMap['5m']?timeframeQualitySnapshot(tfMap,'5m',true):null;
    const triggerProbeSample=record?.triggerProbe?.sampled===true;
    const triggerDataStatus=triggerStage?(q15?.valid&&q5?.valid?'valid':([q15,q5].some(x=>x&&(x.status==='network_error'||x.status==='stale'))?'fetch_or_stale_error':(!tfMap['15m']||!tfMap['5m']||q15?.status==='not_loaded'||q5?.status==='not_loaded'?'pending':'quality_rejected'))):triggerProbeSample?(q15?.valid&&q5?.valid?'diagnostic_sample_valid':([q15,q5].some(x=>x&&(x.status==='network_error'||x.status==='stale'))?'diagnostic_sample_error':'diagnostic_sample_quality_rejected')):'not_eligible';
    const valid1h=q1.valid,valid4h=q4.valid,valid1d=q1d.valid;
    const firstHardBlock=events.find(x=>x.hard&&(!x.known||!x.passed));
    const firstSoftFailure=events.find(x=>!x.hard&&x.known&&!x.passed);
    const firstBlocker=(!valid1h||!valid4h)?'اعتبار داده اجباری ۱ساعته/۴ساعته':(firstHardBlock?.gateId||record?.mtf?.blockReasons?.[0]||null);
    const r=record?.risk;
    const hardBlockers=events.filter(x=>x.hard&&(!x.known||!x.passed)).map(x=>x.gateId);
    const dataStatus=valid1h&&valid4h?'valid':(!tfMap['1h']||!tfMap['4h'])?'not_loaded':([q1,q4].some(x=>x.status==='network_error'||x.status==='stale')?'fetch_or_stale_error':'quality_rejected');
    const rrStatus=!r?'risk_calculation_unavailable':Number.isFinite(r.rrNet)?(r.rrNet>=prefs.minRR?'valid':'below_minimum'):'no_valid_target';
    const row={key:runId+'|'+coin.nobitexSymbol+'|'+(record?.snapshotId||'legacy'),runId,symbol:coin.nobitexSymbol,base:coin.symbol,at:Date.now(),appVersion:'7.6.0',snapshotId:record?.snapshotId||null,snapshotMeta:record?.snapshotMeta||null,
      quoteAt:coin.quoteAt||0,quoteAgeMs:coin.quoteAt?Math.max(0,Date.now()-coin.quoteAt):null,
      monitorPrice:coin.bestAsk>0?coin.bestAsk:coin.price,monitorBid:coin.bestBid||null,monitorAsk:coin.bestAsk||null,
      monitorSpread:r?.spread??null,monitorVolume24h:coin.volume??null,monitorSupportDistancePct:monitorPulseMap.get(coin.id)?.snap?.supportDistancePct??null,monitorResistanceRoomPct:monitorPulseMap.get(coin.id)?.snap?.resistanceRoomPct??null,monitorObservedAt:monitorPulseMap.get(coin.id)?.snap?.at??null,marketQuoteObservedAt:Date.now(),
      candle1h:tfMap['1h']?.lastTime||null,candle4h:tfMap['4h']?.lastTime||null,
      valid1h,valid4h,dataStatus,quality1h:q1,quality4h:q4,quality1d:q1d,
      triggerStage,triggerProbeSample,triggerProbeAt:record?.triggerProbe?.at??null,triggerProbeStatus:record?.triggerProbe?.status??null,
      triggerDataStatus,valid15m:q15?.valid??null,valid5m:q5?.valid??null,quality15m:q15,quality5m:q5,
      dailyStatus:q1d.status,dailyRequired:false,
      trend1h:tfMap['1h']?.trendScore??null,trend4h:tfMap['4h']?.trendScore??null,
      finalStatus:record?.mtf?.signalKey||'unknown',monitorKey:record?.mtf?.monitorKey||null,
      monitorTier:record?.mtf?.monitorTier||null,monitorQualified:record?.mtf?.monitorQualified===true,
      monitorReasons:record?.mtf?.monitorReasons||[],decisionStatus:decision.cls,decisionTitle:decision.title,decisionCategory:decision.category||null,entryQuality:decision.entryQuality,
      rrNet:r?.rrNet??null,rrGross:r?.rrGross??null,rrStatus,rrUnavailableReason:r?.rrUnavailableReason||(r?null:riskCalculationUnavailableReason(coin,record)),
      entry:r?.entry??null,stopLoss:r?.stopLoss??null,target:r?.takeProfit??null,ceiling:r?.ceiling??null,spread:r?.spread??null,riskSnapshot:r?{entry:r.entry,stopLoss:r.stopLoss,target:r.takeProfit,ceiling:r.ceiling,spread:r.spread,rrNet:r.rrNet,tfKey:r.tfKey,snapshotId:record?.snapshotId||null}:null,
      support:r?.support??null,resistance:r?.ceiling??null,resistanceRoomPct:r?.resistanceRoomPct??null,
      valid1d,dailyState:q1d.status,
      supportSource:r?.supportSource??null,supportTouches:r?.supportTouches??0,supportStrength:r?.supportStrength??0,supportConfluence:r?.supportConfluence===true,
      resistanceSource:r?.resistanceSource??null,resistanceTouches:r?.resistanceTouches??0,resistanceStrength:r?.resistanceStrength??0,resistanceConfluence:r?.resistanceConfluence===true,
      adx4h:tfMap['4h']?.metrics?.adx??null,plusDI4h:tfMap['4h']?.metrics?.plusDI??null,minusDI4h:tfMap['4h']?.metrics?.minusDI??null,
      reversal1h:tfMap['1h']?.reversalScore??null,bearishReversal1h:tfMap['1h']?.bearishReversalScore??null,
      reversal4h:tfMap['4h']?.reversalScore??null,bearishReversal4h:tfMap['4h']?.bearishReversalScore??null,
      firstBlocker,firstBlockerCategory:blockerCategory(firstBlocker),allHardBlockers:hardBlockers,firstSoftBlocker:firstSoftFailure?.gateId||null,
      hardFailCount:events.filter(x=>x.hard&&x.known&&!x.passed).length,hardUnknownCount:events.filter(x=>x.hard&&!x.known).length,hardBlockerCount:hardBlockers.length,
      softFailCount:events.filter(x=>!x.hard&&x.known&&!x.passed).length,gateCount:events.length};
    diagnosticMemory.set(row.key,{row,events});
    while(diagnosticMemory.size>DIAGNOSTIC_LIMIT)diagnosticMemory.delete(diagnosticMemory.keys().next().value);
    dbPut('symbol_scans',row).catch(e=>eventLog('ثبت Snapshot نماد ناموفق: '+String(e?.message||e).slice(0,120),'info'));
    for(let i=0;i<events.length;i++)dbPut('gate_events',{key:runId+'|'+coin.nobitexSymbol+'|'+(record?.snapshotId||'legacy')+'|'+i, ...events[i]}).catch(e=>eventLog('ثبت رخداد فیلتر ناموفق: '+String(e?.message||e).slice(0,120),'info'));
  }catch(e){eventLog('ثبت آمار تشخیصی ناموفق: '+e.message)}
}
async function hydrateDiagnosticHistory(){
  try{
    const [scans,events]=await Promise.all([dbAll('symbol_scans'),dbAll('gate_events')]);
    const byKey=new Map();
    for(const e of events){const key=e.snapshotId?e.runId+'|'+e.symbol+'|'+e.snapshotId:e.runId+'|'+e.symbol;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(e)}
    scans.sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,DIAGNOSTIC_LIMIT).forEach(row=>diagnosticMemory.set(row.key,{row,events:(byKey.get(row.key)||[]).sort((a,b)=>a.orderIndex-b.orderIndex)}));
  }catch(e){eventLog('بازیابی آمار تشخیصی ناموفق: '+e.message)}
}
function showDiagnostics(){
  const storedItems=[...diagnosticMemory.values()];
  // Keep diagnostics from the current v7 family; older schemas remain excluded.
  const items=storedItems.filter(x=>String(x.row?.appVersion||'').startsWith('7.'));
  const legacyCount=storedItems.length-items.length;
  const earlyCount=items.filter(x=>x.row?.monitorKey==='early'&&x.row?.monitorTier==='raw').length;
  const qualifiedCount=items.filter(x=>x.row?.monitorQualified===true).length;
  const symbols=new Set(items.map(x=>x.row?.symbol).filter(Boolean)).size;
  const runs=new Set(items.map(x=>x.row?.runId).filter(Boolean)).size;
  const readyCount=items.filter(x=>x.row?.finalStatus==='ready'&&x.row?.decisionStatus==='good').length;
  // Aggregate only snapshots written by this build. Older 7.x records may not
  // contain per-timeframe quality fields and must not be treated as invalid data.
  const currentItems=items.filter(x=>x.row?.appVersion?.startsWith('7.5.')&&typeof x.row?.valid1h==='boolean'&&typeof x.row?.valid4h==='boolean');
  const latestBySymbol=new Map();
  for(const item of currentItems){const r=item.row||{},s=r.symbol;if(!s)continue;const old=latestBySymbol.get(s);if(!old||(r.at||0)>(old.row?.at||0))latestBySymbol.set(s,item);}
  const latestRows=[...latestBySymbol.values()].map(x=>x.row);
  const latestValid=latestRows.filter(r=>r.valid1h===true&&r.valid4h===true).length;
  const latestDataInvalid=latestRows.length-latestValid;
  const latestTrendBlocked=latestRows.filter(r=>r.firstBlockerCategory==='trend_momentum').length;
  const latestTargetBlocked=latestRows.filter(r=>r.rrStatus==='no_valid_target'||r.rrStatus==='below_minimum').length;
  const latestRiskCalcUnavailable=latestRows.filter(r=>r.rrStatus==='risk_calculation_unavailable').length;
  const latestDailyNotRequested=latestRows.filter(r=>r.dailyStatus==='not_requested').length;
  const latestTriggerRows=latestRows.filter(r=>r.triggerStage===true);
  const latestTrigger15Valid=latestTriggerRows.filter(r=>r.valid15m===true).length,latestTrigger5Valid=latestTriggerRows.filter(r=>r.valid5m===true).length;
  const latestTriggerBothValid=latestTriggerRows.filter(r=>r.valid15m===true&&r.valid5m===true).length;
  const latestProbeRows=latestRows.filter(r=>r.triggerProbeSample===true);
  const latestProbe15Valid=latestProbeRows.filter(r=>r.valid15m===true).length,latestProbe5Valid=latestProbeRows.filter(r=>r.valid5m===true).length;
  const latestProbeBothValid=latestProbeRows.filter(r=>r.valid15m===true&&r.valid5m===true).length;
  const latestMonitorRows=latestRows.filter(r=>Number.isFinite(r.monitorObservedAt));
  const latestProbeErrors=latestProbeRows.filter(r=>String(r.triggerProbeStatus||'').includes('error')).length;
  const gates=new Map();
  for(const item of items)for(const e of item.events){
    const g=gates.get(e.gateId)||{name:e.gateId,independent:0,known:0,cumulative:0,cumulativeKnown:0,seen:0,hard:e.hard!==false};
    g.seen++;if(e.known){g.known++;if(e.independentPassed)g.independent++;}
    if(e.hard){g.cumulativeKnown++;if(e.cumulativePassed===true)g.cumulative++;}
    gates.set(e.gateId,g);
  }
  const rows=[...gates.values()].map(g=>`<tr><td>${escapeHTML(g.name)}</td><td>${g.independent}/${g.known}</td><td>${g.hard?`${g.cumulative}/${g.cumulativeKnown}`:'— (فیلتر نرم)'}</td><td>${g.seen}</td></tr>`).join('');
  const countBy=field=>{const m=new Map();for(const x of items){const k=x.row?.[field]||'ثبت‌نشده';m.set(k,(m.get(k)||0)+1);}return [...m.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<tr><td>${escapeHTML(k)}</td><td>${n}</td><td>${items.length?((n/items.length)*100).toFixed(1):'0.0'}٪</td></tr>`).join('');};
  const blockerRows=countBy('firstBlocker'),softRows=countBy('firstSoftBlocker');
  const d=document.createElement('dialog');d.className='v4-dialog';
  d.innerHTML=`<h3>داشبورد تشخیصی فیلترها — نسخه ۷٫۶٫۰</h3><p>آمار تاریخی: ${items.length} Snapshot، ${runs} اجرای اسکن و ${symbols} نماد منحصربه‌فرد. نامزد خام پایش اولیه: ${earlyCount} Snapshot؛ نامزد واجد شرایط: ${qualifiedCount} Snapshot؛ سیگنال خرید تأییدشده: ${readyCount} Snapshot.</p><div class="dr-note"><b>وضعیت آخرین ارزیابی هر نماد (بدون شمارش تکراری):</b> داده معتبر ۱H و ۴H: ${latestValid}/${latestRows.length}؛ داده اجباری نامعتبر/دریافت‌نشده: ${latestDataInvalid}؛ مانع روند/مومنتوم: ${latestTrendBlocked}؛ هدف یا فضای سود نامعتبر/ناکافی: ${latestTargetBlocked}؛ محاسبه ریسک انجام نشده: ${latestRiskCalcUnavailable}؛ داده روزانه در این مرحله درخواست نشده: ${latestDailyNotRequested}. تایم‌فریم روزانه شرط اجباری اسکن پایه نیست. نمادهای رسیده به مرحله ماشه واقعی: ${latestTriggerRows.length}؛ داده معتبر ۱۵m: ${latestTrigger15Valid}؛ داده معتبر ۵m: ${latestTrigger5Valid}؛ هر دو معتبر: ${latestTriggerBothValid}. نمادهای دارای پایش قیمت/اسپرد/حجم/فاصله سطوح: ${latestMonitorRows.length}؛ نمونه تشخیصی مستقل: ${latestProbeRows.length} نماد؛ خطای نمونه‌برداری: ${latestProbeErrors}؛ ۱۵m معتبر: ${latestProbe15Valid}؛ ۵m معتبر: ${latestProbe5Valid}؛ هر دو معتبر: ${latestProbeBothValid}. نمونه تشخیصی به‌تنهایی مجوز ورود نیست.</div><p>عبور مستقل برای همه فیلترها محاسبه می‌شود. عبور تجمعی فقط زنجیره فیلترهای سخت را دنبال می‌کند؛ MACD فیلتر نرم است. ${legacyCount} Snapshot قدیمی کنار گذاشته شده است.</p><h4>عملکرد تک‌تک فیلترها</h4><div style="max-height:38vh;overflow:auto"><table><thead><tr><th>فیلتر</th><th>عبور مستقل</th><th>عبور تجمعی سخت</th><th>تعداد ارزیابی</th></tr></thead><tbody>${rows||'<tr><td colspan="4">هنوز Snapshot کافی ثبت نشده است.</td></tr>'}</tbody></table></div><h4>اولین مانع سخت هر نماد (Snapshot تاریخی)</h4><div style="max-height:24vh;overflow:auto"><table><thead><tr><th>مانع</th><th>تعداد</th><th>سهم</th></tr></thead><tbody>${blockerRows}</tbody></table></div><h4>اولین مانع نرم</h4><div style="max-height:20vh;overflow:auto"><table><thead><tr><th>فیلتر نرم</th><th>تعداد</th><th>سهم</th></tr></thead><tbody>${softRows}</tbody></table></div><p>برای هر نماد در خروجی JSON، وضعیت اجباری ۱H/۴H، جزئیات پوشش، تعداد کندل، شکاف، تازگی، وضعیت اختیاری ۱D، علت نامعتبر بودن هدف سود و دسته مانع ثبت می‌شود. تاریخچه محلی فقط روی همین دستگاه نگهداری می‌شود.</p><div class="v4-actions"><button type="button" id="diagExport">خروجی JSON v10</button><button type="button" id="diagClose">بستن</button></div>`;
  document.body.append(d);d.querySelector('#diagClose').onclick=()=>d.close();
  d.querySelector('#diagExport').onclick=()=>{const payload={format:'nobitex-v7-diagnostics',version:10,appVersion:'7.6.0',exportedAt:new Date().toISOString(),items};downloadBlob('nobitex-v7.6.0-diagnostics.json',new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}))};
  d.addEventListener('close',()=>d.remove());d.showModal();
}
function installDiagnosticsButton(){
  if(document.getElementById('diagnosticsBtn'))return;
  const b=document.createElement('button');b.id='diagnosticsBtn';b.type='button';b.textContent='آمار فیلترها';
  b.style.cssText='position:fixed;bottom:18px;right:18px;z-index:900;background:#1f5c87;color:white;border:1px solid #5598c4;border-radius:10px;padding:12px 16px;min-height:48px;font-weight:700;cursor:pointer;touch-action:manipulation;box-shadow:0 5px 20px #0008';
  b.onclick=showDiagnostics;document.body.append(b);
}

// =========================================================
// MTF AGGREGATION
// =========================================================
function aggregateMTF(tfMap,coin=null,risk=null){
  const ready=Object.keys(TIMEFRAMES).filter(k=>tfMap[k]?.ready);
  const valid=ready.filter(k=>TIMEFRAMES[k].weight>0&&isTimeframeValid(tfMap[k],k));
  const mandatoryReady=MANDATORY_TFS.every(k=>valid.includes(k));
  const h1Frame=tfMap?.['1h'],h4Frame=tfMap?.['4h'];
  const h1Last=Number(h1Frame?.lastTime)||0,h4Last=Number(h4Frame?.lastTime)||0;
  const f1=Number(h1Frame?.fetchedAt)||0,f4=Number(h4Frame?.fetchedAt)||0;
  const h1Close=h1Last+3600000,h4Close=h4Last+14400000;
  const frameCoherent=!!(h1Last&&h4Last&&h4Close<=h1Close&&h1Close-h4Close<=14400000);
  let trend=0,rev=0,bear=0,quality=0,w=0;
  for(const k of valid){const d=tfMap[k],weight=TIMEFRAMES[k].weight;trend+=d.trendScore*weight;rev+=d.reversalScore*weight;bear+=d.bearishReversalScore*weight;quality+=computeDataQuality(d.candles,k,Number.isFinite(d.analysisAsOf)?d.analysisAsOf:Date.now()).quality*weight;w+=weight;}
  const t=w?Math.round(trend/w):null,r=w?Math.round(rev/w):null,br=w?Math.round(bear/w):null;
  const h4=tfMap['4h'],h1=tfMap['1h'],m1=h1?.metrics,m4=h4?.metrics;
  const regimeOK=!!h4&&valid.includes('4h')&&h4.trendScore>=RULES.trend;
  const blocks=[];
  if(!mandatoryReady)blocks.push('۱ ساعت و ۴ ساعت باید تازه، معتبر و پیوسته باشند');
  if(!frameCoherent)blocks.push('زمان دریافت یا مرز بسته‌شدن تایم‌فریم‌های اصلی هم‌خوان نیست');
  if(!regimeOK)blocks.push('رژیم ۴ساعته برای خرید مناسب نیست');
  // نامزد خام برای رصد زودهنگام؛ این برچسب هرگز دروازه خرید را دور نمی‌زند.
  const earlyCandidate=mandatoryReady&&h4&&h1&&h4.trendScore>=25&&h1.trendScore>=45&&h4.bearishReversalScore<75&&h1.bearishReversalScore<75;
  const earlyChecks=[
    {id:'ema',label:'EMA9 بالاتر از EMA20 نیست',ok:!!m1&&m1.ema9>m1.ema20},
    {id:'rsi',label:'RSI خارج از محدوده ۴۵ تا ۷۰ است',ok:!!m1&&m1.rsi>=45&&m1.rsi<=70},
    {id:'di',label:'جهت DI چهارساعته صعودی نیست',ok:!!m4&&m4.adx>=RULES.adxMin&&m4.plusDI>m4.minusDI},
    {id:'cloud',label:'قیمت زیر کف ابر ایچیموکو است',ok:!!m1&&Number.isFinite(m1.cloudBot)&&m1.lastClose>=m1.cloudBot},
    {id:'volume',label:'حجم ۲۴ساعته کمتر از حداقل است',ok:Number.isFinite(coin?.volume)&&coin.volume>=prefs.minVolume},
    {id:'spread',label:'اسپرد بیشتر از حد مجاز یا نامشخص است',ok:Number.isFinite(risk?.spread)&&risk.spread<=prefs.maxSpread}
  ];
  const earlyQualified=!!earlyCandidate&&earlyChecks.every(x=>x.ok);
  const monitorReasons=earlyCandidate?earlyChecks.filter(x=>!x.ok).map(x=>x.label):[];
  let signal='در انتظار تأیید ورود',signalClass='hold',signalKey='await';
  if(!mandatoryReady){signal='داده اجباری ۱ساعته یا ۴ساعته ناقص/نامعتبر';signalClass='blocked';signalKey='insufficient';}
  else if(!regimeOK){signal='رد موقعیت خرید؛ روند ۴ساعته ضعیف است';signalClass='blocked';signalKey='blocked';}
  else if(h1.trendScore>=RULES.trend){signal='نامزد بررسی ورود در ۱ساعته';signalClass='strong-buy';signalKey='ready';}
  else if(t<=38&&br>=55){signal='رد موقعیت خرید؛ شواهد نزولی';signalClass='sell';signalKey='reject';}
  else if(h1.trendScore<50){signal='روند ۱ساعته برای ورود مناسب نیست';signalClass='sell';signalKey='unconfirmed';}
  else if(r>=60&&t>=50){signal='پولبک/برگشت در حال بررسی؛ تأیید لازم';signalClass='buy';signalKey='reversal';}
  else{signal='روند قابل قبول؛ منتظر ماشه ورود';signalClass='hold';signalKey='await';}
  const allBull=valid.length>=2&&valid.every(k=>tfMap[k].trendScore>=62);
  const allBear=valid.length>=2&&valid.every(k=>tfMap[k].trendScore<=38);
  return{ready:mandatoryReady&&frameCoherent,tfCount:ready.length,validCount:valid.length,decisionValidCount:valid.filter(k=>MANDATORY_TFS.includes(k)).length,optionalReadyCount:ready.filter(k=>!MANDATORY_TFS.includes(k)).length,frameCoherent,trendScore:t,reversalScore:r,bearishReversalScore:br,label:trendLabel(t),quality:w?Math.round(quality/w):0,alignment:allBull?'صعودی همگرا':allBear?'نزولی همگرا':'مختلط',signal,signalClass,signalKey,monitorKey:earlyCandidate?'early':null,monitorTier:earlyCandidate?(earlyQualified?'qualified':'raw'):null,monitorQualified:earlyQualified,monitorReasons,monitorLabel:earlyCandidate?(earlyQualified?'نامزد واجد شرایط پایش اولیه':'نامزد خام پایش اولیه؛ هنوز شروط کیفیت را کامل نکرده') :null,gates:{dataValid:mandatoryReady,mandatoryReady,regimeOK},gateBlocked:blocks.length>0,gateReason:blocks.join('؛ '),source:ready.map(k=>`${k}:N`).join(' '),eligible:false};}



// =========================================================
// RISK ENGINE
// =========================================================
function levelsFor(entry,atr,low5,spreadRate=0){
  const stopLoss=Math.min(entry-atr*1.5,low5-atr*.15);
  if(!(stopLoss>0&&stopLoss<entry))return null;
  const sl=prefs.slippageRate,fee=prefs.feeRate,halfSpread=Math.max(0,Number.isFinite(spreadRate)?spreadRate/2:0);
  const buyCost=entry*(1+sl)*(1+fee),stopProceeds=stopLoss*(1-halfSpread)*(1-sl)*(1-fee),netRisk=buyCost-stopProceeds;
  if(!(netRisk>0))return null;
  return{stopLoss,buyCost,stopProceeds,netRisk,rawRisk:entry-stopLoss,halfSpread};
}
function clusterStructuralLevels(levels,entry,side){
  if(!levels.length)return null;
  const sorted=levels.slice().sort((a,b)=>a.price-b.price),clusters=[];
  for(const level of sorted){
    const tolerance=Math.max(entry*.004,(level.atr||0)*.35);
    let cluster=clusters.find(c=>Math.abs(c.weightedPrice/c.weight-level.price)<=Math.max(tolerance,c.tolerance));
    if(!cluster){cluster={items:[],weight:0,weightedPrice:0,tolerance};clusters.push(cluster);}
    const tfWeight=level.tf==='1d'?1.6:1;
    cluster.items.push(level);cluster.weight+=tfWeight;cluster.weightedPrice+=level.price*tfWeight;
    cluster.tolerance=Math.max(cluster.tolerance,tolerance);
  }
  const scored=clusters.map(c=>{
    const price=c.weightedPrice/c.weight,tfSet=[...new Set(c.items.map(x=>x.tf.replace('-range','')))];
    const recency=Math.max(...c.items.map(x=>x.at||0));
    const strength=c.items.length+(tfSet.length>1?2:0)+(c.items.some(x=>x.tf==='1d')?1:0);
    return{price,tf:tfSet.join('+'),at:recency,atr:Math.max(...c.items.map(x=>x.atr||0)),touches:c.items.length,timeframes:tfSet,strength,confluence:tfSet.length>1};
  });
  // Nearest overhead supply / nearest underlying demand remains the conservative selection.
  return side==='support'?scored.filter(x=>x.price<entry).sort((a,b)=>b.price-a.price||b.strength-a.strength)[0]||null:
    scored.filter(x=>x.price>entry).sort((a,b)=>a.price-b.price||b.strength-a.strength)[0]||null;
}
function findStructuralLevels(tfMap,entry){
  const supports=[],resistances=[];
  for(const tfKey of ['4h','1d']){
    const d=tfMap?.[tfKey];if(!d?.ready||!isTimeframeValid(d,tfKey)||!Array.isArray(d.candles)||d.candles.length<10)continue;
    const candles=d.candles.slice(-(tfKey==='1d'?120:160));
    const pivots=pivotIndices(candles,2,2),atr=Number.isFinite(d.metrics?.atr)?d.metrics.atr:0;
    for(const i of pivots.lows){const p=candles[i].l;if(Number.isFinite(p)&&p>0&&p<entry)supports.push({price:p,tf:tfKey,at:candles[i].t,atr});}
    for(const i of pivots.highs){const p=candles[i].h;if(Number.isFinite(p)&&p>entry)resistances.push({price:p,tf:tfKey,at:candles[i].t,atr});}
    // Range fallback is used only if that timeframe has no confirmed pivot on the relevant side.
    if(!pivots.lows.some(i=>candles[i].l<entry)){const p=Math.min(...candles.slice(-40).map(c=>c.l));if(Number.isFinite(p)&&p>0&&p<entry)supports.push({price:p,tf:tfKey+'-range',at:candles.at(-1).t,atr});}
    if(!pivots.highs.some(i=>candles[i].h>entry)){const p=Math.max(...candles.slice(-40).map(c=>c.h));if(Number.isFinite(p)&&p>entry)resistances.push({price:p,tf:tfKey+'-range',at:candles.at(-1).t,atr});}
  }
  return{support:clusterStructuralLevels(supports,entry,'support'),resistance:clusterStructuralLevels(resistances,entry,'resistance')};
}
function riskCalculationUnavailableReason(coin,analysis){
  const tf=analysis?.tfMap?.['1h'];
  if(!tf)return 'تایم‌فریم ۱ساعته هنوز دریافت نشده است؛ محاسبه ریسک تا دریافت داده پایه انجام نمی‌شود.';
  if(!isTimeframeValid(tf,'1h')){
    const dq=computeDataQuality(tf.candles||[],'1h',Number.isFinite(tf.analysisAsOf)?tf.analysisAsOf:Date.now());
    return 'داده ۱ساعته معیار اعتبار را نگذرانده است: '+dataQualityMessage(dq);
  }
  const entry=Number(coin?.bestAsk),bid=Number(coin?.bestBid);
  const atr=tf.metrics?.atr;
  if(!(entry>0&&bid>0&&entry>=bid))return 'مظنه معتبر Ask/Bid برای محاسبه قیمت ورود و اسپرد در دسترس نیست.';
  if(!(Number.isFinite(atr)&&atr>0))return 'داده ۱ساعته معتبر است، اما ATR مثبت و معتبر برای تعیین حد ضرر محاسبه نشده است.';
  const candles=tf.candles||[];
  const low5=candles.length?Math.min(...candles.slice(-5).map(c=>c.l)):NaN;
  const spread=(entry-bid)/((entry+bid)/2);
  if(!Number.isFinite(low5)||!levelsFor(entry,atr,low5,spread))return 'داده ۱ساعته معتبر است، اما حد ضرر قابل استفاده از ترکیب ATR، کف پنج کندل اخیر و هزینه خروج به دست نیامده است.';
  return 'داده ۱ساعته معتبر است؛ با این حال یکی از ورودی‌های محاسبه اندازه موقعیت یا ریسک در دسترس نیست.';
}
function computeRisk(coin,analysis,stopTf='1h'){
  const tfKey=stopTf==='4h'?'4h':'1h',tf=analysis?.tfMap?.[tfKey];
  if(!tf?.ready||!isTimeframeValid(tf,tfKey)||!tf.candles?.length)return null;
  const candles=tf.candles,atr=tf.metrics?.atr;
  const entry=Number(coin?.bestAsk),bid=Number(coin?.bestBid);
  if(!(entry>0&&bid>0&&entry>=bid&&atr>0&&Number.isFinite(atr)))return null;
  const spread=(entry-bid)/((entry+bid)/2);
  const low5=Math.min(...candles.slice(-5).map(c=>c.l));
  const lv=levelsFor(entry,atr,low5,spread);if(!lv)return null;
  const {stopLoss,buyCost,netRisk,rawRisk}=lv;
  const structural=findStructuralLevels(analysis.tfMap,entry);
  const resistance=structural.resistance,support=structural.support;
  let takeProfit=null,netReward=null,rrNet=null,rrGross=null,rrUnavailableReason=null;
  if(!resistance)rrUnavailableReason='مقاومت ساختاری معتبر بالای قیمت ورود پیدا نشد؛ هدف سود قابل اتکا وجود ندارد.';
  else if(!(resistance.price>entry))rrUnavailableReason='مقاومت ساختاری بالاسر در قیمت فعلی وجود ندارد؛ فضای سود قابل محاسبه نیست.';
  else{
    const buffer=Math.max((resistance.atr||0)*.15,resistance.price*.0015),candidate=resistance.price-buffer;
    if(!(candidate>entry))rrUnavailableReason='پس از کسر حاشیه احتیاط از مقاومت، هدف سود بالاتر از قیمت ورود قرار نمی‌گیرد.';
    else{takeProfit=candidate;const targetProceeds=takeProfit*(1-lv.halfSpread)*(1-prefs.slippageRate)*(1-prefs.feeRate);netReward=targetProceeds-buyCost;if(netReward>0){rrNet=netReward/netRisk;rrGross=(takeProfit-entry)/rawRisk;}else rrUnavailableReason='پس از کسر اسپرد خروج، کارمزد و لغزش، بازده خالص تا هدف مثبت نیست.';}
  }
  const ceiling=resistance?.price??null,resistanceRoomPct=Number.isFinite(ceiling)?(ceiling-entry)/entry*100:null;
  const riskBudget=prefs.capital*prefs.riskPct,positionSize=Math.max(0,Math.min(riskBudget/netRisk,prefs.capital/buyCost));
  const structLow=support?.price??Math.min(...candles.slice(-20).map(c=>c.l));
  const structCandles=(analysis.tfMap?.['4h']?.candles?.length?analysis.tfMap['4h'].candles:candles).slice(-40);
  const structHigh=ceiling??Math.max(...structCandles.map(c=>c.h));
  return{entry,stopLoss,takeProfit,atr,structLow,structHigh,support:support?.price??null,supportSource:support?.tf??null,supportTouches:support?.touches??0,supportStrength:support?.strength??0,supportConfluence:support?.confluence??false,ceiling,resistanceRoomPct,rrUnavailableReason,resistanceSource:resistance?.tf??null,resistanceTouches:resistance?.touches??0,resistanceStrength:resistance?.strength??0,resistanceConfluence:resistance?.confluence??false,structuralTarget:takeProfit,structuralRRNet:rrNet,entryCost:buyCost-entry,netRisk,netReward,rrNet,rrGross,spread,positionSize,capital:prefs.capital,riskPct:prefs.riskPct,feeRate:prefs.feeRate,slippageRate:prefs.slippageRate,notional:positionSize*buyCost,riskAmount:positionSize*netRisk,tfKey};
}

// =========================================================
// COIN ANALYSIS — موازی
// =========================================================
function monitorCandidateScore(record){
  const m=record?.mtf, h1=record?.tfMap?.['1h']?.trendScore, h4=record?.tfMap?.['4h']?.trendScore;
  if((m?.monitorKey!=='early'&&m?.eligible!==true)||!Number.isFinite(h1)||!Number.isFinite(h4))return -Infinity;
  return Math.round(h1*.45+h4*.55);
}
function updateMonitorPulse(coin,op){
  const a=op?.analysis||analysisCache.get(coin.id),risk=a?.risk,mtf=a?.mtf;
  const price=coin.bestAsk>0?coin.bestAsk:coin.price;
  const support=Number.isFinite(risk?.support)?risk.support:null,resistance=Number.isFinite(risk?.ceiling)?risk.ceiling:null;
  const snap={at:Date.now(),price:Number.isFinite(price)?price:null,spread:Number.isFinite(risk?.spread)?risk.spread:null,
    volume:Number.isFinite(coin.volume)?coin.volume:null,support,resistance,
    supportDistancePct:Number.isFinite(price)&&price>0&&Number.isFinite(support)?(price-support)/price*100:null,
    resistanceRoomPct:Number.isFinite(price)&&price>0&&Number.isFinite(resistance)?(resistance-price)/price*100:null,
    trend1h:a?.tfMap?.['1h']?.trendScore??null,trend4h:a?.tfMap?.['4h']?.trendScore??null,blockers:(op?.reasons||[]).join('|')};
  const prev=monitorPulseMap.get(coin.id),changes=[];
  if(prev){
    const pct=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&y!==0?Math.abs(x-y)/Math.abs(y):0;
    if(pct(snap.price,prev.snap.price)>=.002)changes.push(`قیمت ${snap.price>prev.snap.price?'افزایش':'کاهش'} ${((snap.price/prev.snap.price-1)*100).toFixed(2)}٪`);
    if(Number.isFinite(snap.spread)&&Number.isFinite(prev.snap.spread)&&Math.abs(snap.spread-prev.snap.spread)>=.00025)changes.push(`اسپرد به ${(snap.spread*100).toFixed(3)}٪ رسید`);
    if(Number.isFinite(snap.volume)&&Number.isFinite(prev.snap.volume)&&pct(snap.volume,prev.snap.volume)>=.03)changes.push('حجم ۲۴ساعته به‌روزرسانی شد');
    if(snap.trend1h!==prev.snap.trend1h||snap.trend4h!==prev.snap.trend4h)changes.push(`امتیاز روند تغییر کرد: ۴H ${snap.trend4h??'—'} / ۱H ${snap.trend1h??'—'}`);
    if(Number.isFinite(snap.supportDistancePct)&&Number.isFinite(prev.snap.supportDistancePct)&&Math.abs(snap.supportDistancePct-prev.snap.supportDistancePct)>=.2)changes.push(`فاصله تا حمایت ${snap.supportDistancePct.toFixed(2)}٪ شد`);
    if(Number.isFinite(snap.resistanceRoomPct)&&Number.isFinite(prev.snap.resistanceRoomPct)&&Math.abs(snap.resistanceRoomPct-prev.snap.resistanceRoomPct)>=.2)changes.push(`فضای تا مقاومت ${snap.resistanceRoomPct.toFixed(2)}٪ شد`);
    if(snap.blockers!==prev.snap.blockers)changes.push('فهرست شروط و موانع تغییر کرد');
  }
  const history=[...(prev?.changes||[]),...changes.map(label=>({at:snap.at,label}))].slice(-4);
  const value={snap,changes:history,lastChangeAt:changes.length?snap.at:(prev?.lastChangeAt||null)};
  monitorPulseMap.set(coin.id,value);
  return value;
}
function triggerProbeCooldownActive(){const at=num(LS('nb5:triggerProbeAt'),0);return Date.now()-at<TRIGGER_PROBE_COOLDOWN_MS;}
async function probeCandidateTimeframes(coin){
  if(triggerProbeBusy||!coin||!marketHealthy||(document.hidden&&!mayRunWhenHidden())||analysisPaused||triggerProbeCooldownActive())return null;
  const current=analysisCache.get(coin.id);if(!current||current.mtf?.monitorKey!=='early')return null;
  const task=(async()=>{
    triggerProbeBusy=true;
    const startedAt=Date.now();
    LS('nb5:triggerProbeAt',String(startedAt));
    try{
      let tfMap={...(current.tfMap||{})},results={};
      for(const key of ['15m','5m']){
        if(tfMap[key]&&!frameDue(coin,key)){results[key]=tfMap[key];continue;}
        const res=await fetchTimeframe(coin,key,5,false);
        const item=res.ready?analyzeTimeframe(res.candles,key,res.source):{ready:false,tf:key,trendScore:null,reversalScore:null,bearishReversalScore:null,dataQuality:res.quality?.quality??0,labels:[],candles:res.candles||[],candlesCount:(res.candles||[]).length};
        Object.assign(item,{source:res.source,pair:res.pair,stale:res.stale,networkError:res.networkError,error:res.error,validation:res.validation,fetchedAt:res.fetchedAt,dataQualityDetail:item.dataQualityDetail||res.quality||null});
        tfMap[key]=item;results[key]=item;
      }
      const q15=timeframeQualitySnapshot(tfMap,'15m',true),q5=timeframeQualitySnapshot(tfMap,'5m',true);
      const probeStatus=q15.valid&&q5.valid?'valid':([q15,q5].some(q=>q.status==='network_error'||q.status==='stale')?'fetch_error':'quality_rejected');
      const updated=finalizeRecord(coin,{...current,tfMap,updatedAt:Date.now(),triggerProbe:{sampled:true,at:Date.now(),status:probeStatus,source:'diagnostic-only'}});
      analysisCache.set(coin.id,updated);recordDiagnosticSnapshot(coin,updated);
      eventLog(`${coin.symbol}: نمونه‌برداری تشخیصی ۱۵m/۵m انجام شد (${probeStatus})؛ این آزمون مجوز ورود نیست.`,'info');
      scheduleRender();
      return {status:probeStatus,q15,q5};
    }catch(e){
      const fallback=analysisCache.get(coin.id)||current;
      fallback.triggerProbe={sampled:true,at:Date.now(),status:'fetch_error',error:String(e.message||e),source:'diagnostic-only'};
      analysisCache.set(coin.id,fallback);recordDiagnosticSnapshot(coin,fallback);
      eventLog(`${coin.symbol}: نمونه‌برداری تشخیصی ۱۵m/۵m ناموفق بود؛ ${e.message}`,'info');
      return {status:'fetch_error',error:e.message};
    }finally{triggerProbeBusy=false;}
  })();
  return task;
}
async function ensureMonitorDailyFrame(coin){
  if(dailyMonitorBusy||!coin||!marketHealthy||(document.hidden&&!mayRunWhenHidden())||analysisPaused)return null;
  const current=analysisCache.get(coin.id);if(!current||current.mtf?.monitorKey!=='early'&&current.mtf?.eligible!==true)return null;
  if(!frameDue(coin,'1d'))return null;
  dailyMonitorBusy=true;
  try{
    const res=await fetchTimeframe(coin,'1d',1,false);
    const item=res.ready?analyzeTimeframe(res.candles,'1d',res.source):{ready:false,tf:'1d',trendScore:null,reversalScore:null,bearishReversalScore:null,dataQuality:res.quality?.quality??0,labels:[],candles:res.candles||[],candlesCount:(res.candles||[]).length};
    Object.assign(item,{source:res.source,pair:res.pair,stale:res.stale,networkError:res.networkError,error:res.error,validation:res.validation,fetchedAt:res.fetchedAt,dataQualityDetail:item.dataQualityDetail||res.quality||null});
    const updated=finalizeRecord(coin,{...current,tfMap:{...(current.tfMap||{}),'1d':item},updatedAt:Date.now()});
    analysisCache.set(coin.id,updated);recordDiagnosticSnapshot(coin,updated);scheduleRender();
    return updated;
  }catch(e){eventLog(`${coin.symbol}: دریافت اختیاری ۱D ناموفق بود؛ ${e.message}`,'info');return null;}
  finally{dailyMonitorBusy=false;}
}
async function analyzeCoin(coin,force=false,full=false,scanPriority=0){if(analysisInflight.has(coin.id))return analysisInflight.get(coin.id);const job=(async()=>{const previous=analysisCache.get(coin.id),tfMap={...(previous?.tfMap||{})};const keys=full?['15m','1h','4h','5m','1d']:MANDATORY_TFS;for(const key of keys){if(!force&&tfMap[key]&&!frameDue(coin,key))continue;const res=await fetchTimeframe(coin,key,full?3:scanPriority,force);let a;if(res.ready){a=analyzeTimeframe(res.candles,key,res.source)}else a={ready:false,tf:key,trendScore:null,reversalScore:null,bearishReversalScore:null,dataQuality:res.quality.quality,labels:[],candles:res.candles,candlesCount:res.candles.length};Object.assign(a,{source:res.source,pair:res.pair,stale:res.stale,networkError:res.networkError,error:res.error,validation:res.validation,fetchedAt:res.fetchedAt,dataQualityDetail:a.dataQualityDetail||res.quality||null});tfMap[key]=a;const partial={...(previous||{}),tfMap:{...tfMap},updatedAt:Date.now()};finalizeRecord(coin,partial);analysisCache.set(coin.id,partial);scheduleRender();}const record=finalizeRecord(coin,{...(previous||{}),tfMap,updatedAt:Date.now()});analysisCache.set(coin.id,record);recordDiagnosticSnapshot(coin,record);if(record.mtf.eligible&&!analysisPaused&&!document.hidden&&!backgroundMonitorEnabled)await emitSignal(coin,record);return record;})();analysisInflight.set(coin.id,job);try{return await job}finally{analysisInflight.delete(coin.id)}}

// Three priority tiers (50/50/50). Each symbol is attempted once per round;
// failures remain eligible in the next round. All symbols retain mandatory 1h/4h analysis.
let scanTier=0,scanOrder=allCoins.slice(),scanAttempted=new Set(),scanCompletedAt=[];
// Per-symbol outcomes prevent one malformed/erroring market from monopolising the scan loop.
const scanProgress=new Map(),scanRetryAt=new Map(),scanFailureCount=new Map();
const SCAN_TIER_SIZE=50;
function scannedSymbolCount(){return allCoins.reduce((n,c)=>n+(scanProgress.has(c.id)||analysisCache.has(c.id)?1:0),0)}
function scanEtaLabel(remaining,rate){if(remaining<=0)return 'تکمیل شد';if(!(rate>0))return 'در حال برآورد';const seconds=Math.ceil(remaining/rate*60);if(seconds<60)return `${seconds} ثانیه`;const minutes=Math.ceil(seconds/60);return `${minutes} دقیقه`}

function pickNextStaleCoin(){
  const n=scanOrder.length;if(!n)return null;
  for(let pass=0;pass<3;pass++){
    const tier=(scanTier+pass)%3,start=tier*SCAN_TIER_SIZE,end=Math.min(n,start+SCAN_TIER_SIZE);
    for(let i=start;i<end;i++){
      const c=scanOrder[i];
      if(!scanAttempted.has(c.id)&&!analysisInflight.has(c.id)&&(scanRetryAt.get(c.id)||0)<=Date.now()&&MANDATORY_TFS.some(k=>frameDue(c,k))){
        if(diagnosticRunPending){beginDiagnosticRun();diagnosticRunPending=false;}
        else if(!diagnosticRunInitialized){beginDiagnosticRun();diagnosticRunInitialized=true;}
        scanTier=tier;scanAttempted.add(c.id);c.__scanTier=tier;return c;
      }
    }
  }
  const retryWaiting=scanOrder.some(c=>!scanAttempted.has(c.id)&&(scanRetryAt.get(c.id)||0)>Date.now()&&MANDATORY_TFS.some(k=>frameDue(c,k)));
  if(scanAttempted.size&&!retryWaiting){scanAttempted.clear();scanTier=0;diagnosticRunPending=true;}
  return null;
}
async function analysisLoop(){if(analysisLoopRunning)return;analysisLoopRunning=true;try{while(analysisLoopShouldRun){if(analysisPaused||(document.hidden&&!mayRunWhenHidden())){await sleep(1000);continue}if(Date.now()<netCooldown){updateAnalysisStatus();await sleep(1000);continue}const coin=pickNextStaleCoin();if(!coin){updateAnalysisStatus();await sleep(2500);continue}const tier=Number.isInteger(coin.__scanTier)?coin.__scanTier:0;try{const result=await analyzeCoin(coin,false,false,30-tier*10);const oneReady=!!result?.tfMap?.['1h']?.ready,fourReady=!!result?.tfMap?.['4h']?.ready;const outcome=oneReady&&fourReady?'ok':(oneReady||fourReady?'partial':'error');const reason=Object.values(result?.tfMap||{}).map(x=>x?.error||x?.networkError).filter(Boolean).join('؛ ');scanProgress.set(coin.id,{status:outcome,at:Date.now(),reason:reason.slice(0,300)});scanRetryAt.delete(coin.id);scanFailureCount.delete(coin.id);scanCompletedAt.push(Date.now());scanCompletedAt=scanCompletedAt.filter(t=>Date.now()-t<60000);const op=publishOpportunity(coin,result);if(op.baseReady&&opportunityInflight.size<MAX_BACKGROUND_TRIGGER_JOBS)ensureOpportunityFrames(coin).catch(e=>eventLog(coin.symbol+': '+e.message,'info'));updateAnalysisStatus();scheduleRender();if(modalCurrentCoin?.id===coin.id)refreshOpenModal()}catch(e){const failures=(scanFailureCount.get(coin.id)||0)+1;scanFailureCount.set(coin.id,failures);const delay=Math.min(180000,15000*Math.pow(2,Math.min(4,failures-1)));scanRetryAt.set(coin.id,Date.now()+delay);scanProgress.set(coin.id,{status:'error',at:Date.now(),reason:String(e?.message||e).slice(0,300),retryAt:Date.now()+delay});scanCompletedAt.push(Date.now());scanCompletedAt=scanCompletedAt.filter(t=>Date.now()-t<60000);eventLog(`${coin.symbol}: خطای تحلیل؛ نماد از صف کنار گذاشته شد و پس از ${Math.ceil(delay/1000)} ثانیه دوباره بررسی می‌شود: ${e.message}`);updateAnalysisStatus();scheduleRender()}await sleep(50)}}finally{analysisLoopRunning=false;if(analysisLoopShouldRun&&(!document.hidden||mayRunWhenHidden()))setTimeout(()=>{if(analysisLoopShouldRun&&!analysisLoopRunning)analysisLoop()},1200)}}

// =========================================================
// RENDER
// =========================================================
function scheduleRender(){
  if(renderScheduled) return;
  renderScheduled=true;
  setTimeout(()=>{ renderScheduled=false; if(allCoins.length) renderTable(allCoins); }, RENDER_THROTTLE_MS);
}

function updateAnalysisStatus(){const n=allCoins.length;let fresh=0,full=0,valid=0,noData=0,errors=0;for(const c of allCoins){const a=analysisCache.get(c.id);if(!a){noData++;continue}finalizeRecord(c,a);if(a.mtf.gates.dataValid)fresh++;if(a.mtf.validCount===2)full++;if(a.mtf.validCount>=1)valid++;if(Object.values(a.tfMap).some(t=>t.networkError||(!t.ready&&t.error)))errors++;}const processed=scannedSymbolCount(),failed=[...scanProgress.values()].filter(x=>x.status==='error').length,partial=[...scanProgress.values()].filter(x=>x.status==='partial').length;analysisBadge.textContent=`بررسی: ${processed}/${n}`;const tierLabel=['اولویت ۱ (۱ تا ۵۰)','اولویت ۲ (۵۱ تا ۱۰۰)','اولویت ۳ (۱۰۱ تا ۱۵۰)'][scanTier]||'پایش';const scanRate=scanCompletedAt.filter(t=>Date.now()-t<60000).length;const scanPct=n?Math.min(100,Math.round(processed/n*100)):0;const eta=scanEtaLabel(Math.max(0,n-processed),scanRate);analysisStatus.innerHTML=`<span>موتور Swing چندتایم‌فریمی ۴ساعته/۱ساعته</span><span>بررسی‌شده: <b>${processed}</b>/${n}</span><span>داده اجباری معتبر: <b>${fresh}</b>/${n}</span><span>دو تایم‌فریم اصلی معتبر: <b>${full}</b></span><span>حداقل یک تایم‌فریم معتبر: <b>${valid}</b></span><span>بدون رکورد تحلیل: <b>${noData}</b></span><span>نمادهای دارای خطای تحلیل: <b>${failed}</b></span><span>تحلیل ناقص/داده ناکافی: <b>${partial}</b></span><span>خطاهای داده‌ای: <b>${errors}</b></span><span>مرحله اسکن: <b>${tierLabel}</b></span><span>پیشرفت بررسی: <b>${scanPct}٪</b></span><span>سرعت ۶۰ ثانیه: <b>${scanRate}</b> نماد</span><span>زمان تخمینی باقی‌مانده: <b>${eta}</b></span><span>صف درخواست: <b>${networkQueue.length}</b> | وقفه API: <b>${netCooldown>Date.now()?Math.ceil((netCooldown-Date.now())/1000)+' ثانیه':'ندارد'}</b></span><span>اسکن ${analysisPaused?'متوقف':(document.hidden&&!mayRunWhenHidden())?'در تب پنهان مکث':backgroundMonitorEnabled?'پایش پس‌زمینه فعال':'تدریجی'}</span>`;if(lastAnalysisError){errorBar.textContent='آخرین خطا: '+lastAnalysisError;errorBar.title=lastAnalysisError;errorBar.classList.add('show')}else errorBar.classList.remove('show');renderDiag();}

function sortCoins(enriched){
  const {key,dir}=sortState, mul=dir==='asc'?1:-1;
  return enriched.slice().sort((A,B)=>{
    let va,vb;
    switch(key){
      case 'rank': va=A.coin.rank; vb=B.coin.rank; break;
      case 'symbol': va=A.coin.symbol; vb=B.coin.symbol; return va.localeCompare(vb)*mul;
      case 'price': va=A.coin.price; vb=B.coin.price; break;
      case 'change24h': va=A.coin.change24h; vb=B.coin.change24h; break;
      case 'qualityScore': va=A.analysis?.mtf?.quality??-Infinity; vb=B.analysis?.mtf?.quality??-Infinity; break;
      case 'updatedAt': va=A.analysis?.updatedAt??0; vb=B.analysis?.updatedAt??0; break;
      default: va=A.coin.rank; vb=B.coin.rank;
    }
    if(va<vb)return -1*mul; if(va>vb)return 1*mul; return 0;
  });
}

const WATCH_KEY='nb4:watchlist:v1';
function loadWatchlist(){try{const x=JSON.parse(LS(WATCH_KEY)||'[]');return Array.isArray(x)?x:[]}catch(error){eventLog('خواندن واچ‌لیست ناموفق بود: '+String(error?.message||error).slice(0,120),'info');return []}}
let watchlist=loadWatchlist();
function saveWatchlist(){LS(WATCH_KEY,JSON.stringify(watchlist));renderWatchlist()}
function addAwaitCandidates(items){let added=0;for(const {coin,analysis} of items){if(analysis?.mtf?.signalKey!=='await')continue;const old=watchlist.find(x=>x.symbol===coin.nobitexSymbol);if(old){old.lastSeen=Date.now();continue;}watchlist.push({symbol:coin.nobitexSymbol,base:coin.symbol,name:coin.name,addedAt:Date.now(),lastSeen:Date.now()});added++;}saveWatchlist();eventLog(`${added} ارز به واچ‌لیست اضافه شد`,'info')}
function addEarlyMonitorCandidates(qualifiedOnly){const expected=qualifiedOnly?'earlyQualified':'early';if(signalFilter.value!==expected){uiAlert(`ابتدا فیلتر سیگنال را روی «${qualifiedOnly?'نامزد واجد شرایط پایش':'نامزد خام پایش اولیه'}» قرار دهید.`);return;}const q=(searchInput.value||'').trim().toLowerCase(),trend=trendFilter.value;const candidates=allCoins.map(coin=>({coin,analysis:finalizeRecord(coin,analysisCache.get(coin.id)||null)})).filter(x=>{const m=x.analysis?.mtf;if(m?.monitorKey!=='early'||(qualifiedOnly&&!m.monitorQualified)||(!qualifiedOnly&&m.monitorQualified)||(hideStable.checked&&STABLES.has(String(x.coin.symbol).toUpperCase()))||(q&&!x.coin.symbol.toLowerCase().includes(q)&&!(x.coin.name||'').toLowerCase().includes(q))||(num(minScoreInput.value,0)>0&&(m.quality??0)<num(minScoreInput.value,0))||(num(minRRInput.value,0)>0&&(x.analysis?.risk?.rrNet??0)<num(minRRInput.value,0)))return false;const target={strong_bull:'صعودی قوی',bull:'صعودی',neutral:'خنثی',bear:'نزولی',strong_bear:'نزولی قوی'}[trend];return trend==='all'||(m.label?.label||'نامشخص')===target});if(!candidates.length){uiAlert('با فیلترهای فعلی، نامزدی در این سطح پایش یافت نشد.');return;}let added=0;for(const {coin} of candidates){const old=watchlist.find(x=>x.symbol===coin.nobitexSymbol);if(old){old.lastSeen=Date.now();old.monitorTier=qualifiedOnly?'qualified':'raw';continue;}watchlist.push({symbol:coin.nobitexSymbol,base:coin.symbol,name:coin.name,addedAt:Date.now(),lastSeen:Date.now(),source:qualifiedOnly?'early-qualified':'early-raw',monitorTier:qualifiedOnly?'qualified':'raw'});added++;}saveWatchlist();eventLog(`${added} ${qualifiedOnly?'نامزد واجد شرایط':'نامزد خام'} به واچ‌لیست اضافه شد`,'info')}
let lastRenderedFiltered=[];
function addCoinToWatchlist(coin,source='manual'){
  if(!coin?.nobitexSymbol)return false;
  const symbol=String(coin.nobitexSymbol).toUpperCase();if(!/^[A-Z0-9]{1,24}USDT$/.test(symbol))return false;
  const old=watchlist.find(x=>x.symbol===symbol);
  if(old){old.lastSeen=Date.now();old.source=old.source||source;}else watchlist.push({symbol,base:coin.symbol||symbol.replace(/USDT$/,''),name:coin.name||coin.symbol||symbol,addedAt:Date.now(),lastSeen:Date.now(),source,snapshotId:analysisCache.get(coin.id)?.snapshotId||null});
  saveWatchlist();return true;
}
function addManualWatchSymbol(raw){
  const key=String(raw||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(!key)return uiAlert('نماد را وارد کنید.');
  const symbol=key.endsWith('USDT')?key:key+'USDT';
  if(!/^[A-Z0-9]{1,24}USDT$/.test(symbol))return uiAlert('نماد واردشده معتبر نیست. فقط بازارهای تتری فعال پشتیبانی می‌شوند.');
  let coin=coinBySym.get(symbol)||allCoins.find(c=>c.nobitexSymbol===symbol||c.symbol===symbol.replace(/USDT$/,''));
  if(!coin){const stat=latestMarketStats.get(symbol.replace(/USDT$/,''));if(stat&&!stat.isClosed&&stat.lastPrice>0&&stat.volumeQuote>0){coin=coinFromMarketStat(stat,allCoins.length+1);setUniverse([...allCoins,coin]);renderTable(allCoins);countBadge.textContent=`${allCoins.length} بازار تتری؛ شامل واچ‌لیست دستی`;startAnalysis();}}
  if(!coin)return uiAlert('این نماد در آمار آخرین دریافت نوبیتکس وجود ندارد یا بازار آن غیرفعال/فاقد قیمت و حجم معتبر است. ابتدا بازار را تازه‌سازی کنید.');
  addCoinToWatchlist(coin,'manual');const input=$('watchManualSymbol');if(input)input.value='';uiToast(`${coin.symbol} به واچ‌لیست اضافه شد و به صف تحلیل افزوده شد.`);
}
function addFilteredResultsToWatchlist(){
  if(!lastRenderedFiltered.length)return uiAlert('در حال حاضر نتیجه‌ای از فیلترهای جاری برای افزودن وجود ندارد.');
  let added=0;for(const item of lastRenderedFiltered){const before=watchlist.some(x=>x.symbol===item.coin.nobitexSymbol);addCoinToWatchlist(item.coin,'filtered-result');if(!before)added++;}
  uiToast(`${added} نماد از نتایج فیلتر به واچ‌لیست اضافه شد.`);
}
function renderWatchlist(){const body=$('watchlistBody'),count=$('watchlistCount');if(!body||!count)return;count.textContent=`${watchlist.length} ارز`;if(!watchlist.length){body.innerHTML='<tr><td colspan="10">واچ‌لیست خالی است.</td></tr>';return;}body.innerHTML=watchlist.map(w=>{const coin=allCoins.find(c=>c.nobitexSymbol===w.symbol),a=coin&&analysisCache.get(coin.id),m=a?.mtf,r=a?.risk;const status=!coin?'در انتظار':!m?'در انتظار':m.eligible?'آماده':(['blocked','riskblocked','reject','insufficient'].includes(m.signalKey)?'ردشده':'در انتظار');const tone=m?.eligible?'var(--green)':(m?.signalKey==='await'||m?.monitorKey==='early')?'var(--yellow)':'var(--text2)';const stamp=w.lastSeen?new Date(w.lastSeen).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}):'—';const snap=a?.snapshotId||w.snapshotId||'—';return `<tr><td data-label="ارز"><b>${escapeHTML(w.base||w.symbol)}</b></td><td data-label="Snapshot" title="${escapeHTML(snap)}" style="font-family:monospace;font-size:.62rem;direction:ltr">${escapeHTML(String(snap).slice(0,10))}</td><td data-label="وضعیت فعلی" style="color:${tone}">${escapeHTML(status)}</td><td data-label="روند / کیفیت">${m?`${m.trendScore??'—'} / ${m.quality??'—'}%`:'—'}</td><td data-label="ورود">${r?formatPrice(r.entry):'—'}</td><td data-label="هدف" style="color:var(--green)">${r?formatPrice(r.takeProfit):'—'}</td><td data-label="حد ضرر" style="color:var(--red2)">${r?formatPrice(r.stopLoss):'—'}</td><td data-label="R/R خالص">${Number.isFinite(r?.rrNet)?r.rrNet.toFixed(2):'—'}</td><td data-label="آخرین بررسی">${stamp}</td><td data-label="عملیات"><button type="button" class="refresh-btn" data-watch-remove="${escapeHTML(w.symbol)}">حذف</button>${coin?' <button type="button" class="refresh-btn" data-watch-open="'+escapeHTML(coin.id)+'">جزئیات</button>':''}</td></tr>`}).join('')}
function exportWatchlist(){const rows=[['Symbol','SnapshotID','Status','TrendScore','Quality','Entry','Target','StopLoss','NetRR','Updated']];for(const w of watchlist){const c=allCoins.find(x=>x.nobitexSymbol===w.symbol),a=c&&analysisCache.get(c.id),m=a?.mtf,r=a?.risk;rows.push([w.symbol,a?.snapshotId||w.snapshotId||'',m?.signal||'not analyzed',m?.trendScore??'',m?.quality??'',r?.entry??'',r?.takeProfit??'',r?.stopLoss??'',r?.rrNet??'',new Date(w.lastSeen||w.addedAt).toISOString()]);}const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='nobitex-watchlist.csv';a.click();URL.revokeObjectURL(url)}

// =========================================================
// INDEPENDENT ENTRY OPPORTUNITY ENGINE (v7.6.0)
// Scans the complete market universe, independent of UI filters/watchlist.
// 1H/4H define regime; 15m confirms context; a closed 5m candle activates trigger.
// =========================================================
function closedFrame(frame,key){
  return !!frame&&frame.ready&&isTimeframeValid(frame,key)&&Array.isArray(frame.candles)&&frame.candles.length>=30;
}
function computeEntryOpportunity(coin,record){
  if(!coin||!record?.tfMap)return {state:'pending',coin,reason:['داده تحلیلی هنوز دریافت نشده است'],updatedAt:Date.now()};
  const a=finalizeRecord(coin,record),dec=computeDecision(coin,a),risk=a.risk,mtf=a.mtf;
  const baseMissing=[...dec.rows,...dec.risks].filter(x=>x.ok!==true).map(x=>`${x.name}: ${x.ok===null?'این شاخص در این نوبت دریافت یا محاسبه نشده است':`مقدار/وضعیت فعلی ${x.val}؛ شرط لازم ${x.need}`}`);
  if(mtf?.blockReasons?.length)baseMissing.push(...mtf.blockReasons);
  if(!marketHealthy)baseMissing.push('داده تازه بازار تأیید نشده است');
  if(coin.marketClosed)baseMissing.push('بازار نماد در وضعیت بسته است');
  if(Date.now()-(coin.quoteAt||0)>90000)baseMissing.push('قیمت خرید/فروش بیش از ۹۰ ثانیه قدیمی است');
  const baseReady=dec.cls==='good'&&baseMissing.length===0&&!!risk&&risk.entry>0&&risk.stopLoss>0&&risk.takeProfit>risk.entry&&Number.isFinite(risk.rrNet)&&risk.rrNet>=prefs.minRR;
  if(!baseReady){
    const relevant=baseMissing.length?baseMissing:[dec.why||'شروط پایه هنوز کامل نیستند'];
    const state=dec.cls==='hot'||(dec.cls==='no'&&baseMissing.length>0)?'blocked':'wait';
    return {state,baseReady:false,coin,analysis:a,decision:dec,reasons:[...new Set(relevant)],updatedAt:Date.now(),priority:mtf?.trendScore||0};
  }
  const f15=a.tfMap['15m'],f5=a.tfMap['5m'];
  const missing=[];
  if(!closedFrame(f15,'15m'))missing.push('داده معتبر ۱۵ دقیقه‌ای در دسترس نیست یا کهنه است');
  if(!closedFrame(f5,'5m'))missing.push('داده معتبر ۵ دقیقه‌ای در دسترس نیست یا کهنه است');
  if(missing.length)return {state:'wait',baseReady:true,coin,analysis:a,decision:dec,reasons:missing,updatedAt:Date.now(),priority:mtf?.trendScore||0};

  const m15=f15.metrics,m5=f5.metrics,c15=f15.candles,c5=f5.candles;
  const last15=c15.at(-1),last5=c5.at(-1),prev5=c5.at(-2);
  const avgVol=c5.slice(-21,-1).reduce((sum,c)=>sum+(Number(c.v)||0),0)/20;
  const volRatio=avgVol>0?(last5.v/avgVol):null;
  const priorHighs=c5.slice(-22,-2).map(c=>c.h).filter(Number.isFinite);
  const triggerLevel=priorHighs.length?Math.max(...priorHighs):null;
  const green5=last5.c>last5.o;
  const fresh15=Number.isFinite(last15?.t)&&Date.now()-last15.t<=2*TIMEFRAMES['15m'].seconds*1000+3000;
  const trend15Ok=!!m15&&fresh15&&m15.ema9>m15.ema20&&m15.rsi>=50&&m15.rsi<=70&&last15.c>m15.ema20&&f15.trendScore>=50;
  const trend5Ok=!!m5&&m5.ema9>m5.ema20&&m5.rsi>=50&&m5.rsi<=75&&last5.c>m5.ema9;
  const breakout=Number.isFinite(triggerLevel)&&prev5.c<=triggerLevel&&last5.c>triggerLevel&&green5&&Number.isFinite(volRatio)&&volRatio>=1.15;
  const retest=Number.isFinite(triggerLevel)&&prev5.c>triggerLevel&&last5.l<=triggerLevel*1.003&&last5.c>triggerLevel&&green5&&Number.isFinite(volRatio)&&volRatio>=0.80;
  const currentAsk=coin.bestAsk>0?coin.bestAsk:coin.price;
  const chaseLimit=Number.isFinite(triggerLevel)?triggerLevel*1.008:null;
  const priceInZone=Number.isFinite(triggerLevel)&&currentAsk>=triggerLevel*0.997&&currentAsk<=chaseLimit;
  const candleFresh=Date.now()-last5.t<=2*TIMEFRAMES['5m'].seconds*1000;
  const spreadOk=Number.isFinite(risk.spread)&&risk.spread<=prefs.maxSpread;
  const rrOk=Number.isFinite(risk.rrNet)&&risk.rrNet>=prefs.minRR;
  const reasons=[];
  if(!fresh15)reasons.push('آخرین کندل بسته‌شده ۱۵ دقیقه‌ای قدیمی است؛ داده تازه لازم است.');
  if(fresh15&&!trend15Ok)reasons.push('زمینه ۱۵ دقیقه‌ای هنوز صعودی و هم‌جهت نیست: EMA9 باید بالاتر از EMA20، RSI بین ۵۰ تا ۷۰ و بسته‌شدن قیمت بالاتر از EMA20 باشد.');
  if(!trend5Ok)reasons.push('مومنتوم ۵ دقیقه‌ای کافی نیست: EMA9 باید بالاتر از EMA20 و RSI بین ۵۰ تا ۷۵ باشد.');
  if(!breakout&&!retest)reasons.push(`منتظر شکست سقف ${triggerLevel?formatPrice(triggerLevel):'نامشخص'} با کندل سبز بسته‌شده و حجم مناسب، یا پولبک موفق به همین سطح بمانید.`);
  if(!priceInZone)reasons.push(`قیمت از محدوده ماشه خارج شده است؛ محدوده مجاز فعلی ${triggerLevel?formatPrice(triggerLevel*0.997)+' تا '+formatPrice(chaseLimit):'قابل محاسبه نیست'} است؛ از تعقیب قیمت خودداری کنید.`);
  if(!candleFresh)reasons.push('کندل ۵ دقیقه‌ای ماشه قدیمی است؛ تأیید تازه لازم است.');
  if(!spreadOk)reasons.push('اسپرد فعلی از سقف مجاز عبور کرده است.');
  if(!rrOk)reasons.push(`نسبت سود به زیان خالص از حداقل ${prefs.minRR} کمتر شده است.`);
  const triggerReady=fresh15&&trend15Ok&&trend5Ok&&(breakout||retest)&&priceInZone&&candleFresh&&spreadOk&&rrOk;
  const entryLow=Number.isFinite(triggerLevel)?triggerLevel*0.997:null;
  const entryHigh=Number.isFinite(triggerLevel)?triggerLevel*1.008:null;
  const invalidationCandle=Number.isFinite(triggerLevel)?triggerLevel:null;
  const invalidationHard=risk.stopLoss;
  const setup=breakout?'شکست مقاومت با کندل بسته‌شده':retest?'پولبک و تثبیت بالای مقاومت':'در انتظار ماشه';
  return {state:triggerReady?'ready':'wait',baseReady:true,triggerReady,coin,analysis:a,decision:dec,reasons,setup,triggerLevel,entryLow,entryHigh,entryReference:currentAsk,target:risk.takeProfit,stopLoss:risk.stopLoss,rrNet:risk.rrNet,positionSize:risk.positionSize,notional:risk.notional,riskAmount:risk.riskAmount,support:risk.support,resistance:risk.ceiling,spread:risk.spread,volumeRatio:volRatio,rsi15:m15.rsi,rsi5:m5.rsi,ema9_15:m15.ema9,ema20_15:m15.ema20,ema9_5:m5.ema9,ema20_5:m5.ema20,trend1:a.tfMap['1h']?.trendScore,trend4:a.tfMap['4h']?.trendScore,trend15:f15.trendScore,triggerCandleAt:last5.t,invalidationCandle,invalidationHard,updatedAt:Date.now(),priority:mtf?.trendScore||0};
}
function notifyEntryOpportunity(op){
  if(!op?.triggerReady)return;
  const candleAt=op.triggerCandleAt||0,key=`${op.coin.nobitexSymbol}:${candleAt}`;
  let ledger={};try{ledger=JSON.parse(LS('nb4:entry-opportunity-alerts')||'{}')}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}
  if(ledger[op.coin.nobitexSymbol]===candleAt)return;
  ledger[op.coin.nobitexSymbol]=candleAt;
  const keys=Object.keys(ledger);if(keys.length>250)for(const k of keys.slice(0,keys.length-250))delete ledger[k];
  if(LS('nb4:entry-opportunity-alerts',JSON.stringify(ledger))===null)return;
  const body=`ورود مرجع ${formatPrice(op.entryReference)} | هدف ${formatPrice(op.target)} | حد ضرر ${formatPrice(op.stopLoss)} | R/R خالص ${op.rrNet.toFixed(2)}`;
  eventLog(`${op.coin.symbol}: ماشه ورود کم‌ریسک تأیید شد؛ ${body}`,'signal');
  notif.notify('ورود کم‌ریسک تأیید شد: '+op.coin.symbol,body,key,'buy');
}
const ENTRY_CONFIRMATION_MS=6000;
function publishOpportunity(coin,record){
  const frameStamp=k=>record?.tfMap?.[k]?.candles?.at(-1)?.t||0;
  const fingerprint=[record?.updatedAt||0,coin.quoteAt||0,coin.price||0,coin.bestAsk||0,coin.bestBid||0,frameStamp('1h'),frameStamp('4h'),frameStamp('15m'),frameStamp('5m'),prefs.minRR,prefs.feeRate,prefs.slippageRate,prefs.maxSpread,prefs.minVolume,prefs.minQuality,prefs.capital,prefs.riskPct,prefs.costAssumptionsConfirmed,marketHealthy,Math.floor(Date.now()/30000)].join('|');
  const previous=opportunityState.get(coin.id);
  if(previous?._fingerprint===fingerprint)return previous;
  const next=computeEntryOpportunity(coin,record),now=Date.now(),candidateAt=next.triggerCandleAt||0;
  if(next.triggerReady){
    const sameCandidate=previous?.candidateCandleAt===candidateAt&&candidateAt>0;
    const candidateSince=sameCandidate?(previous.candidateSince||now):now;
    const confirmed=sameCandidate&&now-candidateSince>=ENTRY_CONFIRMATION_MS;
    next.candidateCandleAt=candidateAt;next.candidateSince=candidateSince;next.candidateCount=sameCandidate?(previous.candidateCount||1)+1:1;
    next.triggerCandidateReady=true;next.triggerReady=confirmed;
    if(!confirmed){next.state='wait';next.reasons=[...(next.reasons||[]),'ماشه ورود برای جلوگیری از نوسان لحظه‌ای، باید در دو مشاهده از یک کندل و با فاصله حداقل ۶ ثانیه پایدار بماند.'];}
  } else {
    next.triggerCandidateReady=false;next.candidateCandleAt=0;next.candidateSince=0;next.candidateCount=0;
  }
  next._fingerprint=fingerprint;opportunityState.set(coin.id,next);
  if(next.triggerReady&&previous?.triggerReady!==true)notifyEntryOpportunity(next);
  return next;
}
async function ensureOpportunityFrames(coin){
  if(opportunityInflight.has(coin.id))return opportunityInflight.get(coin.id);
  const current=analysisCache.get(coin.id);if(!current)return null;
  const pre=computeEntryOpportunity(coin,current);if(!pre.baseReady)return pre; // Strict trading gates remain unchanged.
  const task=(async()=>{
    let tfMap={...(current.tfMap||{})},changed=false;
    for(const key of ['15m','5m']){
      if(tfMap[key]&&!frameDue(coin,key))continue;
      const res=await fetchTimeframe(coin,key,8,false);
      const item=res.ready?analyzeTimeframe(res.candles,key,res.source):{ready:false,tf:key,trendScore:null,reversalScore:null,bearishReversalScore:null,dataQuality:res.quality?.quality??0,labels:[],candles:res.candles||[],candlesCount:(res.candles||[]).length};
      Object.assign(item,{source:res.source,pair:res.pair,stale:res.stale,networkError:res.networkError,error:res.error,validation:res.validation,fetchedAt:res.fetchedAt,dataQualityDetail:item.dataQualityDetail||res.quality||null});
      tfMap[key]=item;changed=true;
    }
    if(changed){const updated=finalizeRecord(coin,{...current,tfMap,updatedAt:Date.now()});analysisCache.set(coin.id,updated);recordDiagnosticSnapshot(coin,updated);}
    const finalRecord=analysisCache.get(coin.id)||current;
    const assessment=publishOpportunity(coin,finalRecord);
    scheduleRender();
    return assessment;
  })().catch(e=>{eventLog(`${coin.symbol}: بررسی ماشه ورود ناموفق بود؛ ${e.message}`,'info');return publishOpportunity(coin,analysisCache.get(coin.id)||current)}).finally(()=>opportunityInflight.delete(coin.id));
  opportunityInflight.set(coin.id,task);return task;
}
async function runOpportunityRefresh(){
  if(opportunityRefreshBusy||analysisPaused||(document.hidden&&!mayRunWhenHidden())||!marketHealthy||!allCoins.length)return;
  opportunityRefreshBusy=true;
  try{
    const strictCandidates=[],monitorCandidates=[],dailyCandidates=[];
    for(const coin of allCoins){
      const rec=analysisCache.get(coin.id);if(!rec||opportunityInflight.has(coin.id))continue;
      const pre=publishOpportunity(coin,rec),m=pre.analysis?.mtf||rec.mtf;
      if(m?.monitorKey==='early'||pre.baseReady){
        const pulse=updateMonitorPulse(coin,pre);
        monitorCandidates.push({coin,op:pre,score:monitorCandidateScore(pre.analysis),pulse});
        const lastDiag=monitorDiagnosticAt.get(coin.id)||0;
        if(Date.now()-lastDiag>=MONITOR_DIAGNOSTIC_MS){monitorDiagnosticAt.set(coin.id,Date.now());recordDiagnosticSnapshot(coin,pre.analysis||rec);}
        if(!rec.tfMap?.['1d']?.ready&&frameDue(coin,'1d'))dailyCandidates.push({coin,score:monitorCandidateScore(pre.analysis)});
      }
      if(pre.baseReady&&(['15m','5m'].some(k=>frameDue(coin,k))))strictCandidates.push({coin,score:pre.priority||0});
    }
    strictCandidates.sort((a,b)=>b.score-a.score);
    // Only one strict trigger refresh per scheduler pass. The queue remains globally throttled.
    if(strictCandidates.length&&opportunityInflight.size<MAX_BACKGROUND_TRIGGER_JOBS&&Date.now()>=netCooldown)await ensureOpportunityFrames(strictCandidates[0].coin);
    // When no symbol has passed every trading gate, sample 5m/15m for one best raw candidate only.
    // This is a data-path test; it cannot qualify the symbol for entry or bypass any gate.
    if(!strictCandidates.length&&opportunityInflight.size===0&&monitorCandidates.length&&!triggerProbeCooldownActive()){
      monitorCandidates.sort((a,b)=>b.score-a.score);
      await probeCandidateTimeframes(monitorCandidates[0].coin);
    }
    // Daily OHLC is optional: enrich at most one monitored candidate every five minutes,
    // outside the serial 150-symbol base scan, to keep the scan path shorter.
    if(!strictCandidates.length&&opportunityInflight.size===0&&!triggerProbeBusy&&dailyCandidates.length&&Date.now()>=nextDailyMonitorAt&&!dailyMonitorBusy){
      dailyCandidates.sort((a,b)=>b.score-a.score);
      nextDailyMonitorAt=Date.now()+DAILY_MONITOR_COOLDOWN_MS;
      ensureMonitorDailyFrame(dailyCandidates[0].coin).catch(e=>eventLog('غنی‌سازی روزانه ناموفق: '+e.message,'info'));
    }
    renderOpportunityBoard();
  }finally{opportunityRefreshBusy=false;}
}
function renderAllOpportunityReasons(op){
  const items=[...(op?.reasons||[]).filter(Boolean).map(x=>String(x)),...(op?.analysis?.mtf?.monitorReasons||[]).filter(Boolean).map(x=>String(x))];
  if(!items.length){
    const gates=[...(op?.decision?.rows||[]),...(op?.decision?.risks||[])];
    for(const g of gates){if(g.ok===true)continue;items.push(`${g.name||'شرط معاملاتی'}: ${g.ok===null?'داده یا محاسبه در دسترس نیست':`مقدار فعلی ${g.val??'—'}؛ شرط لازم ${g.need??'—'}`}`)}
  }
  const unique=[...new Set(items)];
  if(!unique.length)return '<div class="opportunity-empty">مانع ثبت‌شده‌ای وجود ندارد؛ وضعیت ماشه باید در به‌روزرسانی بعدی دوباره بررسی شود.</div>';
  return `<details class="opportunity-wait-wrap blocker-details" open><summary>تمام موانع و شروط تکمیل <span>${unique.length} مورد</span></summary><div class="op-reasons"><ul>${unique.map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul></div></details>`;
}
function monitorQualityLabel(record,key,required){
  const frame=record?.tfMap?.[key];
  if(!required)return 'هنوز به مرحله بررسی ماشه نرسیده';
  if(!frame)return 'در انتظار دریافت';
  const q=timeframeQualitySnapshot(record.tfMap,key,true);
  const status=q.valid?'معتبر':q.status==='network_error'?'خطای دریافت':q.status==='stale'?'داده کهنه':q.status==='not_loaded'?'در انتظار دریافت':'نامعتبر';
  return `${status}؛ ${q.bars}/${q.minBars} کندل؛ پوشش ${Number.isFinite(q.coveragePercent)?q.coveragePercent:0}٪${q.maxGap!=null?`؛ شکاف ${q.maxGap}`:''}`;
}
function renderMonitorCandidateCard(item){
  const {coin,op,record,tier}=item,analysis=op.analysis||record||{},mtf=analysis.mtf||{},risk=analysis.risk||{};
  const tag=op.state==='ready'?'آماده':op.state==='blocked'?'ردشده':'در انتظار';
  const q1=monitorQualityLabel(analysis,'1h',true),q4=monitorQualityLabel(analysis,'4h',true);
  const probeSampled=record?.triggerProbe?.sampled===true||analysis?.triggerProbe?.sampled===true;
  const q15=monitorQualityLabel(analysis,'15m',op.baseReady===true||probeSampled),q5=monitorQualityLabel(analysis,'5m',op.baseReady===true||probeSampled);
  const pulse=item.pulse||monitorPulseMap.get(coin.id),pulseSnap=pulse?.snap||{};
  const pulseChanges=(pulse?.changes||[]).slice(-3).map(x=>escapeHTML(x.label)).join('؛ ');
  const pulseMarkup=`<div class="monitor-pulse"><b>پایش خودکار:</b> قیمت ${Number.isFinite(pulseSnap.price)?formatPrice(pulseSnap.price):'—'}؛ اسپرد ${Number.isFinite(pulseSnap.spread)?(pulseSnap.spread*100).toFixed(3)+'٪':'نامشخص'}؛ حجم ۲۴ساعته ${Number.isFinite(pulseSnap.volume)?Math.round(pulseSnap.volume).toLocaleString('en-US')+' USDT':'—'}؛ فاصله تا حمایت ${Number.isFinite(pulseSnap.supportDistancePct)?pulseSnap.supportDistancePct.toFixed(2)+'٪':'—'}؛ فضای تا مقاومت ${Number.isFinite(pulseSnap.resistanceRoomPct)?pulseSnap.resistanceRoomPct.toFixed(2)+'٪':'—'}؛ آخرین پایش ${pulseSnap.at?new Date(pulseSnap.at).toLocaleTimeString('fa-IR'):'—'}${pulseChanges?`<div class="monitor-pulse-changes">تغییرات اخیر: ${pulseChanges}</div>`:''}</div>`;
  const probeNote=probeSampled?`<div class="dr-note">نمونه‌برداری تشخیصی ۵m/۱۵m: ${escapeHTML(record.triggerProbe.status||'انجام شده')}؛ این آزمون صرفاً برای کنترل مسیر داده است و مجوز ورود محسوب نمی‌شود.</div>`:'';
  const val=(x)=>Number.isFinite(x)&&x>0?formatPrice(x):'—';
  const rr=Number.isFinite(risk.rrNet)?risk.rrNet.toFixed(2):'قابل محاسبه نیست';
  const blockers=renderAllOpportunityReasons(op);
  return `<article class="op-card wait monitor-candidate-card">
    <div class="op-card-top"><div><b>${escapeHTML(coin.symbol)}/USDT</b><small>${escapeHTML(mtf.signal||mtf.monitorLabel||'نامزد تحت پایش')}</small></div><span class="op-tag wait">${tag}</span></div>
    <div class="op-price-grid op-wait-grid">
      <div><span>امتیاز روند ۴H / ۱H</span><strong dir="ltr">${Number.isFinite(mtf.trendScore)?mtf.trendScore:'—'} / ${Number.isFinite(analysis.tfMap?.['1h']?.trendScore)?analysis.tfMap['1h'].trendScore:'—'}</strong></div>
      <div><span>R/R خالص</span><strong dir="ltr">${rr}</strong></div>
      <div><span>قیمت فعلی</span><strong dir="ltr">${val(coin.bestAsk>0?coin.bestAsk:coin.price)}</strong></div>
      <div><span>ورود / هدف / حد ضرر محاسباتی</span><strong dir="ltr">${val(risk.entry)} / ${val(risk.takeProfit)} / ${val(risk.stopLoss)}</strong></div>
      <div><span>کیفیت داده ۱H</span><strong>${q1}</strong></div>
      <div><span>کیفیت داده ۴H</span><strong>${q4}</strong></div>
      <div><span>کیفیت داده ۱۵m</span><strong>${q15}</strong></div>
      <div><span>کیفیت داده ۵m</span><strong>${q5}</strong></div>
    </div>
    ${pulseMarkup}
    ${probeNote}
    ${blockers}
    <div class="op-card-actions"><button type="button" class="refresh-btn" data-op-open="${escapeHTML(coin.id)}">گزارش کامل ارز</button><button type="button" class="refresh-btn" data-watch-add="${escapeHTML(coin.nobitexSymbol)}">＋ واچ‌لیست</button></div>
  </article>`;
}
function renderMonitorCandidatesBoard(){
  const host=$('monitorCandidateList');if(!host)return;
  const candidates=[];
  for(const coin of allCoins){
    const record=analysisCache.get(coin.id);if(!record)continue;
    const op=publishOpportunity(coin,record),m=op.analysis?.mtf||record.mtf||{};
    if(op.state==='ready')continue;
    if(m.monitorKey==='early'||op.baseReady){
      const tier=op.baseReady?'trigger':m.monitorQualified?'qualified':'raw';
      candidates.push({coin,record,op,tier,score:Number(m.trendScore)||Number(op.priority)||0});
    }
  }
  const weight={trigger:3,qualified:2,raw:1};
  candidates.sort((a,b)=>(weight[b.tier]-weight[a.tier])||(b.score-a.score));
  const raw=candidates.filter(x=>x.tier==='raw').length,qualified=candidates.filter(x=>x.tier==='qualified').length,trigger=candidates.filter(x=>x.tier==='trigger').length;
  $('monitorRawCount').textContent=`نامزد خام: ${raw}`;
  $('monitorQualifiedCount').textContent=`نامزد واجد شرایط: ${qualified}`;
  $('monitorTriggerCount').textContent=`در مرحله ماشه: ${trigger}`;
  host.innerHTML=candidates.length?candidates.slice(0,30).map(renderMonitorCandidateCard).join('')+(candidates.length>30?`<div class="opportunity-empty">${candidates.length-30} نامزد دیگر در پایش داخلی هستند؛ ۳۰ مورد برتر در این پنل نمایش داده شده‌اند.</div>`:''):'<div class="opportunity-empty">در حال حاضر نامزد پایش اولیه یا نمادی در مرحله ماشه شناسایی نشده است. این وضعیت به‌معنای فقدان داده بازار نیست.</div>';
}

function renderOpportunityCard(op,compact=false){
  const coin=op.coin,r=op.analysis?.risk;
  if(!op.triggerReady){
    const reasonMarkup=renderAllOpportunityReasons(op);
    const waitVal=(label,value)=>`<div><span>${label}</span><strong dir="ltr">${Number.isFinite(value)&&value>0?formatPrice(value):'—'}</strong></div>`;
    const waitLevels=`<div class="op-price-grid op-wait-grid">${waitVal('قیمت خرید/فروش فعلی',coin.bestAsk>0?coin.bestAsk:coin.price)}${waitVal('ورود مرجع محاسباتی',r?.entry)}${waitVal('حمایت ساختاری',r?.support)}${waitVal('مقاومت بالاسر',r?.ceiling)}${waitVal('هدف ساختاری فعلی',r?.takeProfit)}${waitVal('حد ضرر محاسباتی',r?.stopLoss)}</div>`;
    const triggerInfo=Number.isFinite(op.triggerLevel)?`سطح ماشه: <b dir="ltr">${formatPrice(op.triggerLevel)}</b>؛ محدوده اولیه ورود ${formatPrice(op.entryLow)} تا ${formatPrice(op.entryHigh)}`:'محدوده ماشه دقیق هنوز قابل محاسبه نیست؛ ابتدا باید داده معتبر ۱۵ و ۵ دقیقه‌ای دریافت شود.';
    const invalidation=r?.stopLoss>0?`تا پیش از فعال‌شدن ماشه، این سطوح صرفاً محاسباتی‌اند؛ رسیدن قیمت به حد ضرر مرجع ${formatPrice(r.stopLoss)} یا از بین رفتن شروط روند، طرح فعلی را باطل می‌کند.`:'تا تکمیل داده‌ها، شرط ابطال و حد ضرر معتبر قابل اعلام نیست.';
    const tag=op.state==='blocked'?'ردشده':'در انتظار';
    return `<article class="op-card wait ${op.state==='blocked'?'blocked':''}"><div class="op-card-top"><b>${escapeHTML(coin.symbol)}/USDT</b><span class="op-tag wait">${tag}</span></div>${reasonMarkup}${waitLevels}<div class="op-trigger-hint">${triggerInfo}</div><div class="op-invalidation">${invalidation}</div><div class="op-card-actions"><button type="button" class="refresh-btn" data-op-open="${escapeHTML(coin.id)}">گزارش کامل ارز</button><button type="button" class="refresh-btn" data-watch-add="${escapeHTML(coin.nobitexSymbol)}">＋ واچ‌لیست</button></div></article>`;
  }
  const pct=(v,b)=>Number.isFinite(v)&&Number.isFinite(b)&&b>0?`${((v-b)/b*100).toFixed(2)}٪`:'—';
  const zone=`${formatPrice(op.entryLow)} تا ${formatPrice(op.entryHigh)}`;
  const rr=Number.isFinite(op.rrNet)?op.rrNet.toFixed(2):'—';
  return `<article class="op-card ready"><div class="op-card-top"><div><b>${escapeHTML(coin.symbol)}/USDT</b><small>${escapeHTML(op.setup||'ماشه فعال')}</small></div><span class="op-tag ready">آماده</span></div><div class="op-price-grid">
    <div><span>قیمت مرجع ورود</span><strong dir="ltr">${formatPrice(op.entryReference)}</strong></div><div><span>محدوده مجاز ورود</span><strong dir="ltr">${zone}</strong></div>
    <div><span>هدف سود</span><strong class="positive" dir="ltr">${formatPrice(op.target)} <small>(${pct(op.target,op.entryReference)})</small></strong></div><div><span>حد ضرر</span><strong class="negative" dir="ltr">${formatPrice(op.stopLoss)} <small>(${pct(op.stopLoss,op.entryReference)})</small></strong></div>
    <div><span>R/R خالص</span><strong dir="ltr">${rr}</strong></div><div><span>حجم پیشنهادی</span><strong dir="ltr">${Number.isFinite(op.positionSize)?op.positionSize.toFixed(6):'—'} ${escapeHTML(coin.symbol)}</strong></div>
    <div><span>ارزش موقعیت</span><strong dir="ltr">${Number.isFinite(op.notional)?op.notional.toFixed(2)+' USDT':'—'}</strong></div><div><span>زیان برآوردی در حد ضرر</span><strong class="negative" dir="ltr">${Number.isFinite(op.riskAmount)?op.riskAmount.toFixed(2)+' USDT':'—'}</strong></div>
    <div><span>حمایت ساختاری</span><strong dir="ltr">${Number.isFinite(op.support)?formatPrice(op.support):'—'}</strong></div><div><span>مقاومت بالاسر</span><strong dir="ltr">${Number.isFinite(op.resistance)?formatPrice(op.resistance):'—'}</strong></div>
    <div><span>حجم کندل ۵ دقیقه</span><strong dir="ltr">${Number.isFinite(op.volumeRatio)?op.volumeRatio.toFixed(2)+'× میانگین':'—'}</strong></div><div><span>اسپرد فعلی</span><strong dir="ltr">${Number.isFinite(op.spread)?(op.spread*100).toFixed(3)+'٪':'—'}</strong></div>
    <div><span>قدرت روند ۴H / ۱H</span><strong dir="ltr">${Number.isFinite(op.trend4)?op.trend4:'—'} / ${Number.isFinite(op.trend1)?op.trend1:'—'}</strong></div><div><span>امتیاز روند ۱۵m</span><strong dir="ltr">${Number.isFinite(op.trend15)?op.trend15:'—'}</strong></div>
    <div><span>RSI پانزده / پنج دقیقه</span><strong dir="ltr">${Number.isFinite(op.rsi15)?op.rsi15.toFixed(1):'—'} / ${Number.isFinite(op.rsi5)?op.rsi5.toFixed(1):'—'}</strong></div><div><span>EMA9 / EMA20 (۱۵m)</span><strong dir="ltr">${formatPrice(op.ema9_15)} / ${formatPrice(op.ema20_15)}</strong></div><div><span>EMA9 / EMA20 (۵m)</span><strong dir="ltr">${formatPrice(op.ema9_5)} / ${formatPrice(op.ema20_5)}</strong></div>
  </div><div class="op-invalidation"><b>شرط ابطال:</b> بسته‌شدن کندل ۵ دقیقه‌ای زیر سطح ماشه ${formatPrice(op.invalidationCandle)} یا بسته‌شدن کندل ۱۵ دقیقه‌ای زیر EMA20؛ در هر حال رسیدن قیمت به حد ضرر ${formatPrice(op.invalidationHard)} به معنی خروج طبق برنامه ریسک است. اگر بیش از ۱۰ دقیقه از کندل ماشه بگذرد، قیمت خرید بیش از ۹۰ ثانیه به‌روزرسانی نشود یا R/R از حد مجاز پایین‌تر بیاید، سیگنال منقضی می‌شود.</div><div class="op-confirmation">تأییدها: روند ۱H/۴H، زمینه ۱۵m، شکست/پولبک کندل بسته‌شده ۵m، حجم و اسپرد معتبر.</div><div class="op-card-actions"><button type="button" class="refresh-btn" data-op-open="${escapeHTML(coin.id)}">مشاهده گزارش و نمودار</button><button type="button" class="refresh-btn" data-watch-add="${escapeHTML(coin.nobitexSymbol)}">＋ واچ‌لیست</button></div></article>`;
}
function renderOpportunityBoard(){
  const readyHost=$('opportunityReadyList'),waitHost=$('opportunityWaitList');if(!readyHost||!waitHost)return;
  const rows=[];
  for(const coin of allCoins){const rec=analysisCache.get(coin.id);if(!rec)continue;const op=publishOpportunity(coin,rec);if(op.state==='ready'||op.baseReady||((op.analysis?.mtf?.trendScore||0)>=45&&op.analysis?.mtf?.gates?.mandatoryReady))rows.push(op);}
  const analyzed=scannedSymbolCount();
  const ready=rows.filter(x=>x.state==='ready').sort((a,b)=>(b.rrNet||0)-(a.rrNet||0));
  const wait=rows.filter(x=>x.state!=='ready').sort((a,b)=>(b.priority||0)-(a.priority||0));
  $('opReadyCount').textContent=`ورود تأییدشده: ${ready.length}`;
  $('opWaitCount').textContent=`در انتظار: ${wait.length}`;
  $('opScannedCount').textContent=`بررسی‌شده: ${analyzed}/${allCoins.length}`;
  $('opportunityWaitSummary').textContent=`${wait.length} مورد`;
  readyHost.innerHTML=ready.length?ready.map(x=>renderOpportunityCard(x)).join(''):'<div class="opportunity-empty">در حال حاضر هیچ نمادی تمام شروط ورود را هم‌زمان ندارد. این بخش مستقل از فیلترها و واچ‌لیست است و پس از تأیید کندل ۵ دقیقه‌ای به‌روزرسانی می‌شود.</div>';
  waitHost.innerHTML=wait.length?wait.slice(0,15).map(x=>renderOpportunityCard(x,true)).join(''):'<div class="opportunity-empty">موردی برای انتظار تأیید در داده‌های فعلی شناسایی نشده است.</div>';
  renderMonitorCandidatesBoard();
}

function renderTable(coins){
  const filterVal=trendFilter.value;
  const minScore=num(minScoreInput.value,0);
  const minRR=num(minRRInput.value,0);
  const q=(searchInput.value||'').trim().toLowerCase();
  const hideStableCoins=hideStable.checked;
  const onlyConf=onlyConfirmed.checked;
  const ichiOnly=ichiFilter.checked;

  const enriched=coins.map(c=>({coin:c, analysis:finalizeRecord(c,analysisCache.get(c.id)||null)}));
  const sf=signalFilter.value;
  const sk=x=>x.analysis?.mtf?.monitorKey==='early'?(x.analysis?.mtf?.monitorQualified?'earlyQualified':'early'):(x.analysis?.mtf?.signalKey||'pending');
  const pre=enriched.filter(x=>{
    if(hideStableCoins && STABLES.has(String(x.coin.symbol).toUpperCase())) return false;
    if(q){ const s=(x.coin.symbol||'').toLowerCase(), n=(x.coin.name||'').toLowerCase();
      if(!s.includes(q) && !n.includes(q)) return false; }
    const a=x.analysis?.mtf;
    if(filterVal!=='all'){
      const target={strong_bull:'صعودی قوی',bull:'صعودی',neutral:'خنثی',bear:'نزولی',strong_bear:'نزولی قوی'}[filterVal];
      if((a?.label?.label||'نامشخص')!==target) return false;
    }
    if(minScore>0 && (a?.quality??0) < minScore) return false;
    if(minRR>0 && (x.analysis?.risk?.rrNet??0) < minRR) return false;
    if(ichiOnly){
      const ichi = x.analysis?.tfMap?.['1h']?.metrics?.ichimokuScore;
      if(!Number.isFinite(ichi) || ichi < 62) return false;
    }
    return true;
  });
  const cnt={}; pre.forEach(x=>{ const k=sk(x); cnt[k]=(cnt[k]||0)+1; });
  cnt.buyish=(cnt.ready||0)+(cnt.await||0)+(cnt.reversal||0); cnt.all=pre.length;
  [...signalFilter.options].forEach(o=>{ o.textContent=`${o.dataset.l} (${cnt[o.value]||0})`; });
  let filtered=pre.filter(x=>{
    const k=sk(x), a=x.analysis?.mtf;if(onlyConf&&!a?.eligible)return false;
    if(sf==='all'){
      if(!onlyConf) return true;
      return !!a?.eligible;
    }
    if(sf==='buyish') return k==='ready'||k==='await'||k==='reversal';
    return k===sf;
  });

  filtered=sortCoins(filtered);
  lastRenderedFiltered=filtered.slice();
  visibleCount.textContent=filtered.length;

  if(!filtered.length){
    renderWatchlist();renderOpportunityBoard();
    const totalAnalyzed = analysisCache.size;
    let msg = `⚡ هیچ ارزی با این فیلترها یافت نشد`;
    if(totalAnalyzed < allCoins.length) msg += ` — تحلیل در حال تکمیل است (${totalAnalyzed}/${allCoins.length})`;
    let hint = '';
    if(onlyConf && sf==='all') hint = `<div style="margin-top:14px;color:var(--yellow);font-size:0.85rem;">💡 تیک «فقط تأییدشده» را بردارید.</div>`;
    if(ichiOnly) hint += `<div style="margin-top:8px;color:var(--yellow);font-size:0.85rem;">💡 فیلتر «ایچیموکو صعودی» را بردارید.</div>`;
    if(lastAnalysisError) hint += `<div style="margin-top:8px;color:#ff8a8a;font-size:0.78rem;font-family:monospace;direction:ltr;">${escapeHTML(lastAnalysisError)}</div>`;
    tableBody.innerHTML=`<tr><td colspan="20" style="text-align:center;padding:40px;color:var(--text3);">${msg}${hint}</td></tr>`;
    return;
  }

  tableBody.innerHTML=filtered.map(({coin, analysis})=>{
    const mtf=analysis?.mtf;
    const trend=mtf?.label||trendLabel(null);
    const strong=mtf?.eligible===true;
    const rowClass=strong?'highlight-row':'';
    const quality=mtf?.quality??0;
    const tfCount=mtf?.decisionValidCount??0;
    const tfCountCls=tfCount===2?'full':tfCount===1?'partial':'none';
    const updatedAt=analysis?.updatedAt;
    const risk=analysis?.risk;

    // Ichimoku از 1H
    const ichiMetrics = analysis?.tfMap?.['1h']?.metrics;
    const ichiScore = ichiMetrics?.ichimokuScore;
    const ichiCls = ichiTone(ichiScore);
    const ichiLabel = Number.isFinite(ichiScore) ? Math.round(ichiScore) : '—';

    const entryStr = risk?.entry ? formatPrice(risk.entry) : '—';
    const slStr = risk?.stopLoss ? formatPrice(risk.stopLoss) : '—';
    const tpStr = risk?.takeProfit ? formatPrice(risk.takeProfit) : '—';
    const ceilingStr = risk?.ceiling ? formatPrice(risk.ceiling) : '—';
    const spreadStr = Number.isFinite(risk?.spread) ? (risk.spread*100).toFixed(3)+'٪' : '—';
    const rrVal = risk?.rrNet;
    const rrStr = Number.isFinite(rrVal) ? rrVal.toFixed(2) : '—';
    const rrCls = Number.isFinite(rrVal) ? (rrVal >= 1.5 ? 'ok' : rrVal >= 1 ? 'warn' : 'bad') : '';

    const hardRejected=['blocked','riskblocked','reject','insufficient'].includes(mtf?.signalKey)||Boolean(mtf?.gateBlocked&&!mtf?.eligible);
    const sigClass = mtf?.eligible ? 'strong-buy' : hardRejected ? 'blocked' : 'hold';
    const sigLabel = mtf?.eligible ? 'آماده' : hardRejected ? 'ردشده' : 'در انتظار';

    return `<tr class="clickable ${rowClass}" data-id="${escapeHTML(coin.id)}" data-snapshot-id="${escapeHTML(analysis?.snapshotId||'')}" tabindex="0" role="button" aria-label="جزئیات ${escapeHTML(coin.symbol)}">
      <td class="rank">${coin.rank}</td>
      <td><div class="coin-info"><span class="symbol">${escapeHTML(coin.symbol)}</span><span class="name">${escapeHTML(coin.name)}</span></div></td>
      <td class="price ${Date.now()-(coin.priceAt||0)>90000?'quote-old':''}" title="${coin.priceAt?new Date(coin.priceAt).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}):'قیمت قدیمی/ذخیره‌شده'}" style="text-align:left;" data-p="${escapeHTML(coin.id)}" data-v="${coin.price}">$${formatPrice(coin.price)}</td>
      <td style="text-align:left;"><span class="change ${changeClass(coin.change24h)}" data-c="${escapeHTML(coin.id)}">${formatChange(coin.change24h)}</span></td>
      <td style="text-align:left;">${tfBadge(analysis?.tfMap?.['5m'],'5m')}</td>
      <td style="text-align:left;">${tfBadge(analysis?.tfMap?.['15m'],'15m')}</td>
      <td style="text-align:left;">${tfBadge(analysis?.tfMap?.['1h'],'1H')}</td>
      <td style="text-align:left;">${tfBadge(analysis?.tfMap?.['4h'],'4H')}</td>
      <td style="text-align:left;">${tfBadge(analysis?.tfMap?.['1d'],'1D')}</td>
      <td style="text-align:left;"><span class="ichi-score ${ichiCls}">${ichiLabel}</span></td>
      <td style="text-align:left;">
        <span class="mtf-score ${scoreTone(mtf?.trendScore)}">${Number.isFinite(mtf?.trendScore)?mtf.trendScore:'—'}</span>
        <span class="quality-bar"><span style="width:${quality}%"></span></span>
        <span class="tf-count-pill ${tfCountCls}">${tfCount}/2 اصلی</span>
      </td>
      <td data-risk-value="entry" style="text-align:left;font-size:0.68rem;font-family:monospace;">${entryStr}</td>
      <td data-risk-value="stopLoss" style="text-align:left;font-size:0.68rem;font-family:monospace;color:var(--red2);">${slStr}</td>
      <td data-risk-value="target" style="text-align:left;font-size:0.68rem;font-family:monospace;color:var(--green);">${tpStr}</td>
      <td data-risk-value="ceiling" style="text-align:left;font-size:0.68rem;font-family:monospace;">${ceilingStr}</td>
      <td data-risk-value="spread" style="text-align:left;font-size:0.68rem;font-family:monospace;">${spreadStr}</td>
      <td style="text-align:left;"><span class="risk-badge ${rrCls}" data-risk-value="rrNet">${rrStr}</span></td>
      <td style="text-align:left;">${ageBadge(updatedAt)}</td>
      <td data-risk-value="snapshotId" title="${escapeHTML(analysis?.snapshotId||'')}" style="font-family:monospace;font-size:.62rem;direction:ltr;">${escapeHTML((analysis?.snapshotId||'—').slice(0,10))}</td>
      <td style="text-align:left;"><span class="signal ${sigClass}" data-risk-value="state" title="${escapeHTML(mtf?.gateReason||mtf?.signal||'')}">${escapeHTML(sigLabel)}</span><button type="button" class="refresh-btn row-watch-add" data-watch-add="${escapeHTML(coin.nobitexSymbol)}" aria-label="افزودن ${escapeHTML(coin.symbol)} به واچ‌لیست">＋ واچ‌لیست</button></td>
    </tr>`;
  }).join('');
  renderWatchlist();renderOpportunityBoard();

}

// =========================================================
// MODAL
// =========================================================
function mini(label,value){
  return `<div class="mini-stat"><div class="k">${escapeHTML(label)}</div><div class="v">${escapeHTML(value)}</div></div>`;
}

function renderTimeframeDetail(key, data){
  if(!data || !data.ready){
    return `<div class="tf-detail"><h5>${key} · داده کافی نیست</h5>
      <div style="color:var(--text3);font-size:.72rem;">${escapeHTML(data?.error||'OHLCV در دسترس نیست.')}</div></div>`;
  }
  const m=data.metrics;
  const dq=data.dataQualityDetail||{};
  const ichiScore = m.ichimokuScore ?? '—';
  const fibNearest = m.fib?.nearestLabel || '—';
  return `<div class="tf-detail">
    <h5>${key} · ${data.trend.label} · روند ${Math.round(data.trendScore)}/100 · شواهد برگشت ${Math.round(data.reversalScore)}/100 · کیفیت ${data.dataQuality}%</h5>
    <div class="tf-detail-grid">
      ${mini('RSI 14', m.rsi.toFixed(1))}
      ${mini('ADX 14', m.adx.toFixed(1))}
      ${mini('EMA 20', formatPrice(m.ema20))}
      ${mini('EMA 50', formatPrice(m.ema50))}
      ${mini('ATR 14', formatPrice(m.atr))}
      ${mini('MACD', m.macd.toFixed(6))}
      ${mini('Vol/SMA20', m.volRatio.toFixed(2)+'×')}
      ${mini('Structure', m.structure)}
      ${mini('Ichimoku', String(ichiScore))}
      ${mini('Tenkan', formatPrice(m.tenkan))}
      ${mini('Kijun', formatPrice(m.kijun))}
      ${mini('Cloud Top', formatPrice(m.cloudTop))}
      ${mini('Cloud Bot', formatPrice(m.cloudBot))}
      ${mini('Fib Near', fibNearest)}
      ${mini('کندل معتبر', String(data.candlesCount))}
      ${mini('پوشش تاریخچه', String((dq.coveragePercent??0)+'٪'))}${mini('مجموع کندل‌های مفقود', String(dq.gaps||0))}${mini('بزرگ‌ترین شکاف', String(dq.maxGap||0))}${mini('زمان آخرین کندل',new Date(data.lastTime).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}))}
    </div>
    <div style="margin-top:6px;color:#99aacd;font-size:.68rem;line-height:1.7;">
      ${escapeHTML(data.labels.length ? data.labels.join(' • ') : 'نشانه برگشت قوی ثبت نشده است.')} ${data.networkError?'⚠ '+escapeHTML(data.networkError):''}
    </div>
  </div>`;
}

function renderModalChart(coin, analysis, tfKey){
  if(modalChartInstance&&modalCurrentCoin&&modalCurrentTf){try{chartViews.set(modalCurrentCoin.nobitexSymbol+'|'+modalCurrentTf,modalChartInstance.timeScale().getVisibleLogicalRange())}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}}
  if(modalChartResizeObserver){ modalChartResizeObserver.disconnect(); modalChartResizeObserver=null; }
  if(modalChartInstance){ try{ modalChartInstance.remove(); }catch(e){eventLog('آزادسازی نمودار قبلی ناموفق بود: '+String(e?.message||e).slice(0,100),'info')} modalChartInstance=null; }
  modalChart.innerHTML='';if($('marketLayers')){$('marketLayers').innerHTML='';$('marketLayers').hidden=true;}
  chartTfLabel.textContent='—';
  if(typeof LightweightCharts==='undefined'){
    modalChart.innerHTML='<div class="chart-empty">کتابخانه چارت بارگذاری نشد.</div>';
    return;
  }
  const prefer = tfKey ? [tfKey] : ['15m','1h','4h','5m','1d'];
  let chosen=null;
  for(const k of prefer){
    const tf=analysis?.tfMap?.[k];
    if(Array.isArray(tf?.candles) && tf.candles.length>=2){ chosen={key:k, tf}; break; }
  }
  if(!chosen){
    modalChart.innerHTML='<div class="chart-empty">کندل کافی برای نمایش وجود ندارد.</div>';
    return;
  }
  chartTfLabel.textContent=`${chosen.key} • ${chosen.tf.candlesCount} کندل • Nobitex`;
  modalCurrentTf = chosen.key;

  const chart=LightweightCharts.createChart(modalChart,{
    width: modalChart.clientWidth,
    height: modalChart.clientHeight || 340,
    layout:{ background:{color:'#0b0e14'}, textColor:'#8899bb', fontFamily:'Segoe UI, Tahoma, sans-serif' },
    grid:{ vertLines:{color:'#1f2735'}, horzLines:{color:'#1f2735'} },
    timeScale:{ timeVisible:true, secondsVisible:false, borderColor:'#2a3140', rightOffset:2 },
    rightPriceScale:{ borderColor:'#2a3140' },localization:{timeFormatter:chartTime},
    crosshair:{ mode:LightweightCharts.CrosshairMode.Normal }
  });

  const candleSeries=chart.addCandlestickSeries({
    upColor:'#2ecc71', downColor:'#e74c3c',priceFormat:{type:'price',precision:Math.min(12,Math.max(2,5-Math.floor(Math.log10(chosen.tf.candles.at(-1).c)))),minMove:Math.pow(10,-Math.min(12,Math.max(2,5-Math.floor(Math.log10(chosen.tf.candles.at(-1).c)))))},
    borderUpColor:'#2ecc71', borderDownColor:'#e74c3c',
    wickUpColor:'#2ecc71', wickDownColor:'#e74c3c'
  });

  const seen=new Set();
  const candleData=[];
  chosen.tf.candles.forEach(c=>{
    const t=Math.floor(c.t/1000);
    if(!seen.has(t)){ seen.add(t); candleData.push({time:t, open:c.o, high:c.h, low:c.l, close:c.c}); }
  });
  candleData.sort((a,b)=>a.time-b.time);
  candleSeries.setData(candleData);

  const closes=chosen.tf.candles.map(c=>c.c);
  const ema20=emaSeries(closes,20);
  const emaLine=chart.addLineSeries({ color:'#f7931a', lineWidth:2, priceLineVisible:false, lastValueVisible:false });
  const emaData=[];
  const seenE=new Set();
  chosen.tf.candles.forEach((c,i)=>{
    const t=Math.floor(c.t/1000);
    if(ema20[i]!=null && !seenE.has(t)){ seenE.add(t); emaData.push({time:t, value:ema20[i]}); }
  });
  emaData.sort((a,b)=>a.time-b.time);
  emaLine.setData(emaData);

  // ✅ Ichimoku: Tenkan و Kijun
  const ichi = chosen.tf.metrics?.ichimokuSeries || ichimokuCalc(chosen.tf.candles);
  if(ichi&&$('showIchi')?.checked!==false){
    const tData=[], kData=[];
    const seenT=new Set(), seenK=new Set();
    chosen.tf.candles.forEach((c,i)=>{
      const t=Math.floor(c.t/1000);
      if(ichi.tenkan[i]!=null && !seenT.has(t)){ seenT.add(t); tData.push({time:t, value:ichi.tenkan[i]}); }
      if(ichi.kijun[i]!=null && !seenK.has(t)){ seenK.add(t); kData.push({time:t, value:ichi.kijun[i]}); }
    });
    const tenkanLine = chart.addLineSeries({ color:'#2979ff', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
    tenkanLine.setData(tData);
    const kijunLine = chart.addLineSeries({ color:'#ff6d00', lineWidth:1, priceLineVisible:false, lastValueVisible:false });
    kijunLine.setData(kData);
  }

  addChartLayers(chart,candleSeries,chosen);renderMarketLayers(chart,candleSeries,chosen,analysis);
  const volSeries=chart.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'vol', color:'#4a90e2' });
  chart.priceScale('vol').applyOptions({ scaleMargins:{ top:0.82, bottom:0 } });
  const volData=[];
  const seenV=new Set();
  chosen.tf.candles.forEach(c=>{
    const t=Math.floor(c.t/1000);
    if(seenV.has(t)) return; seenV.add(t);
    volData.push({ time:t, value:c.v, color: c.c>=c.o?'rgba(46,204,113,0.45)':'rgba(231,76,60,0.45)' });
  });
  volData.sort((a,b)=>a.time-b.time);
  volSeries.setData(volData);

  const risk = analysis?.risk;
  if(risk && chosen.key === risk.tfKey){
    try {
      candleSeries.createPriceLine({ price: risk.entry, color:'#f7931a', lineWidth:2,
        lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title: 'ورود' });
      candleSeries.createPriceLine({ price: risk.stopLoss, color:'#e74c3c', lineWidth:2,
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'حد ضرر' });
      if(Number.isFinite(risk.takeProfit)&&risk.takeProfit>risk.entry)candleSeries.createPriceLine({ price: risk.takeProfit, color:'#2ecc71', lineWidth:2,
        lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'هدف ساختاری' });
    } catch(e){eventLog('ثبت خطوط ریسک روی نمودار ناموفق بود: '+String(e?.message||e).slice(0,120),'info')}
  }

  const view=chartViews.get(coin.nobitexSymbol+'|'+chosen.key);if(view)chart.timeScale().setVisibleLogicalRange(view);else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,chosen.tf.candles.length-130),to:chosen.tf.candles.length+26});
  modalChartInstance=chart;
  modalChartResizeObserver=new ResizeObserver(()=>{
    if(!modalChartInstance) return;
    modalChartInstance.applyOptions({ width: modalChart.clientWidth, height: modalChart.clientHeight || 340 });
  });
  modalChartResizeObserver.observe(modalChart);
}


// =========================================================
// گزارش نهایی تصمیم معاملاتی (v7.0)
// آستانه‌ها اولیه و بک‌تست‌نشده‌اند؛ ۵ دقیقه‌ای هرگز به‌تنهایی مجوز ورود نمی‌دهد.
// =========================================================
const DR_NA='قابل محاسبه نیست';
function buildSixPointReview(coin,analysis){
  const h1=analysis?.tfMap?.['1h'],h4=analysis?.tfMap?.['4h'];
  const v1=!!h1&&isTimeframeValid(h1,'1h'),v4=!!h4&&isTimeframeValid(h4,'4h');
  const m1=v1?h1.metrics:null,m4=v4?h4.metrics:null,risk=analysis?.risk;
  let hist=null,histPrev=null;
  if(v1){try{const mm=macdSeries(h1.candles.map(c=>c.c));hist=mm.hist.at(-1);histPrev=mm.hist.at(-2)}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}}
  const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
  const rows=[];
  const push=(name,current,ideal,state,summary,hard=true)=>rows.push({name,current,ideal,state,summary,hard});
  const status=(ok,partial=false)=>ok?'good':partial?'wait':'bad';
  const stateLabel=s=>s==='good'?'مطلوب':s==='wait'?'نیازمند صبر':s==='bad'?'نامطلوب':'شاخص در دسترس نیست';

  // 1) EMA 9/20/50 — use the closed 1H candle values.
  if(m1){
    const cross=m1.ema9>m1.ema20,stack=m1.ema20>m1.ema50;
    push('EMA 9 / 20 / 50 (۱ساعته)',
      `EMA9: ${formatPrice(m1.ema9)} | EMA20: ${formatPrice(m1.ema20)} | EMA50: ${formatPrice(m1.ema50)}`,
      'EMA9 بالاتر از EMA20؛ ترجیحاً EMA20 بالاتر از EMA50',
      status(cross,!cross),
      cross?(stack?'چیدمان صعودی کامل است؛ هم‌جهتی میانگین‌ها مثبت است.':'تقاطع کوتاه‌مدت مثبت است؛ برای اطمینان بیشتر، صعود EMA20 بالای EMA50 را هم زیر نظر بگیرید.'):'فعلاً خرید را به تأخیر بیندازید؛ منتظر عبور و تثبیت EMA9 بالای EMA20 بمانید.');
  }else push('EMA 9 / 20 / 50 (۱ساعته)',DR_NA,'EMA9 بالاتر از EMA20؛ ترجیحاً EMA20 بالاتر از EMA50','na','تایم‌فریم ۱ساعته در این نوبت معتبر/آماده نیست؛ وضعیت دریافت و کیفیت آن را در جدول پایین بررسی کنید.');

  // 2) RSI 1H
  if(m1){
    const ok=m1.rsi>=50&&m1.rsi<=68,hot=m1.rsi>68;
    push('RSI (۱ساعته)',fmt(m1.rsi,1),'بین ۵۰ تا ۶۸',status(ok,!ok&&!hot),
      ok?'مومنتوم در محدوده مطلوب است.':m1.rsi<50?'قدرت خرید هنوز کافی نیست؛ تا عبور RSI از ۵۰ صبر کنید.':m1.rsi>75?'RSI بالاست؛ از تعقیب قیمت و ورود دیرهنگام خودداری کنید.':'RSI بالاتر از محدوده ترجیحی است؛ بهتر است پس از آرام‌شدن حرکت دوباره بررسی شود.');
  }else push('RSI (۱ساعته)',DR_NA,'بین ۵۰ تا ۶۸','na','داده معتبر ۱ساعته در این نوبت آماده نیست؛ علت در جدول کیفیت تایم‌فریم‌ها ثبت شده است.');

  // 3) MACD 1H: MACD above signal, positive histogram and rising histogram.
  if(m1&&Number.isFinite(hist)&&Number.isFinite(histPrev)){
    const ok=m1.macd>0&&m1.macd>m1.signal&&hist>0&&hist>histPrev;
    push('MACD (۱ساعته)',
      `MACD: ${fmt(m1.macd,6)} | Signal: ${fmt(m1.signal,6)} | Hist: ${fmt(hist,6)} (قبلی ${fmt(histPrev,6)})`,
      'MACD مثبت، بالاتر از Signal و هیستوگرام مثبتِ رو به رشد',
      status(ok,!ok&&m1.macd>m1.signal&&hist>0),
      ok?'شتاب صعودی در حال تقویت است.':m1.macd<=m1.signal?'تقاطع صعودی هنوز تأیید نشده؛ منتظر قرارگرفتن MACD بالای خط Signal بمانید.':'شتاب صعودی کافی نیست؛ منتظر مثبت‌شدن و تقویت هیستوگرام باشید.');
  }else push('MACD (۱ساعته)',DR_NA,'MACD مثبت، بالاتر از Signal و هیستوگرام مثبتِ رو به رشد','na','MACD در این نوبت از داده معتبر ۱ساعته قابل محاسبه نیست؛ جزئیات در جدول کیفیت داده آمده است.');

  // 4) Ichimoku 1H
  if(m1&&Number.isFinite(m1.cloudTop)){
    const ok=m1.lastClose>m1.cloudTop;
    push('ایچیموکو (۱ساعته)',
      `قیمت بسته‌شدن: ${formatPrice(m1.lastClose)} | سقف ابر: ${formatPrice(m1.cloudTop)} | کف ابر: ${formatPrice(m1.cloudBot)}`,
      'قیمت بالاتر از سقف ابر',status(ok,!ok&&m1.lastClose>=m1.cloudBot),
      ok?'قیمت بالای ابر است؛ ساختار ایچیموکو به نفع خریداران است.':m1.lastClose>=m1.cloudBot?'قیمت داخل ابر است؛ جهت روشن نیست، منتظر خروج و تثبیت بالای ابر بمانید.':'قیمت زیر ابر است؛ برای معامله لانگ فعلاً مناسب نیست.');
  }else push('ایچیموکو (۱ساعته)',DR_NA,'قیمت بالاتر از سقف ابر','na','برای محاسبه ابر فعلی، داده معتبر ۱ساعته در دسترس نیست؛ جدول کیفیت داده را بررسی کنید.');

  // 5) ADX 4H + DI direction
  if(m4){
    const diUp=Number.isFinite(m4.plusDI)&&Number.isFinite(m4.minusDI)&&m4.plusDI>m4.minusDI;
    const enoughStrength=m4.adx>=RULES.adxMin,ok=enoughStrength&&diUp;
    push('ADX و جهت DI (۴ساعته)',
      `ADX: ${fmt(m4.adx,1)} | +DI: ${fmt(m4.plusDI,1)} | −DI: ${fmt(m4.minusDI,1)}`,
      `ADX حداقل ${RULES.adxMin} و +DI بالاتر از −DI؛ ${RULES.adxMin} تا ${RULES.adxPreferredMax} ترجیحی و بدون سقف سخت`,status(ok,!diUp&&m4.adx>=RULES.adxMin),
      ok?(m4.adx>50?'قدرت روند بالاست؛ فاصله قیمت از ساختار و ATR را نیز بررسی کنید.':'قدرت و جهت روند چهارساعته با سناریوی لانگ هم‌خوان است.'):m4.adx<RULES.adxMin?'روند قدرت کافی ندارد؛ منتظر تقویت روند بمانید.':'جهت DI به نفع فروشندگان است؛ برای لانگ صبر کنید.');
  }else push('ADX و جهت DI (۴ساعته)',DR_NA,`ADX حداقل ${RULES.adxMin} و +DI بالاتر از −DI؛ ${RULES.adxMin} تا ${RULES.adxPreferredMax} ترجیحی و بدون سقف سخت`,'na','داده معتبر ۴ساعته در این نوبت آماده نیست؛ علت در جدول کیفیت تایم‌فریم‌ها ثبت شده است.');

  // 6) Support / resistance context versus the net 2R target.
  if(m1){
    const entry=risk?.entry??(coin.bestAsk>0?coin.bestAsk:coin.price);
    const support=risk?.support??null;
    const resistance=risk?.ceiling??null;
    const supportDist=Number.isFinite(support)&&support>0&&entry>0?(entry-support)/entry*100:null;
    const room=Number.isFinite(resistance)&&entry>0?(resistance-entry)/entry*100:null;
    const nearSupport=supportDist!=null&&supportDist>=0&&supportDist<=3;
    const targetBeforeResistance=!!risk&&Number.isFinite(risk.takeProfit)&&risk.takeProfit>entry&&Number.isFinite(resistance)&&resistance>risk.takeProfit;
    const resistanceRoomPct=room;
    const resistanceTooClose=resistanceRoomPct!=null&&resistanceRoomPct>=0&&resistanceRoomPct<=1.0;
    const ok=nearSupport&&targetBeforeResistance&&!resistanceTooClose;
    const current=`قیمت مرجع: ${formatPrice(entry)} | حمایت: ${formatPrice(support)} (${supportDist==null?'—':fmt(supportDist,2)+'٪ فاصله'}) | مقاومت: ${formatPrice(resistance)} (${room==null?'—':fmt(room,2)+'٪ فاصله'}) | هدف: ${risk?formatPrice(risk.takeProfit):'—'}`;
    const suggestion=ok?'قیمت به حمایت نزدیک است و هدف پیش از مقاومت قرار می‌گیرد؛ همچنان منتظر تأیید ماشه ورود بمانید.':
      (supportDist==null?'سطوح حمایت/مقاومت کامل نیست؛ پس از دریافت داده معتبر دوباره بررسی کنید.':
      supportDist<0?'حمایت محاسباتی شکسته شده؛ تا تشکیل حمایت جدید از ورود لانگ خودداری کنید.':
      !nearSupport?'قیمت از حمایت بیش از حد فاصله دارد؛ منتظر پولبک و نزدیک‌شدن به حمایت بمانید.':
      !resistance?'مقاومت معتبر مشخص نیست؛ فضای کافی تا هدف را نمی‌توان تأیید کرد.':
      resistanceTooClose?`مقاومت فقط ${fmt(resistanceRoomPct,2)}٪ بالاتر از قیمت است؛ خرید زیر مقاومت ممنوع است.`:
      'حمایت و مقاومت ساختاری مناسب‌اند؛ هدف پیش از مقاومت تعیین شده است.');
    push('حمایت و مقاومت',current,'حمایت ۴ساعته/روزانه حداکثر ۳٪ پایین‌تر؛ هدف ساختاری پیش از مقاومت و فضای آزاد بیش از ۱٪',status(ok,!ok&&nearSupport),suggestion,true);
  }else push('حمایت و مقاومت',DR_NA,'حمایت ۴ساعته/روزانه نزدیک و مقاومت ساختاری معتبر','na','داده معتبر ۱ساعته در این نوبت آماده نیست؛ علت در جدول کیفیت تایم‌فریم‌ها ثبت شده است.');

  const tableRows=rows.map(r=>`<tr class="review-row ${r.state}">
    <td class="review-factor" data-label="شاخص">${escapeHTML(r.name)}</td>
    <td data-label="وضعیت فعلی"><div class="review-current">${escapeHTML(r.current)}</div><span class="review-state ${r.state}">${stateLabel(r.state)}</span></td>
    <td class="review-ideal" data-label="وضعیت مطلوب">${escapeHTML(r.ideal)}</td>
    <td class="review-advice" data-label="جمع‌بندی و پیشنهاد">${escapeHTML(r.summary)}</td>
  </tr>`).join('');
  const good=rows.filter(r=>r.state==='good').length;
  const wait=rows.filter(r=>r.state==='wait').length;
  const bad=rows.filter(r=>r.state==='bad').length;
  const na=rows.filter(r=>r.state==='na').length;
  const overall=bad?'هنوز چند شرط معاملاتی برقرار نیست':na?'یک یا چند شاخص در این نوبت قابل ارزیابی نیست؛ وضعیت داده در گزارش کیفیت جداگانه آمده است':wait?'نیازمند صبر و بررسی دوباره':'هر ۶ بررسی مثبت است؛ تأیید ماشه و کنترل ریسک همچنان لازم است';
  return `<section class="six-review" aria-label="جدول شش شاخص بررسی رمزارز">
    <div class="six-review-head"><div><div class="six-review-title">🔎 بررسی سریع ۶ شاخص برای معامله لانگ</div><div class="six-review-sub">مقادیر بر اساس آخرین کندل بسته و داده بازار دریافت‌شده محاسبه می‌شوند.</div></div><div class="six-review-counts"><span class="good">مطلوب ${good}</span><span class="wait">صبر ${wait}</span><span class="bad">نامطلوب ${bad}</span><span class="na">نامشخص ${na}</span></div></div>
    <div class="six-review-wrap"><table class="six-review-table"><thead><tr><th>شاخص</th><th>وضعیت فعلی رمزارز</th><th>وضعیت مطلوب</th><th>جمع‌بندی و پیشنهاد</th></tr></thead><tbody>${tableRows}</tbody></table></div>
    <div class="six-review-footer"><b>جمع‌بندی:</b> ${escapeHTML(overall)}<span> این جدول ابزار غربال‌گری است و به‌تنهایی دستور خرید صادر نمی‌کند.</span></div>
  </section>`;
}
function computeDecision(coin,analysis){
  const f=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):null;
  const h1=analysis?.tfMap?.['1h'],h4=analysis?.tfMap?.['4h'],risk=analysis?.risk,mtf=analysis?.mtf;
  const v1=!!h1&&isTimeframeValid(h1,'1h'),v4=!!h4&&isTimeframeValid(h4,'4h');
  const m1=v1?h1.metrics:null,m4=v4?h4.metrics:null;
  let hist=null,histPrev=null;
  if(v1){try{const mm=macdSeries(h1.candles.map(c=>c.c));hist=mm.hist.at(-1);histPrev=mm.hist.at(-2)}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}}
  const rows=[];
  const add=(name,need,val,ok,hard=true)=>rows.push({name,need,val:val??DR_NA,ok:val==null?null:ok,hard});
  add('روند ۴ساعته','امتیاز ≥ '+RULES.trend,v4?f(h4.trendScore,0):null,v4&&h4.trendScore>=RULES.trend,true);
  add('روند ۱ساعته','امتیاز ≥ '+RULES.trend,v1?f(h1.trendScore,0):null,v1&&h1.trendScore>=RULES.trend,true);
  add('EMA 9 و 20 (۱ساعته)','EMA9 بالاتر از EMA20',m1?`EMA9=${f(m1.ema9,m1.ema9<1?6:4)} / EMA20=${f(m1.ema20,m1.ema20<1?6:4)}`:null,m1&&m1.ema9>m1.ema20);
  add('RSI یک‌ساعته',`${RULES.rsiMin} تا ${RULES.rsiMax}`,m1?f(m1.rsi):null,m1&&m1.rsi>=RULES.rsiMin&&m1.rsi<=RULES.rsiMax);
  add('ADX و جهت DI چهار‌ساعته',`ADX ≥ ${RULES.adxMin} و +DI بالاتر از −DI؛ ${RULES.adxMin} تا ${RULES.adxPreferredMax} ترجیحی، بدون سقف سخت`,m4?`ADX=${f(m4.adx)} / +DI=${f(m4.plusDI)} / −DI=${f(m4.minusDI)}`:null,m4&&m4.adx>=RULES.adxMin&&m4.plusDI>m4.minusDI);
  const macdOk=m1&&m1.macd>m1.signal&&Number.isFinite(hist)&&hist>0&&Number.isFinite(histPrev)&&hist>histPrev;
  add('MACD یک‌ساعته','مثبت و رو به تقویت',m1&&Number.isFinite(hist)&&Number.isFinite(histPrev)?`هیستوگرام ${f(hist,6)} (قبلی ${f(histPrev,6)})`:null,macdOk,false);
  add('قیمت و ابر ایچیموکو (۱ساعته)','قیمت بالای ابر',m1&&Number.isFinite(m1.cloudTop)?`قیمت ${formatPrice(m1.lastClose)} / سقف ابر ${formatPrice(m1.cloudTop)}`:null,m1&&Number.isFinite(m1.cloudTop)&&m1.lastClose>m1.cloudTop);
  const q1=h1?.candles?.length?computeDataQuality(h1.candles,'1h',Number.isFinite(h1.analysisAsOf)?h1.analysisAsOf:Date.now()).quality:null,q4=h4?.candles?.length?computeDataQuality(h4.candles,'4h',Number.isFinite(h4.analysisAsOf)?h4.analysisAsOf:Date.now()).quality:null;
  const qMin=(q1!=null&&q4!=null)?Math.min(q1,q4):null;
  const risks=[];
  const addR=(name,need,val,ok)=>risks.push({name,need,val:val??DR_NA,ok:val==null?null:ok,hard:true});
  addR('اسپرد',`حداکثر ${(prefs.maxSpread*100).toFixed(2)}٪`,risk&&risk.spread!=null?(risk.spread*100).toFixed(3)+'٪':(risk?'اسپرد از دفتر سفارش قابل محاسبه نیست':'محاسبه ریسک/اسپرد انجام نشده'),risk&&risk.spread!=null&&risk.spread<=prefs.maxSpread);
  const qText=`۱ساعته ${q1==null?'دریافت/اعتبارسنجی نشده':q1+'٪'}؛ ۴ساعته ${q4==null?'دریافت/اعتبارسنجی نشده':q4+'٪'}؛ حداقل کندل و پوشش: ${v1?'۱H معتبر':'۱H نامعتبر'} / ${v4?'۴H معتبر':'۴H نامعتبر'}`;
  addR('اعتبار داده اجباری',`هر دو تایم‌فریم ۱H و ۴H معتبر و کیفیت ≥ ${prefs.minQuality}٪`,qText,v1&&v4&&qMin!=null&&qMin>=prefs.minQuality);
  const rrText=!risk?riskCalculationUnavailableReason(coin,analysis):Number.isFinite(risk.rrNet)?f(risk.rrNet,2):(risk.rrUnavailableReason||'هدف سود خالص معتبر قابل تعیین نیست');
  addR('نسبت سود به زیان خالص',`حداقل ${prefs.minRR}`,rrText,!!risk&&Number.isFinite(risk.rrNet)&&risk.rrNet>=prefs.minRR-1e-6);
  addR('حجم ۲۴ساعته',`حداقل ${prefs.minVolume.toLocaleString('en-US')} USDT`,Number.isFinite(coin.volume)?Math.round(coin.volume).toLocaleString('en-US')+' USDT':'حجم ۲۴ساعته از بازار دریافت نشده',Number.isFinite(coin.volume)&&coin.volume>=prefs.minVolume);
  const entry=risk?.entry??(coin.bestAsk>0?coin.bestAsk:coin.price);
  const support=risk?.support??null;
  const resistance=risk?.ceiling??null;
  const supportDistance=support>0&&entry>0?(entry-support)/entry*100:null;
  const resistanceRoom=Number.isFinite(resistance)&&resistance>0&&entry>0?(resistance-entry)/entry*100:null;
  const supportReady=Number.isFinite(supportDistance)&&supportDistance>=0&&supportDistance<=3;
  const resistanceClear=Number.isFinite(resistanceRoom)&&resistanceRoom>1.0&&risk&&Number.isFinite(risk.takeProfit)&&risk.takeProfit>entry&&resistance>risk.takeProfit;
  addR('حمایت ساختاری','حمایت معتبر حداکثر ۳٪ پایین‌تر از قیمت ورود',supportDistance==null?'حمایت ساختاری معتبر در دسترس نیست':`فاصله حمایت ${supportDistance.toFixed(2)}٪`,supportReady);
  const resistanceText=resistanceRoom==null?(risk?.rrUnavailableReason||'مقاومت بالاسر معتبر قابل شناسایی نیست'):`فاصله مقاومت ${resistanceRoom.toFixed(2)}٪${Number.isFinite(risk?.takeProfit)?'؛ هدف '+formatPrice(risk.takeProfit):'؛ هدف سود معتبر تعیین نشده'}`;
  addR('فضای سود تا مقاومت','مقاومت حداقل ۱٪ بالاتر از ورود و هدف معتبر پیش از مقاومت',resistanceText,resistanceClear);
  const momentumReady=!!macdOk;
  const spreadReady=!!risk&&risk.spread!=null&&risk.spread<=prefs.maxSpread;
  const rrReady=!!risk&&Number.isFinite(risk.rrNet)&&risk.rrNet>=prefs.minRR;
  const entryQuality=Math.round((supportReady?25:0)+(resistanceClear?30:0)+(momentumReady?25:0)+(spreadReady&&rrReady?20:0));

  const hot=[];
  if(m1&&m1.rsi>75)hot.push(`RSI یک‌ساعته ${f(m1.rsi)} بالاتر از ۷۵`);
  if(v1){const c=h1.candles.at(-1);if(m1.atr>0&&(c.h-c.l)>3*m1.atr)hot.push('جهش شدید آخرین کندل ۱ساعته (دامنه بیش از ۳ برابر ATR)')}
  if(risk&&(risk.entry-risk.stopLoss)/risk.entry>0.08)hot.push(`فاصله حد ضرر ${(((risk.entry-risk.stopLoss)/risk.entry)*100).toFixed(1)}٪ بیش از ۸٪`);
  const all=[...rows,...risks];
  const hardFail=all.filter(r=>r.hard&&r.ok!==true);
  const softFail=all.filter(r=>!r.hard&&r.ok!==true);
  const extra=(mtf?.blockReasons||[]).filter(Boolean);
  let cls,title,why,category;
  if(!v1||!v4){cls='no';category='data';title='داده اجباری نامعتبر یا دریافت‌نشده';why=`اعتبار داده اجباری: ${!v1?'۱ساعته نامعتبر/دریافت‌نشده':''}${!v1&&!v4?' و ':''}${!v4?'۴ساعته نامعتبر/دریافت‌نشده':''}. جزئیات علت در جدول کیفیت تایم‌فریم‌ها آمده است.`}
  else if(hot.length){cls='hot';category='risk';title='بیش‌ازحد پرریسک';why=hot.join('؛ ')}
  else if(risk&&!Number.isFinite(risk.rrNet)){cls='no';category='risk_reward';title='فضای سود کافی نیست؛ هدف معتبر تعیین نشده';why=risk.rrUnavailableReason||'مقاومت بالاسر یا بازده خالص قابل محاسبه نیست؛ ورود مسدود است.'}
  else if(hardFail.length){cls='no';category=hardFail.some(r=>/روند|EMA|RSI|ADX|DI|ایچیموکو/.test(r.name))?'trend_momentum':hardFail.some(r=>/فضای سود|نسبت سود|مقاومت|حمایت/.test(r.name))?'risk_reward':'other';title=category==='trend_momentum'?'شرایط روند/مومنتوم تأیید نشده':category==='risk_reward'?'ریسک به بازده یا ساختار قیمت نامناسب است':'عدم ورود؛ یکی از شروط سخت برقرار نیست';why=hardFail.map(r=>`${r.name}: ${r.val}؛ شرط لازم: ${r.need}`).join(' | ')}
  else if(softFail.length){cls='wait';category='confirmation';title='در انتظار تأیید';why=softFail.map(r=>`${r.name}: اکنون ${r.val}؛ لازم است ${r.need}`).join(' | ')}
  else if(extra.length){cls='no';category='other';title='عدم ورود';why=extra.join('؛ ')}
  else{cls='good';category='eligible';title='مناسب بررسی ورود';why='همه شروط جدول بالا برقرارند: '+all.map(r=>`${r.name} (${r.val})`).join('، ')}
  return{rows,risks,cls,title,why,category,entryQuality,supportDistance,resistanceRoom};
}
function buildDataQualityAudit(analysis){
  const tfMap=analysis?.tfMap||{};
  const specs=[['1h','۱ ساعته',true],['4h','۴ ساعته',true],['1d','روزانه',false],['15m','۱۵ دقیقه',false],['5m','۵ دقیقه',false]];
  const rows=specs.map(([key,label,required])=>{
    const snap=timeframeQualitySnapshot(tfMap,key,required);
    let statusText,statusClass;
    if(snap.status==='valid'){statusText='معتبر';statusClass='ok';}
    else if(snap.status==='not_requested'){statusText=required?'دریافت نشده':'در این مرحله درخواست نشده؛ غیرالزامی';statusClass='na';}
    else if(snap.status==='not_loaded'){statusText='داده اجباری دریافت نشده';statusClass='bad';}
    else if(snap.status==='network_error'||snap.status==='stale'){statusText='خطای دریافت / داده کهنه';statusClass='bad';}
    else {statusText='داده دریافت شده، اما معیار کیفیت را نگذرانده';statusClass='bad';}
    const detail=snap.status==='not_requested'||snap.status==='not_loaded'
      ? (required?'داده پایه هنوز در دسترس نیست.':'در اسکن پایه اجباری نیست؛ هنگام نیاز یا بازکردن جزئیات دریافت می‌شود.')
      : `${snap.bars}/${snap.minBars} کندل؛ پوشش ${snap.coveragePercent}٪؛ شکاف کل ${snap.gaps??0}؛ بزرگ‌ترین شکاف ${snap.maxGap??0} کندل؛ فاصله نامنظم ${snap.misaligned??0}؛ سن آخرین کندل ${Number.isFinite(snap.ageSec)?Math.round(snap.ageSec/60)+' دقیقه':'—'}؛ تازگی مجاز ${Math.round(snap.freshnessLimitSec/60)} دقیقه${snap.quality!=null?'؛ امتیاز کیفیت '+snap.quality+'٪':''}`;
    const reason=snap.error?`<div class="dq-reason">${escapeHTML(snap.error)}</div>`:'';
    return `<tr><td data-label="تایم‌فریم"><b>${label}</b>${required?' <small>(اجباری)</small>':' <small>(اختیاری)</small>'}</td><td data-label="وضعیت"><span class="${statusClass==='ok'?'ok':statusClass==='bad'?'bad':'na'}">${statusText}</span></td><td data-label="جزئیات">${escapeHTML(detail)}${reason}</td><td data-label="منبع">${escapeHTML(snap.source||'—')}</td></tr>`;
  }).join('');
  return `<div class="dq-audit"><div class="dr-note">اعتبار داده اجباری فقط بر اساس ۱H و ۴H تعیین می‌شود. نبود داده ۱D، ۱۵m یا ۵m در اسکن پایه به‌تنهایی به معنی «داده ناکافی» نیست؛ این تایم‌فریم‌ها بسته به مرحله تحلیل دریافت می‌شوند.</div><div class="dr-wrap"><table><thead><tr><th>تایم‌فریم</th><th>وضعیت</th><th>جزئیات کیفیت</th><th>منبع</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function buildDecisionReport(coin,analysis){
  const f=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):null;
  const risk=analysis?.risk,mtf=analysis?.mtf;
  const {rows,risks,cls,title,why,entryQuality,supportDistance,resistanceRoom}=computeDecision(coin,analysis);
  const icon=r=>r.ok===true?'<span class="ok">✓ برقرار</span>':r.ok===false?'<span class="bad">✗ برقرار نیست</span>':'<span class="na">— '+DR_NA+'</span>';
  const tbl=list=>`<div class="dr-wrap"><table><thead><tr><th>شاخص</th><th>شرط مطلوب</th><th>مقدار فعلی</th><th>وضعیت</th></tr></thead><tbody>${list.map(r=>`<tr><td data-label="شاخص">${escapeHTML(r.name)}</td><td data-label="شرط مطلوب">${escapeHTML(r.need)}</td><td data-label="مقدار فعلی" dir="ltr" style="text-align:right">${escapeHTML(String(r.val))}</td><td data-label="وضعیت">${icon(r)}</td></tr>`).join('')}</tbody></table></div>`;
  let levels;
  if(risk){
    const res=risk.ceiling;
    const pct=(a,b)=>((a-b)/b*100).toFixed(2)+'٪';
    levels=`<div class="dr-levels">
      <div><span>قیمت ورود پیشنهادی (Ask)</span>${formatPrice(risk.entry)}</div>
      <div><span>حد ضرر</span>${formatPrice(risk.stopLoss)} (${pct(risk.stopLoss,risk.entry)})</div>
      <div><span>حمایت ساختاری (${escapeHTML(risk.supportSource||'منبع نامشخص')})</span>${Number.isFinite(risk.support)?formatPrice(risk.support)+` · ${risk.supportTouches||0} پیوت · قدرت ${risk.supportStrength||0}${risk.supportConfluence?' · هم‌پوشانی ۴ساعته/روزانه':''}`:'حمایت معتبر یافت نشد'}</div>
      <div><span>هدف فروش ساختاری (پیش از مقاومت)</span>${Number.isFinite(risk.takeProfit)?formatPrice(risk.takeProfit)+' (+'+pct(risk.takeProfit,risk.entry)+')':'قابل تعیین نیست'}</div>
      <div><span>مقاومت ساختاری (${escapeHTML(risk.resistanceSource||'منبع نامشخص')})</span>${res?formatPrice(res)+' ('+pct(res,risk.entry)+') · '+(risk.resistanceTouches||0)+' پیوت · قدرت '+(risk.resistanceStrength||0)+(risk.resistanceConfluence?' · هم‌پوشانی ۴ساعته/روزانه':''):'مقاومت معتبر یافت نشد'}</div>
      <div><span>R/R خالص بر مبنای هدف ساختاری</span>${Number.isFinite(risk.structuralRRNet)?risk.structuralRRNet.toFixed(2):'قابل محاسبه نیست'}</div>
      <div><span>مقدار ریسک (خالص)</span>${risk.riskAmount?risk.riskAmount.toFixed(2)+' USDT ('+(risk.riskPct*100).toFixed(2)+'٪ سرمایه)':DR_NA}</div>
    </div>`;
  }else levels=`<div class="dr-note">قیمت ورود، حد ضرر، هدف و مقدار ریسک محاسبه نشده است: ${escapeHTML(riskCalculationUnavailableReason(coin,analysis))}</div>`;
  const score=Number.isFinite(mtf?.trendScore)?mtf.trendScore:null;
  const sixPointReview=buildSixPointReview(coin,analysis);
  return `<section class="dr" aria-label="گزارش نهایی تصمیم معاملاتی">
    ${sixPointReview}
    <div class="dr-head"><div><div class="dr-title">گزارش نهایی تصمیم معاملاتی — ${escapeHTML(coin.symbol)}/USDT</div>
    <div class="dr-note">امتیاز همگرایی چندتایم‌فریمی؛ احتمال برد نیست و سیگنال خرید قطعی محسوب نمی‌شود.</div></div>
    <div class="dr-score">${score!=null?score:'—'}<small> / 100</small></div></div>
    <h4>۱. وضعیت روند و اندیکاتورها (۴ساعته و ۱ساعته)</h4>${tbl(rows)}
    <h4>۲. کنترل ریسک و نقدشوندگی بازار</h4>${tbl(risks)}
    <h4>۳. کیفیت و کفایت داده در هر تایم‌فریم</h4>${buildDataQualityAudit(analysis)}
    <h4>۴. کیفیت مستقل نقطه ورود</h4>
    <div class="dr-note">کیفیت ورود: <b>${entryQuality} از ۱۰۰</b> | فاصله حمایت: ${Number.isFinite(supportDistance)?supportDistance.toFixed(2)+'٪':'نامشخص'} | فضای تا مقاومت: ${Number.isFinite(resistanceRoom)?resistanceRoom.toFixed(2)+'٪':'نامشخص'} — این امتیاز مستقل از امتیاز روند است و شروط حیاتی را دور نمی‌زند.</div>
    <h4>۵. نتیجه نهایی</h4>
    <div class="dr-final ${cls}"><b>${title}</b><br>${escapeHTML(why)}</div>
    <div class="dr-note" style="margin-top:6px">قاعده ورود: روند ۴ساعته و ۱ساعته ≥ ${RULES.trend}، EMA9 بالای EMA20، RSI یک‌ساعته بین ${RULES.rsiMin} تا ${RULES.rsiMax}، ADX چهارساعته حداقل ${RULES.adxMin} و +DI بالاتر از −DI (بدون سقف سخت)، MACD مثبت و رو به تقویت، قیمت بالای ابر، اسپرد ≤ ${(prefs.maxSpread*100).toFixed(2)}٪، کیفیت داده ≥ ${prefs.minQuality}٪، حمایت/مقاومت ساختاری ۴ساعته یا روزانه و R/R خالص واقعی ≥ ${prefs.minRR}. هدف سود از مقاومت ساختاری نزدیک و با حاشیه احتیاط تعیین می‌شود؛ در نبود فضای کافی، نسبت سود به زیان رد خواهد شد. RSI بالای ۷۵، کندل جهشی یا حد ضرر دورتر از ۸٪ همچنان پرریسک محسوب می‌شود.</div>
    <h4>۶. سطوح پیشنهادی معامله</h4>${levels}
    <div class="dr-note" style="margin-top:8px">⚠ این آستانه‌ها پیشنهادی‌اند و هنوز با آمار واقعی آزموده نشده‌اند. تایم‌فریم ۵ دقیقه‌ای به‌تنهایی مجوز ورود نمی‌دهد. توصیه مالی نیست.</div>
  </section>`;
}

function openDetailModal(coin){
  const analysis=analysisCache.get(coin.id);
  const mtf=analysis?.mtf;
  const risk=analysis?.risk;
  modalCurrentCoin = coin;
  live.bookSym=coin.nobitexSymbol; wsSync();

  modalTitle.textContent=`${coin.symbol} / USDT`;
  modalSub.textContent=`${coin.name} • ${coin.rankSource||'حجم تتری'} • ${mtf?.alignment||'در حال تحلیل'} • Snapshot: ${analysis?.snapshotId||'در دسترس نیست'}`;
  $('detailModal').dataset.snapshotId=analysis?.snapshotId||'';

  const tfKeys = Object.keys(TIMEFRAMES);
  tfSelectors.innerHTML = tfKeys.map(k=>{
    const tf=analysis?.tfMap?.[k];
    const disabled = !(tf?.candles?.length>=2);
    return `<button class="tf-sel-btn" data-tf="${k}" ${disabled?'disabled style="opacity:.4;cursor:not-allowed"':''}>${TIMEFRAMES[k].label}${disabled?' ✕':''}</button>`;
  }).join('');

  tfSelectors.querySelectorAll('button[data-tf]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.disabled) return;
      tfSelectors.querySelectorAll('button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderModalChart(coin, analysis, btn.dataset.tf);
    });
  });

  const ichiM = analysis?.tfMap?.['1h']?.metrics;
  const ichiScore = ichiM?.ichimokuScore;
  const ichiLabels = ichiM?.ichimokuLabels?.join(' • ') || '—';

  modalGrid.innerHTML=`
    <div class="item"><div class="label">قیمت نوبیتکس</div><div class="value" id="mPrice">$${formatPrice(coin.price)}</div></div>
    <div class="item"><div class="label">تغییر ۲۴ساعته</div><div class="value">${formatChange(coin.change24h)}</div></div>
    <div class="item"><div class="label">حجم ۲۴ساعته</div><div class="value">$${(coin.volume||0).toLocaleString('en-US',{maximumFractionDigits:0})}</div></div>
    <div class="item"><div class="label">Ask / Bid</div><div class="value"><span id="mAsk">$${formatPrice(coin.bestAsk)}</span> / <span id="mBid">$${formatPrice(coin.bestBid)}</span></div></div>
    <div class="item"><div class="label">اسپرد Snapshot</div><div class="value" id="mSpread">${Number.isFinite(risk?.spread)?(risk.spread*100).toFixed(3)+'%':'نامعتبر'}</div></div>
    <div class="item"><div class="label">جریان معاملات ۶۰ ثانیه اخیر</div><div class="value" id="mTradeFlow">در انتظار معاملات زنده</div></div>
    <div class="item"><div class="label">همگرایی MTF</div><div class="value"><span class="mtf-score ${scoreTone(mtf?.trendScore)}">${Number.isFinite(mtf?.trendScore)?mtf.trendScore:'—'}</span></div></div>
    <div class="item"><div class="label">کیفیت داده</div><div class="value">${mtf?.quality??0}%</div></div>
    <div class="item" style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;"><button type="button" id="registerPurchasedTradeBtn" class="refresh-btn" style="padding:12px 18px;font-weight:800;">✓ خرید انجام شد؛ ثبت در دفتر معاملات</button></div>
    <div class="item"><div class="label">تایم‌فریم‌های اصلی معتبر</div><div class="value">${mtf?.decisionValidCount??0}/2</div></div>
    <div class="item"><div class="label">امتیاز Ichimoku (1H)</div><div class="value"><span class="ichi-score ${ichiTone(ichiScore)}">${Number.isFinite(ichiScore)?Math.round(ichiScore):'—'}</span></div></div>
    <div class="item" style="grid-column:span 3;"><div class="label">وضعیت Ichimoku</div><div class="value" style="direction:rtl;text-align:right;font-size:0.72rem;">${escapeHTML(ichiLabels)}</div></div>
  `;
  const purchaseBtn=$('registerPurchasedTradeBtn');
  if(purchaseBtn){purchaseBtn.disabled=!(analysis&&risk&&risk.entry>0&&risk.stopLoss>0&&risk.takeProfit>0);purchaseBtn.title=purchaseBtn.disabled?'سطوح تحلیلی معتبر هنوز آماده نیستند':'';purchaseBtn.onclick=()=>registerPurchasedTrade(coin,analysis);}
  const backtestButton=$('runBacktestBtn');if(backtestButton)backtestButton.onclick=()=>runBacktestPair(coin,analysis);
  const parityButton=$('indicatorParityBtn');if(parityButton)parityButton.onclick=()=>{const x=runIndicatorParityChecks();$('indicatorParityResults').innerHTML=`<b>${x.pass?'آزمون مرجع داخلی موفق':'اختلاف عددی یافت شد'}</b><div>${x.results.map(r=>`${r.name}: خطای بیشینه ${r.max.toExponential(2)} (${r.count} مقدار)`).join('<br>')}</div><small>${x.reference}</small>`;};

  try{$('decisionReport').innerHTML=buildDecisionReport(coin,analysis)}catch(e){$('decisionReport').innerHTML='<div class="dr-note">گزارش نهایی: '+escapeHTML(e.message)+'</div>';eventLog('گزارش نهایی '+coin.symbol+': '+e.message)}
  if(mtf?.blockReasons?.length){
    gateInfo.innerHTML=`<div class="gate-info">⛔ ${escapeHTML(mtf.blockReasons.join('؛ '))}</div>`;
  } else if(mtf?.eligible){
    gateInfo.innerHTML=`<div class="gate-info ok">✅ تمام دروازه‌های اجباری عبور شده‌اند</div>`;
  } else {
    gateInfo.innerHTML='';
  }

  // ✅ کارت فیبوناچی
  const fibData = analysis?.tfMap?.['1h']?.metrics?.fib;
  if(fibData && fibData.levels){
    fibCard.style.display='block';
    fibGrid.innerHTML = fibData.levels.map(lv=>{
      const isNearest = fibData.nearest && Math.abs(lv.p - fibData.nearest.p) < 0.001;
      return `<div class="fib-item ${isNearest?'nearest':''}">
        <div class="p">${lv.label}</div>
        <div class="v">$${formatPrice(lv.price)}</div>
      </div>`;
    }).join('');
  } else {
    fibCard.style.display='none';
  }

  if(risk){
    riskCard.style.display='block';
    const rrCls = risk.rrNet>=1.5?'var(--green)':(risk.rrNet>=1?'var(--yellow)':'var(--red)');
    riskGrid.innerHTML=`
      <div class="risk-item"><div class="k">ورود (Ask)</div><div class="v" style="color:var(--accent);">$${formatPrice(risk.entry)}</div></div>
      <div class="risk-item"><div class="k">حد ضرر</div><div class="v" style="color:var(--red2);">$${formatPrice(risk.stopLoss)}</div></div>
      <div class="risk-item"><div class="k">هدف ساختاری</div><div class="v" style="color:var(--green);">$${formatPrice(risk.takeProfit)}</div></div>
      <div class="risk-item"><div class="k">R/R ناخالص</div><div class="v">${risk.rrGross?risk.rrGross.toFixed(2):'—'}</div></div>
      <div class="risk-item"><div class="k">R/R خالص</div><div class="v" style="color:${rrCls};">${risk.rrNet?risk.rrNet.toFixed(2):'—'}</div></div>
      <div class="risk-item"><div class="k">ATR 14</div><div class="v">$${formatPrice(risk.atr)}</div></div>
      <div class="risk-item"><div class="k">کف ساختاری</div><div class="v">$${formatPrice(risk.structLow)}</div></div>
      <div class="risk-item"><div class="k">مقاومت / سقف محاسباتی</div><div class="v">$${formatPrice(risk.ceiling)}</div></div>
      <div class="risk-item"><div class="k">اسپرد Snapshot</div><div class="v">${Number.isFinite(risk.spread)?(risk.spread*100).toFixed(3)+'%':'—'}</div></div>
      <div class="risk-item"><div class="k">کارمزد کل</div><div class="v">${(risk.feeRate*200).toFixed(2)}%</div></div>
      <div class="risk-item"><div class="k">لغزش کل</div><div class="v">${(risk.slippageRate*200).toFixed(2)}%</div></div>
      <div class="risk-item"><div class="k">اندازه موقعیت</div><div class="v">${risk.positionSize?risk.positionSize.toFixed(6):'—'}</div></div>
      <div class="risk-item"><div class="k">سرمایه فرضی</div><div class="v">$${risk.capital}</div></div>
      <div class="risk-item" style="grid-column:1/-1"><div class="k">شناسه Snapshot تحلیل</div><div class="v" style="font-size:.68rem;direction:ltr">${escapeHTML(analysis?.snapshotId||'—')}</div></div>
    `;
  } else {
    riskCard.style.display='none';
  }

  const parts=[];
  if(mtf){
    parts.push(`روند: ${mtf.label.label} (${mtf.trendScore}/100)`);
    parts.push(`شواهد برگشت صعودی: ${mtf.reversalScore}/100  •  نزولی: ${mtf.bearishReversalScore}/100`);
    parts.push(`چیدمان: ${mtf.alignment}  •  تایم‌فریم‌های اصلی معتبر: ${mtf.decisionValidCount??0}/2  •  کیفیت: ${mtf.quality}%`);
    parts.push(`دروازه‌ها: داده ${mtf.gates?.dataValid?'✓':'✗'}  •  رژیم ۴ساعته ${mtf.gates?.regimeOK?'✓':'✗'}`);
    parts.push(`سیگنال: ${mtf.signal}`);
  } else {
    parts.push('داده OHLCV هنوز کامل نشده است...');
  }
  analysisText.textContent=parts.join('\n');

  const sigClass=mtf?.eligible?'strong-buy':(['blocked','riskblocked','reject','insufficient'].includes(mtf?.signalKey)?'blocked':'hold');
  const primaryState=mtf?.eligible?'آماده':(['blocked','riskblocked','reject','insufficient'].includes(mtf?.signalKey)?'ردشده':'در انتظار');
  signalBadge.innerHTML=`<span class="signal ${sigClass}" title="${escapeHTML(mtf?.gateReason||mtf?.signal||'')}">🔔 ${primaryState}</span>`;

  tfDetailHost.innerHTML=Object.keys(TIMEFRAMES)
    .map(k=>renderTimeframeDetail(k, analysis?.tfMap?.[k]))
    .join('');

  modalOverlay.classList.add('active');
  if(document.activeElement===document.body)modalClose.focus();

  setTimeout(()=>{
    if(!modalOverlay.classList.contains('active')||modalCurrentCoin?.id!==coin.id)return;
    const firstReady = (modalCurrentTf&&analysis?.tfMap?.[modalCurrentTf]?.candles?.length>=2)?modalCurrentTf:Object.keys(TIMEFRAMES).find(k=>analysis?.tfMap?.[k]?.candles?.length>=2);
    if(firstReady){
      const btn=tfSelectors.querySelector(`button[data-tf="${firstReady}"]`);
      if(btn){ btn.classList.add('active'); }
      renderModalChart(coin, analysis, firstReady);
    } else {
      renderModalChart(coin, analysis);
    }
  }, 50);
}

function closeModal(){
  modalOverlay.classList.remove('active');
  if(modalChartResizeObserver){ modalChartResizeObserver.disconnect(); modalChartResizeObserver=null; }
  if(modalChartInstance){ try{ modalChartInstance.remove(); }catch(e){eventLog('آزادسازی نمودار قبلی ناموفق بود: '+String(e?.message||e).slice(0,100),'info')} modalChartInstance=null; }
  modalChart.innerHTML='';if($('marketLayers')){$('marketLayers').innerHTML='';$('marketLayers').hidden=true;}
  live.bookSym=null; wsSync();
  modalCurrentCoin=null; modalCurrentTf=null;
}

// =========================================================
// WEBSOCKET
// =========================================================
const live={ws:null,id:0,retry:0,timer:null,sub:new Set(),bookSym:null,ok:false,pending:new Map(),tradeTape:new Map(),candleBars:new Map(),lastCandleAt:0,lastTradeAt:0};
const dirty=new Set(); let liveTimer=null;
function markDirty(c){ dirty.add(c.id); if(!liveTimer) liveTimer=setTimeout(flushLive,800); }
function flushLive(){
  liveTimer=null;
  for(const id of dirty){
    const c=coinById.get(id); if(!c) continue;
    const p=document.querySelector(`[data-p="${CSS.escape(id)}"]`);
    if(p){
      const prev=num(p.dataset.v); p.dataset.v=c.price; p.textContent='$'+formatPrice(c.price);
      if(c.price!==prev){ p.classList.remove('fu','fd'); void p.offsetWidth; p.classList.add(c.price>prev?'fu':'fd'); }
    }
    const ch=document.querySelector(`[data-c="${CSS.escape(id)}"]`);
    if(ch){ ch.className='change '+changeClass(c.change24h); ch.textContent=formatChange(c.change24h); }
    const rec=analysisCache.get(c.id);
    if(rec){
      finalizeRecord(c,rec);
      const row=p?.closest('tr[data-id]');
      if(row){
        row.dataset.snapshotId=rec.snapshotId||'';row.title='Snapshot: '+(rec.snapshotId||'—');
        const values={entry:rec.risk?.entry,stopLoss:rec.risk?.stopLoss,target:rec.risk?.takeProfit,ceiling:rec.risk?.ceiling,spread:rec.risk?.spread,rrNet:rec.risk?.rrNet,snapshotId:rec.snapshotId};
        for(const [key,value] of Object.entries(values)){const cell=row.querySelector(`[data-risk-value="${key}"]`);if(cell)cell.textContent=key==='snapshotId'?String(value||'—').slice(0,10):Number.isFinite(value)?(key==='rrNet'?value.toFixed(2):key==='spread'?(value*100).toFixed(3)+'٪':formatPrice(value)):'—';if(key==='snapshotId')cell.title=String(value||'');}
        const rrCell=row.querySelector('[data-risk-value="rrNet"]');if(rrCell){rrCell.className='risk-badge '+(Number.isFinite(values.rrNet)?(values.rrNet>=1.5?'ok':values.rrNet>=1?'warn':'bad'):'');}
        const state=row.querySelector('[data-risk-value="state"]');if(state){const rejected=['blocked','riskblocked','reject','insufficient'].includes(rec.mtf?.signalKey)||rec.mtf?.gateBlocked&&!rec.mtf?.eligible;state.textContent=rec.mtf?.eligible?'آماده':rejected?'ردشده':'در انتظار';state.className='signal '+(rec.mtf?.eligible?'strong-buy':rejected?'blocked':'hold');state.title=rec.mtf?.gateReason||rec.mtf?.signal||'';}
      }
    }
    if(modalCurrentCoin && modalCurrentCoin.id===id){
      const set=(i,v)=>{ const e=$(i); if(e) e.textContent='$'+formatPrice(v); };
      set('mPrice',c.price);set('mBid',c.bestBid);set('mAsk',c.bestAsk);
      const flow=$('mTradeFlow');if(flow)flow.textContent=tradeFlowLabel(c.nobitexSymbol);
      const r=rec?.risk,sp=$('mSpread');if(sp)sp.textContent=Number.isFinite(r?.spread)?(r.spread*100).toFixed(3)+'%':'نامعتبر';
      if(rec)refreshOpenModal(false);
    }
  }
  dirty.clear();
}
function bookPrice(x){ return num(Array.isArray(x)?x[0]:(x?.price??x?.p)); }
function candleResolution(tf){return ({'5m':'5','15m':'15','1h':'60','4h':'240'})[tf]||null;}
function tradeFlowLabel(symbol){
  const rows=(live.tradeTape.get(symbol)||[]).filter(x=>Date.now()-x.time<=60000);
  if(!rows.length)return 'داده کافی نیست';
  let buy=0,sell=0;for(const x of rows){if(x.type==='buy')buy+=x.volume;else if(x.type==='sell')sell+=x.volume;}
  const total=buy+sell;if(!total)return 'حجم صفر';
  return `خرید ${(buy/total*100).toFixed(0)}٪ • فروش ${(sell/total*100).toFixed(0)}٪ • ${rows.length} معامله`;
}
async function ingestLiveCandle(symbol,tfKey,data){
  const tf=TIMEFRAMES[tfKey];if(!tf||!data||!['t','o','h','l','c','v'].every(k=>data[k]!==undefined))return;
  let stamp=num(data.t,NaN);if(stamp>1e12)stamp=Math.floor(stamp/1000);
  const normalized=normalizeNobitex({s:'ok',t:[stamp],o:[data.o],h:[data.h],l:[data.l],c:[data.c],v:[data.v]},tfKey);
  if(!normalized.length)return;
  const bar=normalized[0],key=symbol+'|'+tfKey;
  try{
    const rec=await dbGet('candles',key);let bars=validateCachedCandles(rec?.candles||[],tfKey);
    const previous=live.candleBars.get(key);const changed=previous!==undefined&&previous!==bar.t;
    live.candleBars.set(key,bar.t);const map=new Map(bars.map(x=>[x.t,x]));map.set(bar.t,bar);
    bars=[...map.values()].sort((a,b)=>a.t-b.t).slice(-600);
    await dbPut('candles',{key,sym:symbol,tf:tfKey,candles:bars,fetchedAt:Date.now(),validation:{invalid:0,duplicates:0},networkError:null,source:'WebSocket'});
    live.lastCandleAt=Date.now();
    // Re-run the selected coin after a new bar begins; the prior bar is then closed.
    if(changed&&modalCurrentCoin?.nobitexSymbol===symbol&&!modalBusy&&!analysisInflight.has(modalCurrentCoin.id)){
      if(live.reanalyseTimer)clearTimeout(live.reanalyseTimer);
      live.reanalyseTimer=setTimeout(async()=>{const coin=modalCurrentCoin;if(!coin||coin.nobitexSymbol!==symbol||modalBusy)return;try{await analyzeCoin(coin,false,true);if(modalCurrentCoin?.nobitexSymbol===symbol){modalRefreshAt=0;refreshOpenModal()}}catch(e){eventLog(symbol+' '+tfKey+' WS: '+e.message)}},1800);
    }
  }catch(e){eventLog('ذخیره کندل زنده '+symbol+' '+tfKey+': '+e.message)}
}
function handlePush(channel,data){
  if(typeof data==='string'){try{data=JSON.parse(data)}catch{return}}
  if(channel==='public:market-stats-all'){
    const raw=data?.stats||data?.marketStats||data;if(!raw||typeof raw!=='object')return;
    let stats;try{stats=statsMap(raw,Date.now());latestMarketStats=stats}catch{return}
    live.lastDataAt=Date.now();marketHealthy=true;diag.ws='✓ آمار زنده بازار';
    if(!allCoins.length){setUniverse(augmentUniverseWithWatchlist(buildUniverse(null,stats),stats));countBadge.textContent=`${allCoins.length} بازار تتری؛ WS`;loadingState.style.display='none';tableContainer.style.display='block';startAnalysis();scheduleRender()}
    for(const st of stats.values()){const c=coinBySym.get(st.symbol);if(!c)continue;Object.assign(c,{price:st.lastPrice,dayOpen:st.dayOpen,change24h:st.change24h,volume:st.volumeQuote,high24h:st.high,low24h:st.low,bestBid:st.bestBid,bestAsk:st.bestAsk,quoteAt:st.quoteAt,priceAt:st.priceAt});markDirty(c)}
    for(const [key,v] of Object.entries(raw)){if(!v?.isClosed)continue;const symbol=key.toUpperCase().replace(/[-_/]/g,''),c=coinBySym.get(symbol);if(c){c.marketClosed=true;c.quoteAt=0}}
    renderDiag();return;
  }
  if(channel.startsWith('public:orderbook-')){
    const c=coinBySym.get(channel.slice('public:orderbook-'.length));if(!c)return;
    const asks=(data?.asks||[]).map(bookPrice).filter(p=>p>0),bids=(data?.bids||[]).map(bookPrice).filter(p=>p>0);
    if(asks.length&&bids.length){c.bestAsk=Math.min(...asks);c.bestBid=Math.max(...bids);c.quoteAt=Date.now();markDirty(c)}return;
  }
  if(channel.startsWith('public:candle-')){
    const m=channel.match(/^public:candle-([A-Z0-9]{1,24}USDT)-(5|15|60|240)$/);if(!m)return;
    const tf=({'5':'5m','15':'15m','60':'1h','240':'4h'})[m[2]];if(tf)void ingestLiveCandle(m[1],tf,data);return;
  }
  if(channel.startsWith('public:trades-')){
    const symbol=channel.slice('public:trades-'.length);if(!/^[A-Z0-9]{1,24}USDT$/.test(symbol))return;
    const time=num(data?.time,Date.now());const row={time:time>1e12?time:time*1000,price:num(data?.price),volume:num(data?.volume),type:String(data?.type||'').toLowerCase()};
    if(!row.price||!row.volume||!['buy','sell'].includes(row.type))return;
    const tape=live.tradeTape.get(symbol)||[];tape.push(row);const cutoff=Date.now()-60000;live.tradeTape.set(symbol,tape.filter(x=>x.time>=cutoff).slice(-500));live.lastTradeAt=Date.now();
    if(modalCurrentCoin?.nobitexSymbol===symbol){const el=$('mTradeFlow');if(el)el.textContent=tradeFlowLabel(symbol)}return;
  }
}
function wsSend(o){if(live.ws&&live.ws.readyState===1)live.ws.send(JSON.stringify(o));}
function wsSync(){
  if(!live.ok)return;live.pending??=new Map();const wanted=new Set(['public:market-stats-all']);
  if(live.bookSym){wanted.add('public:orderbook-'+live.bookSym);wanted.add('public:trades-'+live.bookSym);for(const tf of ['5m','15m','1h','4h'])wanted.add(`public:candle-${live.bookSym}-${candleResolution(tf)}`)}
  for(const channel of wanted){if(live.sub.has(channel)||[...live.pending.values()].some(p=>p.channel===channel&&p.kind==='subscribe'))continue;const id=++live.id;live.pending.set(id,{channel,kind:'subscribe'});wsSend({id,subscribe:{channel}})}
  for(const channel of [...live.sub])if(!wanted.has(channel)){wsSend({id:++live.id,unsubscribe:{channel}});live.sub.delete(channel)}
}
function wsConnect(){if((document.hidden&&!mayRunWhenHidden())||live.ws&&live.ws.readyState<=1)return;let ws;try{ws=new WebSocket(WS_URL)}catch{diag.ws='اتصال ناموفق';renderDiag();return}live.ws=ws;live.pending=new Map();diag.ws='در حال اتصال';renderDiag();let closed=false;const down=()=>{if(closed||live.ws!==ws)return;closed=true;live.ws=null;live.ok=false;live.sub.clear();live.pending.clear();try{ws.close()}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}diag.ws='قطع؛ تلاش مجدد';renderDiag();if((!document.hidden||mayRunWhenHidden())&&!live.timer)live.timer=setTimeout(()=>{live.timer=null;wsConnect()},Math.min(60000,1000*2**Math.min(6,live.retry++)))};ws.onopen=()=>ws.send(JSON.stringify({id:++live.id,connect:{name:'NobitexScanner-v5'}}));ws.onmessage=event=>{for(const line of String(event.data).split('\n')){let m;try{m=JSON.parse(line)}catch{continue}if(m.connect){live.ok=true;live.retry=0;diag.ws='✓ متصل؛ منتظر داده';renderDiag();wsSync()}else if(m.error){const p=live.pending.get(m.id);if(p)live.pending.delete(m.id);eventLog('خطای اشتراک WS: '+(m.error.message||m.error.code));if(p?.kind==='subscribe')diag.ws='خطای اشتراک';renderDiag()}else if(m.subscribe&&live.pending.has(m.id)){const p=live.pending.get(m.id);live.sub.add(p.channel);live.pending.delete(m.id)}else if(m.push?.channel)handlePush(m.push.channel,m.push.pub?.data);else if(!Object.keys(m).length&&ws.readyState===1)ws.send('{}')}};ws.onclose=down;ws.onerror=down;}

// =========================================================
// REFRESH / INIT
// =========================================================
function startAnalysis(){
  if(allCoins.length && !analysisLoopRunning){ analysisLoopShouldRun=true; analysisLoop(); }
}
async function refreshData(){if(refreshInFlight||(document.hidden&&!mayRunWhenHidden()))return;refreshInFlight=true;refreshBtn.disabled=true;try{statusDot.className='dot yellow';statusText.textContent='دریافت آمار بازار';const stats=await fetchNobitexMarketStats();latestMarketStats=stats;const cachedCg=prefs.useCoinGecko?(await dbGet('meta','cgList'))?.list:null;setUniverse(augmentUniverseWithWatchlist(buildUniverse(cachedCg,stats),stats));if(!diagnosticRunInitialized){beginDiagnosticRun();diagnosticRunInitialized=true;}for(const id of analysisCache.keys())if(!coinById.has(id))analysisCache.delete(id);marketHealthy=true;lastMarketAt=Date.now();countBadge.textContent=`${allCoins.length} بازار تتری`;lastUpdateEl.textContent=new Date(lastMarketAt).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'})+' | '+new Date(lastMarketAt).toISOString().replace('T',' ').slice(0,19)+' UTC';loadingState.style.display='none';tableContainer.style.display='block';renderTable(allCoins);updateAnalysisStatus();statusDot.className='dot green';statusText.textContent='آمار بازار تازه است';await dbPut('meta',{key:'universe',coins:allCoins,ts:lastMarketAt});if(prefs.useCoinGecko)fetchTopCoins().then(()=>renderDiag());wsConnect();wsSync()}catch(error){marketHealthy=live.ok&&Date.now()-(live.lastDataAt||0)<90000;statusDot.className=marketHealthy?'dot yellow':'dot red';statusText.textContent=marketHealthy?'REST ناموفق؛ دریافت WS برقرار است':allCoins.length?'خطای دریافت؛ نمایش داده ذخیره‌شده':'اتصال ناموفق';eventLog(error.message);if(allCoins.length){renderTable(allCoins)}else{loadingState.style.display='block';tableContainer.style.display='none';loadingState.innerHTML=`<div style="color:#ff8a8a">${escapeHTML(error.message)}</div><p style="margin-top:12px;line-height:2">برای اتصال از رایانه، بسته را کامل استخراج و Start-Windows.cmd را اجرا کنید. یا در «اتصال و ریسک» یک واسط اختصاصی معتبر وارد کنید. تغییر VPN به‌تنهایی محدودیت Origin مرورگر را رفع نمی‌کند.</p>`}}finally{startAnalysis();refreshInFlight=false;refreshBtn.disabled=false;renderDiag()}}

function initSortHeaders(){
  document.querySelectorAll('th.sortable').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key=th.dataset.sort;
      if(sortState.key===key){ sortState.dir=sortState.dir==='asc'?'desc':'asc'; }
      else { sortState={key, dir:'asc'}; }
      document.querySelectorAll('th.sortable').forEach(x=>x.classList.remove('sort-asc','sort-desc'));
      th.classList.add(sortState.dir==='asc'?'sort-asc':'sort-desc');
      if(allCoins.length) renderTable(allCoins);
    });
  });
  const rankTh=document.querySelector('th.sortable[data-sort="rank"]');
  if(rankTh) rankTh.classList.add('sort-asc');
}

function init(){installJournalButton();installDiagnosticsButton();try{PROXY=validProxy(PROXY)}catch(error){PROXY='';LS('proxyUrl','');eventLog('واسط اختصاصی نامعتبر بود و غیرفعال شد: '+String(error?.message||error).slice(0,120),'info')}initSortHeaders();renderDiag();loadingState.style.display='block';tableContainer.style.display='none';countBadge.textContent='در انتظار بازار واقعی';analysisBadge.textContent='تحلیل: ۰';(async()=>{await idbOpen();await hydrateDiagnosticHistory();await restoreBackgroundMonitor();renderDiag();dbPrune().catch(error=>eventLog('پاک‌سازی کش محلی ناموفق بود: '+String(error?.message||error).slice(0,120),'info'));const cached=await dbGet('meta','universe');if(Array.isArray(cached?.coins)&&cached.coins.length){setUniverse(cached.coins.filter(c=>/^[A-Z0-9]{1,24}USDT$/.test(c.nobitexSymbol)).slice(0,TOP_LIMIT));countBadge.textContent=`${allCoins.length} بازار ذخیره‌شده؛ نیازمند دریافت تازه`;loadingState.style.display='none';tableContainer.style.display='block';renderTable(allCoins)}refreshData()})().catch(e=>eventLog('راه‌اندازی: '+e.message));refreshBtn.addEventListener('click',refreshData);tickerTimer=setInterval(()=>{if(!document.hidden||mayRunWhenHidden())refreshData()},TICKER_REFRESH_MS);for(const control of [trendFilter,signalFilter,hideStable,onlyConfirmed,ichiFilter])control.addEventListener('change',()=>renderTable(allCoins));for(const control of [searchInput,minScoreInput,minRRInput])control.addEventListener('input',debounce(()=>renderTable(allCoins),250));tableBody.addEventListener('click',event=>{const add=event.target.closest('[data-watch-add]');if(add){event.preventDefault();event.stopPropagation();const c=coinBySym.get(add.dataset.watchAdd);if(c)addCoinToWatchlist(c,'table-filter');return;}const row=event.target.closest('tr[data-id]'),coin=row&&coinById.get(row.dataset.id);if(coin)openCoinDetail(coin)});
$('watchManualAddBtn').addEventListener('click',()=>addManualWatchSymbol($('watchManualSymbol').value));$('watchManualSymbol').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addManualWatchSymbol(e.currentTarget.value)}});$('watchAddFilteredBtn').addEventListener('click',addFilteredResultsToWatchlist);$('addEarlyBtn').addEventListener('click',()=>addEarlyMonitorCandidates(false));$('addEarlyQualifiedBtn').addEventListener('click',()=>addEarlyMonitorCandidates(true));$('addAwaitBtn').addEventListener('click',()=>{if(signalFilter.value!=='await'){uiAlert('ابتدا فیلتر سیگنال را روی «در انتظار تأیید ورود» قرار دهید.');return;}const q=(searchInput.value||'').trim().toLowerCase(),trend=trendFilter.value;const candidates=allCoins.map(coin=>({coin,analysis:finalizeRecord(coin,analysisCache.get(coin.id)||null)})).filter(x=>{const m=x.analysis?.mtf;if(m?.signalKey!=='await'||(hideStable.checked&&STABLES.has(String(x.coin.symbol).toUpperCase()))||(q&&!x.coin.symbol.toLowerCase().includes(q)&&!(x.coin.name||'').toLowerCase().includes(q))||(num(minScoreInput.value,0)>0&&(m.quality??0)<num(minScoreInput.value,0))||(num(minRRInput.value,0)>0&&(x.analysis?.risk?.rrNet??0)<num(minRRInput.value,0)))return false;const target={strong_bull:'صعودی قوی',bull:'صعودی',neutral:'خنثی',bear:'نزولی',strong_bear:'نزولی قوی'}[trend];return trend==='all'||(m.label?.label||'نامشخص')===target});if(!candidates.length){uiAlert('با فیلترهای فعلی، ارز واجد شرایطی در انتظار ماشه ورود نیست.');return;}addAwaitCandidates(candidates)});$('exportWatchlistBtn').addEventListener('click',exportWatchlist);$('clearWatchlistBtn').addEventListener('click',async()=>{if(await uiConfirm('تمام ارزهای واچ‌لیست حذف شوند؟')){watchlist=[];saveWatchlist()}});$('monitorCandidatesPanel').addEventListener('click',e=>{const w=e.target.closest('[data-watch-add]');if(w){e.preventDefault();e.stopPropagation();const c=coinBySym.get(w.dataset.watchAdd);if(c)addCoinToWatchlist(c,'monitor-filter');return;}const b=e.target.closest('[data-op-open]');if(b){const c=coinById.get(b.dataset.opOpen);if(c)openCoinDetail(c)}});$('entryOpportunityPanel').addEventListener('click',e=>{const w=e.target.closest('[data-watch-add]');if(w){e.preventDefault();e.stopPropagation();const c=coinBySym.get(w.dataset.watchAdd);if(c)addCoinToWatchlist(c,'opportunity-filter');return;}const b=e.target.closest('[data-op-open]');if(b){const c=coinById.get(b.dataset.opOpen);if(c)openCoinDetail(c)}});$('watchlistBody').addEventListener('click',e=>{const rm=e.target.closest('[data-watch-remove]'),op=e.target.closest('[data-watch-open]');if(rm){watchlist=watchlist.filter(x=>x.symbol!==rm.dataset.watchRemove);saveWatchlist()}else if(op){const c=coinById.get(op.dataset.watchOpen);if(c)openCoinDetail(c)}});renderWatchlist();tableBody.addEventListener('keydown',event=>{if(event.key==='Enter'){const row=event.target.closest('tr[data-id]'),coin=row&&coinById.get(row.dataset.id);if(coin)openCoinDetail(coin)}});modalClose.addEventListener('click',closeModal);modalOverlay.addEventListener('click',e=>{if(e.target===modalOverlay)closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});window.addEventListener('online',()=>{netCooldown=0;refreshData();wsConnect()});document.addEventListener('visibilitychange',()=>{if(document.hidden&&!mayRunWhenHidden())wsStop();else{refreshData();wsConnect();scheduleRender()}});notifBtn.textContent='🔔 اعلان خاموش';notifBtn.addEventListener('click',async()=>{if(notif.enabled)notif.disable();else await notif.enable();notifBtn.classList.toggle('active',notif.enabled);notifBtn.textContent=notif.enabled?'🔔 اعلان فعال':'🔔 اعلان خاموش'});testSoundBtn.textContent='🔊 صدا خاموش';testSoundBtn.title='فعال‌سازی مستقل صدا؛ بدون درخواست مجوز اعلان';testSoundBtn.addEventListener('click',async()=>{if(notif.soundEnabled)notif.soundEnabled=false;else if(await notif.enableSound())notif.beep('buy',true);testSoundBtn.classList.toggle('active',notif.soundEnabled);testSoundBtn.textContent=notif.soundEnabled?'🔊 صدا فعال':'🔊 صدا خاموش'});proxyBtn.textContent='⚙ اتصال و ریسک';proxyBtn.onclick=showSettings;const pause=$('pauseBtn');pause.onclick=()=>{analysisPaused=!analysisPaused;pause.textContent=analysisPaused?'▶ ادامه اسکن':'⏸ توقف اسکن';updateAnalysisStatus()};$('backgroundMonitorBtn').addEventListener('click',()=>setBackgroundMonitorEnabled(!backgroundMonitorEnabled));$('portfolioBacktestBtn')?.addEventListener('click',runPortfolioBacktest);$('eventsBtn').onclick=showEvents;$('modalRetry').onclick=()=>{if(modalCurrentCoin&&!modalBusy)analyzeCoin(modalCurrentCoin,true,true).then(()=>{modalRefreshAt=0;refreshOpenModal();scheduleRender()}).catch(e=>eventLog(e.message))};setInterval(()=>{if(!document.hidden){updateAnalysisStatus();scheduleRender()}},15000);if(opportunityRefreshTimer)clearInterval(opportunityRefreshTimer);opportunityRefreshTimer=setInterval(()=>runOpportunityRefresh().catch(e=>eventLog('موتور فرصت‌یابی: '+e.message,'info')),MONITOR_REFRESH_MS);if(backgroundMonitorStatusTimer)clearInterval(backgroundMonitorStatusTimer);backgroundMonitorStatusTimer=setInterval(()=>{if(backgroundMonitorEnabled)syncBackgroundMonitor()},15000);wsConnect();window.addEventListener('beforeunload',()=>{if(backgroundMonitorEnabled)return;analysisLoopShouldRun=false;clearInterval(tickerTimer);wsStop()});}


// v4 runtime state and helpers
const DEFAULT_PREFS={feeRate:.001,slippageRate:.0015,capital:100,riskPct:.005,minRR:2,minVolume:10000,maxSpread:.004,minQuality:80,useCoinGecko:false,costAssumptionsConfirmed:false};

let prefs=loadPrefs();

function loadPrefs(){let p={};try{p=JSON.parse(LS('nb4:prefs')||'{}')}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}const out={...DEFAULT_PREFS};for(const [k,min,max] of [['feeRate',0,.02],['slippageRate',0,.05],['capital',1,1e9],['riskPct',.0001,.05],['minRR',1,10],['minVolume',0,1e12],['maxSpread',.0001,.1],['minQuality',50,100]]){if(Number.isFinite(p[k]))out[k]=Math.max(min,Math.min(max,p[k]));}if(p.feeRate===.0013)out.feeRate=.001;if(p.capital===1000)out.capital=100;out.useCoinGecko=p.useCoinGecko===true;out.costAssumptionsConfirmed=p.costAssumptionsConfirmed===true;return out;}

function validateCachedCandles(bars,tfKey){if(!Array.isArray(bars))return [];return normalizeNobitex({s:'ok',t:bars.map(b=>b.t/1000),o:bars.map(b=>b.o),h:bars.map(b=>b.h),l:bars.map(b=>b.l),c:bars.map(b=>b.c),v:bars.map(b=>b.v)},tfKey);}

function contiguousTail(candles,tfKey){if(!candles.length)return [];const step=TIMEFRAMES[tfKey].seconds*1000;let i=candles.length-1;while(i>0&&candles[i].t-candles[i-1].t===step)i--;return candles.slice(i);}

function isTimeframeValid(d,k){if(!d?.ready||d.networkError||d.stale||d.validation?.invalid)return false;const asOf=Number.isFinite(d.analysisAsOf)?d.analysisAsOf:Date.now();const q=computeDataQuality(d.candles||[],k,asOf);return q.usable&&q.quality>=prefs.minQuality;}

function snapshotHash(input){let h=2166136261;for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36).toUpperCase()}
function analysisSnapshotMeta(coin,record){
  const h1=record?.tfMap?.['1h'],h4=record?.tfMap?.['4h'];
  const quoteAt=Number(coin?.quoteAt)||0,ask=Number(coin?.bestAsk)||0,bid=Number(coin?.bestBid)||0;
  const fetch1=Number(h1?.fetchedAt)||0,fetch4=Number(h4?.fetchedAt)||0;
  const last1=Number(h1?.lastTime)||0,last4=Number(h4?.lastTime)||0;
  const skew=fetch1&&fetch4?Math.abs(fetch1-fetch4):null;
  const h1Close=last1+3600000,h4Close=last4+14400000;
  const coherent=!!(h1?.ready&&h4?.ready&&last1&&last4&&h4Close<=h1Close&&h1Close-h4Close<=14400000);
  const barSignature=[h1?.candles?.at(-1),h4?.candles?.at(-1)].map(b=>b?[b.t,b.o,b.h,b.l,b.c,b.v].join(':'):'missing').join('|');
  const material=[coin?.nobitexSymbol,record?.stopTf||'1h',quoteAt,ask,bid,coin?.priceAt,last1,last4,barSignature,fetch1,fetch4,prefs.minRR,prefs.feeRate,prefs.slippageRate,prefs.maxSpread,prefs.minVolume,prefs.minQuality,prefs.capital,prefs.riskPct,prefs.costAssumptionsConfirmed].join('|');
  return {id:'S'+snapshotHash(material),createdAt:Date.now(),quoteAt,quoteAgeMs:quoteAt?Math.max(0,Date.now()-quoteAt):null,ask,bid,priceAt:Number(coin?.priceAt)||0,fetch1h:fetch1||null,fetch4h:fetch4||null,last1h:last1||null,last4h:last4||null,frameFetchSkewMs:skew,dataCoherent:coherent,settings:{minRR:prefs.minRR,feeRate:prefs.feeRate,slippageRate:prefs.slippageRate,maxSpread:prefs.maxSpread,minVolume:prefs.minVolume,capital:prefs.capital,riskPct:prefs.riskPct,minQuality:prefs.minQuality,costAssumptionsConfirmed:prefs.costAssumptionsConfirmed}};
}
function validateRiskSnapshot(risk,coin){
  if(!risk)return {valid:false,reasons:['محاسبه ریسک موجود نیست']};
  const reasons=[];
  if(!(Number.isFinite(risk.entry)&&risk.entry>0))reasons.push('قیمت ورود معتبر نیست');
  if(!(Number.isFinite(risk.stopLoss)&&risk.stopLoss>0&&risk.stopLoss<risk.entry))reasons.push('حد ضرر باید پایین‌تر از ورود باشد');
  if(!(Number.isFinite(risk.takeProfit)&&risk.takeProfit>risk.entry))reasons.push('هدف سود باید بالاتر از ورود باشد');
  if(!(Number.isFinite(risk.ceiling)&&risk.ceiling>risk.takeProfit))reasons.push('هدف سود باید پایین‌تر از سقف ساختاری باشد');
  if(!(Number.isFinite(risk.spread)&&risk.spread>=0))reasons.push('اسپرد Snapshot معتبر نیست');
  const ask=Number(coin?.bestAsk),bid=Number(coin?.bestBid);
  if(ask>0&&Math.abs(risk.entry-ask)>Math.max(1e-10,ask*1e-8))reasons.push('قیمت ورود با Ask همین Snapshot یکسان نیست');
  if(ask>0&&bid>0&&ask>=bid){const expected=(ask-bid)/((ask+bid)/2);if(Math.abs(risk.spread-expected)>Math.max(1e-9,expected*1e-6))reasons.push('اسپرد با Bid/Ask همین Snapshot قابل بازتولید نیست');}
  if(!(Number.isFinite(risk.netRisk)&&risk.netRisk>0&&Number.isFinite(risk.netReward)&&risk.netReward>0))reasons.push('ریسک و پاداش خالص معتبر نیستند');
  const recomputed=risk.netRisk>0?risk.netReward/risk.netRisk:NaN;
  if(!(Number.isFinite(risk.rrNet)&&Number.isFinite(recomputed)&&Math.abs(risk.rrNet-recomputed)<=Math.max(1e-8,Math.abs(recomputed)*1e-8)))reasons.push('R/R خالص با نسبت پاداش به ریسک قابل بازتولید نیست');
  return {valid:reasons.length===0,reasons,recomputedRR:Number.isFinite(recomputed)?recomputed:null};
}
const readyGateStability = new Map();
const READY_GATE_CONFIRMATION_MS = 6000;
function confirmReadyGateStability(coin, record) {
  const id = coin?.id;
  const quoteAt = Number(coin?.quoteAt) || 0;
  const one = record?.tfMap?.['1h']?.candles?.at(-1)?.t || 0;
  const four = record?.tfMap?.['4h']?.candles?.at(-1)?.t || 0;
  if (!id || !quoteAt || !one || !four) { if (id) readyGateStability.delete(id); return false; }
  const frameKey = `${one}|${four}`;
  const now = Date.now();
  const previous = readyGateStability.get(id);
  if (!previous || previous.frameKey !== frameKey || quoteAt <= previous.lastQuoteAt) {
    readyGateStability.set(id, { frameKey, since: now, firstQuoteAt: quoteAt, lastQuoteAt: quoteAt, observations: 1 });
    return false;
  }
  previous.lastQuoteAt = quoteAt;
  previous.observations += 1;
  return previous.observations >= 2 && now - previous.since >= READY_GATE_CONFIRMATION_MS;
}

function finalizeRecord(coin,record){
  if(!record)return null;
  const historicalAsOf=Number.isFinite(record.historicalAsOf)?record.historicalAsOf:Date.now();
  record.snapshotMeta=analysisSnapshotMeta(coin,record);record.snapshotId=record.snapshotMeta.id;
  record.risk=computeRisk(coin,record,record.stopTf==='4h'?'4h':'1h');if(record.risk){record.risk.integrity=validateRiskSnapshot(record.risk,coin);record.risk.snapshotId=record.snapshotId;record.risk.snapshotMeta=record.snapshotMeta;record.risk.snapshot={snapshotId:record.snapshotId,createdAt:record.snapshotMeta.createdAt,entry:record.risk.entry,stopLoss:record.risk.stopLoss,target:record.risk.takeProfit,ceiling:record.risk.ceiling,spread:record.risk.spread,rrNet:record.risk.rrNet,recomputedRR:record.risk.integrity.recomputedRR,integrityValid:record.risk.integrity.valid,tfKey:record.risk.tfKey};record.riskSnapshot=record.risk.snapshot;}else{record.riskSnapshot={snapshotId:record.snapshotId,available:false,reason:riskCalculationUnavailableReason(coin,record)};}
  record.mtf=aggregateMTF(record.tfMap,coin,record.risk);
  const m=record.mtf,r=record.risk,blocks=[],EPS=1e-6;
  if(!record.backtestMode&&!marketHealthy)blocks.push('دریافت تازه بازار تأیید نشده است');
  if(coin.marketClosed)blocks.push('بازار نماد بسته است');
  if(m.gateBlocked)blocks.push(m.gateReason);
  if(!record.snapshotMeta.dataCoherent)blocks.push('Snapshot تایم‌فریم‌های ۱H و ۴H هم‌زمان یا هم‌تراز نیست');
  if(historicalAsOf-(coin.quoteAt||0)>90000)blocks.push('آمار خرید و فروش قدیمی است');
  if(!(coin.volume>=prefs.minVolume))blocks.push('حجم روزانه کمتر از حد انتخابی است');
  if(!record.backtestMode&&!prefs.costAssumptionsConfirmed)blocks.push('کارمزد، لغزش و حداقل حجم هنوز برای حساب واقعی بررسی و تأیید نشده‌اند');
  if(!r)blocks.push('محاسبه ریسک معتبر نیست');
  else{
    if(r.integrity?.valid!==true)blocks.push('ناسازگاری داخلی محاسبه ریسک: '+(r.integrity?.reasons||['تطبیق Snapshot ناموفق']).join('؛ '));
    const refCandles=record.tfMap?.[r.tfKey]?.candles||record.tfMap?.['1h']?.candles||[];
    if(!refCandles.length||Math.abs(r.entry-refCandles.at(-1).c)>2*r.atr)blocks.push('فاصله قیمت جاری از کندل مرجع بیش از ۲ ATR است');
    if(r.spread===null||r.spread>prefs.maxSpread)blocks.push('اسپرد نامعتبر یا بیش از حد مجاز است');
    if(!Number.isFinite(r.rrNet)||r.rrNet<prefs.minRR-EPS)blocks.push('نسبت سود به زیان خالص کافی نیست');
    if(r.positionSize<=0||r.notional>prefs.capital+1e-8)blocks.push('اندازه موقعیت معتبر نیست');
  }
  m.eligible=false;m.gates.riskOK=!!r&&r.rrNet>=prefs.minRR-EPS;m.gates.quoteFresh=historicalAsOf-(coin.quoteAt||0)<=90000;m.gates.snapshotCoherent=record.snapshotMeta.dataCoherent;m.blockReasons=blocks;
  if(m.signalKey==='ready'){
    const block=why=>{m.signalKey='riskblocked';m.signal='ردشده؛ '+why;m.signalClass='blocked';m.gateBlocked=true;m.gateReason=why};
    if(blocks.length){readyGateStability.delete(coin.id);block(blocks.join('؛ '));}
    else{const dec=computeDecision(coin,record);if(dec.cls==='good'){
      const stable=record.backtestMode===true||confirmReadyGateStability(coin,record);
      if(stable)m.eligible=true;
      else{m.signalKey='await';m.signal='در انتظار تثبیت شرایط';m.signalClass='hold';m.gateReason='شرایط پایه باید در دست‌کم دو مظنه تازه و با فاصله زمانی حداقل ۶ ثانیه پایدار بماند.';}
    }else if(dec.cls==='hot'||dec.cls==='no'){readyGateStability.delete(coin.id);block(dec.why);}else{readyGateStability.delete(coin.id);m.signalKey='await';m.signal='در انتظار تأیید';m.signalClass='hold';}}
  }
  return record;
}

const frameMeta=new Map(),analysisInflight=new Map();

let networkNext=0,networkBusy=false,networkQueue=[],netTimes=[],netCooldown=0,netFails=0,analysisPaused=false,backgroundMonitorEnabled=false,backgroundMonitorStatusTimer=null;
const BACKGROUND_MONITOR_PREF='nb5:backgroundMonitorEnabled';

const requestInflight=new Map(),eventHistory=[];

const circuits={nobitex:{fails:0,until:0},coingecko:{fails:0,until:0}};

class ApiError extends Error{constructor(message,status=0,retryAfter=30,code=null){super(message);this.status=status;this.retryAfter=retryAfter;this.code=code;}}

function eventLog(message,type='error'){eventHistory.unshift({at:Date.now(),message:String(message).slice(0,600),type});if(eventHistory.length>100)eventHistory.pop();if(type==='error')lastAnalysisError=String(message);}

function requestJob(key,run,priority=0,service='nobitex',intervalMs=0){if(requestInflight.has(key))return requestInflight.get(key);const promise=new Promise((resolve,reject)=>{networkQueue.push({run,priority,resolve,reject,key,service,intervalMs});drainRequests()});requestInflight.set(key,promise);promise.finally(()=>requestInflight.delete(key)).catch(()=>{});return promise;}

async function drainRequests(){
  if(networkBusy)return;networkBusy=true;
  try{
    while(networkQueue.length){
      networkQueue.sort((a,b)=>b.priority-a.priority);
      const job=networkQueue.shift(),circuit=circuits[job.service];
      const requestedFloor=Math.max(250,Number(job.intervalMs)||(job.service==='nobitex'?NOBITEX_DEFAULT_INTERVAL_MS:1000));
      let settled=false,attempt=0;
      while(!settled&&attempt<2){
        try{
          if(Date.now()<circuit.until){
            const wait=Math.max(0,circuit.until-Date.now());
            if(job.service==='nobitex')netCooldown=circuit.until;
            await sleep(wait+250);
          }
          const run=async()=>{
            const previous=num(LS('nb4:lastRequest'),0);
            const floor=Math.max(requestedFloor,Number(circuit.intervalMs)||0);
            await sleep(Math.max(0,Math.max(networkNext,previous+floor)-Date.now()));
            const startedAt=Date.now();
            networkNext=startedAt+floor;
            LS('nb4:lastRequest',String(startedAt));
            netTimes.push(startedAt);
            return job.run();
          };
          const value=navigator.locks?await navigator.locks.request('nb4:network',run):await run();
          circuit.fails=0;circuit.until=0;
          circuit.successStreak=(circuit.successStreak||0)+1;
          // After a sustained clean run, cautiously recover toward the configured floor.
          if(circuit.intervalMs&&circuit.successStreak>=40){
            circuit.intervalMs=Math.max(requestedFloor,circuit.intervalMs-100);
            circuit.successStreak=0;
          }
          if(job.service==='nobitex'){netFails=0;netCooldown=0;}
          job.resolve(value);settled=true;
        }catch(e){
          attempt++;circuit.fails++;circuit.successStreak=0;
          if(e.status===429){
            const waitSec=Math.max(1,Math.min(3600,Number(e.retryAfter)||30));
            circuit.until=Date.now()+waitSec*1000;
            const currentFloor=Math.max(requestedFloor,Number(circuit.intervalMs)||0);
            circuit.intervalMs=Math.min(NOBITEX_MAX_INTERVAL_MS,Math.max(currentFloor+500,Math.ceil(currentFloor*1.5)));
            if(job.service==='nobitex'){netFails=circuit.fails;netCooldown=circuit.until;}
            eventLog(`محدودیت نرخ API؛ صف حفظ شد، فاصله درخواست به ${circuit.intervalMs}ms افزایش یافت و پس از ${waitSec} ثانیه ادامه می‌یابد`,'info');
            if(attempt<2)continue;
          }else if(circuit.fails>=3)circuit.until=Date.now()+30000;
          if(job.service==='nobitex')netCooldown=circuit.until;
          job.reject(e);settled=true;
        }
      }
      renderDiag();
    }
  }finally{networkBusy=false;if(networkQueue.length)queueMicrotask(drainRequests);}
}

function isLocalMode(){if(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())return false;return ['http:','https:'].includes(location.protocol)&&['127.0.0.1','localhost','[::1]'].includes(location.hostname);}

function validProxy(value){if(!value)return '';const u=new URL(value);if(u.username||u.password||u.search||u.hash)throw new Error('نشانی واسط باید بدون رمز، پارامتر و بخش انتهایی باشد');if(u.protocol!=='https:'&&!(['127.0.0.1','localhost'].includes(u.hostname)&&u.protocol==='http:'))throw new Error('واسط باید HTTPS یا نشانی محلی باشد');return u.href.replace(/\/+$/,'');}

function statsMap(stats,at){const map=new Map();for(const [key,s] of Object.entries(stats||{})){const match=key.toUpperCase().match(/^([A-Z0-9]+)[-_\/]?USDT$/);if(!match||s.isClosed===true)continue;const base=match[1].replace(/[-_/]$/,'');if(base==='USDT'||base==='RLS')continue;const lastPrice=num(s.latest,NaN),quoteVolume=num(s.volumeDst,NaN);if(!(lastPrice>0&&quoteVolume>0))continue;map.set(base,{symbol:base+'USDT',base,lastPrice,dayOpen:num(s.dayOpen),change24h:num(s.dayChange,NaN),volumeQuote:quoteVolume,volume:num(s.volumeSrc),high:num(s.dayHigh),low:num(s.dayLow),bestBid:num(s.bestBuy),bestAsk:num(s.bestSell),isClosed:false,quoteAt:at,priceAt:at})}if(!map.size)throw new ApiError('بازار تتری فعال با قیمت و حجم معتبر دریافت نشد');return map;}

function latestClosedCandleStart(tfKey,now=Date.now()){const ms=TIMEFRAMES[tfKey].seconds*1000;return Math.floor(now/ms)*ms-ms;}
function candleSeriesNeedsRefresh(candles,tfKey,now=Date.now()){if(!Array.isArray(candles)||!candles.length)return true;const last=Number(candles.at(-1)?.t)||0;return last<latestClosedCandleStart(tfKey,now);}
function frameDue(coin,k){const meta=frameMeta.get(coin.nobitexSymbol+'|'+k),a=analysisCache.get(coin.id)?.tfMap?.[k],now=Date.now(),retryAt=Math.max(Number(meta?.retryAt)||0,Number(a?.retryAt)||0);if(retryAt>now)return false;if(!a?.candles?.length)return true;if(a.networkError||a.validation?.invalid)return true;const lastFetchAt=Math.max(Number(meta?.fetchedAt)||0,Number(a?.fetchedAt)||0);return !lastFetchAt||now-lastFetchAt>=TIMEFRAMES[k].seconds*1000;}

let marketHealthy=false,lastMarketAt=0,modalBusy=false,settingsDialog=null,modalRefreshAt=0;

function claimSignal(ledger,symbol,bar,now=Date.now()){const key=`N:${symbol}:1h:${bar}:long:v4`,cool='cool:'+symbol;if(ledger[key]||now-(ledger[cool]||0)<3600000)return{allowed:false,ledger};const clean=Object.fromEntries(Object.entries(ledger).filter(([,v])=>now-v<7*86400000));clean[key]=now;clean[cool]=now;return{allowed:true,ledger:clean,key};}


// ======================= Trade Journal v6 =======================
// The application does not place orders. Automatic records therefore capture
// a confirmed signal snapshot; execution price and realized outcome are user-entered.
const JOURNAL_KEY='nb6:trade-journal:v1';
function loadTradeJournal(){try{const x=JSON.parse(LS(JOURNAL_KEY)||'[]');return Array.isArray(x)?x:[]}catch(error){eventLog('خواندن دفتر معاملات ناموفق بود: '+String(error?.message||error).slice(0,140),'info');return[]}}
let tradeJournal=loadTradeJournal();
function saveTradeJournal(){LS(JOURNAL_KEY,JSON.stringify(tradeJournal));}
function captureTradeSnapshot(coin,record,signalKey){
  const old=tradeJournal.find(x=>x.signalKey===signalKey);
  if(old)return old;
  const h1=record.tfMap?.['1h'],h4=record.tfMap?.['4h'],m1=h1?.metrics,m4=h4?.metrics,r=record.risk;
  let hist=null,histPrev=null;try{const z=macdSeries(h1.candles.map(c=>c.c));hist=z.hist.at(-1);histPrev=z.hist.at(-2)}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}
  const decision=computeDecision(coin,record);
  const snap={
    id:'J'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    signalKey,symbol:coin.nobitexSymbol,base:coin.symbol,at:Date.now(),
    status:'سیگنال تأییدشده؛ اجرای واقعی ثبت نشده',
    snapshotId:record.snapshotId||null,snapshotMeta:record.snapshotMeta||null,riskSnapshot:{snapshotId:record?.snapshotId||null,entry:r?.entry??null,stopLoss:r?.stopLoss??null,target:r?.takeProfit??null,ceiling:r?.ceiling??null,spread:r?.spread??null,rrNet:r?.rrNet??null,tfKey:r?.tfKey??null,available:!!r},trendScore:record.mtf?.trendScore??null,entryReference:r?.entry??null,
    stopLoss:r?.stopLoss??null,target:r?.takeProfit??null,rrNet:r?.rrNet??null,
    entryQuality:decision.entryQuality,
    six:{
      ema:!!(m1&&m1.ema9>m1.ema20),
      rsi:!!(m1&&m1.rsi>=50&&m1.rsi<=68),
      macd:!!(m1&&m1.macd>m1.signal&&hist>0&&hist>histPrev),
      ichimoku:!!(m1&&m1.lastClose>m1.cloudTop),
      adx:!!(m4&&m4.adx>=RULES.adxMin&&m4.plusDI>m4.minusDI),
      supportResistance:decision.risks.some(x=>x.name==='حمایت و مقاومت'&&x.ok===true)
    },
    indicators:{
      ema9:m1?.ema9??null,ema20:m1?.ema20??null,ema50:m1?.ema50??null,
      rsi:m1?.rsi??null,macd:m1?.macd??null,macdSignal:m1?.signal??null,
      macdHist:hist,macdHistPrev:histPrev,adx:m4?.adx??null,
      plusDI:m4?.plusDI??null,minusDI:m4?.minusDI??null,
      support:m1?.support??null,resistance:r?.ceiling??m1?.resistance??null
    },
    actualEntry:null,actualExit:null,outcome:'ثبت‌نشده',pnl:null,notes:''
  };
  tradeJournal.unshift(snap);tradeJournal=tradeJournal.slice(0,500);saveTradeJournal();return snap;
}
async function registerPurchasedTrade(coin,record){
  const risk=record?.risk;if(!risk||!(risk.entry>0&&risk.stopLoss>0&&risk.takeProfit>0)){uiAlert('سطوح پیشنهادی معتبر نیستند؛ تحلیل را تازه‌سازی کنید.');return;}
  const entryRaw=await uiPrompt('قیمت واقعی خرید اجراشده در نوبیتکس (USDT):',String(risk.entry));if(entryRaw===null)return;
  const actualEntry=Number(entryRaw);if(!(actualEntry>0&&Number.isFinite(actualEntry))){uiAlert('قیمت واقعی خرید باید عددی بزرگ‌تر از صفر باشد.');return;}
  const signalKey='MANUAL:'+coin.nobitexSymbol+':'+Date.now()+':'+Math.random().toString(36).slice(2,7);
  const x=captureTradeSnapshot(coin,record,signalKey);
  x.manualPurchase=true;x.actualEntry=actualEntry;x.status='خرید واقعی ثبت شده؛ سفارش OCO نیازمند ثبت در صرافی است';
  x.ocoTarget=Number(risk.takeProfit);x.ocoStopTrigger=Number(risk.stopLoss);x.ocoStopLimit=Number(risk.stopLoss);
  x.purchaseAt=Date.now();x.outcome='باز';saveTradeJournal();journalDialog();
  eventLog(`${coin.symbol}: خرید واقعی در دفتر معاملات ثبت شد؛ قیمت اجرا ${actualEntry}`,'signal');
}
function journalDialog(){
  let d=document.getElementById('tradeJournalDialog');
  if(!d){d=document.createElement('dialog');d.id='tradeJournalDialog';d.className='v4-dialog';document.body.append(d);}
  const rows=tradeJournal.map((x,i)=>({x,i})).filter(({x})=>x.manualPurchase).map(({x,i})=>`<tr><td>${i+1}</td><td>${escapeHTML(x.base||x.symbol||'—')}</td><td title="${escapeHTML(x.snapshotId||'')}" style="font-family:monospace;font-size:.62rem;direction:ltr">${escapeHTML((x.snapshotId||'—').slice(0,10))}</td><td>${new Date(x.purchaseAt||x.at).toLocaleString('fa-IR')}</td><td>${Number.isFinite(Number(x.actualEntry))?escapeHTML(String(x.actualEntry)):'—'}</td><td>${Number.isFinite(Number(x.ocoTarget??x.target))?escapeHTML(String(x.ocoTarget??x.target)):'—'}</td><td>${Number.isFinite(Number(x.ocoStopTrigger??x.stopLoss))?escapeHTML(String(x.ocoStopTrigger??x.stopLoss)):'—'}</td><td>${Number.isFinite(Number(x.ocoStopLimit??x.stopLoss))?escapeHTML(String(x.ocoStopLimit??x.stopLoss)):'—'}</td><td>${escapeHTML(x.outcome||'باز')}</td><td>${Number.isFinite(Number(x.pnl))?Number(x.pnl).toFixed(8):'—'}</td><td style="white-space:nowrap"><button type="button" class="refresh-btn" data-journal-oco="${i}">ویرایش OCO</button> <button type="button" class="refresh-btn" data-journal-result="${i}">ثبت فروش/نتیجه</button> <button type="button" class="refresh-btn" data-journal-delete="${i}" style="background:#a52a2a">حذف</button></td></tr>`).join('');
  d.innerHTML=`<h3>دفتر معاملات واقعی</h3>
  <p>هر ردیف پس از خرید واقعی و با فشردن دکمه ثبت خرید ایجاد می‌شود. هدف فروش و دو قیمت سفارش حد ضرر OCO از سطوح پیشنهادی تحلیل مقداردهی اولیه می‌شوند؛ ثبت سفارش در صرافی همچنان دستی است.</p>
  <div style="max-height:55vh;overflow:auto"><table><thead><tr><th>#</th><th>ارز</th><th>Snapshot</th><th>زمان خرید</th><th>قیمت واقعی خرید</th><th>هدف فروش OCO</th><th>فعال‌سازی حد ضرر</th><th>قیمت سفارش حد ضرر</th><th>وضعیت</th><th>P/L (USDT)</th><th>عملیات</th></tr></thead><tbody>${rows||'<tr><td colspan="11">هنوز خریدی به‌صورت دستی ثبت نشده است.</td></tr>'}</tbody></table></div>
  <div class="v4-actions journal-actions"><button type="button" id="journalExport">خروجی CSV</button><button type="button" id="journalBackup">پشتیبان JSON</button><button type="button" id="journalRestore">بازیابی پشتیبان</button><input type="file" id="journalRestoreFile" accept="application/json,.json" hidden><button type="button" id="journalClose">بستن</button></div>`;
  d.querySelector('#journalClose').onclick=()=>d.close();d.querySelector('#journalExport').onclick=exportTradeJournal;
  d.querySelector('#journalBackup').onclick=backupTradeJournal;
  d.querySelector('#journalRestore').onclick=()=>d.querySelector('#journalRestoreFile').click();
  d.querySelector('#journalRestoreFile').onchange=e=>restoreTradeJournal(e.target.files?.[0]);
  d.querySelectorAll('[data-journal-oco]').forEach(b=>b.onclick=async()=>{
    const x=tradeJournal[Number(b.dataset.journalOco)];if(!x)return;
    const ask=(label,current)=>uiPrompt(label,current==null?'':String(current));
    const target=await ask('قیمت هدف فروش OCO (USDT):',x.ocoTarget??x.target);if(target===null)return;
    const trigger=await ask('قیمت فعال‌سازی حد ضرر (Stop Trigger) (USDT):',x.ocoStopTrigger??x.stopLoss);if(trigger===null)return;
    const limit=await ask('قیمت سفارش حد ضرر (Stop Limit) (USDT):',x.ocoStopLimit??x.stopLoss);if(limit===null)return;
    const t=Number(target),tr=Number(trigger),l=Number(limit);if(!(t>0&&tr>0&&l>0&&[t,tr,l].every(Number.isFinite))){uiAlert('هر سه قیمت OCO باید عددی معتبر و بزرگ‌تر از صفر باشند.');return;}
    x.ocoTarget=t;x.ocoStopTrigger=tr;x.ocoStopLimit=l;x.status='قیمت‌های OCO در دفتر ثبت شد؛ کنترل ثبت در صرافی با کاربر است';saveTradeJournal();journalDialog();
  });
  d.querySelectorAll('[data-journal-result]').forEach(b=>b.onclick=async()=>{
    const x=tradeJournal[Number(b.dataset.journalResult)];if(!x)return;
    const exit=await uiPrompt('قیمت واقعی فروش اجراشده (USDT):',x.actualExit??'');if(exit===null)return;
    const qty=await uiPrompt('مقدار دارایی فروخته‌شده:',x.quantity??'');if(qty===null)return;
    const fee=await uiPrompt('مجموع کارمزد خرید و فروش پرداختی (USDT):',x.fees??'0');if(fee===null)return;
    const ex=Number(exit),q=Number(qty),fees=Number(fee),en=Number(x.actualEntry);
    if(!(en>0&&ex>0&&q>0&&fees>=0&&[en,ex,q,fees].every(Number.isFinite))){uiAlert('قیمت‌ها و مقدار باید مثبت و کارمزد صفر یا بیشتر باشد.');return;}
    x.actualExit=ex;x.quantity=q;x.fees=fees;x.pnl=(ex-en)*q-fees;x.outcome=x.pnl>0?'سودآور':x.pnl<0?'زیان‌ده':'سربه‌سر';x.status='فروش ثبت شد';x.exitAt=Date.now();saveTradeJournal();journalDialog();
  });
  d.querySelectorAll('[data-journal-delete]').forEach(b=>b.onclick=async()=>{
    const index=Number(b.dataset.journalDelete),x=tradeJournal[index];if(!x)return;
    if(!await uiConfirm(`رکورد ${x.base||x.symbol} از دفتر معاملات حذف شود؟ این کار قابل بازگشت نیست.`))return;
    tradeJournal.splice(index,1);saveTradeJournal();journalDialog();
  });
  if(!d.open)d.showModal();
}
function backtestMetrics(trades,initialCapital){
  const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0),grossWin=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  let equity=initialCapital,peak=initialCapital,maxDD=0;const curve=[equity];
  for(const t of trades){equity+=t.pnl;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak>0?(peak-equity)/peak:0);curve.push(equity)}
  return{trades:trades.length,winRate:trades.length?wins.length/trades.length*100:0,profitFactor:grossLoss>0?grossWin/grossLoss:(grossWin>0?Infinity:0),maxDrawdown:maxDD*100,expectancyR:trades.length?trades.reduce((s,t)=>s+t.rMultiple,0)/trades.length:0,expectancyPct:trades.length?trades.reduce((s,t)=>s+t.pnlPercent,0)/trades.length:0,netPnl:equity-initialCapital,finalEquity:equity};
}
function backtestStopFillPrice(openPrice,lowPrice,stopPrice){if(![openPrice,lowPrice,stopPrice].every(Number.isFinite))return null;return (openPrice<=stopPrice||lowPrice<=stopPrice)?Math.min(openPrice,stopPrice):null;}
async function runHistoricalBacktest(coin,record,stopTf='1h'){
  const h1=record?.tfMap?.['1h']?.candles||[],h4=record?.tfMap?.['4h']?.candles||[];
  if(h1.length<140||h4.length<90)throw new Error('برای بک‌تست پایه حداقل ۱۴۰ کندل ۱H و ۹۰ کندل ۴H لازم است.');
  const capitalStart=prefs.capital,spread=Math.max(0,prefs.maxSpread),halfSpread=spread/2,fee=prefs.feeRate,slip=prefs.slippageRate;
  const trades=[];let i=100,equity=capitalStart;
  while(i<h1.length-2){
    if((i%16)===0)await new Promise(resolve=>setTimeout(resolve,0));
    const bar=h1[i],asOf=bar.t+3600000;
    const h1Window=h1.slice(0,i+1),h4Window=h4.filter(x=>x.t+14400000<=asOf);
    if(h4Window.length<80){i++;continue;}
    const a1=analyzeTimeframe(h1Window,'1h','Backtest',asOf),a4=analyzeTimeframe(h4Window,'4h','Backtest',asOf);
    if(!a1.ready||!a4.ready){i++;continue;}
    const close=bar.c,simCoin={...coin,price:close,bestAsk:close*(1+halfSpread),bestBid:close*(1-halfSpread),quoteAt:asOf,priceAt:asOf,volume:h1.slice(Math.max(0,i-23),i+1).reduce((s,x)=>s+x.v*x.c,0),marketClosed:false};
    const simRecord={tfMap:{'1h':a1,'4h':a4},historicalAsOf:asOf,backtestMode:true,stopTf};
    finalizeRecord(simCoin,simRecord);
    const dec=computeDecision(simCoin,simRecord);
    if(dec.cls!=='good'||!simRecord.mtf?.eligible){i++;continue;}
    const next=h1[i+1];if(!next||!(next.o>0)){i++;continue;}
    const rawEntry=next.o*(1+halfSpread),fillEntry=rawEntry*(1+slip)*(1+fee);
    simCoin.bestAsk=rawEntry;simCoin.bestBid=next.o*(1-halfSpread);simCoin.price=next.o;simCoin.quoteAt=next.t;
    const risk=computeRisk(simCoin,simRecord,stopTf);
    const gapTooLarge=!risk||Math.abs(risk.entry-a1.lastClose)>2*risk.atr;
    const supportDistance=risk?.support>0?(risk.entry-risk.support)/risk.entry*100:Infinity;
    const resistanceRoom=risk?.ceiling>risk?.entry?(risk.ceiling-risk.entry)/risk.entry*100:0;
    const stopTooWide=risk&&((risk.entry-risk.stopLoss)/risk.entry)>.08;
    if(!risk||gapTooLarge||risk.spread>prefs.maxSpread||risk.stopLoss>=fillEntry||risk.takeProfit<=fillEntry||risk.rrNet<prefs.minRR||supportDistance>3||resistanceRoom<=1||stopTooWide||simCoin.volume<prefs.minVolume||!(equity>0)){i++;continue;}
    const unitRiskNet=risk.netRisk;
    if(!(unitRiskNet>0)){i++;continue;}
    const qty=Math.min((equity*prefs.riskPct)/unitRiskNet,equity/fillEntry);if(!(qty>0)){i++;continue;}
    let exitPrice=null,exitIndex=i+1,exitReason='افق ۷۲ کندل';
    const end=Math.min(h1.length-1,i+73);
    for(let j=i+1;j<=end;j++){
      const f=h1[j],stopFill=backtestStopFillPrice(f.o,f.l,risk.stopLoss),hitStop=stopFill!==null,hitTarget=f.h>=risk.takeProfit;
      if(hitStop&&hitTarget){exitPrice=stopFill;exitIndex=j;exitReason=f.o<risk.stopLoss?'گپ زیر حد ضرر (پرشدن روی Open؛ اولویت محافظه‌کارانه)':'حد ضرر (اولویت محافظه‌کارانه در برخورد هم‌زمان)';break;}
      if(hitStop){exitPrice=stopFill;exitIndex=j;exitReason=f.o<risk.stopLoss?'گپ زیر حد ضرر (پرشدن روی Open)':'حد ضرر';break;}
      if(hitTarget){exitPrice=risk.takeProfit;exitIndex=j;exitReason='هدف سود';break;}
    }
    if(exitPrice==null){exitPrice=h1[end].c;exitIndex=end;}
    const sellNet=exitPrice*(1-halfSpread)*(1-slip)*(1-fee),pnl=(sellNet-fillEntry)*qty;
    trades.push({entryAt:next.t,exitAt:h1[exitIndex].t,entry:fillEntry,exit:exitPrice,stopLoss:risk.stopLoss,target:risk.takeProfit,qty,pnl,pnlPercent:pnl/(qty*fillEntry)*100,rMultiple:pnl/(unitRiskNet*qty),reason:exitReason,stopTf,equityBefore:equity});
    equity+=pnl;
    i=Math.max(i+1,exitIndex+1);
  }
  return{stopTf,assumptions:{spreadPct:spread*100,spreadModel:'اسپرد ثابت برابر سقف تنظیم‌شده کاربر؛ دفتر سفارش تاریخی در کش وجود ندارد',feePct:fee*100,slippagePct:slip*100,horizonHours:72,capitalModel:'ریسک درصدی از Equity جاری با به‌روزرسانی پس از هر معامله؛ بدون موقعیت هم‌زمان',entry:'ورود روی Open کندل ۱H بعد از سیگنال با spread/fee/slippage',sameBarRule:'اگر TP و SL در یک کندل لمس شوند، SL مقدم فرض می‌شود',entryTrigger:'این آزمون دروازه پایه ۱H/۴H را می‌سنجد؛ ماشه مستقل ۱۵m/۵m در تاریخچه OHLCV ذخیره‌شده بازسازی نشده است',referenceBars:h1.length,independentOutOfSample:false,orderBookDepthIncluded:false,stopFrame:stopTf},trades,metrics:backtestMetrics(trades,capitalStart)};
}
function renderBacktestResult(label,result){const m=result.metrics,fmt=v=>Number.isFinite(v)?v.toFixed(2):'∞';return `<section class="backtest-result"><h4>${label}</h4><div class="backtest-metrics"><span>تعداد معاملات <b>${m.trades}</b></span><span>Win Rate <b>${fmt(m.winRate)}٪</b></span><span>Profit Factor <b>${fmt(m.profitFactor)}</b></span><span>Max Drawdown <b>${fmt(m.maxDrawdown)}٪</b></span><span>Expectancy <b>${fmt(m.expectancyR)}R</b></span><span>خالص P/L <b>${fmt(m.netPnl)} USDT</b></span></div><p>فرض اسپرد ${fmt(result.assumptions.spreadPct)}٪، کارمزد هر سمت ${fmt(result.assumptions.feePct)}٪ و لغزش هر سمت ${fmt(result.assumptions.slippagePct)}٪. دوره داده: ${result.assumptions.referenceBars} کندل ۱H. ${result.assumptions.entryTrigger}</p></section>`;}
function aggregatePortfolioTrades(symbolTrades,initialCapital,maxConcurrent=3,riskPct=prefs.riskPct){
  const events=[];symbolTrades.forEach((row,index)=>{for(const trade of row.trades){const id=`${row.symbol}:${index}:${trade.entryAt}:${trade.exitAt}`;events.push({at:trade.entryAt,type:'entry',id,trade,symbol:row.symbol},{at:trade.exitAt,type:'exit',id,trade,symbol:row.symbol});}});
  events.sort((a,b)=>a.at-b.at||(a.type===b.type?0:a.type==='exit'?-1:1));
  let equity=initialCapital,peak=initialCapital,maxConcurrentSeen=0,skipped=0;
  const open=new Map(),closed=[];
  for(const event of events){
    if(event.type==='entry'){
      if(open.size>=maxConcurrent){skipped++;continue;}
      const riskCash=equity*riskPct/maxConcurrent;
      open.set(event.id,{...event,riskCash,equityAtEntry:equity});maxConcurrentSeen=Math.max(maxConcurrentSeen,open.size);
    }else{
      const position=open.get(event.id);if(!position)continue;open.delete(event.id);
      const pnl=position.riskCash*position.trade.rMultiple;
      const before=equity;equity+=pnl;peak=Math.max(peak,equity);
      closed.push({...position.trade,symbol:position.symbol,pnl,pnlPercent:before>0?pnl/before*100:0,equityBefore:before,portfolioRiskCash:position.riskCash});
    }
  }
  return {trades:closed,metrics:backtestMetrics(closed,initialCapital),symbols:[...new Set(closed.map(t=>t.symbol))],maxConcurrentSeen,skippedByConcurrency:skipped};
}
async function runBacktestPair(coin,record){const out=$('historicalBacktestResults');if(!out)return;out.textContent='بک‌تست در حال اجراست؛ محاسبات به‌صورت مرحله‌ای انجام می‌شود تا رابط قفل نشود…';try{const one=await runHistoricalBacktest(coin,record,'1h'),four=await runHistoricalBacktest(coin,record,'4h');out.innerHTML=renderBacktestResult('حد ضرر مبتنی بر ۱H',one)+renderBacktestResult('حد ضرر مبتنی بر ۴H',four)+'<p class="backtest-note">خروج حد ضرر در صورت گپ نزولی روی Open کندل بعدی محاسبه می‌شود. این آزمون فقط از تاریخچه محلی ۱H/۴H استفاده می‌کند؛ ماشه ۵/۱۵ دقیقه‌ای، عمق دفتر سفارش، لغزش متغیر و داده خارج از نمونه بازسازی نشده‌اند.</p>'; }catch(e){out.textContent='بک‌تست اجرا نشد: '+e.message;}}
async function runPortfolioBacktest(){
  const out=$('portfolioBacktestResults');if(!out)return;
  const candidates=allCoins.map(coin=>({coin,record:analysisCache.get(coin.id)})).filter(x=>x.record?.tfMap?.['1h']?.candles?.length>=140&&x.record?.tfMap?.['4h']?.candles?.length>=90).sort((a,b)=>(b.coin.volume||0)-(a.coin.volume||0)).slice(0,12);
  if(candidates.length<2){out.textContent='برای آزمون چندنمادی، دست‌کم دو نماد با تاریخچه معتبر در کش محلی لازم است. ابتدا اسکن کامل را اجرا کنید.';return;}
  out.textContent=`آزمون پرتفوی برای ${candidates.length} نماد در حال اجراست…`;
  try{
    const [oneRows,fourRows]=await Promise.all([['1h'],['4h']].map(async ([tf])=>{const rows=[];for(const {coin,record} of candidates){const result=await runHistoricalBacktest(coin,record,tf);rows.push({symbol:coin.symbol,trades:result.trades});}return rows;}));
    const one=aggregatePortfolioTrades(oneRows,prefs.capital,3,prefs.riskPct),four=aggregatePortfolioTrades(fourRows,prefs.capital,3,prefs.riskPct);
    const render=(label,p)=>`<section class="backtest-result"><h4>${label}</h4><div class="backtest-metrics"><span>تعداد معاملات <b>${p.metrics.trades}</b></span><span>Win Rate <b>${p.metrics.winRate.toFixed(2)}٪</b></span><span>Profit Factor <b>${Number.isFinite(p.metrics.profitFactor)?p.metrics.profitFactor.toFixed(2):'∞'}</b></span><span>Max Drawdown <b>${p.metrics.maxDrawdown.toFixed(2)}٪</b></span><span>Expectancy <b>${p.metrics.expectancyR.toFixed(2)}R</b></span><span>خالص P/L <b>${p.metrics.netPnl.toFixed(2)} USDT</b></span></div><p>نمادهای معامله‌شده: ${p.symbols.length} از ${candidates.length}؛ حداکثر موقعیت هم‌زمان: ${p.maxConcurrentSeen}/3؛ موقعیت‌های حذف‌شده به‌علت سقف هم‌زمانی: ${p.skippedByConcurrency}</p></section>`;
    out.innerHTML=render('پرتفوی چندنمادی؛ حد ضرر ۱H',one)+render('پرتفوی چندنمادی؛ حد ضرر ۴H',four)+`<p class="backtest-note">این برآورد روی ${candidates.length} نماد دارای تاریخچه محلی اجرا شده و حداکثر ۳ موقعیت هم‌زمان با تقسیم بودجه ریسک میان آن‌ها را فرض می‌کند. طول داده هر نماد محدود به کش موجود (حداکثر حدود ۵۰۰ کندل ۱H) است؛ ماشه ۵/۱۵ دقیقه‌ای، عمق دفتر سفارش، لغزش متغیر و اعتبارسنجی خارج از نمونه بازسازی نشده‌اند. این نتیجه برای اثبات سودآوری یا پیش‌بینی نرخ برد آینده کافی نیست.</p>`;
  }catch(error){out.textContent='آزمون چندنمادی اجرا نشد: '+String(error?.message||error);eventLog('بک‌تست چندنمادی: '+String(error?.message||error));}
}
function runIndicatorParityChecks(){
  const vals=Array.from({length:240},(_,i)=>100+Math.sin(i*.17)*4+i*.035+Math.cos(i*.037)*1.2);
  const bars=vals.map((c,i)=>{const p=vals[Math.max(0,i-1)];return{t:1700000000000+i*3600000,o:p,h:Math.max(p,c)+.6,l:Math.min(p,c)-.5,c,v:100+i%17}});
  const maxDiff=(a,b)=>{let m=0,n=0;for(let i=0;i<Math.min(a.length,b.length);i++)if(Number.isFinite(a[i])&&Number.isFinite(b[i])){m=Math.max(m,Math.abs(a[i]-b[i]));n++}return{max:m,count:n}};
  const refEMA=(v,p)=>{const out=Array(v.length).fill(null);if(v.length<p)return out;let seed=0;for(let i=0;i<p;i++)seed+=v[i];let e=seed/p;out[p-1]=e;const alpha=2/(p+1);for(let i=p;i<v.length;i++){e=e+alpha*(v[i]-e);out[i]=e}return out};
  const refRSI=(v,p=14)=>{const out=Array(v.length).fill(null);if(v.length<=p)return out;let up=0,down=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];up+=d>0?d:0;down+=d<0?-d:0}up/=p;down/=p;for(let i=p;i<v.length;i++){if(i>p){const d=v[i]-v[i-1];up=(up*(p-1)+(d>0?d:0))/p;down=(down*(p-1)+(d<0?-d:0))/p}out[i]=down===0?(up===0?50:100):100-100/(1+up/down)}return out};
  const refTR=(b)=>b.map((x,i)=>i===0?x.h-x.l:Math.max(x.h-x.l,Math.abs(x.h-b[i-1].c),Math.abs(x.l-b[i-1].c)));
  const refATR=(b,p=14)=>{const tr=refTR(b),out=Array(b.length).fill(null);if(b.length<p)return out;let x=tr.slice(0,p).reduce((a,z)=>a+z,0)/p;out[p-1]=x;for(let i=p;i<tr.length;i++){x=(x*(p-1)+tr[i])/p;out[i]=x}return out};
  const refMACD=(v)=>{const fast=refEMA(v,12),slow=refEMA(v,26),line=Array(v.length).fill(null),signal=Array(v.length).fill(null),hist=Array(v.length).fill(null);let first=-1;for(let i=0;i<v.length;i++){if(fast[i]!=null&&slow[i]!=null){line[i]=fast[i]-slow[i];if(first<0)first=i}}if(first>=0){const raw=line.slice(first).filter(Number.isFinite),sig=refEMA(raw,9);for(let i=0;i<sig.length;i++)signal[first+i]=sig[i]}for(let i=0;i<v.length;i++)if(line[i]!=null&&signal[i]!=null)hist[i]=line[i]-signal[i];return{macd:line,signal,hist}};
  const refADX=(b,p=14)=>{const n=b.length,adx=Array(n).fill(null),plus=Array(n).fill(null),minus=Array(n).fill(null),dx=[];if(n<p*2)return{adx,plus,minus};let trSm=0,posSm=0,negSm=0;for(let i=1;i<n;i++){const up=b[i].h-b[i-1].h,dn=b[i-1].l-b[i].l,tr=refTR([b[i-1],b[i]])[1],pos=up>dn&&up>0?up:0,neg=dn>up&&dn>0?dn:0;if(i<=p){trSm+=tr;posSm+=pos;negSm+=neg}else{trSm=trSm-trSm/p+tr;posSm=posSm-posSm/p+pos;negSm=negSm-negSm/p+neg}if(i>=p){const pdi=trSm?100*posSm/trSm:0,mdi=trSm?100*negSm/trSm:0;plus[i]=pdi;minus[i]=mdi;dx.push({i,value:pdi+mdi?100*Math.abs(pdi-mdi)/(pdi+mdi):0})}}if(dx.length>=p){let v=dx.slice(0,p).reduce((a,z)=>a+z.value,0)/p;adx[dx[p-1].i]=v;for(let j=p;j<dx.length;j++){v=(v*(p-1)+dx[j].value)/p;adx[dx[j].i]=v}}return{adx,plus,minus}};
  const refIchi=(b,periods=[9,26,52])=>{const calc=p=>{const o=Array(b.length).fill(null);for(let i=p-1;i<b.length;i++){let hi=-Infinity,lo=Infinity;for(let j=i-p+1;j<=i;j++){hi=Math.max(hi,b[j].h);lo=Math.min(lo,b[j].l)}o[i]=(hi+lo)/2}return o};const tenkan=calc(periods[0]),kijun=calc(periods[1]),senkouB=calc(periods[2]),senkouA=tenkan.map((v,i)=>v==null||kijun[i]==null?null:(v+kijun[i])/2);return{tenkan,kijun,senkouA,senkouB}};
  const macd=macdSeries(vals),refMacd=refMACD(vals),adx=adxSeries(bars),refAdx=refADX(bars),ichi=ichimokuCalc(bars),refIch=refIchi(bars);
  const rows=[
    ['EMA20',emaSeries(vals,20),refEMA(vals,20)],['RSI14',rsiSeries(vals,14),refRSI(vals,14)],['ATR14',atrSeries(bars,14),refATR(bars,14)],
    ['MACD line',macd.macd,refMacd.macd],['MACD signal',macd.signal,refMacd.signal],['MACD histogram',macd.hist,refMacd.hist],
    ['ADX14',adx,refAdx.adx],['+DI14',adx.plusDI,refAdx.plus],['-DI14',adx.minusDI,refAdx.minus],
    ['Ichimoku Tenkan',ichi.tenkan,refIch.tenkan],['Ichimoku Kijun',ichi.kijun,refIch.kijun],['Ichimoku Senkou A',ichi.senkouA,refIch.senkouA],['Ichimoku Senkou B',ichi.senkouB,refIch.senkouB]
  ];
  const results=rows.map(([name,a,b])=>({name,...maxDiff(a,b)}));
  const pass=results.every(x=>x.max<=1e-9&&x.count>0);
  return{pass,results,reference:'بازمحاسبه مستقل با فرمول‌های مرجع درون‌برنامه‌ای روی داده مصنوعی قطعی؛ این آزمون معادل تطبیق با TA-Lib/TradingView یا آزمون داده بازار نیست.'};
}

function downloadBlob(filename,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function backupTradeJournal(){
  const payload={format:'nobitex-trade-journal',version:1,exportedAt:new Date().toISOString(),records:tradeJournal.filter(x=>x.manualPurchase)};
  downloadBlob('nobitex-trade-journal-backup.json',new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}));
}
function normalizeImportedTrade(x){
  if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('رکورد معامله باید شیء باشد.');
  const allowed=['id','signalKey','symbol','base','at','purchaseAt','exitAt','status','snapshotId','snapshotMeta','riskSnapshot','trendScore','entryReference','stopLoss','target','ocoTarget','ocoStopTrigger','ocoStopLimit','rrNet','entryQuality','six','indicators','actualEntry','actualExit','outcome','pnl','notes','manualPurchase','quantity','fees'];
  for(const key of Object.keys(x))if(!allowed.includes(key))throw new Error('فیلد ناشناخته در فایل پشتیبان: '+key);
  const out={};
  const str=(k,max,required=false)=>{const v=x[k];if(v==null&&!required)return null;if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v))throw new Error('فیلد متنی نامعتبر: '+k);return v};
  const numField=(k,{min=-Number.MAX_VALUE,max=Number.MAX_VALUE,required=false}={})=>{const v=x[k];if(v==null&&!required)return null;const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error('فیلد عددی نامعتبر: '+k);return n};
  out.id=str('id',100,true);out.signalKey=str('signalKey',180)||'';out.symbol=str('symbol',40,true);out.base=str('base',24)||out.symbol;
  if(!/^[A-Z0-9]{2,24}USDT$/.test(out.symbol))throw new Error('نماد معامله معتبر نیست.');
  out.at=numField('at',{min:0,max:Date.now()+86400000,required:true});out.purchaseAt=numField('purchaseAt',{min:0,max:Date.now()+86400000});out.exitAt=numField('exitAt',{min:0,max:Date.now()+86400000});
  out.manualPurchase=x.manualPurchase===true;if(!out.manualPurchase)throw new Error('فقط معاملات خرید دستی قابل بازیابی هستند.');
  for(const k of ['trendScore','entryReference','stopLoss','target','ocoTarget','ocoStopTrigger','ocoStopLimit','rrNet','entryQuality','actualEntry','actualExit','pnl','quantity','fees'])out[k]=numField(k,{min:k==='trendScore'||k==='entryQuality'?0:-1e15,max:1e15});
  if(!(out.actualEntry>0))throw new Error('قیمت خرید واقعی معتبر نیست.');
  out.status=str('status',240)||'بازیابی‌شده';out.snapshotId=str('snapshotId',80)||null;for(const k of ['snapshotMeta','riskSnapshot']){if(x[k]!=null){if(typeof x[k]!=='object'||Array.isArray(x[k]))throw new Error('ساختار '+k+' معتبر نیست.');out[k]=x[k]}}out.outcome=str('outcome',80)||'ثبت‌نشده';out.notes=str('notes',2000)||'';
  if(x.six!=null){if(typeof x.six!=='object'||Array.isArray(x.six))throw new Error('ساختار six نامعتبر است.');out.six={};for(const k of ['ema','rsi','macd','ichimoku','adx','supportResistance']){if(k in x.six&&typeof x.six[k]!=='boolean')throw new Error('فیلد six نامعتبر است: '+k);if(k in x.six)out.six[k]=x.six[k]}}
  if(x.indicators!=null){if(typeof x.indicators!=='object'||Array.isArray(x.indicators))throw new Error('ساختار indicators نامعتبر است.');out.indicators={};for(const k of ['ema9','ema20','ema50','rsi','macd','macdSignal','macdHist','macdHistPrev','adx','plusDI','minusDI','support','resistance'])if(k in x.indicators){const n=Number(x.indicators[k]);if(x.indicators[k]!==null&&!Number.isFinite(n))throw new Error('اندیکاتور نامعتبر: '+k);out.indicators[k]=x.indicators[k]===null?null:n}}
  return out;
}
async function restoreTradeJournal(file){
  if(!file)return;
  try{
    if(file.size>5*1024*1024)throw new Error('حجم فایل پشتیبان نباید بیشتر از ۵ مگابایت باشد.');
    const data=JSON.parse(await file.text());
    if(!data||data.format!=='nobitex-trade-journal'||data.version!==1||!Array.isArray(data.records))throw new Error('ساختار یا نسخه فایل پشتیبان معتبر نیست.');
    if(data.records.length>500)throw new Error('تعداد رکوردها از سقف ۵۰۰ بیشتر است.');
    const valid=data.records.map(normalizeImportedTrade);
    if(!await uiConfirm(`${valid.length} رکورد معتبر از فایل پشتیبان بازیابی شود؟ رکوردهای هم‌شناسه جایگزین خواهند شد.`))return;
    const byId=new Map(tradeJournal.map(x=>[x.id,x]));for(const x of valid)byId.set(x.id,x);
    tradeJournal=Array.from(byId.values()).sort((a,b)=>(b.purchaseAt||b.at||0)-(a.purchaseAt||a.at||0)).slice(0,500);
    saveTradeJournal();journalDialog();uiAlert('بازیابی دفتر معاملات انجام شد.');
  }catch(err){uiAlert('بازیابی ناموفق: '+err.message)}finally{const f=document.getElementById('journalRestoreFile');if(f)f.value='';}
}

function exportTradeJournal(){
  const cols=['symbol','base','at','purchaseAt','exitAt','status','snapshotId','snapshotMeta','riskSnapshot','trendScore','entryReference','actualEntry','stopLoss','target','ocoTarget','ocoStopTrigger','ocoStopLimit','rrNet','entryQuality','ema','rsi','macd','ichimoku','adx','supportResistance','actualExit','quantity','fees','outcome','pnl','notes'];
  const rows=[cols,...tradeJournal.filter(x=>x.manualPurchase).map(x=>cols.map(k=>k==='at'||k==='purchaseAt'||k==='exitAt'?((x[k]||x.at)?new Date(x[k]||x.at).toISOString():''):k in (x.six||{})?x.six[k]:k in (x.indicators||{})?x.indicators[k]:x[k]??''))];
  const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
  downloadBlob('nobitex-trade-journal-v7.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}));
}
function installJournalButton(){
  if(document.getElementById('tradeJournalBtn'))return;
  const b=document.createElement('button');b.id='tradeJournalBtn';b.type='button';b.textContent='دفتر معاملات';
  b.style.cssText='position:fixed;bottom:18px;left:18px;z-index:900;background:#087f78;color:white;border:1px solid #35bdb0;border-radius:10px;padding:12px 16px;min-height:48px;font-weight:700;cursor:pointer;touch-action:manipulation;box-shadow:0 5px 20px #0008';
  b.onclick=journalDialog;document.body.append(b);
}

async function emitSignal(coin,record){if(!record.mtf.eligible)return;const run=async()=>{let ledger={};try{ledger=JSON.parse(LS('nb4:alerts')||'{}')}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}const decision=claimSignal(ledger,coin.nobitexSymbol,record.tfMap['1h'].lastTime);if(!decision.allowed)return;if(LS('nb4:alerts',JSON.stringify(decision.ledger))===null){notif.enabled=false;notif.soundEnabled=false;eventLog('سابقه هشدار ذخیره نشد؛ اعلان و صدا برای جلوگیری از تکرار غیرفعال شدند');return}const body=`ورود مرجع: ${formatPrice(record.risk.entry)} USDT | نسبت خالص: ${record.risk.rrNet.toFixed(2)}`;eventLog(`${coin.symbol}: نامزد بررسی خرید؛ ${body}`,'signal');await notif.notify('شرایط پایه تکمیل شد؛ منتظر ماشه: '+coin.symbol,body,decision.key,'info')};if(navigator.locks)await navigator.locks.request('nb4:alert-ledger',run);else await run();}

function showSettings(){if(!settingsDialog){settingsDialog=document.createElement('dialog');settingsDialog.id='settingsDialog';settingsDialog.className='v4-dialog';document.body.append(settingsDialog)}const fields=[['feeRate','کارمزد هر سمت (درصد)',prefs.feeRate*100,0,2,.01],['slippageRate','لغزش هر سمت (درصد)',prefs.slippageRate*100,0,5,.01],['capital','سرمایه فرضی (USDT)',prefs.capital,1,1e9,1],['riskPct','ریسک هر معامله (درصد سرمایه)',prefs.riskPct*100,.01,5,.01],['minRR','نسبت سود به زیان خالصِ هدف (و حداقل مجاز)',prefs.minRR,1,10,.1],['minVolume','حداقل حجم روزانه (USDT)',prefs.minVolume,0,1e12,1000],['maxSpread','حداکثر اسپرد (درصد)',prefs.maxSpread*100,.01,10,.05],['minQuality','حداقل کیفیت داده',prefs.minQuality,50,100,1]];settingsDialog.innerHTML=`<form id="settingsForm"><h3>اتصال، هزینه و ریسک</h3><p>دریافت مستقیم نوبیتکس ممکن است به سیاست Origin یا شبکه محدود شود. فایل کامل و راهنمای اجرای محلی داخل بسته است. پروکسی عمومی خودکار حذف شده است.</p><label>واسط اختصاصی HTTPS (اختیاری؛ مبدأ آن باید در connect-src همین CSP مجاز شود)<input id="proxyField" type="url" value="${escapeHTML(PROXY)}" placeholder="https://your-worker.example" dir="ltr"></label><label><input id="cgEnabled" type="checkbox" ${prefs.useCoinGecko?'checked':''}> رتبه جهانی CoinGecko؛ اختیاری و مستقل از دریافت قیمت</label><label class="assumption-confirm"><input id="costAssumptionsConfirmed" type="checkbox" ${prefs.costAssumptionsConfirmed?'checked':''}> کارمزد، لغزش و حداقل حجم را با شرایط واقعی حسابم تطبیق داده‌ام و تأیید می‌کنم.</label><div class="v4-fields">${fields.map(([k,l,v,min,max,step])=>`<label>${l}<input type="number" required data-pref="${k}" value="${v}" min="${min}" max="${max}" step="${step}"></label>`).join('')}</div><p>تنظیمات هزینه از حساب صرافی خوانده نمی‌شوند؛ پیش‌فرض کارمزد ۰٫۱٪ هر سمت و حداقل حجم ۱۰٬۰۰۰ USDT است. تا زمانی که این فرض‌ها و لغزش را با شرایط واقعی حساب تطبیق و تأیید نکنید، دروازه ورود نهایی و آلارم خرید فعال نمی‌شود. امتیازها نیز احتمال برد نیستند.</p><div class="v4-actions"><button type="submit">ذخیره تنظیمات</button><button type="button" id="settingsClose">بستن</button></div><p id="settingsError" role="status"></p></form>`;settingsDialog.querySelector('#settingsClose').onclick=()=>settingsDialog.close();settingsDialog.querySelector('#settingsForm').onsubmit=e=>{e.preventDefault();try{const nextProxy=validProxy(settingsDialog.querySelector('#proxyField').value.trim()),sourceChanged=nextProxy!==PROXY;const next={...prefs};for(const input of settingsDialog.querySelectorAll('[data-pref]')){let value=input.valueAsNumber;if(!input.checkValidity()||!Number.isFinite(value))throw new Error('مقدار تنظیمات معتبر نیست');if(['feeRate','slippageRate','riskPct','maxSpread'].includes(input.dataset.pref))value/=100;next[input.dataset.pref]=value}next.useCoinGecko=settingsDialog.querySelector('#cgEnabled').checked;next.costAssumptionsConfirmed=settingsDialog.querySelector('#costAssumptionsConfirmed').checked;PROXY=nextProxy;prefs=next;LS('nb4:prefs',JSON.stringify(prefs));LS('proxyUrl',PROXY);if(sourceChanged){netCooldown=0;netFails=0;frameMeta.clear();for(const c of Object.values(circuits)){c.fails=0;c.until=0}}settingsDialog.close();for(const c of allCoins){const a=analysisCache.get(c.id);if(a)finalizeRecord(c,a)}scheduleRender();refreshData()}catch(error){settingsDialog.querySelector('#settingsError').textContent=error.message}};settingsDialog.showModal();}

function showEvents(){const d=document.createElement('dialog');d.className='v4-dialog';d.innerHTML=`<h3>گزارش رخدادها</h3><div>${eventHistory.length?eventHistory.map(e=>`<article><small>${new Date(e.at).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'})}</small><p>${escapeHTML(e.message)}</p></article>`).join(''):'رخدادی ثبت نشده است.'}</div><button>بستن</button>`;document.body.append(d);d.querySelector('button').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());d.showModal();}

function refreshOpenModal(force=false){if(!modalCurrentCoin||!modalOverlay.classList.contains('active')||(!force&&Date.now()-modalRefreshAt<1200))return;const selected=modalCurrentTf,scroll=$('detailModal').querySelector('.modal-box').scrollTop;openDetailModal(coinById.get(modalCurrentCoin.id)||modalCurrentCoin);if(selected){modalCurrentTf=selected;renderModalChart(modalCurrentCoin,analysisCache.get(modalCurrentCoin.id),selected);tfSelectors.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===selected))}$('detailModal').querySelector('.modal-box').scrollTop=scroll;modalRefreshAt=Date.now();}

async function openCoinDetail(coin){openDetailModal(coin);modalBusy=true;try{await analyzeCoin(coin,false,true);if(!analysisCache.get(coin.id)?.tfMap?.['5m']||!analysisCache.get(coin.id)?.tfMap?.['1d'])await analyzeCoin(coin,false,true);const rec=analysisCache.get(coin.id);if(rec){publishOpportunity(coin,rec);if(computeEntryOpportunity(coin,rec).baseReady)ensureOpportunityFrames(coin).catch(error=>eventLog('تکمیل داده‌های فرصت '+coin.symbol+' ناموفق بود: '+String(error?.message||error).slice(0,120),'info'));}if(modalCurrentCoin?.id===coin.id){modalRefreshAt=0;refreshOpenModal()}}catch(e){eventLog(coin.symbol+': '+e.message)}finally{modalBusy=false;updateAnalysisStatus();scheduleRender()}}

function wsStop(){if(live.timer)clearTimeout(live.timer);live.timer=null;const ws=live.ws;live.ws=null;live.ok=false;live.sub.clear();live.pending?.clear();if(ws){ws.onclose=null;ws.onerror=null;try{ws.close(1000)}catch(error){eventLog('خطای غیرمسدودکننده: '+String(error?.message||error).slice(0,140),'info')}}diag.ws='مکث';renderDiag();}

const chartViews=new Map();

function chartTime(value){let t=value;if(typeof value==='object')t=Date.UTC(value.year,value.month-1,value.day)/1000;return new Date(t*1000).toLocaleString('fa-IR',{timeZone:'Asia/Tehran',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}

function addChartLayers(chart,candleSeries,chosen){const bars=chosen.tf.candles,step=TIMEFRAMES[chosen.key].seconds,ichi=chosen.tf.metrics?.ichimokuSeries||ichimokuCalc(bars);const line=(values,shift,color,width=1)=>{const s=chart.addLineSeries({color,lineWidth:width,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s.setData(values.flatMap((v,i)=>v==null?[]:[{time:Math.floor(bars[i].t/1000)+shift*step,value:v}]));return s};if($('showIchi')?.checked!==false){line(ichi.senkouA,26,'#42c78f');line(ichi.senkouB,26,'#d98571');line(bars.map(b=>b.c),-26,'#aa80d6');}const fib=chosen.tf.metrics?.fib||zigzagFib(bars);if(fib&&$('showZig')?.checked!==false){const s=chart.addLineSeries({color:'#dfc278',lineWidth:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s.setData(fib.pivots.map(p=>({time:Math.floor(bars[p.i].t/1000),value:p.price})));candleSeries.setMarkers(fib.pivots.map(p=>({time:Math.floor(bars[p.i].t/1000),position:p.type==='H'?'aboveBar':'belowBar',color:'#dfc278',shape:'circle',text:p.type,size:.6})));const last=fib.pivots.at(-1);if(last.i<bars.length-1){const provisional=chart.addLineSeries({color:'#ac9865',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dashed,priceLineVisible:false,lastValueVisible:false});provisional.setData([{time:Math.floor(bars[last.i].t/1000),value:last.price},{time:Math.floor(bars.at(-1).t/1000),value:bars.at(-1).c}])}}if(fib&&$('showFib')?.checked){for(const lv of fib.levels)candleSeries.createPriceLine({price:lv.price,color:'#9472bb88',lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dotted,axisLabelVisible:false,title:'Fib '+lv.label});}}

function classicPivots(bar){
  if(!bar||![bar.h,bar.l,bar.c].every(Number.isFinite)||bar.l<=0||bar.h<bar.l||bar.c<bar.l||bar.c>bar.h)return null;
  const p=(bar.h+bar.l+bar.c)/3,range=bar.h-bar.l;
  return {P:p,R1:2*p-bar.l,S1:2*p-bar.h,R2:p+range,S2:p-range};
}

function volumeProfile(candles,count=24){
  const bars=candles.slice(-200).filter(b=>[b.l,b.h,b.c,b.v].every(Number.isFinite)&&b.l>0&&b.h>=b.l&&b.v>=0);
  if(!bars.length)return null;
  const low=Math.min(...bars.map(b=>b.l)),high=Math.max(...bars.map(b=>b.h)),total=bars.reduce((sum,b)=>sum+b.v,0);
  if(!(total>0))return null;
  if(high===low)return {bins:[{low,high,volume:total}],total,poc:low,val:low,vah:high,pocIndex:0,from:bars[0].t,to:bars.at(-1).t,candles:bars.length};
  count=Math.max(4,Math.min(80,Math.floor(count)||24));
  const step=(high-low)/count,bins=Array.from({length:count},(_,i)=>({low:low+i*step,high:low+(i+1)*step,volume:0}));
  for(const bar of bars){
    if(bar.h===bar.l){bins[Math.min(count-1,Math.max(0,Math.floor((bar.c-low)/step)))].volume+=bar.v;continue}
    for(const bin of bins)bin.volume+=bar.v*Math.max(0,Math.min(bin.high,bar.h)-Math.max(bin.low,bar.l))/(bar.h-bar.l);
  }
  const pocIndex=bins.reduce((best,b,i)=>b.volume>bins[best].volume?i:best,0);
  let left=pocIndex,right=pocIndex,area=bins[pocIndex].volume;
  while(area<total*.7&&(left>0||right<count-1)){
    if(right<count-1&&(left===0||bins[right+1].volume>=bins[left-1].volume))area+=bins[++right].volume;
    else area+=bins[--left].volume;
  }
  return {bins,total,poc:(bins[pocIndex].low+bins[pocIndex].high)/2,pocIndex,val:bins[left].low,vah:bins[right].high,from:bars[0].t,to:bars.at(-1).t,candles:bars.length};
}

function renderMarketLayers(chart,series,chosen,analysis){
  const container=$('marketLayers');if(!container)return;const parts=[];
  const addLine=(price,title,color)=>series.createPriceLine({price,title,color,lineWidth:1,lineStyle:LightweightCharts.LineStyle.Dotted,axisLabelVisible:false});
  if($('showPivots')?.checked){
    const day=analysis?.tfMap?.['1d'],pivots=isTimeframeValid(day,'1d')?classicPivots(day.candles.at(-1)):null;
    if(pivots){for(const [key,price] of Object.entries(pivots))addLine(price,key,key==='P'?'#e4b268aa':'#879bb077');parts.push(`<p>پیوت کلاسیک روزانه، از آخرین کندل روزانه بسته نوبیتکس (${new Date(day.lastTime).toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran'})}): ${Object.entries(pivots).map(([k,v])=>`${k}: ${formatPrice(v)}`).join(' · ')}</p>`)}
    else parts.push('<p>پیوت روزانه در انتظار کندل روزانه تازه و معتبر است.</p>');
  }
  if($('showProfile')?.checked){
    const profile=volumeProfile(chosen.tf.candles);
    if(profile){
      addLine(profile.poc,'POC','#d7a5ed');addLine(profile.val,'VAL','#879acb');addLine(profile.vah,'VAH','#879acb');
      const max=Math.max(...profile.bins.map(b=>b.volume)),height=profile.bins.length*7+8;
      const bars=profile.bins.map((b,i)=>`<rect x="132" y="${4+(profile.bins.length-1-i)*7}" width="${((b.volume/max)*440).toFixed(2)}" height="5" fill="${i===profile.pocIndex?'#d7a5ed':'#55789a'}"><title>${formatPrice(b.low)}–${formatPrice(b.high)}: ${b.volume.toFixed(4)}</title></rect>`).join('');
      parts.push(`<p>Volume Profile تخمینی · ${profile.candles} کندل بسته ${chosen.key} · POC: ${formatPrice(profile.poc)} · VAL: ${formatPrice(profile.val)} · VAH: ${formatPrice(profile.vah)}</p><svg viewBox="0 0 600 ${height}" role="img" aria-label="پروفایل تخمینی حجم بر حسب قیمت"><text x="2" y="14" fill="#a5b8d0" font-size="11">${formatPrice(profile.bins.at(-1).high)}</text><text x="2" y="${height-4}" fill="#a5b8d0" font-size="11">${formatPrice(profile.bins[0].low)}</text>${bars}</svg><p>حجم پایه هر کندل به نسبت هم‌پوشانی بازه قیمت در ۲۴ سطل توزیع می‌شود؛ ناحیه ارزش ۷۰٪ است. این تخمین OHLCV، داده واقعی معاملات در هر قیمت نیست و وارد امتیاز سیگنال نمی‌شود.</p>`);
    }else parts.push('<p>برای پروفایل حجم، داده دارای حجم مثبت لازم است.</p>');
  }
  container.innerHTML=parts.join('');container.hidden=!parts.length;
}


for(const id of ['showIchi','showZig','showFib','showPivots','showProfile'])$(id)?.addEventListener('change',()=>{if(modalCurrentCoin)renderModalChart(modalCurrentCoin,analysisCache.get(modalCurrentCoin.id),modalCurrentTf)});
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();


// ===== رفتار موبایل: دکمه‌های تاشو و دکمه برگشت اندروید =====
(function(){
  const hdr=document.querySelector('header'),bar=document.querySelector('.status-bar'),flt=document.querySelector('.filters');
  if(bar){const b=bar.querySelector('#mobMore')||document.createElement('button');b.id='mobMore';b.type='button';b.className='refresh-btn';b.textContent='⋯ بیشتر';
    b.onclick=()=>{hdr.classList.toggle('more');b.textContent=hdr.classList.contains('more')?'▲ کمتر':'⋯ بیشتر'};if(!b.parentElement)bar.insertBefore(b,bar.firstChild)}
  if(flt){const b=flt.querySelector('#mobFilterBtn')||document.createElement('button');b.id='mobFilterBtn';b.type='button';b.textContent='🎛 فیلترهای بیشتر';
    b.onclick=()=>{flt.classList.toggle('open');b.textContent=flt.classList.contains('open')?'▲ بستن فیلترها':'🎛 فیلترهای بیشتر'};if(!b.parentElement)flt.appendChild(b)}
  // مدیریت یکپارچه Back اندروید برای پنجره‌ها و صفحه جزئیات
  const backTargets = [
    { selector: '#nbxApiModal.open', close: () => document.getElementById('nbxApiCloseBtn')?.click() },
    { selector: 'dialog[open]', close: () => { const d=[...document.querySelectorAll('dialog[open]')].pop(); if(d) d.close(); } },
    { selector: '#detailModal.active', close: () => document.getElementById('modalClose')?.click() },
    { selector: '.modal-overlay.active', close: () => document.querySelector('.modal-overlay.active .modal-close, .modal-overlay.active [data-close]')?.click() },
    { selector: 'details[open]', close: () => { const all=[...document.querySelectorAll('details[open]')]; all.at(-1)?.removeAttribute('open'); } },
    { selector: '.filters.open', close: () => { const x=document.querySelector('.filters.open'); if(x){x.classList.remove('open');const b=document.getElementById('mobFilterBtn');if(b)b.textContent='🎛 فیلترهای بیشتر';} } },
    { selector: 'header.more', close: () => { const x=document.querySelector('header.more'); if(x){x.classList.remove('more');const b=document.getElementById('mobMore');if(b)b.textContent='⋯ بیشتر';} } }
  ];
  const visibleBackTarget = () => backTargets.find(x => document.querySelector(x.selector));
  let backStateActive = false;
  let closingFromPop = false;
  const syncBackState = () => {
    const target = visibleBackTarget();
    if (target && !backStateActive && !closingFromPop) {
      history.pushState({ nobitexOverlay: true }, '', location.href);
      backStateActive = true;
    } else if (!target && backStateActive && !closingFromPop) {
      backStateActive = false;
      if (history.state?.nobitexOverlay) history.back();
    }
  };
  const backObserver = new MutationObserver(syncBackState);
  backObserver.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['class','open','aria-hidden']});
  window.addEventListener('nobitex:back',()=>{const target=visibleBackTarget();if(target)target.close();});
  window.addEventListener('popstate', () => {
    if (backStateActive) {
      backStateActive = false;
      closingFromPop = true;
      const target = visibleBackTarget();
      if (target) target.close();
      setTimeout(() => { closingFromPop = false; syncBackState(); }, 0);
    } else if (visibleBackTarget()) {
      const target = visibleBackTarget();
      target.close();
    }
  });

})();
