import {classificationRequest} from '../recognize-order/classification-handler.ts';

// All continuation state is in Postgres. A scheduler tick processes at most one batch.
export async function runTaskStep(rpc:any, base:string){
 const task=await rpc('zy_classification_task_claim');
 if(!task)return {processed:false};
 const items=task.items;
 const result=await classificationRequest({base,headers:{},body:{action:'classification-batch',items},
  member:{user:{id:task.actor,role:'admin'}},taskTaxonomy:task.taxonomy});
 let done:number[]=[],code=result.data.code;
 if(result.status===200){
  done=result.data.items.filter((x:any)=>x.result).map((x:any)=>items[x.index].id);
  code=done.length===items.length?null:'CLASSIFICATION_RESPONSE_INCOMPLETE';
 }else if(!code){
  code=result.status===400?'CLASSIFICATION_INPUT_INVALID':result.status===409?'CLASSIFICATION_BUSY':'CLASSIFICATION_SERVICE_ERROR';
 }
 await rpc('zy_classification_task_finish',{p_id:task.id,p_lease:task.lease,p_done:done,p_code:code});
 return {processed:true};
}
