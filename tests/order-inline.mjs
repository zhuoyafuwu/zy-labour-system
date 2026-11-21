import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),T=require('../dist/business-time.js'),H=require('../dist/human-save.js');
const read=p=>readFileSync(p,'utf8'),html=read('dist/index.html'),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ready={id:'synthetic-one',code:'SYN-001',title:'合成仓库理货员',employer:'合成公司',gender:'男女不限',salary:'  HKD17120+提成,  ',raw:'保留原单编号及原文\n【标点】<&>。\n',price:'3.8w',createdAt:'2026-11-21T01:00:00Z',customFeeNote:'劳务，服务费管理费：3.8w全包\n人工备注保持不变。'};
const rows=[ready,{...ready,id:'synthetic-two',code:'SYN-002',title:'合成清洁员',createdAt:'2026-11-20T16:30:00Z'},{...ready,id:'synthetic-draft',code:'SYN-003',price:'',createdAt:'2026-11-18T01:00:00Z'},{...ready,id:'synthetic-review',code:'SYN-004',gender:''}];const before=JSON.stringify(rows);
const nodes=new Map();for(const key of ['#order-workspace','#order-search','#content','#results','#state-chips','#list-count','[data-range="date"]'])nodes.set(key,{innerHTML:'',textContent:'',setAttribute(){},toggleAttribute(){},classList:{add(){}}});
const strip={scrollLeft:0,querySelector:()=>null};nodes.set('#order-calendar',{innerHTML:'',querySelector:()=>strip,contains:()=>false});
const context=vm.createContext({esc,orders:rows,filters:{orders:{q:'',s:'',range:'today',date:''}},view:'orders',ZYHumanSave:H,ZYTime:{...T,todayKey:()=> '2026-11-21'},ZYOrderParser:{isHumanReviewed:o=>!!o.humanReviewedAt,reviewOrder:()=>({warnings:[]})},document:{body:{dataset:{}},readyState:'loading',addEventListener(){},activeElement:null,getElementById:()=>null,querySelectorAll:()=>[],querySelector:s=>s==='.date-segments'?{classList:{add(){}}}:null},$:s=>nodes.get(s),window:{},addEventListener(){},requestAnimationFrame:cb=>cb(),setTimeout,clearTimeout,scrollY:0,innerHeight:900,today:()=> '2026-11-21',day:v=>T.dateKey(v),orderStateLabels:{ready:'可发布',draft:'待确认金额',review:'需核对'},persistHumanList(){}});
context.orderPublication=o=>({order:o,problems:H.issues(o,[]).map(x=>x.message)});context.orderState=o=>!o.price?'draft':H.issues(o,[]).length?'review':'ready';
for(const prefix of ['function priceN(','function feeNote(','function publishedFeeNote(','function publish('])vm.runInContext(html.split('\n').find(line=>line.startsWith(prefix)),context);
vm.runInContext(read('dist/ui-system.js'),context);vm.runInContext(read('dist/order-list.js'),context);
// The concatenated visible body is the actual publication, including exact whitespace and manual fees.
const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
for(const row of rows){context.row=row;const slip=context.ZYUI.companySlip(row),parts=[...slip.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(m=>decode(m[1]));assert.equal(parts.join('\n'),vm.runInContext('publish(row)',context));assert(!slip.includes('::before'))}
const card=context.card(ready);assert(card.includes('<button class="order-grid order-open"'));assert(card.includes('aria-expanded="false"'));assert(!card.includes('order-expanded"'));assert(!card.includes('row-more'));
context.toggleOrderDetails(ready.id);assert.equal(vm.runInContext('selectedOrderId',context),ready.id);assert.equal((nodes.get('#results').innerHTML.match(/class="order-expanded"/g)||[]).length,1);assert(nodes.get('#results').innerHTML.includes(esc(ready.raw)));assert(nodes.get('#results').innerHTML.includes('order-source'));
context.toggleOrderDetails(rows[1].id);assert.equal(vm.runInContext('selectedOrderId',context),rows[1].id);context.toggleOrderDetails(rows[1].id);assert.equal(vm.runInContext('selectedOrderId',context),null);
context.openOrderDetail(ready.id);context.listRender();assert.equal(vm.runInContext('selectedOrderId',context),ready.id);context.setOrderState('ready');assert.equal(vm.runInContext('selectedOrderId',context),ready.id);
context.rememberOrderList(ready.id);vm.runInContext("filters.orders.q='temporary';selectedOrderId=null",context);context.restoreOrderList();assert.equal(vm.runInContext('selectedOrderId',context),ready.id);assert.equal(context.filters.orders.q,'');
context.filters.orders.q='SYN-002';context.listRender();assert.equal(vm.runInContext('selectedOrderId',context),null);assert(nodes.get('#state-chips').innerHTML.includes('>1</b>'));
context.filters.orders.q='';context.filters.orders.s='';context.openOrderDetail(ready.id);context.orders=rows.filter(r=>r.id!==ready.id);context.listRender();assert.equal(vm.runInContext('selectedOrderId',context),null);context.orders=rows;
assert(context.orderExpandedMarkup(rows[2]).includes('确认金额'));assert(context.orderExpandedMarkup(rows[3]).includes('去核对'));assert(context.orderExpandedMarkup(rows[3]).includes('zy-notice--warning'));
vm.runInContext("calendarExpanded=true;orderCalendarMonth={year:2026,month:11}",context);context.renderOrderCalendar();let calendar=nodes.get('#order-calendar').innerHTML;assert.equal((calendar.match(/class="calendar-day /g)||[]).length,30);assert(!calendar.includes('<input'));assert(!calendar.includes('·</'));assert(calendar.includes('aria-label="11月21日，3 份"'));assert(calendar.includes('aria-current="date"'));
context.selectOrderDate('2026-11-21');assert.equal(context.filters.orders.range,'date');assert(nodes.get('#state-chips').innerHTML.includes('>3</b>'));context.selectOrderDate('2026-11-21');assert.equal(context.filters.orders.range,'all');assert.equal(context.filters.orders.date,'');
const focused=[],dateButtons=Array.from({length:3},(_,i)=>({focus(){focused.push(i)}}));dateButtons[1].parentElement={querySelectorAll:()=>dateButtons};context.orderDateKeys({key:'ArrowRight',currentTarget:dateButtons[1],preventDefault(){}});context.orderDateKeys({key:'ArrowLeft',currentTarget:dateButtons[1],preventDefault(){}});assert.deepEqual(focused,[2,0]);
context.markOrderCopied(ready.id,context.publish(ready));assert.equal(context.orderCopyLabel(ready.id),'已复制');context.orders=rows.map(r=>r.id===ready.id?{...r,notes:'synthetic changed text'}:r);context.listRender();assert.equal(context.orderCopyLabel(ready.id),'复制');context.orders=rows;
context.moveOrderCalendar(1);calendar=nodes.get('#order-calendar').innerHTML;assert.equal((calendar.match(/class="date-count numeric" data-user-content><\/span>/g)||[]).length,31);
assert.equal(JSON.stringify(rows),before);assert(!html.includes('id="detail-overlay"'));assert(!read('dist/ui-components.css').includes('.zy-slip::before'));
console.log('PASS: inline disclosure, single selection, sync/filter/editor restoration, deletion/filter collapse, exact publication/raw, warnings, Beijing dates, counts, keyboard and immutable records');

assert(!context.orderExpandedMarkup(ready).includes('zy-notice--warning'));
context.ZYOrderParser.reviewOrder=()=>({warnings:['synthetic private recognition evidence']});
const flagged=context.orderExpandedMarkup(ready);
assert(flagged.includes('识别结果可能不完整，请核对'));
assert(!flagged.includes('synthetic private recognition evidence'));
assert(!flagged.includes('order-field-sources'));
