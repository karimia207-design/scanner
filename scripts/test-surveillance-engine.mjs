import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,'web/app.js'),'utf8');
function extract(name){const start=source.indexOf(`function ${name}(`);if(start<0)throw new Error(`Missing ${name}`);const tail=source.slice(start),next=tail.slice(1).search(/\nfunction\s+[A-Za-z_$][\w$]*\s*\(/);return tail.slice(0,next<0?tail.length:next+1);}
const context=vm.createContext({
  prefs:{minVolume:10000,maxSpread:.004,minRR:2},
  Number,Math,Array,Object,String,Date,
  console
});
vm.runInContext(extract('clampScore')+'\n'+extract('computeTradeabilityScore')+'\n'+extract('computeSurveillanceEligibility'),context);
const coin={volume:5000,quoteAt:1000000,marketClosed:false,bestAsk:100,price:100};
const risk={entry:100,stopLoss:97,takeProfit:103,rrNet:1.2,spread:.006,integrity:{valid:true}};
const discovery={candidate:true,score:84,resistanceRoom:3};
const analysis={backtestMode:false,snapshotMeta:{dataCoherent:true},risk};
const surveillance=context.computeSurveillanceEligibility(coin,analysis,discovery,{marketHealthy:true,now:1010000});
if(!surveillance.eligible)throw new Error('Surveillance must remain eligible when only economic execution gates fail');
const trade=context.computeTradeabilityScore(coin,risk,discovery);
if(!Number.isFinite(trade.score)||trade.score<0||trade.score>100)throw new Error('Tradeability score out of range');
if(!trade.reasons.some(x=>x.includes('حجم'))||!trade.reasons.some(x=>x.includes('اسپرد'))||!trade.reasons.some(x=>x.includes('R/R')))throw new Error('Tradeability blockers were not surfaced');
const stale=context.computeSurveillanceEligibility({...coin,quoteAt:1},analysis,discovery,{marketHealthy:true,now:1010000});
if(stale.eligible||!stale.reasons.some(x=>x.includes('قدیمی')))throw new Error('Stale quote was not rejected from surveillance');
const incoherent=context.computeSurveillanceEligibility(coin,{...analysis,snapshotMeta:{dataCoherent:false}},discovery,{marketHealthy:true,now:1010000});
if(incoherent.eligible)throw new Error('Incoherent 1H/4H snapshot was admitted to surveillance');
const invalidRisk=context.computeSurveillanceEligibility(coin,{...analysis,risk:{...risk,integrity:{valid:false}}},discovery,{marketHealthy:true,now:1010000});
if(invalidRisk.eligible)throw new Error('Invalid canonical risk snapshot was admitted to surveillance');
const closed=context.computeSurveillanceEligibility({...coin,marketClosed:true},analysis,discovery,{marketHealthy:true,now:1010000});
if(closed.eligible)throw new Error('Closed market was admitted to surveillance');
const unhealthy=context.computeSurveillanceEligibility(coin,analysis,discovery,{marketHealthy:false,now:1010000});
if(unhealthy.eligible)throw new Error('Unhealthy market state was admitted to live surveillance');
const wideStop=context.computeSurveillanceEligibility(coin,{...analysis,risk:{...risk,stopLoss:90}},discovery,{marketHealthy:true,now:1010000});
if(wideStop.eligible)throw new Error('Stop distance over 8% was admitted to surveillance');
console.log('Surveillance/entry separation checks passed: economic gates do not block observation; stale, incoherent, invalid-risk, closed-market and excessive-stop candidates are rejected.');
