process.on('uncaughtException',e=>{console.error(e.message,e.where||'');process.exit(1)});
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const admin='10000000-0000-0000-0000-000000000001',staff='10000000-0000-0000-0000-000000000002';
let db;
async function bootstrap(){db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create schema vault;create table vault.decrypted_secrets(name text,decrypted_secret text);`);
for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));

await db.query("insert into auth.users values($1),($2);",[admin,staff]);
await db.query("insert into zy_private.members values($1,'synthetic-admin','admin',true),($2,'synthetic-staff','staff',true)",[admin,staff]);
}
await bootstrap();
async function login(id=admin,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
async function rpc(fn,...args){return (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args)).rows[0].r}
const a={id:'synthetic-a',code:'SYN-A',title:'岗位【合成工】',gender:'女',raw:'合成原文不修改',createdAt:'2026-11-20T00:00:00Z',price:'3.8w',status:'ready',notes:'住宿打20%',salary:'HKD17120+提成'},b={...a,id:'synthetic-b',code:'SYN-B'};
await login();await rpc('zy_orders_save',[a,b],0);await rpc('zy_worker_save',{id:'synthetic-worker',name:'synthetic worker',gender:'男',createdAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:00Z',workHistory:[]});
const migration=readFileSync('supabase/pending-migrations/202611200001_human_order_versions.sql','utf8');await db.exec('reset role');
await db.exec(readFileSync('supabase/pending-migrations/human-order-preflight.sql','utf8'));
await assert.rejects(()=>db.exec(migration),/read_only/);await db.exec('rollback');
await login();await rpc('zy_maintenance_set',true);await db.exec('reset role');await db.exec(migration);
await login();const initial=await rpc('zy_orders_get');assert.equal(initial.orderStorage,'rows-v1');assert.deepEqual(initial.orders.map(({_version,...v})=>v),[a,b]);assert(initial.orders.every(o=>o._version===1));
await rpc('zy_maintenance_set',false);
const editedA={...a,notes:'人工，保留。'},editedB={...b,salary:'HKD18000-20000；面试定薪）+加班另计'};
const first=await rpc('zy_order_save',editedA,1);await login(staff);const second=await rpc('zy_order_save',editedB,1);assert(first.version>1);assert(second.version>first.version);
const conflict=await rpc('zy_order_save',{...a,notes:'my other edit'},1);assert.equal(conflict.conflict,true);assert.deepEqual(conflict.current.data,editedA);
await rpc('zy_order_save',{...a,notes:'my other edit'},conflict.current.version);
await assert.rejects(()=>rpc('zy_order_history',a.id),/权限不足/);
await login();let history=(await rpc('zy_order_history',a.id)).history;assert.equal(history.length,3);assert.deepEqual(history.at(-1).data,a);
const restored=await rpc('zy_order_restore',a.id,1);assert.deepEqual(restored.order,{...a,_version:restored.version});history=(await rpc('zy_order_history',a.id)).history;assert.equal(history[0].action,'restore');
await assert.rejects(()=>rpc('zy_order_save',{...a,raw:'changed'},restored.version),/不能更改/);await assert.rejects(()=>rpc('zy_order_save',{...a,createdAt:'changed'},restored.version),/不能更改/);
await assert.rejects(()=>rpc('zy_order_save',{...a,title:' '},restored.version),/职位/);await assert.rejects(()=>rpc('zy_order_save',{...a,gender:''},restored.version),/性别/);await assert.rejects(()=>rpc('zy_order_save',{...a,code:b.code},restored.version),/已存在/);
await assert.rejects(()=>rpc('zy_orders_save',[a,b],1),/刷新/);
await assert.rejects(()=>rpc('zy_job_profiles_apply',[],[],0),/禁止回填/);
const removed=await rpc('zy_order_delete',a.id,restored.version);assert.equal((await rpc('zy_orders_get')).orders.length,1);assert((await rpc('zy_order_save',a,removed.version)).conflict);await rpc('zy_order_restore',a.id,1);
assert((await rpc('zy_order_history',null)).orders.some(o=>o.id===a.id));
await login(admin,'service_role');const aiContext=await rpc('zy_ai_service_context',admin,'synthetic-worker');assert.equal(aiContext.orders.find(o=>o.id===b.id).salary,editedB.salary);await assert.rejects(()=>rpc('zy_worker_save',{id:'synthetic-worker'}),/permission denied/);await login();
const backup=await rpc('zy_export');assert.deepEqual(backup.orders.find(o=>o.id===a.id),a);assert.equal((await rpc('zy_order_history',a.id)).history[1].action,'delete');
for(const role of ['authenticated','service_role','anon']){await login(admin,role);for(const table of ['orders','workers','order_state','order_history'])await assert.rejects(()=>db.query(`update zy_private.${table} set ${table==='order_state'?'revision=revision':'data=data'}`),/permission denied/)}
await db.exec('reset role');await assert.rejects(()=>db.exec("update zy_private.order_state set revision=revision+1"),/只读/);await assert.rejects(()=>db.exec("delete from zy_private.order_history"),/只读/);
const archived=(await db.query('select orders from zy_private.order_state')).rows[0].orders;assert.deepEqual(archived,[a,b]);
// Portable export/import round trip includes append-only audit and soft-deleted records.
await login();const live=(await rpc('zy_orders_get')).orders.find(o=>o.id===b.id);await rpc('zy_order_delete',b.id,live._version);const completeBackup=await rpc('zy_export');
await db.close();await bootstrap();await login();await rpc('zy_maintenance_set',true);await db.exec('reset role');await db.exec(migration);await login();await rpc('zy_maintenance_set',false);await rpc('zy_import',completeBackup,0);
const roundtrip=await rpc('zy_export');assert.deepEqual(roundtrip.orders,completeBackup.orders);assert.deepEqual(roundtrip.workers,completeBackup.workers);assert.deepEqual(roundtrip.orderHistory,completeBackup.orderHistory);assert.deepEqual(roundtrip.deletedOrders,completeBackup.deletedOrders);await assert.rejects(()=>rpc('zy_import',completeBackup,0),/空数据库/);
const resumed=(await rpc('zy_orders_get')).orders[0];const next=await rpc('zy_order_save',{...resumed,notes:'after import',_version:undefined},resumed._version);assert(next.version>Math.max(...completeBackup.orderHistory.map(h=>h.version)));
await db.close();console.log('Human order database: exact migration, independent saves, conflicts, history, restore, soft delete, immutable archive and role denials passed');
