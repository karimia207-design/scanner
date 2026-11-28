import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,'web/app.js'),'utf8');
const store=new Map();
const sandbox={
  LS:(key,value)=>{if(value===undefined)return store.has(key)?store.get(key):null;store.set(key,value);return value;},
  Date,Intl,JSON,Number,Math,Array,Set,Map,String,console
};
const context=vm.createContext(sandbox);
const names=['tehranDayKey','readOpportunityHistory','recordOpportunityHistory','opportunityHistorySummary'];
const snippets=[];
for(const name of names){
  const start=source.indexOf(`function ${name}(`);
  if(start<0)throw new Error(`Missing ${name}`);
  const tail=source.slice(start),next=tail.slice(1).search(/\nfunction\s+[A-Za-z_$][\w$]*\s*\(/);
  snippets.push(tail.slice(0,next<0?tail.length:next+1));
}
const constant=source.match(/const OPPORTUNITY_HISTORY_KEY='[^']+';/)?.[0];
if(!constant)throw new Error('Daily opportunity history key missing');
vm.runInContext(constant+'\n'+snippets.join('\n'),context);
const op={triggerReady:false,coin:{nobitexSymbol:'BTCUSDT',symbol:'BTC'},triggerCandleAt:1000};
context.recordOpportunityHistory(op);
if(JSON.parse(store.get('nb4:opportunity-history-v1')||'[]').length!==0)throw new Error('Unconfirmed setup was counted');
op.triggerReady=true;op.strategyId='pullback';op.strategy='اصلاح و بازگشت';op.opportunityScore=82;op.entryReference=100;op.target=106;op.stopLoss=97;op.rrNet=2.2;
context.recordOpportunityHistory(op);
op.triggerCandleAt=2000;context.recordOpportunityHistory(op);
const rows=JSON.parse(store.get('nb4:opportunity-history-v1')||'[]');
if(rows.length!==1||rows[0].symbol!=='BTCUSDT')throw new Error('Duplicate setup was not de-duplicated');
const summary=context.opportunityHistorySummary();
if(summary.today!==1)throw new Error('Tehran daily count did not include the confirmed setup');
console.log('Daily opportunity history checks passed: only confirmed triggers counted, duplicate candle suppressed, Tehran day key validated.');
