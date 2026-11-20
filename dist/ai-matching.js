/* AI metadata lives in server caches. This client sends IDs only, never applicant fields. */
(function(root){
 const states=new Map();let generation=0;
 const state=key=>states.get(key);
 function reset(){generation++;states.clear()}
 function decorate(bundle,worker){const current=states.get(bundle.key);if(!current)return bundle;return {...bundle,results:bundle.results.map(rule=>{
  const result=current.results.get(rule.orderId);if(!result||result.hard)return rule;
  const job=bundle.orders.get(rule.orderId),hard=ZYMatching.checkHardConditions(worker,job).failures.filter(r=>!r.template.startsWith('没有相关工作经历'));if(hard.length)return rule;
  const rank={excluded:0,manual:0,low:1,mid:2,high:3},disagreement=Math.abs(rank[result.level]-(rule.excluded?0:rank[rule.level]||0))>=2,reason=result.reason+(result.level==='excluded'&&result.missing?.length?'；'+result.missing.join('；'):''),exp=rule.experience||ZYMatching.scoreExperience(worker,job),conditions=rule.conditions||ZYMatching.scoreConditions(worker,job),intent=rule.intent||ZYMatching.scoreIntent(worker,job);
  return {...rule,manual:false,excluded:result.level==='excluded',level:result.level,ai:true,aiReason:reason,disagreement,ruleScore:rule.score,score:rule.score??0,experience:exp,conditions,intent,dims:rule.dims||[],missing:result.missing,reasonDetails:[{template:'{reason}',values:{reason},text:reason}],reasons:[reason]};
 })}}
 async function start(worker,bundle,{force=false}={}){
  if(states.has(bundle.key)&&!force)return;const token=generation,user=sessionUser?.id,current={status:'pending',profile:null,results:new Map(),done:0};states.set(bundle.key,current);while(states.size>8)states.delete(states.keys().next().value);
  const active=()=>generation===token&&sessionUser?.id===user&&states.get(bundle.key)===current;
  const paint=()=>{if(active()&&view==='match'&&selectedMatchWorker()?.id===worker.id)renderMatchPage({sync:true})};
  try{if(force)await api('/api/ai-matching',{method:'POST',body:{action:'profile',workerId:worker.id,force:true}});
   let prepared=await api('/api/ai-matching',{method:'POST',body:{action:'prepare',workerId:worker.id}});if(!active())return;for(let wait=0;prepared.status==='pending'&&wait<14&&active();wait++){paint();await new Promise(resolve=>setTimeout(resolve,2000));if(!active())return;prepared=await api('/api/ai-matching',{method:'POST',body:{action:'prepare',workerId:worker.id}})}if(!prepared.profile){current.status='failed';paint();return}
   current.profile=prepared.profile;current.total=prepared.items.length;for(const row of prepared.items)if(row.result){current.results.set(row.orderId,{...row.result,hard:row.hard});current.done++}
   const batches=[];const pending=prepared.items.filter(x=>!x.result).map(x=>x.orderId);for(let i=0;i<pending.length;i+=30)batches.push(pending.slice(i,i+30));paint();
   let next=0,failed=false;await Promise.all(Array.from({length:Math.min(6,batches.length)},async()=>{while(next<batches.length&&active()){const ids=batches[next++];try{const response=await api('/api/ai-matching',{method:'POST',body:{action:'match',workerId:worker.id,orderIds:ids}});if(!active())return;for(const row of response.items||[])if(row.result&&!current.results.has(row.orderId)){current.results.set(row.orderId,{...row.result,hard:row.hard});current.done++}if(response.status==='failed'||response.items?.some(x=>!x.result))failed=true;paint()}catch{failed=true}}}));
   if(active()){current.status=failed?'failed':'ready';if(!failed)current.completedAt=new Date().toISOString();paint()}
  }catch{if(active()){current.status='failed';paint()}}
 }
 async function saved(workerId){try{await api('/api/ai-matching',{method:'POST',body:{action:'profile',workerId}})}catch{/* Durable server job retries after a failed save-time attempt. */}}
 root.ZYAIMatching={state,decorate,start,saved,reset};
})(globalThis);
