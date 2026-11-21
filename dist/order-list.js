/* View-only unified order workspace. Business validation and writes stay in their existing modules. */
let selectedOrderId=null,detailTab='company',orderListReturn=null,searchTimer=null;
let calendarExpanded=false,orderSourceOpen=false;
const copiedOrderIds=new Map();
const expandedOrderDates=new Set();
const jsValue=value=>esc(JSON.stringify(value));
const navSymbols={orders:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',workers:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',match:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10l2 2 4-4"/>',workerRecords:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M5 17c0-4 8-4 8 0M15 8h3M15 12h3"/>'};
function navigation(){
 const nav=$('#nav');if(!nav)return;
 nav.innerHTML=[['劳务单',['orders']],['劳工信息',['workers','workerRecords','match']]].map(([label,keys])=>`<section class="nav-group"><h2 class="nav-group-title">${label}</h2><div class="nav-group-items">${keys.map(k=>`<button class="${k===view?'active':''} ${k==='match'?'match-nav':''}" ${k===view?'aria-current="page"':''} onclick="go('${k}',{preserveOrders:true})"><svg viewBox="0 0 24 24" aria-hidden="true">${navSymbols[k]}</svg><span>${k==='workers'?'劳工登记':names[k]}</span>${k==='orders'?'<b id="nav-review-count" hidden></b>':''}</button>`).join('')}</div></section>`).join('');updateReviewCount();
}
function updateReviewCount(){const badge=$('#nav-review-count');if(!badge)return;const n=orders.filter(o=>orderState(o)==='review').length;badge.hidden=!n;badge.textContent=n;badge.setAttribute('aria-label',(window.ZYI18n?.translate('需核对')||'需核对')+': '+n)}
function go(v,options={}){
 if(v!=='match')window.ZYMatchUI?.leave();closeOrderMenu();hideDetailOverlay();
 if(v==='dashboard'||v==='orders'){
  if(!options.preserveOrders){filters.orders.range=v==='dashboard'?'today':'all';filters.orders.date=''}
  view='orders';calendarExpanded=false;
 }else view=v;
 document.body.dataset.view=view;navigation();render();window.scrollTo(0,0);
}
function teamMenu(){
 $('#modal').innerHTML=`<h2>我的</h2><p><span data-user-content>${esc(sessionUser?.username)}</span> · ${sessionUser?.role==='admin'?'管理员':'员工'}</p><div class="actions"><button onclick="accountDialog()">设置</button><button onclick="logout()">退出</button><button data-language-toggle onclick="ZYI18n.toggle()">English</button><button onclick="$('#modal').close()">关闭</button></div><p>${esc($('#syncStatus')?.textContent||'')}</p>`;$('#modal').showModal();
}
function render(){
 document.body.dataset.view=view;
 if(view==='match')return matchView();if(view==='new')return newView();if(view==='workers')return workerView();if(view==='workerRecords')return recordsView();
 if(!$('#order-workspace'))$('#content').innerHTML=`<div id="order-workspace" class="order-workspace-inline"><section class="order-list-pane" aria-label="劳务单列表"><div class="order-tools"><div class="order-heading"><h1>劳务单</h1><div class="business-clock"><time id="business-date" data-user-content></time> <span>北京时间</span></div></div><input id="order-search" type="search" placeholder="搜索职位、单号、雇主、薪资" aria-label="搜索职位、单号、雇主、薪资" value="${esc(filters.orders.q)}" oninput="queueOrderSearch(this.value)"><div class="date-segments" role="group" aria-label="日期范围"><button data-range="today" onclick="setOrderRange('today')">今天</button><button class="range-week" data-range="week" onclick="setOrderRange('week')">本周</button><button data-range="all" onclick="setOrderRange('all')">全部</button><button class="range-date" data-range="date" aria-controls="order-calendar" onclick="toggleOrderCalendar()">选日期</button></div><div id="state-chips" aria-label="状态筛选"></div><div id="order-calendar"></div></div><div class="order-table-scroll"><div class="order-table"><div class="order-grid order-table-head" aria-hidden="true"><span>单号</span><span>职位 · 雇主</span><span>月薪</span><span>状态</span><span>复制</span><span></span></div><div id="results"></div></div></div><p id="list-count" class="list-count"></p></section></div><button class="new-order-fab" aria-label="整理新劳务单" onclick="editing=null;go('new')">＋</button>`;
 if(document.activeElement!==$('#order-search'))$('#order-search').value=filters.orders.q;
 renderOrderCalendar();listRender();
}
function queueOrderSearch(value){filters.orders.q=value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(view==='orders'){renderOrderCalendar();listRender()}},200)}
function setOrderRange(range){clearTimeout(searchTimer);filters.orders.range=range;filters.orders.date='';calendarExpanded=false;renderOrderCalendar();listRender()}
function toggleOrderCalendar(){calendarExpanded=!calendarExpanded;if(calendarExpanded){const date=filters.orders.date||ZYTime.todayKey();const [year,month]=date.split('-').map(Number);orderCalendarMonth={year,month}}renderOrderCalendar();scrollOrderDateIntoView()}
function rangeOrders(){
 const f=filters.orders,currentDay=ZYTime.todayKey(),{start,end}=ZYTime.weekRange(currentDay);
 return orders.filter(o=>{const key=ZYTime.dateKey(o.createdAt);return f.range==='today'?key===currentDay:f.range==='week'?key>=start&&key<end:f.range==='date'?key===f.date:true});
}
function orderMatchesQuery(record){const p=orderPublication(record).order,query=String(filters.orders.q||'').trim().toLowerCase();return ['title','code','employer','salary'].some(k=>String(p[k]||'').toLowerCase().includes(query))}
function setOrderState(state){filters.orders.s=state;renderOrderCalendar();listRender()}
function stateBadge(state){return `<span class="state-badge state-${state}" title="${orderStateLabels[state]}">${orderStateLabels[state]}</span>`}
function orderRowKey(id){return 'order-'+encodeURIComponent(id)}
function orderCopyLabel(id,full=false){return copiedOrderIds.has(id)?'已复制':full?'复制公司单':'复制'}
function rowAction(o){const state=orderState(o),id=jsValue(o.id);return `<button class="row-action action-${state} ${copiedOrderIds.has(o.id)?'is-copied':''}" data-copy-order="${esc(o.id)}" onclick="${state==='ready'?`copyOrder(${id})`:state==='review'?`openOrderDetail(${id})`:`fillPrice(${id})`}">${state==='ready'?orderCopyLabel(o.id):state==='review'?'核对':'填金额'}</button>`}
function card(record){
 const o=orderPublication(record).order,state=orderState(record),id=jsValue(o.id),expanded=selectedOrderId===o.id;
 return `<article class="order-entry" data-order-id="${esc(o.id)}"><div class="order-row ${expanded?'selected':''}" data-order-id="${esc(o.id)}" data-state="${state}"><button class="order-grid order-open" id="${orderRowKey(o.id)}" aria-expanded="${expanded}" aria-controls="${orderRowKey(o.id)}-details" onclick="toggleOrderDetails(${id})"><span class="row-code numeric" data-user-content title="${esc(o.code)}">${esc(o.code)}</span><span class="row-identity" data-user-content title="${esc([o.title,o.employer].filter(Boolean).join(' · '))}"><strong>${esc(o.title)}</strong>${o.employer?`<span class="row-employer"> · ${esc(o.employer)}</span>`:''}</span><span class="row-salary numeric" ${o.salary?'data-user-content':''} title="${esc(o.salary)}">${esc(o.salary||'未识别')}</span><span class="row-status">${stateBadge(state)}</span><span class="row-copy-space" aria-hidden="true"></span><span class="order-chevron" aria-hidden="true">⌄</span><span class="mobile-row-meta numeric" data-user-content>${esc([o.code,o.salary].filter(Boolean).join(' · '))}</span></button>${rowAction(record)}</div>${expanded?orderExpandedMarkup(record):''}</article>`;
}
function orderExpandedMarkup(record){
 const {order:o,problems}=orderPublication(record),state=orderState(record),id=jsValue(o.id),reviewed=ZYOrderParser.isHumanReviewed(o);
 const warning=state!=='ready'?`<div class="publication-problems zy-notice zy-notice--warning" role="status"><strong>${state==='draft'?'请先确认全包价':'请核对公司单信息'}</strong>${problems.length?`<ul>${problems.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}</div>`:'';
 const meta=[reviewed?'<span>已人工核对</span>':'',`<time data-user-content>${esc(day(o.humanReviewedAt||o.createdAt))}</time>`,`<span>全包价</span> ${priceN(o.price)>0?`<b data-user-content>${esc(priceFmt(o.price))}</b>`:'<span>待确认</span>'}`].filter(Boolean).join(' · ');
 return `<section class="order-expanded" id="${orderRowKey(o.id)}-details" aria-labelledby="${orderRowKey(o.id)}">${warning}<div class="order-expanded-columns"><section class="order-source"><div class="order-source-heading"><h3>原单</h3><span>上家原文 · 只读</span></div><pre class="source-copy" data-user-content>${esc(record.raw||'')}</pre><details class="order-field-sources" ${orderSourceOpen?'open':''} ontoggle="if(this.isConnected)orderSourceOpen=this.open"><summary>字段来源</summary>${recognitionReviewMarkup(record,-1,true)}</details></section><section class="order-company">${ZYUI.companySlip(record)}<div class="order-expanded-actions"><p class="order-expanded-meta">${meta}</p><div class="order-action-buttons"><button class="danger" data-order-action="delete" onclick="deleteOrder(${id})">删除</button><button data-order-action="edit" onclick="editOrder(${id})">编辑</button><button class="primary ${copiedOrderIds.has(o.id)?'is-copied':''}" data-order-action="primary" ${state==='ready'?`data-copy-order="${esc(o.id)}" data-copy-full="true"`:''} onclick="${state==='ready'?`copyOrder(${id})`:state==='review'?`editOrder(${id})`:`fillPrice(${id})`}">${state==='ready'?orderCopyLabel(o.id,true):state==='review'?'去核对':'确认金额'}</button></div></div></section></div></section>`;
}
function listRender(){
 if(view!=='orders'||!$('#results'))return;
 for(const [id,text] of copiedOrderIds){const record=orders.find(o=>o.id===id);if(!record||publish(record)!==text)copiedOrderIds.delete(id)}
 const active=document.activeElement,activeEntry=active?.closest('.order-entry'),focusAction=active?.dataset?.orderAction,focusRow=active?.classList.contains('order-open'),focusCopy=active?.classList.contains('row-action');
 const f=filters.orders,range=rangeOrders().filter(orderMatchesQuery),matches=range.filter(o=>!f.s||orderState(o)===f.s);
 if(selectedOrderId&&!matches.some(o=>o.id===selectedOrderId)){selectedOrderId=null;orderSourceOpen=false}
 const selected=matches.find(o=>o.id===selectedOrderId);if(selected)expandedOrderDates.add(day(selected.createdAt));
 $('#state-chips').innerHTML=[['','全部'],['review','需核对'],['draft','待确认金额'],['ready','可发布']].map(([state,label])=>`<button class="state-chip" data-filter-state="${state}" aria-pressed="${f.s===state}" onclick="setOrderState('${state}')"><i class="state-dot dot-${state||'all'}" aria-hidden="true"></i><span>${label}</span> <b data-user-content>${state?range.filter(o=>orderState(o)===state).length:range.length}</b></button>`).join('');
 document.querySelectorAll('[data-range]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.range===f.range)));
 const dateButton=$('[data-range="date"]');dateButton.textContent=f.range==='date'?f.date:'选日期';dateButton.toggleAttribute('data-user-content',f.range==='date');dateButton.setAttribute('aria-expanded',String(calendarExpanded));
 document.querySelector('.date-segments').classList.add('show-date');
 const groups={};for(const o of matches)(groups[day(o.createdAt)]??=[]).push(o);
 $('#results').innerHTML=matches.length?Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(d=>{
  const heading=`<span data-user-content>${esc(d)}</span>${d===today()?' · <span>今天</span>':''}<span class="group-count">共 ${groups[d].length} 份</span>`;
  return ['all','week'].includes(f.range)?`<details class="order-date-group" ${expandedOrderDates.has(d)?'open':''}><summary data-date="${esc(d)}" onclick="expandedOrderDates[this.parentElement.open?'delete':'add'](this.dataset.date)">${heading}</summary><div class="order-date-content">${groups[d].map(card).join('')}</div></details>`:`<section class="order-date-section"><h2 class="order-group-heading">${heading}</h2>${groups[d].map(card).join('')}</section>`;
 }).join(''):'<div class="empty">暂无符合条件的劳务单<br><small>整理一份新劳务单，开始今天的工作。</small></div>';
 $('#list-count').textContent=`共 ${matches.length} 份`;updateReviewCount();
 if(activeEntry){const entry=[...document.querySelectorAll('.order-entry')].find(e=>e.dataset.orderId===activeEntry.dataset.orderId);const target=focusAction?entry?.querySelector(`[data-order-action="${focusAction}"]`):focusRow?entry?.querySelector('.order-open'):focusCopy?entry?.querySelector('.row-action'):null;target?.focus({preventScroll:true})}
 ensureExpandedOrderVisible();
}
let orderCalendarMonth=(({year,month})=>({year,month}))(ZYTime.parts(new Date()));
function orderDateKey(value){return ZYTime.dateKey(value)}
function selectOrderDate(value){filters.orders.date=filters.orders.date===value?'':value;filters.orders.range=filters.orders.date?'date':'all';if(value){const [year,month]=value.split('-').map(Number);orderCalendarMonth={year,month}}renderOrderCalendar();listRender();scrollOrderDateIntoView()}
function moveOrderCalendar(offset){const total=orderCalendarMonth.year*12+orderCalendarMonth.month-1+offset;orderCalendarMonth={year:Math.floor(total/12),month:(total%12+12)%12+1};renderOrderCalendar();scrollOrderDateIntoView()}
function renderOrderCalendar(){
 const container=$('#order-calendar');if(!container)return;$('[data-range="date"]')?.setAttribute('aria-expanded',String(calendarExpanded));const oldScroll=container.querySelector('.order-date-strip')?.scrollLeft||0,active=container.contains(document.activeElement)?document.activeElement:null,focusDate=active?.dataset?.date,focusMonth=active?.dataset?.monthStep,focusLabel=active?.getAttribute('aria-label'),focusClear=active?.classList.contains('order-date-clear');
 if(!calendarExpanded){container.innerHTML='';return}
 const currentDate=ZYTime.todayKey(),{year:y,month:m}=orderCalendarMonth,counts={};for(const o of orders.filter(orderMatchesQuery).filter(o=>!filters.orders.s||orderState(o)===filters.orders.s)){const key=orderDateKey(o.createdAt);if(key)counts[key]=(counts[key]||0)+1}
 const info=ZYTime.monthInfo(y,m),cells=[];let monthTotal=0;
 for(let n=1;n<=info.daysInMonth;n++){const key=`${y}-${String(m).padStart(2,'0')}-${String(n).padStart(2,'0')}`,weekday=(info.firstWeekday+n-2)%7,selected=filters.orders.date===key,count=counts[key]||0;monthTotal+=count;
 cells.push(`<button type="button" data-date="${key}" aria-label="${m}月${n}日，${count} 份" aria-pressed="${selected}" ${key===currentDate?'aria-current="date"':''} class="calendar-day ${key===currentDate?'calendar-today':''} ${selected?'is-selected':''} ${count?'has-orders':''} ${weekday===0&&n>1?'week-start':''}" onclick="selectOrderDate('${key}')" onkeydown="orderDateKeys(event)"><span class="date-weekday">${key===currentDate?'今天':['周一','周二','周三','周四','周五','周六','周日'][weekday]}</span><strong class="date-number numeric" data-user-content>${n}</strong><span class="date-count numeric" data-user-content>${count||''}</span></button>`)}
 const selected=filters.orders.date,selectedParts=selected?.split('-').map(Number);
 const description=selected?`<span>已选</span> <span>${selectedParts[1]}月${selectedParts[2]}日</span> · <span data-user-content>${counts[selected]||0}</span> <span>份</span>`:`<span>本月共</span> <span data-user-content>${monthTotal}</span> <span>份，点日期查看当天的单</span>`;
 container.innerHTML=`<section class="order-date-panel" aria-label="日期筛选"><div class="order-date-header"><div class="order-month-controls"><button type="button" aria-label="上个月" data-month-step="-1" onclick="moveOrderCalendar(-1)">‹</button><strong>${y}年${m}月</strong><button type="button" aria-label="下个月" data-month-step="1" onclick="moveOrderCalendar(1)">›</button></div><p class="order-date-description">${description}</p>${selected?'<button class="order-date-clear" onclick="selectOrderDate(\'\')">清除日期</button>':''}</div><div class="order-date-strip" role="group" aria-label="选择日期">${cells.join('')}</div></section>`;
 container.querySelector('.order-date-strip').scrollLeft=oldScroll;if(focusDate)container.querySelector(`[data-date="${focusDate}"]`)?.focus({preventScroll:true});else if(focusMonth)container.querySelector(`[data-month-step="${focusMonth}"]`)?.focus({preventScroll:true});else if(focusLabel)container.querySelector(`[aria-label="${focusLabel}"]`)?.focus({preventScroll:true});else if(focusClear)container.querySelector('.order-date-clear')?.focus({preventScroll:true});
}
function scrollOrderDateIntoView(){requestAnimationFrame(()=>{const strip=$('.order-date-strip');if(!strip)return;const target=strip.querySelector('[aria-pressed="true"]')||strip.querySelector('[aria-current="date"]');if(!target)return;const box=target.getBoundingClientRect(),viewport=strip.getBoundingClientRect();if(box.left<viewport.left||box.right>viewport.right)strip.scrollLeft+=box.left-viewport.left-(viewport.width-box.width)/2})}
function orderDateKeys(event){if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...event.currentTarget.parentElement.querySelectorAll('button')],at=buttons.indexOf(event.currentTarget),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;buttons[next]?.focus()}
function rememberOrderList(id){selectedOrderId=id;orderListReturn={filters:{...filters.orders},id,sourceOpen:orderSourceOpen,pageY:scrollY}}
function restoreOrderList(){if(!orderListReturn)return;filters.orders={...orderListReturn.filters};selectedOrderId=orderListReturn.id;orderSourceOpen=orderListReturn.sourceOpen;render();ensureExpandedOrderVisible()}
function showSavedOrder(id){filters.orders={q:'',s:'',range:'today',date:''};selectedOrderId=id;orderSourceOpen=false;const record=orders.find(o=>o.id===id);if(record)expandedOrderDates.add(day(record.createdAt));render();ensureExpandedOrderVisible()}
function ensureExpandedOrderVisible(){if(!selectedOrderId)return;const button=document.getElementById(orderRowKey(selectedOrderId));if(!button)return;const box=button.getBoundingClientRect();if(box.top<0||box.bottom>innerHeight)button.scrollIntoView({block:'nearest',behavior:'instant'})}
function toggleOrderDetails(id){if(selectedOrderId===id){selectedOrderId=null;orderSourceOpen=false;listRender()}else openOrderDetail(id)}
function openOrderDetail(id,tab){if(!orders.some(o=>o.id===id))return;if(selectedOrderId!==id)orderSourceOpen=tab==='sources';selectedOrderId=id;closeOrderMenu();listRender()}
function closeOrderDetail(){selectedOrderId=null;orderSourceOpen=false;listRender()}
// Compatibility for authentication/editor callers; order details no longer use any dialog.
function hideDetailOverlay(){}
function refreshOrderDetail(){listRender()}
function markOrderCopied(id,text){const record=orders.find(o=>o.id===id);if(!record||publish(record)!==text)return;copiedOrderIds.set(id,text);document.querySelectorAll('[data-copy-order]').forEach(button=>{if(button.dataset.copyOrder!==id)return;button.classList.add('is-copied');button.textContent='已复制'})}

let orderMenuTrigger=null;
function openOrderMenu(id,trigger,detailOnly=false){
 const record=orders.find(o=>o.id===id);if(!record)return;const menu=$('#order-menu');orderMenuTrigger=trigger;
 menu.innerHTML=`${detailOnly?'':`<button role="menuitem" onclick="closeOrderMenu();editOrder(${jsValue(id)})">编辑公司单</button>${!ZYOrderParser.isHumanReviewed(record)?`<button role="menuitem" onclick="closeOrderMenu();markOrderReviewed(${jsValue(id)})">标记已人工核对</button>`:''}`}<button role="menuitem" class="danger" onclick="closeOrderMenu();deleteOrder(${jsValue(id)})">删除</button>`;
 document.body.append(menu);menu.hidden=false;
 const rect=trigger.getBoundingClientRect();menu.style.right=Math.max(8,innerWidth-rect.right)+'px';menu.style.top=Math.min(rect.bottom+4,innerHeight-menu.offsetHeight-8)+'px';menu.querySelector('button')?.focus();
}
function closeOrderMenu(){const menu=$('#order-menu');if(menu){menu.hidden=true;document.body.append(menu)}}
addEventListener('click',event=>{if(!event.target.closest('#order-menu,[aria-haspopup="menu"]'))closeOrderMenu()});
addEventListener('keydown',event=>{const menu=$('#order-menu');if(menu&&!menu.hidden){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeOrderMenu();orderMenuTrigger?.focus()}else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const items=[...menu.querySelectorAll('button')],at=items.indexOf(document.activeElement);items[(at+(event.key==='ArrowDown'?1:items.length-1))%items.length].focus()}}},true);
