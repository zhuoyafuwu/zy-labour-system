/* Whole-document review shared by single and batch entry. No row-number extraction. */
let singleRecognitionMeta=null;
const recognitionWorkspace=window.newView;
window.newView=function(){
 recognitionWorkspace();
 attachHumanEditor();
 if(mode==='batch'&&!editing)return;
 singleRecognitionMeta=editing?{...(orders.find(o=>o.id===editing)||{})}:null;
 const raw=$('#raw');if(!raw)return;
 const feedback=document.createElement('div');feedback.id='recognition-feedback';feedback.setAttribute('role','status');raw.parentElement.insertBefore(feedback,raw);
 const refresh=()=>{if(!$('#raw'))return;const meta=singleRecognitionMeta||{};if(!ZYOrderParser.isHumanReviewed(meta))meta.reviewConfirmation='';singleRecognitionMeta=meta;recognitionFeedback([])};
 for(const control of $('#content').querySelectorAll('[id^="o-"]'))control.addEventListener(control.tagName==='SELECT'?'change':'input',refresh);
 if(editing){const button=document.createElement('button');button.type='button';button.textContent='按原单重新识别（预览）';button.onclick=reparseExistingOrder;raw.parentElement.querySelector('.note').before(button)}
};
function recognitionFeedback(messages,multi=false){
 const container=$('#recognition-feedback');if(!container)return;
 let notices=container.querySelector('.recognition-messages');if(!notices){notices=document.createElement('div');notices.className='recognition-messages';container.prepend(notices)}
 notices.innerHTML=messages.length?`<div class="note">${messages.map(message=>`<p>${esc(message)}</p>`).join('')}${multi?'<button type="button" onclick="moveSourceToBatch()">转到批量处理</button>':''}</div>`:'';

}
function fillRecognisedFields(order){for(const key of Object.keys(orderFields))$('#o-'+key).value=(key==='salary'?ZYOrderParser.formatCompanySalary(order[key]):order[key])||'';refreshFeeNote();globalThis.ZYUI?.editorPreview()}
function beginRecognitionProgress(button){
 if(!button||button.disabled)return null;
 button.disabled=true;button.setAttribute('aria-busy','true');
 let box=button.parentElement.querySelector('.recognition-progress');
 if(!box){box=document.createElement('span');box.className='recognition-progress';box.setAttribute('role','status');box.innerHTML='<span class="recognition-track" role="progressbar" aria-label="整理进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="recognition-fill"></span></span><b class="recognition-percent">0%</b><span class="recognition-stage"></span><small>等待动画，非实际处理百分比</small>';button.after(box)}
 const bar=box.querySelector('[role="progressbar"]'),fill=box.querySelector('.recognition-fill'),percent=box.querySelector('b'),label=box.querySelector('.recognition-stage');
 function paint(value){fill.style.transform='scaleX('+(value/100)+')';const rounded=Math.floor(value);bar.setAttribute('aria-valuenow',String(rounded));const text=rounded+'%';if(percent.textContent!==text)percent.textContent=text}
 const started=performance.now();paint(5);label.textContent='正在整理，请稍候';
 const timer=setInterval(()=>{if(!box.isConnected){clearInterval(timer);return}paint(Math.min(95,5+90*(1-Math.exp(-(performance.now()-started)/35000))))},350);
 return {update(){},finish(text,complete=false){clearInterval(timer);if(box.isConnected){if(complete)paint(100);label.textContent=text}button.disabled=false;button.removeAttribute('aria-busy')}};
}

window.autoParse=async function(){
 const button=document.querySelector('button[onclick="autoParse()"]'),progress=beginRecognitionProgress(button);if(!progress)return;
 let outcome='整理已停止',complete=false;
 try{
  const element=$('#raw'),owner=sessionUser,formBefore=JSON.stringify(read(orderFields)),original=element.value;
  if(!original.trim()){outcome='请先粘贴原单';return toast(outcome)}
  const input=original.trim();progress.update(25,'规则识别');
  const analysis=ZYOrderParser.analyze(input,code(),{explicitBoundary:true});
  progress.update(40,'检查AI连接');
  const result=await ZYAI.enhance(analysis,(value,text)=>progress.update(value,text));
  progress.update(85,'核对识别结果');
  if(sessionUser!==owner||$('#raw')!==element)return;
  if(JSON.stringify(read(orderFields))!==formBefore||element.value!==original){outcome='表单已修改，未覆盖人工内容';return toast(outcome)}
  if(!result.order){recognitionFeedback(result.warnings,true);outcome=result.warnings[0];return toast(outcome)}
  const order=ZYCompanyText.draft(result.order);if(!order.sourcePrefix&&singleRecognitionMeta?.raw===order.raw){order.sourcePrefix=singleRecognitionMeta.sourcePrefix||'';order.code=ZYOrderParser.companyCode(order.code,order.sourcePrefix)}order.price=suggestion(order.salary);singleRecognitionMeta=order;$('#raw').value=order.raw;fillRecognisedFields(order);priceManual=false;
  recognitionFeedback([]);outcome='整理完成，请核对各项信息';complete=true;toast(outcome);
 }catch{outcome='整理未完成，请重试';toast(outcome)}
 finally{progress.finish(outcome,complete)}
};

