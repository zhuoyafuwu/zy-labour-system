import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),M=require('../dist/matching.js'),T=require('../dist/business-time.js');
const read=p=>readFileSync(p,'utf8'),html=read('dist/index.html'),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Render the actual publication and slip with hostile markup, multiline notes and exact fee text.
const ctx=vm.createContext({esc,orderPublication:o=>({order:o}),persistHumanList(){}});
for(const prefix of ['function priceN(','function feeNote(','function publishedFeeNote(','function publish('])vm.runInContext(html.split('\n').find(line=>line.startsWith(prefix)),ctx);
vm.runInContext(read('dist/ui-system.js'),ctx);
const order={id:'synthetic-order',code:'SYN-UI',title:'仓库理货员（文员）',gender:'男女不限',salary:'  HKD17120+提成,  ',notes:'第一行\n第二行<&>',price:'3.8w',raw:'immutable source',customFeeNote:'人工备注：不改金额 3.8w\n人工第二行。'};
ctx.order=order;const before=JSON.stringify(order),published=vm.runInContext('publish(order)',ctx),slip=vm.runInContext('ZYUI.companySlip(order)',ctx);
assert(slip.includes(esc('工资待遇：'+order.salary)));assert(slip.includes(esc(order.notes)));assert(slip.includes(esc('备注：'+order.customFeeNote)));assert(!slip.includes('<&>'));assert.equal(JSON.stringify(order),before);
let copied;ctx.orders=[order];ctx.navigator={clipboard:{async writeText(text){copied=text}}};ctx.$=()=>({open:false});ctx.toast=()=>{};
const copy=read('dist/order-recognition.js');vm.runInContext(copy.slice(copy.indexOf('async function copyConfirmedOrder'),copy.indexOf('let pendingOrderReview')),ctx);await ctx.copyConfirmedOrder(order.id);assert.equal(copied,published);assert.equal(JSON.stringify(order),before);
// Real matching rules remain read-only, while presentation deduplicates tags and rounds display only.
const worker={id:'synthetic-worker',name:'合成劳工',gender:'男',birthDate:'1980-06-12',desiredJob1:'仓库理货员',workHistory:[{period:'2018-2026',position:'仓库理货员',employer:'合成公司',duties:'货物收发及盘点。'}]};
const dataBefore=JSON.stringify([worker,order]),content={innerHTML:''};const context=vm.createContext({ZYMatching:M,ZYTime:T,ZYClassification:{majorLabel:x=>x,revision:1},ZYI18n:{language:'zh',translate:s=>s},workers:[worker],orders:[order],revision:1,view:'match',sessionUser:{role:'admin'},window:{},document:{activeElement:null,querySelectorAll:()=>[],querySelector:()=>null},$:s=>s==='#content'?content:null,esc,jsValue:v=>esc(JSON.stringify(v)),addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),scrollY:0,orderState:()=> 'ready',orderPublication:o=>({order:o}),setTimeout,clearTimeout});
vm.runInContext(read('dist/match-view.js'),context);vm.runInContext("matchState.workerId='synthetic-worker'",context);
const result=M.matchWorkerToOrder(worker,order);result.ruleScore=72.25;result.ai=true;result.aiReason='合成理由：仓储经验相符。';result.missing=['期望薪金'];result.conditions.items.push(...result.conditions.items);context.result=result;context.order=order;
vm.runInContext("matchState.openOrderId=order.id",context);const row=context.matchRow(result,order);assert(!row.includes('72.25'));assert(row.includes('72/100'));assert(!row.includes('重新分析'));assert(row.includes('合成理由'));
const profile=context.matchProfile(worker,result,{key:'synthetic',results:[result]});assert(!profile.includes('—'));assert(!profile.includes('联系电话'));assert(!profile.includes('3 ·'));
assert.equal(context.matchWorkerLabel({name:'合成劳工'}),'合成劳工');assert(context.matchReason({template:'期望薪资缺失、无法解析或币种不同，未作汇率换算'}).includes('劳工未填期望薪金'));
context.renderMatchPage();assert(!content.innerHTML.includes('分类管理'));assert(content.innerHTML.includes('data-selected="true"'));assert.equal(JSON.stringify([worker,order]),dataBefore);
vm.runInContext('matchState.workerId=null',context);context.renderMatchPage();assert(content.innerHTML.includes('worker-directory'));assert(content.innerHTML.includes('规则高匹配'));assert(!content.innerHTML.includes('请选择一位已登记劳工'));
// Every shared variable resolves; physical PDF dimensions are outside this screen contract.
const tokens=JSON.parse(read('dist/design-tokens.json')),css=['design-tokens','base-layout','workspace-theme','ui-components','unified-ui'].map(n=>read('dist/'+n+'.css')).join('\n');
const defs=new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]));for(const m of css.matchAll(/var\((--[\w-]+)([^)]*)\)/g))assert(defs.has(m[1])||m[2].startsWith(','),'Undefined '+m[1]);assert.equal(tokens.breakpoints['bp-mobile'],639);assert.equal(tokens.breakpoints['bp-tablet'],1099);
console.log('PASS: shared tokens, exact publication/clipboard, immutable data, readable matching, directory and empty-field presentation');
// Actual client coordination: totals/completion timestamp, IDs-only calls and cache reopening.
const calls=[];const ai=vm.createContext({sessionUser:{id:'synthetic-user'},view:'elsewhere',api:async(path,{body})=>{calls.push(body);if(body.action==='prepare')return {profile:{summary:'synthetic'},items:[{orderId:'one',result:{level:'high',reason:'synthetic',missing:[]}},{orderId:'two'}]};return {status:'ready',items:[{orderId:'two',result:{level:'mid',reason:'synthetic',missing:[]}}]}} });
vm.runInContext(read('dist/ai-matching.js'),ai);await ai.ZYAIMatching.start({id:'synthetic-worker'},{key:'synthetic-key',results:[]});const status=ai.ZYAIMatching.state('synthetic-key');assert.equal(status.status,'ready');assert.equal(status.total,2);assert.equal(status.done,2);assert(T.formatDateTime(status.completedAt));const callCount=calls.length;await ai.ZYAIMatching.start({id:'synthetic-worker'},{key:'synthetic-key',results:[]});assert.equal(calls.length,callCount);assert(calls.every(c=>Object.keys(c).every(k=>['action','workerId','orderIds'].includes(k))));
ai.api=async()=>{throw Error('synthetic outage')};await ai.ZYAIMatching.start({id:'synthetic-worker'},{key:'synthetic-failed',results:[]});assert.equal(ai.ZYAIMatching.state('synthetic-failed').status,'failed');
console.log('PASS: AI progress metadata, timestamp, cache reopening, failure state and IDs-only transport');
