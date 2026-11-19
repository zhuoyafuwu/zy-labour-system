import {textHash} from '../recognize-order/match-profile.ts';
import '../../../dist/business-time.js';
import '../../../dist/order-parser.js';
import '../../../dist/human-save.js';
import {scrub,hash,hardFailure,validateProfile,validateMatches,profilePrompt,matchPrompt} from './contracts.ts';
import {reportAIError} from '../_shared/ai-rpc.ts';
export {safeCode} from '../_shared/ai-rpc.ts';
const H=(globalThis as any).ZYHumanSave;
export function releaseReady(order:any){return H.isReady(order)}
export async function modelJSON(prompt:string,input:any,timeout=25000){
 const env=(globalThis as any).Deno.env,provider=env.get('AI_PROVIDER')||'gemini',deepseek=provider==='deepseek',prefix=deepseek?'DEEPSEEK':'GEMINI',model=env.get(prefix+'_MODEL'),key=env.get(prefix+'_API_KEY');
 if(!['deepseek','gemini'].includes(provider)||env.get(prefix+'_ENABLED')!=='true'||!key||!model)throw Error('AI_DISABLED');
 const source=JSON.stringify(scrub(input));if(source.length>200000)throw Error('AI_INPUT_TOO_LARGE');
 const response=await fetch(deepseek?'https://api.deepseek.com/chat/completions':'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',headers:deepseek?{Authorization:'Bearer '+key,'Content-Type':'application/json'}:{'x-goog-api-key':key,'Content-Type':'application/json'},signal:AbortSignal.timeout(timeout),body:JSON.stringify(deepseek?{model,temperature:0,messages:[{role:'system',content:prompt},{role:'user',content:source}],response_format:{type:'json_object'},max_tokens:8192,stream:false}:{systemInstruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:source}]}],generationConfig:{temperature:0,maxOutputTokens:8192,responseMimeType:'application/json'}})});
 if(!response.ok)throw Error(response.status===429?'AI_PROVIDER_THROTTLED':'AI_PROVIDER_FAILED');const text=await response.text();if(text.length>250000)throw Error('AI_RESPONSE_TOO_LARGE');let data;try{data=JSON.parse(text)}catch{throw Error('AI_INVALID_JSON')}
 const candidate=deepseek?data.choices?.[0]:data.candidates?.[0];if((deepseek?candidate?.finish_reason:candidate?.finishReason)!==(deepseek?'stop':'STOP'))throw Error('AI_INCOMPLETE');
 try{return JSON.parse(deepseek?candidate.message?.content:(candidate.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join(''))}catch{throw Error('AI_INVALID_JSON')}
}
export async function ensureProfile(rpc:any,actor:string,workerId:string,ctx:any,force=false){
 if(ctx.profile&&!force)return ctx.profile;
 const claim=await rpc('zy_ai_inference_claim',{p_actor:actor,p_worker_id:workerId,p_kind:'profile',p_key:await hash(workerId+':'+ctx.input_hash)},true);if(!claim)return null;
 let result:any=null,code:any=null,step='profile_meter';
 try{await rpc('zy_ai_inference_meter',{p_actor:actor,p_kind:'profile',p_manual:force},true);step='profile_model';const output=await modelJSON(profilePrompt,ctx.input);step='profile_validation';result=validateProfile(output,scrub(ctx.input))}catch(e){code=reportAIError(e,step)}
 const saved=await rpc('zy_ai_inference_finish',{p_actor:actor,p_worker_id:workerId,p_kind:'profile',p_key:await hash(workerId+':'+ctx.input_hash),p_lease:claim.lease,p_profile_hash:ctx.input_hash,p_order_id:null,p_order_hash:null,p_result:result,p_code:code},true);
 if(!saved)return null;if(code)throw Error(code);return result;
}
export async function prepareMatches(ctx:any,profile:any,workerId:string,cached:any[]=[]){
 const profileVersion=await hash([workerId,ctx.input_hash,profile]),rows=[];
 for(const original of ctx.orders||[]){if(!releaseReady(original))continue;const order=original,hard=hardFailure(ctx.worker,order);if(hard.length){rows.push({orderId:order.id,hard:true,result:{level:'excluded',reason:hard.join('；'),missing:[],evidence:''}});continue}
  const awaitHash=await textHash('order',order);const cache=(ctx.taxonomy?.cache||[]).find((c:any)=>c.text_hash===awaitHash),manual=cache?.by==='user'?cache:order.matchProfile?.by==='user'?order.matchProfile:null;let classification=manual||cache||order.matchProfile||null;if(classification){classification={...classification};const seen=new Set();let sub=(ctx.taxonomy?.subcategories||[]).find((s:any)=>s.id===classification.subcategory_id);while(sub?.merged_into&&!seen.has(sub.id)){seen.add(sub.id);sub=ctx.taxonomy.subcategories.find((s:any)=>s.id===sub.merged_into)}classification={major:sub?.major||classification.major||'other',subcategory_id:sub?.id||classification.subcategory_id||null,name:sub?.name||null,source:classification.by==='user'?'manual':classification.by}}
  const summary=scrub({code:order.code,title:order.title,classification,workContent:order.workContent,requirements:order.requirements,language:order.language,salary:order.salary});
  const orderHash=await hash([summary,ctx.taxonomy_hash]),key=await hash([profileVersion,orderHash]);rows.push({orderId:order.id,key,orderHash,summary,result:cached.find((x:any)=>x.cache_key===key)?.result||null});
 }
 return rows;
}
export async function matchingRequest(ctx:any){
 const {rpc,actor,body}=ctx;if(typeof body.workerId!=='string'||body.workerId.length>100)throw Error('INVALID_WORKER');
 const data=await rpc('zy_ai_worker_context',{p_worker_id:body.workerId});const profile=await ensureProfile(rpc,actor,body.workerId,data,body.action==='profile'&&!!body.force);
 if(!profile)return {status:'pending',profile:null,items:[]};
 if(body.action==='profile')return {status:'ready',profile,inputHash:data.input_hash};
 const cached=await rpc('zy_ai_cached_matches',{p_worker_id:body.workerId}),rows=await prepareMatches(data,profile,body.workerId,cached);
 if(body.action==='prepare')return {status:'ready',profile,inputHash:data.input_hash,items:rows.map(({summary,...row})=>row)};
 if(body.action!=='match'||!Array.isArray(body.orderIds)||body.orderIds.length>30)throw Error('INVALID_BATCH');
 const selected=rows.filter((x:any)=>body.orderIds.includes(x.orderId)),pending=[];
 const claims=await rpc('zy_ai_match_claim_batch',{p_actor:actor,p_worker_id:body.workerId,p_keys:selected.filter((r:any)=>!r.result).map((r:any)=>r.key)},true);
 for(const row of selected){const claim=claims.find((c:any)=>c.key===row.key);if(claim)pending.push({...row,lease:claim.lease})}

 // Every request owns its leases; only safe fixed errors leave this boundary.
 if(pending.length){let results:any[]=[],code:any=null,step='match_meter';try{await rpc('zy_ai_inference_meter',{p_actor:actor,p_kind:'match',p_manual:false},true);step='match_model';const output=await modelJSON(matchPrompt,{profile,items:pending.map((r:any,index:number)=>({index,...r.summary}))},25000);step='match_validation';results=validateMatches(output,pending,profile)}catch(e){code=reportAIError(e,step)}
  const commits=pending.map((row:any,index:number)=>{const result=results.find((r:any)=>r.index===index)||null;return {key:row.key,lease:row.lease,orderId:row.orderId,orderHash:row.orderHash,result,code:code||(!result?'AI_RESULT_MISSING':null)}});
  const saved=await rpc('zy_ai_match_finish_batch',{p_actor:actor,p_worker_id:body.workerId,p_profile_hash:data.input_hash,p_items:commits},true);
  for(const commit of commits){const target=selected.find((x:any)=>x.key===commit.key);if(target&&commit.result&&saved.some((s:any)=>s.key===commit.key&&s.saved))target.result=commit.result;}

  return {status:code?'failed':'ready',code,items:selected.map(({summary,...row}:any)=>row)};
 }
 return {status:'ready',items:selected.map(({summary,...row}:any)=>row)};
}
