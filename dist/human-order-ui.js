/* Explicit human actions only. Recognition suggestions live in a separate preview. */
let humanSaving=false,humanEditBase=null,humanDraftIdentity=null;
function humanError(message,needsLogin=false){let node=$('#human-save-error');if(!node){node=document.createElement('p');node.id='human-save-error';node.setAttribute('role','alert');($('.human-save-actions')||$('#batchpreview .actions'))?.append(node)}node.hidden=!message;node.textContent=message||'';if(needsLogin){const button=document.createElement('button');button.type='button';button.textContent='重新登录并保留输入';button.onclick=humanReauthenticate;node.append(button)}}
function humanWarnings(){
 const values=ZYHumanSave.read(orderFields,$),keys=ZYCompanyText.fields;
 for(const key of keys){const control=$('#o-'+key);if(!control)continue;let node=document.getElementById('human-warning-'+key);if(!node){node=document.createElement('small');node.id='human-warning-'+key;node.className='human-warning';control.after(node)}
  const text=values[key]||'',messages=[];if(/[【】「」『』\[\]]/.test(text))messages.push('包含括号，将按人工文字保存');if(/扣|住宿打\s*\d|报价|報價|全包/.test(text))messages.push('含收费或扣费字样，请核对；不影响保存');node.textContent=messages.join('；');
 }
}
function attachHumanEditor(){
 humanEditBase=editing?JSON.parse(JSON.stringify(orders.find(o=>o.id===editing))):null;
 const save=document.querySelector('button[onclick="saveOrder()"]');if(!save)return;if(!editing)humanDraftIdentity={id:crypto.randomUUID(),createdAt:new Date().toISOString()};save.parentElement.classList.add('human-save-actions');save.dataset.humanSave='true';
 const node=document.createElement('p');node.id='human-save-error';node.setAttribute('role','alert');node.hidden=true;save.parentElement.append(node);
 for(const field of document.querySelectorAll('[id^="o-"]'))field.addEventListener('input',humanWarnings);
 humanWarnings();ZYUI.editorPreview();if(editing&&sessionUser?.role==='admin'&&ZYOrderStore.storage==='rows-v1'){const button=document.createElement('button');button.textContent='修改历史';button.onclick=()=>showOrderHistory(editing);save.after(button)}
}
async function humanResolveConflict(candidate,base,response){
 if(response.current.deleted||!response.current.data)throw Error('这张单已被删除，当前输入已保留；请先查看修改历史');
 let current={...response.current.data,_version:response.current.version};
 while(response.conflict){if(response.current.deleted||!response.current.data)throw Error('这张单已被删除，当前输入已保留');const decision=await new Promise(resolve=>{
  const rows=ZYHumanSave.diff(base,candidate,current);window.humanConflictChoice=kind=>{let value=candidate;if(kind==='theirs')value=current;if(kind==='merge'){value={...candidate};for(const [i,row] of rows.entries())if(!$('#human-merge-'+i).checked){if(row.theirs===undefined)delete value[row.key];else value[row.key]=row.theirs}}$('#modal').close();$('#modal').oncancel=null;resolve({kind,value})};
  $('#modal').innerHTML=`<h2>这张单已被其他同事修改</h2><p>当前输入已保留。只有同一张单的修改需要确认。</p><div class="human-conflict-scroll"><table class="human-conflicts"><thead><tr><th>字段</th><th>你的内容</th><th>对方内容</th><th>逐项合并</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${r.bothChanged?'both-changed':''}"><th>${esc(orderFields[r.key]||r.key)}</th><td><pre data-user-content>${esc(typeof r.mine==='object'?JSON.stringify(r.mine):r.mine??'')}</pre></td><td><pre data-user-content>${esc(typeof r.theirs==='object'?JSON.stringify(r.theirs):r.theirs??'')}</pre></td><td><label><input id="human-merge-${i}" type="checkbox" ${r.useMine?'checked':''}>使用我的</label></td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="primary" autofocus onclick="humanConflictChoice('mine')">保留我的</button><button onclick="humanConflictChoice('theirs')">采用对方的</button><button onclick="humanConflictChoice('merge')">逐项合并并保存</button><button onclick="humanConflictChoice('cancel')">返回编辑</button></div>`;
  $('#modal').oncancel=e=>{e.preventDefault();window.humanConflictChoice('cancel')};$('#modal').showModal();
 });
 if(decision.kind==='cancel')throw Error('保存尚未完成，当前输入已保留');
 if(decision.kind==='theirs')return {order:current,adopted:true};
 candidate=decision.value;const problems=ZYHumanSave.issues(candidate,orders);if(problems.length)throw Error(problems[0].message);
 response=await ZYOrderStore.save(candidate,current,api);if(response.conflict)current={...response.current.data,_version:response.current.version};
 }return response;
}
async function saveHumanOrder(){
 if(humanSaving)return;humanSaving=true;const button=document.querySelector('[data-human-save]'),label=button?.textContent;if(button){button.disabled=true;button.textContent='保存中'}humanError('');
 try{
  const base=humanEditBase,values=ZYHumanSave.read(orderFields,$),source=base||singleRecognitionMeta||{};if(!base)humanDraftIdentity??={id:crypto.randomUUID(),createdAt:new Date().toISOString()};
  const candidate=ZYHumanSave.prepare({...source,...values,id:base?.id||humanDraftIdentity.id,raw:base?.raw??$('#raw').value,createdAt:base?.createdAt||humanDraftIdentity.createdAt,status:base&&values.price===String(base.price??'')?base.status:status(values.price)},base);
  const issues=ZYHumanSave.issues(candidate,orders);if(issues.length){humanError(issues.map(e=>e.message).join('；'));return}
  let result=await ZYOrderStore.save(candidate,base,api);if(result.conflict)result=await humanResolveConflict(candidate,base,result);
  const latest=await api('/api/orders');ZYOrderStore.note(latest);orders=latest.orders;revision=latest.revision;
  const wasEditing=!!editing;singleRecognitionMeta=null;leaveOrderEditor();if(!wasEditing)showSavedOrder(candidate.id);toast(result.adopted?'已采用对方内容':'劳务单已保存');
 }catch(e){humanError(e.message||'保存失败，当前输入已保留，请重试',e.status===401)}
 finally{humanSaving=false;if(button?.isConnected){button.disabled=false;button.textContent=label}}
}
async function saveHumanBatch(){
 if(!batch.length)return toast('没有可保存的原单');
 const added=batch.map(o=>{o.id??=crypto.randomUUID();o.createdAt??=new Date().toISOString();return ZYHumanSave.prepare({...o,status:status(o.price)})});
 for(let i=0;i<added.length;i++){const problems=ZYHumanSave.issues(added[i],[...orders,...added]);if(problems.length){activeBatch=i;renderBatch();humanError(problems[0].message);return}}
 try{const response=await ZYOrderStore.writeList([...added,...orders],api,humanResolveConflict);orders=response.orders;revision=response.revision;batch=[];batchInput='';activeBatch=0;go('orders',{preserveOrders:true});showSavedOrder(added[0].id);toast('批量劳务单已保存')}catch(e){humanError(e.message,e.status===401)}
}
async function persistHumanList(){try{const response=await ZYOrderStore.writeList(orders,api,humanResolveConflict);orders=response.orders;revision=response.revision;return true}catch(e){humanError(e.message,e.status===401);toast(e.message);return false}}
async function auditHumanOrders(){const response=await api('/api/orders'),report=ZYHumanSave.audit(response.orders);window.lastHumanSaveAudit=report;$('#modal').innerHTML=`<h2>人工保存只读巡检</h2><p>只在内存中检查，没有提交保存。</p><p>总数：${report.total} · 不通过：${report.rejectedCount} · 违规改写：${report.rewrittenCount} · 允许的字形或不可见字符转换：${report.permittedTransforms.length}</p><pre data-user-content>${esc(JSON.stringify({rejected:report.rejected,rewritten:report.rewritten,permittedTransforms:report.permittedTransforms},null,2))}</pre><button onclick="$('#modal').close()">关闭</button>`;$('#modal').showModal();return report}
async function showOrderHistory(id){
 try{const response=await api('/api/order-history',{method:'POST',body:{id}});$('#modal').innerHTML=`<h2>公司单修改历史</h2><div class="human-history">${response.history.map(h=>`<details><summary>版本 ${h.version} · ${esc(h.action)} · ${esc(ZYTime.formatDateTime(h.saved_at))} · <span data-user-content>${esc(h.saved_by_name||'')}</span></summary><pre data-user-content>${esc(JSON.stringify(h.data,null,2))}</pre><button onclick="restoreOrderHistory(${jsValue(id)},${h.version})">恢复此版本</button></details>`).join('')}</div><button onclick="$('#modal').close()">关闭</button>`;$('#modal').showModal()}catch(e){toast(e.message)}
}
function restoreOrderHistory(id,version){$('#modal').innerHTML=`<h2>确认恢复历史版本</h2><p>恢复会生成新的修改历史，当前版本仍可找回。尚未保存的编辑会关闭。</p><p id="human-restore-error" role="alert"></p><div class="actions"><button class="primary" id="human-restore-confirm" onclick="confirmOrderRestore(${jsValue(id)},${Number(version)})">确认恢复</button><button onclick="showOrderHistory(${jsValue(id)})">返回历史</button></div>`}
async function confirmOrderRestore(id,version){const button=$('#human-restore-confirm');button.disabled=true;try{await api('/api/order-restore',{method:'POST',body:{id,version}});const state=await api('/api/orders');ZYOrderStore.note(state);orders=state.orders;revision=state.revision;$('#modal').close();editing=null;const previous=saving;saving=true;try{go('orders')}finally{saving=previous}toast('历史版本已恢复')}catch(e){$('#human-restore-error').textContent=e.message;button.disabled=false}}


