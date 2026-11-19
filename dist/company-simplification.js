/* Explicit admin-only one-time conversion. Never invoked on load or sync. */
let companyConversionPlan=null;
function downloadCompanyConversion(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function previewCompanySimplification(){
 if(sessionUser?.role!=='admin'||sessionUser.readOnly)return;
 const owner=sessionUser.id;try{const source=await api('/api/orders');if(sessionUser?.id!==owner)return;const plan=ZYCompanyText.plan(source.orders);companyConversionPlan={owner,revision:source.revision,source:source.orders,...plan};
 $('#modal').innerHTML=`<h2>公司单简体转换预览</h2><p><span>将修改</span> <b data-user-content>${plan.count}</b> <span>张单</span></p><p>只转换公司单文字。原单、金额、人工核对结果和劳工资料保持不变。</p><p>先下载备份和预览，确认保存后再执行。</p><div class="actions"><button onclick="downloadCompanySimplification()">下载备份和预览</button><button id="company-conversion-apply" disabled onclick="applyCompanySimplification()">确认执行转换</button><button onclick="companyConversionPlan=null;$('#modal').close()">取消</button></div>`;$('#modal').showModal();
 }catch(e){toast(e.message)}
}
function downloadCompanySimplification(){const p=companyConversionPlan;if(!p||sessionUser?.id!==p.owner)return;const suffix=ZYTime.todayKey()+'.json';downloadCompanyConversion('company-orders-backup-'+suffix,{revision:p.revision,orders:p.source});downloadCompanyConversion('company-conversion-preview-'+suffix,{revision:p.revision,count:p.count,changes:p.changed});$('#company-conversion-apply').disabled=!p.count}
async function applyCompanySimplification(){const p=companyConversionPlan;if(!p||sessionUser?.role!=='admin'||sessionUser.id!==p.owner||sessionUser.readOnly)return;if(!confirm(ZYI18n.translate('确认已保存备份并执行公司单简体转换？')))return;const button=$('#company-conversion-apply');button.disabled=true;try{await saveCompanyConversion(p);companyConversionPlan=null;$('#modal').close();await performSync();toast('公司单简体转换完成')}catch(e){toast(e.message);button.disabled=false}}

async function saveCompanyConversion(plan){
 const fresh=await api('/api/orders');
 for(const change of plan.changed){const old=plan.source.find(o=>o.id===change.id),current=fresh.orders.find(o=>o.id===change.id);if(JSON.stringify(old)!==JSON.stringify(current))throw Error('预览后有公司单变动，请重新预览和备份')}
 let saved=0;
 for(const change of plan.changed){const result=await ZYOrderStore.save(plan.orders.find(o=>o.id===change.id),plan.source.find(o=>o.id===change.id),api);if(result.conflict)throw Error(`已转换 ${saved} 张；另一张单已变化，请重新预览，未覆盖他人内容`);saved++}
}
