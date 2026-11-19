import assert from 'node:assert/strict';
import {textHash} from '../supabase/functions/recognize-order/match-profile.ts';
import {readRpcResponse,safeCode} from '../supabase/functions/_shared/ai-rpc.ts';

// Invoke actual HTTP entrypoints. SQL void must be an empty HTTP body, not JSON null.
const handlers:any[]=[];
const env:any={SUPABASE_URL:'https://synthetic.example',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',ZY_ALLOWED_ORIGINS:'https://site.example',AI_PROVIDER:'deepseek',DEEPSEEK_ENABLED:'true',DEEPSEEK_MODEL:'deepseek-chat',DEEPSEEK_API_KEY:'synthetic-provider'};
(globalThis as any).Deno={env:{get:(key:string)=>env[key]},serve:(handler:any)=>handlers.push(handler)};
await import('../supabase/functions/ai-matching/index.ts');
await import('../supabase/functions/classification-worker/index.ts');
const [matching,worker]=handlers,P=(globalThis as any).ZYOrderParser;
const input={history:[{position:'合成仓管员',duties:'合成库存管理',employer:'合成公司',period:'2020-2024'}],certificates:'',intents:[]};
const original={...P.parse('岗位：合成仓务员\n性别：男\n工资：HKD18000\n工作内容：合成库存管理','ZY-26-1118-01'),id:'synthetic-order',price:'3.8w',status:'ready'};
const order={...original,...P.humanReviewMetadata(original,'synthetic-admin')};
const profile={summary:'具有合成仓储经验',skills:[{name:'合成库存管理',evidence:'合成库存管理'}],directions:[{major:'logistics',name:'合成仓储',years:3,evidence:'合成仓管员'}]};
let cachedProfile:any=null,cachedMatches:any[]=[],modelCalls=0,finishedProfiles=0,finishedBatches=0,finishedTasks=0;
let voidMode='204',meterFailure='',taskMode=false,profileJob=false;
const events:string[]=[],logs:string[]=[];
const realError=console.error;console.error=(...args:any[])=>logs.push(args.join(' '));
const voidResponse=()=>voidMode==='204'?new Response(null,{status:204}):new Response(voidMode==='empty'?'':' \n\t ',{status:200});
const kindInput={title:'合成仓务员',workContent:'合成库存管理'};
const cacheRow={text_hash:await textHash('order',kindInput),kind:'order',major:'logistics',subcategory_id:'synthetic-category',evidence:'合成仓务员',by:'ai'};
globalThis.fetch=async(url:any,options:any)=>{
 const target=String(url),body=JSON.parse(options.body||'{}');
 if(target.includes('/rest/v1/rpc/')){
  const name=target.split('/').at(-1)!;events.push(name);
  if(name==='zy_session')return Response.json({user:{id:'synthetic-actor',role:'admin'}});
  if(name==='zy_classification_worker_authorized')return Response.json(true);
  if(name==='zy_ai_pending_profiles')return Response.json(profileJob?[{actor:'synthetic-actor',worker_id:'synthetic-worker'}]:[]);
  if(name==='zy_ai_worker_context'||name==='zy_ai_service_context')return Response.json({input,input_hash:'a'.repeat(64),profile:cachedProfile,worker:{gender:'男',age:'40'},orders:[order],taxonomy:{subcategories:[],cache:[]},taxonomy_hash:'synthetic-taxonomy'});
  if(name==='zy_ai_inference_claim')return Response.json({lease:'synthetic-profile-lease'});
  if(name==='zy_ai_inference_meter'){
   if(meterFailure==='http')return new Response('PRIVATE-DATABASE-ERROR',{status:503});
   if(meterFailure==='json')return new Response('PRIVATE-INVALID-RPC-BODY',{status:200});
   if(meterFailure==='network')throw Error('PRIVATE-NETWORK-ERROR');
   return voidResponse();
  }
  if(name==='zy_ai_inference_finish'){
   if(body.p_result){cachedProfile=body.p_result;finishedProfiles++}return Response.json(true);
  }
  if(name==='zy_ai_cached_matches')return Response.json(cachedMatches);
  if(name==='zy_ai_match_claim_batch')return Response.json(body.p_keys.map((key:string)=>({key,lease:'synthetic-match-lease'})));
  if(name==='zy_ai_match_finish_batch'){
   finishedBatches++;cachedMatches=body.p_items.filter((item:any)=>item.result).map((item:any)=>({cache_key:item.key,result:item.result}));
   return Response.json(body.p_items.map((item:any)=>({key:item.key,saved:true})));
  }
  if(name==='zy_classification_task_claim')return Response.json(taskMode?{id:'synthetic-task',actor:'synthetic-actor',lease:'synthetic-lease',items:[{id:1,kind:'order',input:kindInput}],taxonomy:{subcategories:[],cache:[cacheRow]}}:null);
  if(name==='zy_classification_task_finish'){assert.deepEqual(body.p_done,[1]);finishedTasks++;return voidResponse()}
  throw Error('Unexpected synthetic RPC '+name);
 }
 assert(target.includes('api.deepseek.com'));events.push('model');modelCalls++;
 const source=JSON.parse(body.messages[1].content);
 const result=source.history?profile:{items:source.items.map((item:any)=>({index:item.index,level:'high',reason:'合成库存管理经历支持该岗位',missing:[],evidence:'合成仓管员'}))};
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
};
const request=(body:any)=>new Request('https://synthetic.example',{method:'POST',headers:{origin:'https://site.example',authorization:'Bearer synthetic-user'},body:JSON.stringify({workerId:'synthetic-worker',...body})});
const workerRequest=()=>new Request('https://synthetic.example',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)}});
function reset(){cachedProfile=null;cachedMatches=[];modelCalls=0;finishedProfiles=0;finishedBatches=0;finishedTasks=0;events.length=0;logs.length=0;meterFailure='';taskMode=false;profileJob=false}
try{
 for(voidMode of ['204','empty','whitespace']){
  reset();const response=await matching(request({action:'prepare'}));assert.equal(response.status,200);assert.equal((await response.json()).status,'ready');
  assert.equal(modelCalls,1);assert.equal(finishedProfiles,1);assert(events.indexOf('model')>events.indexOf('zy_ai_inference_meter'));
  const matched=await matching(request({action:'match',orderIds:['synthetic-order']}));assert.equal(matched.status,200);assert.equal((await matched.json()).items[0].result.level,'high');assert.equal(modelCalls,2);assert.equal(finishedBatches,1);
  const repeat=await matching(request({action:'prepare'}));assert.equal(repeat.status,200);assert((await repeat.json()).items[0].result);assert.equal(modelCalls,2);assert.equal(logs.length,0);
  // A real task-finish 204/empty body must not turn successful background work into HTTP 503.
  taskMode=true;const tick=await worker(workerRequest());assert.equal(tick.status,200);assert.deepEqual(await tick.json(),{processed:true});assert.equal(finishedTasks,1);assert.equal(logs.length,0);
  reset();profileJob=true;const profileTick=await worker(workerRequest());assert.equal(profileTick.status,200);assert.equal(modelCalls,1);assert.equal(finishedProfiles,1);assert.equal(logs.length,0);
 }
 for(const [failure,code] of [['json','AI_RPC_RESPONSE_INVALID'],['http','AI_DATABASE_UNAVAILABLE'],['network','AI_DATABASE_UNAVAILABLE']]){
  reset();meterFailure=failure;const response=await matching(request({action:'prepare'}));assert.equal(response.status,503);const result=await response.json();assert.equal(result.code,code);assert.equal(modelCalls,0);assert.equal(finishedProfiles,0);
  const diagnostics=logs.map(line=>JSON.parse(line));assert(diagnostics.some(row=>row.code===code&&row.step==='zy_ai_inference_meter'));
  for(const diagnostic of diagnostics)assert.deepEqual(Object.keys(diagnostic).sort(),['code','step']);assert(!JSON.stringify(logs).includes('PRIVATE'));assert(!JSON.stringify(result).includes('PRIVATE'));
  reset();profileJob=true;meterFailure=failure;await worker(workerRequest());assert.equal(modelCalls,0);assert(logs.some(line=>JSON.parse(line).code===code));
 }
 // Preserve JSON scalars and classify RPC decoding separately from malformed model JSON.
 assert.equal(await readRpcResponse(Response.json(false),'zy_session'),false);
 assert.equal(await readRpcResponse(Response.json(null),'zy_session'),null);
 assert.equal(safeCode(Error('AI_DATABASE_UNAVAILABLE')),'AI_DATABASE_UNAVAILABLE');
 assert.equal(safeCode(Error('AI_RPC_RESPONSE_INVALID')),'AI_RPC_RESPONSE_INVALID');
 assert.equal(safeCode(Error('AI_INVALID_JSON')),'AI_INVALID_JSON');
}finally{console.error=realError}
console.log('PASS: actual HTTP entrypoints accept 204/empty RPC bodies, reach model, persist profile/matches, reuse cache, finish background work and emit only safe code/step diagnostics');
