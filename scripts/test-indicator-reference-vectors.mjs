import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=await readFile(path.join(root,'web/app.js'),'utf8');
const fixture=JSON.parse(await readFile(path.join(root,'scripts/fixtures/talib-rsi-reference.json'),'utf8'));
const start=app.indexOf('function rsiSeries(');if(start<0)throw new Error('rsiSeries missing');
const next=app.slice(start).search(/\nfunction\s+[A-Za-z_$][\w$]*\s*\(/);
const source=app.slice(start,next<0?app.length:start+next);
const context=vm.createContext({Math,Array,Number});vm.runInContext(source+'\nthis.rsiSeries=rsiSeries;',context);
for(const item of fixture.cases){const results=context.rsiSeries(item.values,fixture.period).filter(Number.isFinite);if(item.expectedTail){if(results.length!==item.expectedTail.length)throw new Error(`${item.id}: output length ${results.length}, expected ${item.expectedTail.length}`);for(let i=0;i<results.length;i++)if(Math.abs(results[i]-item.expectedTail[i])>1e-9)throw new Error(`${item.id}[${i}]: expected ${item.expectedTail[i]}, got ${results[i]}`);}else{const result=results.at(-1);if(!Number.isFinite(result)||Math.abs(result-item.expected)>1e-10)throw new Error(`${item.id}: expected ${item.expected}, got ${result}`);}}
console.log(`External TA-Lib reference vectors passed: ${fixture.cases.length} RSI boundary cases (${fixture.reference}).`);
