import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {textHash} from '../supabase/functions/recognize-order/match-profile.ts';
import {runTaskStep} from '../supabase/functions/classification-worker/runner.ts';

process.on('uncaughtException',e=>{console.error(e.message);process.exit(1)});
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
await db.exec('create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text)');
for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
const actor='10000000-0000-0000-0000-000000000001',staff='10000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users values('${actor}'),('${staff}');insert into zy_private.members values('${actor}','synthetic-admin','admin',true),('${staff}','synthetic-staff','staff',true);`);
async function role(name:string,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+name)}
async function sql(query:string,args:any[]=[]){await role('postgres');return args.length?(await db.query(query,args)).rows:(await db.exec(query)).at(-1)!.rows}
async function call(name:string,data:any={}){const keys=Object.keys(data);return (await db.query(`select public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) as r`,Object.values(data))).rows[0].r}
async function rpc(name:string,data:any={}){await role('service_role');return call(name,data)}
async function control(action:string){await role('authenticated',actor);return call('zy_classification_task_control',{p_action:action})}
const orders=Array.from({length:45},(_,i)=>({id:'synthetic-'+i,title:'合成电工'+i,workContent:'设备检修',price:'3.8w',salary:'HKD 18000',raw:'合成原单不可修改',humanReviewedBy:'synthetic-human',recognitionReview:{confirmed:true},status:'ready'}));
orders.push({...orders[0],id:'manual-profile',matchProfile:{by:'user',version:2,sourceHash:'manual'}} as any);
await sql('update zy_private.order_state set orders=$1',[JSON.stringify(orders)]);
const workers=[{id:'synthetic-worker',name:'PRIVATE-NAME',phone:'PRIVATE-PHONE',idNumber:'PRIVATE-ID',photo:'PRIVATE-PHOTO',workHistory:[{position:'合成维修工',duties:'合成检修',employer:'合成设备公司'}],desiredJob1:'合成技术员',certificates:'电工证及高空证、健康证',humanReviewedBy:'synthetic-human'}];
await sql('insert into zy_private.workers(id,version,data) values($1,1,$2)',[workers[0].id,JSON.stringify(workers[0])]);
const before=await sql('select orders from zy_private.order_state');const workersBefore=await sql('select * from zy_private.workers');
for(let i=0;i<40;i++)await sql('insert into public.zy_job_classification_cache(text_hash,kind,major,subcategory_id,evidence,by) values($1,$2,$3,$4,$5,$6)',[await textHash('order',orders[i]),'order','maintenance','seed:electrician',orders[i].title,i<3?'user':'ai']);
const initialCache=await sql('select * from public.zy_job_classification_cache order by text_hash');
await role('anon');await assert.rejects(()=>call('zy_classification_task_control',{p_action:'start'}),/permission denied/);
await role('authenticated',staff);await assert.rejects(()=>call('zy_classification_task_control',{p_action:'start'}),/权限不足/);
await assert.rejects(()=>call('zy_classification_task_claim'),/permission denied/);
await assert.rejects(()=>db.query('select * from zy_private.classification_tasks'),/permission denied/);
const started=await control('start');assert.equal(started.task.total,49);assert.equal((await control('start')).task.id,started.task.id);
const inputs=JSON.stringify(await sql('select input from zy_private.classification_task_items'));
for(const value of ['PRIVATE','HKD','3.8w','原单','confirmed'])assert(!inputs.includes(value));
const env:any={SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',AI_PROVIDER:'deepseek',DEEPSEEK_ENABLED:'true',DEEPSEEK_MODEL:'deepseek-chat',DEEPSEEK_API_KEY:'synthetic-model'};
(globalThis as any).Deno={env:{get:(key:string)=>env[key]}};
let modelCalls=0,mode='ok';
globalThis.fetch=async(url:any,options:any)=>{
 const body=JSON.parse(options.body);
 if(String(url).includes('/rest/v1/rpc/')){try{return Response.json(await rpc(String(url).split('/').at(-1)!,body))}catch(e:any){return Response.json({code:e.code},{status:400})}}
 assert(String(url).includes('api.deepseek.com'));modelCalls++;
 const source=JSON.parse(body.messages[1].content);assert(!JSON.stringify(source).includes('PRIVATE'));
 if(mode==='incomplete')return Response.json({choices:[{finish_reason:'length'}]});
 const items=source.items.map((x:any)=>({index:x.index,major:'maintenance',subcategory_id:'seed:electrician',evidence:x.input.title||x.input.position||x.input.text}));
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items})}}]});
};
async function advance(){await sql("update zy_private.classification_tasks set next_run_at=now()-interval '1 minute'")}
async function step(){await advance();return runTaskStep(rpc,'https://synthetic.example')}
// Simulate a killed worker after claim. Another process cannot take a live lease.
const killed=await rpc('zy_classification_task_claim');assert(killed);assert.equal(await rpc('zy_classification_task_claim'),null);
await sql("update zy_private.classification_tasks set lease_until=now()-interval '1 second'");
const replacement=await rpc('zy_classification_task_claim');assert.notEqual(replacement.lease,killed.lease);
await assert.rejects(()=>rpc('zy_classification_task_finish',{p_id:killed.id,p_lease:killed.lease,p_done:[],p_code:null}),/租约失效/);
await sql("update zy_private.classification_tasks set lease_until=now()-interval '1 second'");
// First five batches are all cache hits, including the three protected manual rows.
for(let i=0;i<5;i++)await step();assert.equal(modelCalls,0);
mode='incomplete';await step();assert.equal(modelCalls,1);
assert.equal((await sql('select batch_size from zy_private.classification_tasks'))[0].batch_size,4);
// A fresh runner invocation resumes with no in-memory cursor.
mode='ok';for(let i=0;i<8;i++)await step();
assert.equal((await control('status')).task.status,'completed');assert.equal((await control('status')).task.done,49);
for(const row of initialCache){const saved=(await sql('select * from public.zy_job_classification_cache where text_hash=$1',[row.text_hash]))[0];assert.deepEqual(saved,row)}
assert.deepEqual(await sql('select orders from zy_private.order_state'),before);assert.deepEqual(await sql('select * from zy_private.workers'),workersBefore);
// Fresh task reuses all caches without paid requests or quota increments.
const paid=modelCalls;await control('start');for(let i=0;i<9;i++)await step();assert.equal(modelCalls,paid);
// Persistently incomplete responses shrink 8 -> 4 -> 2 -> 1, then stop; failed items can explicitly resume.
await sql("update zy_private.order_state set orders='[{\"id\":\"failure\",\"title\":\"合成故障岗位\"}]';delete from zy_private.workers");
await control('start');mode='incomplete';for(let i=0;i<8;i++)await step();
assert.equal((await control('status')).task.status,'completed_with_errors');assert.equal((await control('status')).task.failed,1);
assert.equal(modelCalls-paid,1); // Actual singleton fails once; it cannot loop forever.
await control('resume');mode='ok';await step();assert.equal((await control('status')).task.status,'completed');
// Repeated multi-item truncation reaches a bounded singleton path and completes with errors.
await sql('update zy_private.order_state set orders=$1',[JSON.stringify(Array.from({length:8},(_,i)=>({id:'split-'+i,title:'合成拆批岗位'+i})))]);
await control('start');mode='incomplete';const splitCalls=modelCalls;
for(let i=0;i<16;i++)await step();
assert.equal((await control('status')).task.failed,8);assert.equal((await control('status')).task.status,'completed_with_errors');
assert.equal(modelCalls-splitCalls,11); // 8 -> 4 -> 2 -> eight singletons.
assert((await sql('select max(attempts) as n from zy_private.classification_task_items'))[0].n<=6);
await control('resume');mode='ok';for(let i=0;i<10;i++)await step();assert.equal((await control('status')).task.status,'completed');
const beforeQuotaCalls=modelCalls;
// Daily quota exhaustion waits until the next Shanghai day without burning retries.
await sql("update zy_private.order_state set orders='[{\"id\":\"quota\",\"title\":\"合成额度岗位\"}]';update zy_private.job_classification_usage set calls=50");
await control('start');await step();const quota=await sql('select last_code,next_run_at > now() as future from zy_private.classification_tasks order by created_at desc limit 1');
assert.equal(quota[0].last_code,'CLASSIFICATION_QUOTA_EXHAUSTED');assert(quota[0].future);assert.equal(modelCalls,beforeQuotaCalls);
assert.equal((await sql("select attempts from zy_private.classification_task_items where input->>'title'='合成额度岗位'"))[0].attempts,0);
await role('authenticated',actor);assert((await call('zy_ai_reserve')).ok); // Recognition counter remains independent.
// Maintenance and disabled task owners stop work. Resuming requires an active admin.
await sql('update zy_private.settings set read_only=true');await advance();assert.equal(await rpc('zy_classification_task_claim'),null);
await sql('update zy_private.settings set read_only=false;update zy_private.members set active=false where role=\'admin\'');await advance();assert.equal(await rpc('zy_classification_task_claim'),null);
await sql("update zy_private.members set active=true where role='admin'");assert.equal((await control('status')).task.status,'paused');
await control('resume');await control('pause');await advance();assert.equal(await rpc('zy_classification_task_claim'),null);
await db.close();console.log('PASS: durable tasks, 40 cache reuse / 3 manual protection, no business writes, crash recovery, fenced leases, retries, resume, Shanghai quota wait, authorization and maintenance');