function moveSourceToBatch(){batchInput=ZYOrderParser.splitOrders($('#raw').value).join('\n---\n');batch=[];editing=null;mode='batch';newView();previewBatch()}
async function reparseExistingOrder(){
 const owner=sessionUser,element=$('#raw'),formBefore=JSON.stringify(read(orderFields)),input=orders.find(o=>o.id===editing)?.raw||element.value,result=await ZYAI.enhance(ZYOrderParser.analyze(input,$('#o-code').value,{explicitBoundary:true}));
 if(sessionUser!==owner||$('#raw')!==element)return;
 if(JSON.stringify(read(orderFields))!==formBefore)return toast('表单已修改，未覆盖人工内容');
 if(!result.order){recognitionFeedback(result.warnings,true);return}
 const old=orders.find(o=>o.id===editing),fresh=ZYCompanyText.draft(result.order);
 fresh.sourcePrefix=fresh.sourcePrefix||old?.sourcePrefix||$('#o-code').value.match(/ ([A-Z]+)$/)?.[1]||'';
 fresh.code=$('#o-code').value.trim();fresh.price=$('#o-price').value;
 const keys=Object.keys(orderFields).filter(k=>!['code','price'].includes(k));
 window.adoptHumanSuggestion=key=>{const node=$('#o-'+key);if(node){node.value=fresh[key]??'';node.dispatchEvent(new Event('input',{bubbles:true}));humanWarnings()}};
 $('#modal').innerHTML=`<h2>重新识别建议（不会自动替换）</h2><div class="human-conflict-scroll"><table><thead><tr><th>字段</th><th>建议文字</th><th>操作</th></tr></thead><tbody>${keys.map(k=>`<tr><th>${esc(orderFields[k])}</th><td data-user-content>${esc(fresh[k]??'')}</td><td><button onclick="adoptHumanSuggestion('${k}')">采纳此项</button></td></tr>`).join('')}</tbody></table></div><button onclick="$('#modal').close()">返回编辑</button>`;$('#modal').showModal();
}
function recognitionMetadata(order,meta){
 if(!meta)return {};
 let previous={};try{previous=JSON.parse(meta.parsedSnapshot||'{}')}catch{}
 const manual=Object.keys(previous).filter(key=>String(order[key]??'')!==String((key==='salary'?ZYOrderParser.formatCompanySalary(previous[key]):previous[key])??''));
 return {matchProfile:meta.matchProfile||null,aiProvider:meta.aiProvider||'',aiModel:meta.aiModel||'',aiEvidence:meta.aiEvidence||'',aiWarnings:meta.aiWarnings||'',boundaryMode:meta.boundaryMode||'',sourcePrefix:order.sourcePrefix||meta.sourcePrefix||'',parserVersion:meta.parserVersion||'',parsedSnapshot:meta.parsedSnapshot||'',manualFields:JSON.stringify(manual),recognitionAudit:meta.recognitionAudit||'',reviewConfirmation:meta.reviewConfirmation||'',humanReviewedSource:meta.humanReviewedSource||'',humanReviewedAt:meta.humanReviewedAt||'',humanReviewedBy:meta.humanReviewedBy||''};
}
window.saveOrder=async function(){return saveHumanOrder()};
window.copyOrder=async function(id){
 const record=orders.find(o=>o.id===id);if(!record)return;if(priceN(record.price)<=0)return toast('请先确认金额');
 if(view==='orders')return copyConfirmedOrder(id);
 $('#modal').innerHTML=`<h2>复制公司单</h2>${ZYUI.companySlip(record)}<div class="actions"><button onclick="$('#modal').close()">返回</button><button class="primary" onclick="copyConfirmedOrder(${jsValue(id)})">复制公司单</button></div>`;$('#modal').showModal();
};
async function copyConfirmedOrder(id){const record=orders.find(o=>o.id===id);if(!record)return;try{const text=publish(record);await navigator.clipboard.writeText(text);if(typeof markOrderCopied==='function')markOrderCopied(id,text);if($('#modal').open)$('#modal').close();toast('公司单已复制')}catch{toast('复制失败，请保留当前内容后重试')}}

let pendingOrderReview=null;
function reviewList(title,items,userContent=false){return items.length?`<section class="review-dialog-section"><h3>${title}</h3><ul>${items.map(text=>`<li ${userContent?'data-user-content':''}>${esc(text)}</li>`).join('')}</ul></section>`:''}
window.markOrderReviewed=function(id){
 const record=orders.find(order=>order.id===id);if(!record||!sessionUser)return;
 const blockers=ZYHumanSave.issues(record,orders).map(x=>x.message);
 pendingOrderReview={id,record:JSON.stringify(record),owner:sessionUser.id};
 $('#modal').innerHTML=`<h2>确认人工核对</h2><p data-user-content>${esc(record.code)} · ${esc(record.title)}</p><p>请确认已核对公司单信息。</p>${reviewList('请先修改以下问题',blockers)}<div class="actions"><button onclick="$('#modal').close()">取消</button>${blockers.length?'<button class="primary" onclick="editPendingReview()">编辑公司单</button>':'<button class="primary" id="confirm-order-review" onclick="confirmOrderReview()">确认已人工核对</button>'}</div>`;
 $('#modal').showModal();
};
function editPendingReview(){const id=pendingOrderReview?.id;$('#modal').close();if(id)editOrder(id)}
window.confirmOrderReview=async function(){
 const pending=pendingOrderReview,record=orders.find(order=>order.id===pending?.id);if(!record||!sessionUser||sessionUser.id!==pending.owner)return;
 if(JSON.stringify(record)!==pending.record)return toast('订单已变化，请重新打开核对');
 const metadata=ZYOrderParser.humanReviewMetadata(record,sessionUser.username);
 const problems=ZYHumanSave.issues(record,orders).map(x=>x.message);if(problems.length)return toast(problems[0]);
 const before=orders;orders=orders.map(order=>order.id===record.id?{...order,...metadata}:order);
 if(!await persist()){orders=before;return;}
 pendingOrderReview=null;$('#modal').close();render();toast('公司单已人工核对');
};
