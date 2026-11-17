"""Synthetic conversion, source preservation and revision protection; no hosted calls."""
import sys,secrets,tempfile,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server.app import make_server,create_user
with tempfile.TemporaryDirectory() as tmp:
 server=make_server(Path(tmp)/'company.sqlite3',port=0,secure=False);url=f'http://127.0.0.1:{server.server_port}';server.public_origin=url
 password=secrets.token_urlsafe(24);create_user(server.db_path,'synthetic-admin',password,'admin');threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page();errors=[];downloads=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('download',lambda d:downloads.append(d.suggested_filename));page.on('dialog',lambda d:d.accept())
   page.goto(url);page.locator('[name=username]').fill('synthetic-admin');page.locator('[name=password]').fill(password);page.locator('#loginForm button').click();page.wait_for_selector('#syncStatus')
   page.evaluate("editing=null;mode='single';go('new');ZYAI.enhance=async a=>a")
   raw='【職位】倉務員\n【雇主】合成物流公司\n【月薪】HKD16800\n【性別】男\n【語言】粵語\n【工作時間】輪班\n【面試】視頻面試\n【工作內容】整理貨物'
   page.locator('#raw').fill(raw);page.evaluate('autoParse()');assert page.locator('#raw').input_value()==raw;assert page.locator('#o-language').input_value()=='粤语';assert '轮班' in page.locator('#o-hours').input_value()
   page.evaluate("editing=null;mode='batch';batch=[];batchInput='';go('new')");page.locator('#batchraw').fill(raw);page.evaluate('previewBatch()');assert page.evaluate('batch[0].raw')==raw;assert page.locator('#b-0-language').input_value()=='粤语'
   page.evaluate(r'''async()=>{const raw='岗位：倉務員\n性别：男\n工资：HKD16800',o={...ZYOrderParser.analyze(raw,'ZY-26-1117-01',{explicitBoundary:true}).order,id:'synthetic-order',price:'3.8w',language:'粵語',createdAt:new Date().toISOString(),status:'ready'};Object.assign(o,ZYOrderParser.humanReviewMetadata(o,'synthetic-admin'));const saved=await api('/api/orders',{method:'PUT',body:{orders:[o],revision}});orders=[o];revision=saved.revision;}''')
   before=page.evaluate("api('/api/orders').then(r=>r.orders[0])")
   page.evaluate('previewCompanySimplification()');assert page.locator('#company-conversion-apply').is_disabled();assert page.evaluate('companyConversionPlan.count')==1
   page.evaluate('downloadCompanySimplification()');page.wait_for_timeout(100);assert len(downloads)==2;assert not page.locator('#company-conversion-apply').is_disabled()
   # A concurrent writer invalidates the preview; no overwrite is allowed.
   page.evaluate("api('/api/orders').then(r=>api('/api/orders',{method:'PUT',body:r}))")
   page.evaluate('applyCompanySimplification()');assert page.evaluate("api('/api/orders').then(r=>r.orders[0])")==before
   page.evaluate('previewCompanySimplification()');page.evaluate('downloadCompanySimplification()');page.evaluate('applyCompanySimplification()')
   after=page.evaluate("api('/api/orders').then(r=>r.orders[0])");assert after['language']=='粤语'
   fields=page.evaluate('ZYCompanyText.fields');assert {k:v for k,v in before.items() if k not in fields}=={k:v for k,v in after.items() if k not in fields}
   assert not errors,errors;browser.close();print('PASS: single/batch original preservation, local simplified fields, explicit backup/preview gate, stale-write rejection and unchanged human review/fees')
 finally:server.shutdown();server.server_close()
