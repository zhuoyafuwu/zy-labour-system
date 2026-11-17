"""Synthetic AI UI only; intercepted transport never reaches a real provider."""
import sys,secrets,tempfile,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server.app import make_server,create_user
with tempfile.TemporaryDirectory() as tmp:
 server=make_server(Path(tmp)/'ai.sqlite3',port=0,secure=False);url=f'http://127.0.0.1:{server.server_port}';server.public_origin=url
 password=secrets.token_urlsafe(24);create_user(server.db_path,'synthetic-admin',password,'admin');threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(url);page.locator('[name=username]').fill('synthetic-admin');page.locator('[name=password]').fill(password);page.locator('#loginForm button').click();page.wait_for_selector('#syncStatus')
   page.evaluate(r'''async()=>{
    const raw='岗位：仓务员\n性别：男\n工资：HKD18000';orders=Array.from({length:35},(_,i)=>{const o={...ZYOrderParser.parse(raw,'ZY-26-1117-'+String(i+1).padStart(2,'0')),id:'ai-'+i,title:i===0?'物流文员':'仓务员',price:'3.8w',status:'ready',createdAt:'2018-01-01T00:00:00Z'};return {...o,...ZYOrderParser.humanReviewMetadata(o,'synthetic-admin')}});const saved=await api('/api/orders',{method:'PUT',body:{orders,revision}});revision=saved.revision;
    await dbWrite('put',{id:'ai-worker',name:'PRIVATE-NAME',age:'40',gender:'男',phone:'PRIVATE-PHONE',workHistory:[{position:'仓管员',period:'2020-至今'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    window.aiCalls=[];window.aiFail=false;window.aiResultCache=new Map();const native=api;
    api=async(path,options={})=>{if(path!=='/api/ai-matching')return native(path,options);aiCalls.push(options.body);if(aiFail)throw Error('synthetic outage');const profile={summary:'仓储管理经验丰富',skills:[{name:'库存管理',evidence:'仓管员'}],directions:[{major:'logistics',name:'物流仓储',years:3,evidence:'仓管员'}]};if(options.body.action==='profile')return {status:'ready',profile};if(options.body.action==='prepare')return {status:'ready',profile,items:orders.map(o=>({orderId:o.id,result:aiResultCache.get(o.id)||null}))};await new Promise(r=>setTimeout(r,30));return {status:'ready',items:options.body.orderIds.map(id=>{const result={level:'high',reason:'依据仓管员经历，适合仓储及物流文员',missing:[],evidence:'仓管员'};aiResultCache.set(id,result);return {orderId:id,result}})}};
    openWorkerMatch('ai-worker');
   }''')
   page.wait_for_function("()=>document.querySelector('.ai-match-status')?.innerText.includes('AI匹配完成')")
   assert page.locator('.match-entry').count()==35
   assert '仓管员' in page.locator('.ai-match-reason').first.inner_text()
   assert '建议人工确认' in page.locator('[data-match-order="ai-0"]').inner_text()
   assert '仓储管理经验丰富' in page.locator('.ai-worker-summary').inner_text()
   calls=page.evaluate('aiCalls');assert len([x for x in calls if x['action']=='match'])==2
   assert not any('PRIVATE' in str(x) for x in calls)
   count=len(calls);page.evaluate("go('orders');openWorkerMatch('ai-worker')");page.wait_for_selector('.ai-match-reason');assert page.evaluate('aiCalls.length')==count
   page.evaluate('aiFail=true');page.get_by_role('button',name='重新 AI 分析',exact=True).click();page.wait_for_function("()=>document.querySelector('.ai-match-status')?.innerText.includes('AI分析失败')")
   assert page.locator('.match-entry').count()>0
   page.set_viewport_size({'width':390,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert not errors,errors;browser.close();print('PASS: 35 all-date AI rows, 30-item batches, streamed results, evidence/summary, disagreement flag, IDs-only requests, memory cache and outage fallback')
 finally:server.shutdown();server.server_close()
