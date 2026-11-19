/* Per-record optimistic transport. The legacy bridge merges fresh unrelated rows. */
(function(root){
 let baseline=[],storage='legacy';const clone=v=>JSON.parse(JSON.stringify(v)),plain=v=>{const copy={...v};delete copy._version;return copy},same=(a,b)=>JSON.stringify(plain(a||{}))===JSON.stringify(plain(b||{}));
 function note(response){baseline=clone(response.orders);storage=response.orderStorage||'legacy';return response}
 async function save(candidate,base,request){
  if(storage==='rows-v1'){const response=await request('/api/order-save',{method:'POST',body:{order:plain(candidate),baseVersion:base?._version??null}});if(response.conflict&&!response.current.deleted&&same(candidate,response.current.data))return {order:{...response.current.data,_version:response.current.version},version:response.current.version};return response}
  for(let attempt=0;attempt<4;attempt++){
   const current=await request('/api/orders'),theirs=current.orders.find(o=>o.id===candidate.id);
   if(theirs&&same(candidate,theirs))return {order:theirs,revision:current.revision};
   if(!same(base,theirs))return {conflict:true,current:{data:theirs||null,version:theirs?._version??null,deleted:!theirs}};
   const next=theirs?current.orders.map(o=>o.id===candidate.id?plain(candidate):o):[plain(candidate),...current.orders];
   try{const result=await request('/api/orders',{method:'PUT',body:{orders:next,revision:current.revision}});return {order:plain(candidate),revision:result.revision}}
   catch(e){if(!['40001'].includes(e.code)&&e.status!==409)throw e}
  }
  throw Error('其他同事正在保存，请稍后重试；当前输入已保留');
 }
 async function remove(record,request){
  if(storage==='rows-v1')return request('/api/order-delete',{method:'POST',body:{id:record.id,baseVersion:record._version}});
  for(let attempt=0;attempt<4;attempt++){
   const current=await request('/api/orders'),theirs=current.orders.find(o=>o.id===record.id);
   if(!same(record,theirs))return {conflict:true,current:{data:theirs,version:theirs?._version}};
   try{return await request('/api/orders',{method:'PUT',body:{orders:current.orders.filter(o=>o.id!==record.id),revision:current.revision}})}catch(e){if(e.code!=='40001'&&e.status!==409)throw e}
  }throw Error('删除未完成，请刷新后重试');
 }
 async function writeList(next,request,resolve){const previous=clone(baseline);
  const pending=[...next.filter(o=>!previous.some(p=>p.id===o.id)).reverse(),...next.filter(o=>previous.some(p=>p.id===o.id))];
  for(const candidate of pending){const base=previous.find(o=>o.id===candidate.id);if(same(candidate,base))continue;let result=await save(candidate,base,request);if(result.conflict){if(!resolve)throw Error('此单已由同事修改，当前输入已保留');result=await resolve(candidate,base,result)}if(!result)throw Error('保存尚未完成，当前输入已保留')}
  return note(await request('/api/orders'));
 }
 root.ZYOrderStore={note,save,remove,writeList,plain,get storage(){return storage}};if(typeof module!=='undefined'&&module.exports)module.exports=root.ZYOrderStore;
})(globalThis);
