import {matchInput,flatItems,itemInput,textHash,validateRow,matchPrompt,batchSchema} from './match-profile.ts';
async function runClassification(ctx:any){
 const {base,headers,body,member}=ctx,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const rpc=async(name:string,data:any={},privileged=false)=>{if(name==='zy_job_taxonomy'&&ctx.taskTaxonomy)return ctx.taskTaxonomy;ctx.phase=name;const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:privileged?{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'}:headers,body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});if(!response.ok){let detail:any={};try{detail=await response.json()}catch{}const err:any=Error('classification-rpc');err.code=detail.code==='54000'?'CLASSIFICATION_QUOTA_EXHAUSTED':detail.code==='42501'?'CLASSIFICATION_PERMISSION_DENIED':detail.code==='55000'?'CLASSIFICATION_READ_ONLY':'CLASSIFICATION_DATABASE_ERROR';err.status=detail.code==='54000'?429:detail.code==='42501'?403:detail.code==='55000'?409:503;throw err}return await response.json()};
 if(!member?.user?.id)return {status:403,data:{error:'需要有效的团队账号'}};
 if(body.action==='classification-manage'){if(member.user.role!=='admin')return {status:403,data:{error:'仅管理员可管理分类'}};return {status:200,data:await rpc('zy_job_manage',{p_action:body.operation,p_data:body.data})}}
 if(body.action==='classification-batch'&&member.user.role!=='admin')return {status:403,data:{error:'仅管理员可运行批量回填'}};
 if(!service)return {status:503,data:{error:'归类服务尚未部署，使用规则兜底'}};
 let input:any,items:any[];
 try{if(body.action==='match-profile'){input=matchInput(body.input,body.kind);items=flatItems(input,body.kind)}else{if(!Array.isArray(body.items)||body.items.length>20)throw Error();items=body.items.map((x:any,index:number)=>({kind:x.kind,input:itemInput(x.input,x.kind),slot:index}))}}catch{return {status:400,data:{error:'归类输入无效'}}}
 const taxonomy=await rpc('zy_job_taxonomy'),dictionary=taxonomy.subcategories||[],unique:any[]=[],results=new Map<string,any>();
 for(const item of items){item.text_hash=await textHash(item.kind,item.input);const cached=taxonomy.cache?.find((c:any)=>c.text_hash===item.text_hash);if(cached&&(!body.force||cached.by==='user')&&Object.values(item.input).some(t=>typeof t==='string'&&t.includes(cached.evidence))){results.set(item.text_hash,cached);continue}if(item.kind==='order'&&!item.input.title.trim()&&!item.input.workContent.trim()||item.kind==='history'&&!item.input.position.trim()&&!item.input.duties.trim())continue;if(!unique.some(x=>x.text_hash===item.text_hash))unique.push(item)}
 const hadMisses=unique.length>0;
 if(unique.length){
  const ticket=crypto.randomUUID();try{
  const claim=await rpc('zy_job_claim',{p_actor:member.user.id,p_hashes:unique.map(x=>x.text_hash),p_ticket:ticket,p_force:!!body.force},true);
  for(const r of claim.cached||[])results.set(r.text_hash,r);
  if(claim.busy?.length)return {status:409,data:{error:'相同职位正在归类，请稍后重试'}};
  const claimed=new Set(claim.claimed||[]);for(let i=unique.length-1;i>=0;i--)if(!claimed.has(unique[i].text_hash))unique.splice(i,1);
  if(unique.length){
  if(unique.length>20)return {status:400,data:{error:'每次最多归类20项'}};
  const deepseek=(Deno.env.get('AI_PROVIDER')||'gemini')==='deepseek',secret=Deno.env.get(deepseek?'DEEPSEEK_API_KEY':'GEMINI_API_KEY')||'',model=Deno.env.get(deepseek?'DEEPSEEK_MODEL':'GEMINI_MODEL')||'',enabled=Deno.env.get(deepseek?'DEEPSEEK_ENABLED':'GEMINI_ENABLED')==='true';
  if(!enabled||!secret||!(deepseek?/^deepseek-[a-z0-9._-]{1,100}$/:/^gemini-[a-z0-9._-]{1,100}$/).test(model))return {status:503,data:{error:'AI尚未启用，使用规则兜底'}};
  await rpc('zy_job_reserve',{p_actor:member.user.id},true);
  const source=JSON.stringify({dictionary:dictionary.filter((s:any)=>!s.merged_into).map((s:any)=>({id:s.id,major:s.major,name:s.name,aliases:s.aliases})),items:unique.map((x,index)=>({index,kind:x.kind,input:x.input}))});
  ctx.phase='model';ctx.modelTimeout=body.action==='classification-batch'?60000:20000;const response=deepseek?await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},signal:AbortSignal.timeout(ctx.modelTimeout),body:JSON.stringify({model,temperature:0,messages:[{role:'system',content:matchPrompt},{role:'user',content:source}],response_format:{type:'json_object'},max_tokens:8192,stream:false})}):await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',headers:{'x-goog-api-key':secret,'Content-Type':'application/json'},signal:AbortSignal.timeout(ctx.modelTimeout),body:JSON.stringify({systemInstruction:{parts:[{text:matchPrompt}]},contents:[{role:'user',parts:[{text:source}]}],generationConfig:{temperature:0,maxOutputTokens:8192,responseMimeType:'application/json',responseSchema:batchSchema}})});
  if(!response.ok)return {status:503,data:{error:response.status===429?'AI供应商限流，请稍后继续；不是系统分类额度耗尽':response.status===401||response.status===403?'AI供应商鉴权失败，请检查现有服务端配置':'AI供应商暂不可用，已完成结果保留',code:response.status===429?'CLASSIFICATION_PROVIDER_RATE_LIMIT':response.status===401||response.status===403?'CLASSIFICATION_PROVIDER_AUTH':'CLASSIFICATION_PROVIDER_UNAVAILABLE',providerStatus:response.status}};const text=await response.text();if(text.length>250000)throw Object.assign(Error('oversize'),{code:'CLASSIFICATION_RESPONSE_TOO_LARGE',status:502});const data=JSON.parse(text),candidate=deepseek?data.choices?.[0]:data.candidates?.[0];if((deepseek?candidate?.finish_reason:candidate?.finishReason)!==(deepseek?'stop':'STOP'))throw Object.assign(Error('incomplete'),{code:'CLASSIFICATION_RESPONSE_INCOMPLETE',status:502});const parsed=JSON.parse(deepseek?candidate.message?.content||'':(candidate.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>p.text||'').join('')),validated=[];
  for(const r of Array.isArray(parsed.items)?parsed.items:[]){if(!Number.isInteger(r.index)||r.index<0||r.index>=unique.length)continue;const item=unique[r.index],row=validateRow(r,item.input,dictionary);if(row&&row.major!=='other'&&!validated.some((x:any)=>x.text_hash===item.text_hash))validated.push({...row,kind:item.kind,text_hash:item.text_hash})}
  const saved=await rpc('zy_job_classification_commit',{p_actor:member.user.id,p_items:validated},true);for(const r of saved.items||[])results.set(r.text_hash,r);
  }
  }finally{const phase=ctx.phase;try{await rpc('zy_job_release',{p_ticket:ticket},true)}catch{}finally{ctx.phase=phase}}
 }
 const latest=hadMisses?await rpc('zy_job_taxonomy'):taxonomy;
 if(body.action==='classification-batch')return {status:200,data:{items:items.map((item,index)=>({index,text_hash:item.text_hash,result:results.get(item.text_hash)||null})),taxonomy:latest}};
 const rows=items.map(item=>({...results.get(item.text_hash),index:item.slot,kind:item.kind})).filter(x=>x.major),profile=body.kind==='order'?rows[0]||null:{intents:rows.filter(r=>r.kind==='intent'),history:rows.filter(r=>r.kind==='history'),certificates:rows.filter(r=>r.kind==='certificate')};
 return {status:200,data:{matchProfile:profile,taxonomy:latest}};
}

