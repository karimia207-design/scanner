import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,'web/app.js'),'utf8');
function extract(name){const start=source.indexOf(`function ${name}(`);if(start<0)throw new Error(`Missing ${name}`);const next=source.slice(start).search(/\nfunction\s+[A-Za-z_$][\w$]*\s*\(/);return source.slice(start,next<0?source.length:start+next)}
const fake={
  OPPORTUNITY_STRATEGIES:{trend:{id:'trend',label:'ادامه روند'},pullback:{id:'pullback',label:'اصلاح و بازگشت'},range:{id:'range',label:'برگشت از کف محدوده'},breakout:{id:'breakout',label:'شکست و بازآزمایی'}},
  prefs:{minVolume:10000,maxSpread:.004},
  isTimeframeValid:(f,k)=>!!f?.ready,
  Number,Math,Array,Object,String,Map,Set,
  console
};
const ctx=vm.createContext(fake);
vm.runInContext(extract('clampScore')+'\n'+extract('computeTradeabilityScore')+'\n'+extract('computeOpportunityDiscovery'),ctx);
function frame(score,metrics,rev=40){return {ready:true,trendScore:score,reversalScore:rev,metrics}}
const baseRisk={support:98,ceiling:106,spread:.001,entry:100,stopLoss:97,takeProfit:105,rrNet:2.1};
const coin={bestAsk:100,price:100,volume:500000};
const make=(h4,h1)=>({tfMap:{'1h':frame(h1,{ema9:101,ema20:100,ema50:98,rsi:55,adx:18,plusDI:24,minusDI:18,atr:1.2,volRatio:1.5,lastClose:100,structure:'bullish'},55),'4h':frame(h4.score,{adx:h4.adx,plusDI:24,minusDI:18,structure:h4.structure||'bullish',volRatio:1.1},35)},risk:baseRisk});
const trend=ctx.computeOpportunityDiscovery(coin,make({score:75,adx:26},68));
if(!trend.candidate||!trend.modes.some(x=>x.id==='trend'))throw new Error('Trend continuation candidate not detected');
const pullback=ctx.computeOpportunityDiscovery(coin,make({score:62,adx:23},48));
if(!pullback.candidate||!pullback.modes.some(x=>x.id==='pullback'))throw new Error('Pullback candidate not detected');
const range=ctx.computeOpportunityDiscovery({...coin,bestAsk:100},{...make({score:48,adx:15,structure:'mixed'},48),risk:{...baseRisk,support:99.5,ceiling:104}});
if(!range.candidate||!range.modes.some(x=>x.id==='range'))throw new Error('Range reversal candidate not detected');
const breakout=ctx.computeOpportunityDiscovery(coin,make({score:56,adx:22},48));
if(!breakout.candidate||!breakout.modes.some(x=>x.id==='breakout'))throw new Error('Breakout candidate not detected');
const invalid=ctx.computeOpportunityDiscovery(coin,{tfMap:{'1h':{ready:false},'4h':{ready:false}},risk:baseRisk});
if(invalid.candidate)throw new Error('Invalid mandatory timeframe data was accepted');
if(trend.score<0||trend.score>100)throw new Error('Opportunity score out of range');
if(!Number.isFinite(trend.tradeabilityScore)||trend.tradeabilityScore<0||trend.tradeabilityScore>100)throw new Error('Tradeability score out of range');
if(!Number.isFinite(trend.rankingScore)||trend.rankingScore<0||trend.rankingScore>100)throw new Error('Combined ranking score out of range');
console.log('Multi-strategy discovery checks passed: trend, pullback, range, breakout, tradeability score and mandatory-data rejection.');
