/* Human-owned values: no recognition dependencies, punctuation or whitespace cleanup. */
(function(root){
 const text=root.ZYCompanyText||(typeof require==='function'?require('./company-text.js'):null);
 const invisible=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\u2060\ufeff]/g;
 const codeKey=value=>String(value??'').trim().toLowerCase();
 function prepare(values,existing=null){
  const result=text.convert({...existing,...values});
  for(const key of [...text.fields,'code'])if(typeof result[key]==='string')result[key]=result[key].replace(invisible,'');
  if(existing){result.id=existing.id;result.raw=existing.raw;result.createdAt=existing.createdAt}
  return result;
 }
 function issues(candidate,records=[]){const errors=[];
  if(!String(candidate.title??'').trim())errors.push({field:'title',message:'请填写职位名称'});
  if(!['男','女','男女不限'].includes(candidate.gender))errors.push({field:'gender',message:'请选择招聘性别'});
  if(records.some(o=>o.id!==candidate.id&&codeKey(o.code)===codeKey(candidate.code)))errors.push({field:'code',message:'公司单号已存在，请修改'});
  return errors;
 }
 function read(definitions,query,prefix='o'){
  const result={};for(const key of Object.keys(definitions)){const node=query('#'+prefix+'-'+key);if(node)result[key]=node.value}
  const note=query('#'+prefix+'-fee-note');if(note)result.customFeeNote=note.dataset.manual==='true'?note.value:null;
  return result;
 }
 function diff(base,mine,theirs){return [...new Set([...Object.keys(mine),...Object.keys(theirs)])].filter(k=>!['id','raw','createdAt','_version'].includes(k)&&JSON.stringify(mine[k])!==JSON.stringify(theirs[k])).map(key=>({key,mine:mine[key],theirs:theirs[key],bothChanged:JSON.stringify(base?.[key])!==JSON.stringify(mine[key])&&JSON.stringify(base?.[key])!==JSON.stringify(theirs[key]),useMine:JSON.stringify(base?.[key])!==JSON.stringify(mine[key])}))}
 function audit(records){const rejected=[],rewritten=[],permittedTransforms=[];for(const row of records){const next=prepare(row,row),expected=text.convert(row);for(const key of [...text.fields,'code'])if(typeof expected[key]==='string')expected[key]=expected[key].replace(invisible,'');expected.raw=row.raw;expected.createdAt=row.createdAt;expected.id=row.id;const errors=issues(next,records);if(errors.length)rejected.push({code:row.code,fields:errors.map(e=>e.field)});const fields=Object.keys(expected).filter(k=>JSON.stringify(expected[k])!==JSON.stringify(row[k]));if(fields.length)permittedTransforms.push({code:row.code,fields});const unexpected=[...new Set([...Object.keys(next),...Object.keys(expected)])].filter(k=>JSON.stringify(next[k])!==JSON.stringify(expected[k]));if(unexpected.length)rewritten.push({code:row.code,fields:unexpected})}return {total:records.length,rejected,rewritten,permittedTransforms,rejectedCount:rejected.length,rewrittenCount:rewritten.length}}
 function isReady(order){const n=String(order.price??'').match(/\d+(?:\.\d+)?/);return !!n&&+n[0]>0&&issues(order).length===0}
 root.ZYHumanSave={prepare,issues,read,diff,audit,codeKey,isReady};if(typeof module!=='undefined'&&module.exports)module.exports=root.ZYHumanSave;
})(globalThis);