// Return only fixed diagnostics, never provider bodies, SQL messages or source data.
export async function classificationRequest(ctx:any){
 try{return await runClassification(ctx)}catch(e){
  const err=e as any,timeout=err?.name==='TimeoutError'||err?.name==='AbortError',model=ctx.phase==='model';
  const code=timeout?(model?'CLASSIFICATION_MODEL_TIMEOUT':'CLASSIFICATION_DATABASE_TIMEOUT'):err?.code||(err instanceof SyntaxError?'CLASSIFICATION_RESPONSE_INVALID':'CLASSIFICATION_SERVICE_ERROR');
  const messages:Record<string,string>={CLASSIFICATION_MODEL_TIMEOUT:'AI归类等待60秒后超时，已完成结果保留，请稍后继续',CLASSIFICATION_DATABASE_TIMEOUT:'分类数据库请求超时，已完成结果保留',CLASSIFICATION_QUOTA_EXHAUSTED:'系统今日分类额度已用完',CLASSIFICATION_PERMISSION_DENIED:'分类数据库权限检查失败',CLASSIFICATION_READ_ONLY:'系统暂停写入，分类已停止',CLASSIFICATION_DATABASE_ERROR:'分类数据库操作失败，请检查部署与权限',CLASSIFICATION_RESPONSE_INVALID:'AI返回格式无效，已完成结果保留',CLASSIFICATION_RESPONSE_INCOMPLETE:'AI返回被截断，已完成结果保留',CLASSIFICATION_RESPONSE_TOO_LARGE:'AI返回过大，已完成结果保留'};
  return {status:timeout?504:err?.status||(err instanceof SyntaxError?502:503),data:{error:code==='CLASSIFICATION_MODEL_TIMEOUT'?`AI归类等待${(ctx.modelTimeout||60000)/1000}秒后超时，已完成结果保留，请稍后继续`:messages[code]||'归类服务异常，已完成结果保留',code,stage:ctx.phase||'input'}};
 }
}
