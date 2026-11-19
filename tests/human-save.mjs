import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import H from '../dist/human-save.js';
import S from '../dist/order-store.js';
const read=p=>readFileSync(p,'utf8');
const fixtures=JSON.parse(read('tests/fixtures/human-save-cases.json'));
for(const {expectedError,...negative} of fixtures.filter(c=>c.expectedError)){const row={...negative,id:'negative'};assert(H.issues(row,expectedError==='code'?[{...row,id:'duplicate'}]:[]).some(e=>e.field===expectedError))}
const cases=fixtures.filter(c=>!c.expectedError).map(({expected,...row},i)=>({row:{...row,id:'synthetic-'+i,raw:'合成原文【不改】\u0002',createdAt:'2026-11-20T00:00:00Z',price:'3.8w',status:'ready',humanReviewedAt:'unchanged'},expected}));
for(const {row,expected} of cases){const result=H.prepare(row,row);assert.deepEqual(H.issues(result,cases.map(c=>c.row)),[]);assert.deepEqual(result,{...row,...expected});assert.equal(result.raw,row.raw);assert.equal(result.humanReviewedAt,'unchanged')}
const row=cases[0].row;
assert.equal(H.issues({...row,title:' \t\n '}).at(0).field,'title');assert.equal(H.issues({...row,gender:''}).at(0).field,'gender');assert.equal(H.issues(row,[{...row,id:'other'}]).at(0).field,'code');
assert.equal(H.read({salary:1},selector=>selector==='#o-salary'?{value:'  HKD17120+提成,  '}:null).salary,'  HKD17120+提成,  ');
// Protect the actual entry points and their isolated dependencies, not recognition previews.
const forbidden=/\b(?:sanitizeCompany|validateCompany|repairLegacyOrders|present|cleanOrders|formatCompanySalary)\s*\(/;
for(const path of ['dist/human-save.js','dist/human-order-ui.js','dist/order-store.js','dist/company-text.js'])assert(!forbidden.test(read(path)),path+' crossed recognition boundary');
for(const [path,name,target] of [['dist/order-recognition.js','saveOrder','saveHumanOrder'],['dist/batch-editor.js','saveBatch','saveHumanBatch']]){assert(read(path).includes(`window.${name}=async function(){return ${target}()};`),name+' must use the isolated human path')}
const html=read('dist/index.html');assert(html.includes('const o=(orders.find(x=>x.id===editing)||{})'));assert(!html.includes("k==='salary'?ZYOrderParser.formatCompanySalary"));assert(html.includes('human-order-ui.js'));
assert(!sectionAPI().includes('ZYOrderStore.note'));
function sectionAPI(){const s=read('dist/shared.js');return s.slice(s.indexOf('async function api'),s.indexOf('function loginScreen'))}
assert(!read('dist/shared.js').includes('repairLegacyOrders'));assert(!read('dist/shared.js').includes('cleanOrders'));
// Real login/sync functions with mock UI and requests: no business writes.
const shared=read('dist/shared.js');function section(name,next){return shared.slice(shared.indexOf('async function '+name),shared.indexOf('async function '+next))}
let calls=[];const ui={hidden:false,open:false,remove(){},innerHTML:'',textContent:''};
const ctx=vm.createContext({window:{},ZYOrderStore:{note(){}},document:{hidden:false},sessionUser:null,csrf:'',orders:[],revision:0,worker:{},editing:null,selectedOrderId:null,detailTab:'company',view:'dashboard',saving:false,lastSync:0,$:()=>ui,esc:String,go(){},render(){},updateReviewCount(){},api:async(path,opts={})=>{calls.push([path,opts.method||'GET']);return path==='/api/orders'?{orders:[row],revision:1}:{readOnly:false}}});
vm.runInContext(section('enterWorkspace','logout')+section('performSync','migrateLocal'),ctx);await vm.runInContext("enterWorkspace({user:{id:'synthetic',username:'synthetic',role:'staff'},csrf:'synthetic'})",ctx);await vm.runInContext('performSync()',ctx);assert(calls.length>=3);assert(calls.every(([,method])=>method==='GET'));
// Unrelated legacy edits survive a revision race; same-record edits return structured conflict.
let rows=[row,{...row,id:'second',code:'SYN-second'}],revision=1,race=true;S.note({orders:rows,revision});
const request=async(path,{method='GET',body}={})=>{assert.equal(path,'/api/orders');if(method==='GET')return structuredClone({orders:rows,revision});if(race){race=false;rows[1]={...rows[1],notes:'another person'};revision++;throw Object.assign(Error('race'),{code:'40001'})}assert.equal(body.revision,revision);rows=structuredClone(body.orders);revision++;return {revision}};
await S.save({...row,notes:'my exact，文字。'},row,request);assert.equal(rows[1].notes,'another person');assert.equal(rows[0].notes,'my exact，文字。');assert((await S.save({...row,notes:'stale'},row,request)).conflict);
const delta=H.diff({notes:'old',salary:'old'},{notes:'mine',salary:'old'},{notes:'theirs',salary:'new'});assert(delta.find(x=>x.key==='notes').bothChanged);assert(!delta.find(x=>x.key==='salary').useMine);
S.note({orders:[],revision:0,orderStorage:'rows-v1'});let endpoint;await S.save(row,{_version:7},async(p,o)=>{endpoint=[p,o.body];return {version:8}});assert.equal(endpoint[0],'/api/order-save');assert.equal(endpoint[1].baseVersion,7);assert(!('_version' in endpoint[1].order));
console.log('Human save: exact fixtures, blockers, structural boundary, login/sync and optimistic transport passed');
// Save failure preserves every input and leaves a durable error beside an unblocked retry button.
let releaseSave,capturedCandidate,leftEditor=false;const errors=[];
const button={disabled:false,textContent:'保存修改',isConnected:true};
const inputs={'#o-title':{value:'岗位【人工输入】'},'#o-salary':{value:'  HKD17120+提成,  '},'#o-gender':{value:'女'},'#o-code':{value:row.code},'#o-price':{value:'3.8w'}};
const failureCtx=vm.createContext({api(){throw Error('No write expected in mocked transport')},window:{},document:{querySelector:()=>button},$:id=>inputs[id]||null,ZYHumanSave:H,ZYCompanyText:globalThis.ZYCompanyText,ZYOrderStore:{save:async candidate=>{capturedCandidate=candidate;await new Promise(resolve=>releaseSave=resolve);throw Error('合成网络失败')}},orderFields:{title:1,salary:1,gender:1,code:1,price:1},orders:[row],editing:row.id,singleRecognitionMeta:null,status:()=>{throw Error('Existing amount confirmation must not be recomputed')},leaveOrderEditor:()=>{leftEditor=true},__base:row});
vm.runInContext(read('dist/human-order-ui.js'),failureCtx);failureCtx.__error=message=>errors.push(message);vm.runInContext('humanError=__error;humanEditBase=__base',failureCtx);
const failed=vm.runInContext('saveHumanOrder()',failureCtx);assert.equal(button.disabled,true,errors.join(";"));assert.equal(button.textContent,'保存中');releaseSave();await failed;assert.equal(button.disabled,false);assert.equal(button.textContent,'保存修改');assert.equal(errors.at(-1),'合成网络失败');assert.equal(leftEditor,false);assert.equal(capturedCandidate.salary,inputs['#o-salary'].value);assert.equal(capturedCandidate.title,inputs['#o-title'].value);assert.equal(capturedCandidate.raw,row.raw);
// A fresh read used by an audit cannot authorize overwriting unrelated edits.
assert(!sectionAPI().includes('ZYOrderStore.note'));
assert(!read('dist/order-store.js').includes('for(const old of previous)'));
const audit=H.audit(cases.map(c=>c.row));assert.equal(audit.rejectedCount,0);assert.equal(audit.rewrittenCount,0);assert.equal(audit.permittedTransforms.length,2);
console.log('Human UI: busy state, persistent error, input retention, immutable raw and read-only audit passed');
let loginRedirects=0;const authCtx=vm.createContext({cloudMode:false,cloud:null,csrf:'',saving:true,view:'new',loginScreen:()=>loginRedirects++,fetch:async()=>({status:401,ok:false,json:async()=>({error:'synthetic expired session'})})});vm.runInContext(sectionAPI(),authCtx);await assert.rejects(()=>vm.runInContext("api('/api/orders',{method:'PUT',body:{orders:[]}})",authCtx),e=>e.status===401);assert.equal(loginRedirects,0);console.log('Human authentication: expired session preserves editor instead of replacing the page');
// A lost refresh after successful creation must not produce a second ID on retry.
const newIds=[];let generated=0;failureCtx.crypto={randomUUID:()=>`synthetic-retry-${++generated}`};failureCtx.status=()=> 'ready';failureCtx.orders=[];failureCtx.editing=null;failureCtx.ZYOrderStore={save:async candidate=>{newIds.push([candidate.id,candidate.createdAt]);return {order:candidate}}};failureCtx.api=async()=>{throw Error('synthetic refresh failed after commit')};inputs['#raw']={value:'合成新原单'};vm.runInContext('humanEditBase=null;humanDraftIdentity=null',failureCtx);await vm.runInContext('saveHumanOrder()',failureCtx);await vm.runInContext('saveHumanOrder()',failureCtx);assert.equal(generated,1);assert.deepEqual(newIds[0],newIds[1]);console.log('Human retries: stable new-record identity survives a failed post-save refresh');
// Restoring requires a visible page confirmation, never a native blocking dialog.
const restoreNodes={'#modal':{innerHTML:'',close(){}},'#human-restore-confirm':{disabled:false},'#human-restore-error':{textContent:''}};let restoredCalls=0,restoredNavigation=false;failureCtx.$=id=>restoreNodes[id]||null;failureCtx.jsValue=JSON.stringify;failureCtx.saving=false;failureCtx.go=()=>{assert.equal(failureCtx.saving,true);restoredNavigation=true};failureCtx.toast=()=>{};failureCtx.ZYOrderStore={note(){}};failureCtx.api=async path=>{restoredCalls++;return path==='/api/orders'?{orders:[row],revision:9}:{version:9}};vm.runInContext("restoreOrderHistory('synthetic-history',1)",failureCtx);assert.equal(restoredCalls,0);assert(restoreNodes['#modal'].innerHTML.includes('确认恢复'));await vm.runInContext("confirmOrderRestore('synthetic-history',1)",failureCtx);assert.equal(restoredCalls,2);assert(restoredNavigation);assert.equal(failureCtx.saving,false);console.log('Human restore: explicit page confirmation and guarded editor close passed');