async function browseOrderHistory(){if(ZYOrderStore.storage!=='rows-v1')return toast('单张历史功能将在数据库迁移后启用');try{const result=await api('/api/order-history',{method:'POST',body:{id:null}});$('#modal').innerHTML=`<h2>公司单历史与已删除记录</h2>${result.orders.map(o=>`<p><span data-user-content>${esc(o.code)} · ${esc(o.title)}</span> ${o.deleted?'（已删除）':''} <button onclick="showOrderHistory(${jsValue(o.id)})">修改历史 / 恢复</button></p>`).join('')}<button onclick="$('#modal').close()">关闭</button>`;$('#modal').showModal()}catch(e){toast(e.message)}}

function humanReauthenticate(){
 const owner=sessionUser?.id;if(!owner)return;
 $('#modal').innerHTML=`<h2>重新登录（保留编辑内容）</h2><form id="human-login"><label>账号<input name="username" autocomplete="username" value="${esc(sessionUser.username)}" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><p id="human-login-error" role="alert"></p><button class="primary" type="submit">登录并返回编辑</button><button type="button" onclick="$('#modal').close()">返回编辑</button></form>`;
 $('#human-login').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;try{const form=new FormData(event.target),result=await api('/api/login',{method:'POST',body:{username:form.get('username'),password:form.get('password')}});if(result.user?.id!==owner){await api('/api/logout',{method:'POST',body:{}});throw Error('请使用原编辑账号登录，当前输入未改变')}sessionUser=result.user;csrf=result.csrf;$('#modal').close();humanError('登录已恢复，请再次点击保存')}catch(e){$('#human-login-error').textContent=e.message}finally{button.disabled=false}};
 $('#modal').showModal();
}
