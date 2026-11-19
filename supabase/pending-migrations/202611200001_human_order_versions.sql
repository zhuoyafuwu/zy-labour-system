-- PENDING: execute only after explicit approval, private backup, maintenance and lease drain.
-- Copy is an explicitly approved one-off migration; JSON values are never normalized.
begin;
lock table zy_private.settings,zy_private.order_state,zy_private.workers in exclusive mode;
do $$begin
 if not (select read_only from zy_private.settings where id=1) then raise exception 'Maintenance read_only must be enabled';end if;
 if exists(select 1 from zy_private.classification_tasks where lease_until>now()) or exists(select 1 from zy_private.ai_inference_jobs where lease_until>now()) then raise exception 'Drain active task leases before migration';end if;
end $$;
create sequence zy_private.order_version_seq start 2;
create table zy_private.orders(
 id text primary key,data jsonb not null,version bigint not null default 1,
 updated_at timestamptz not null default now(),updated_by uuid,deleted_at timestamptz,
 sort_position bigint not null default 0,
 check(data->>'id'=id),check(jsonb_typeof(data)='object')
);
create unique index orders_active_code on zy_private.orders(lower(btrim(data->>'code'))) where deleted_at is null;
create table zy_private.order_history(
 order_id text not null,version bigint not null,data jsonb not null,
 action text not null check(action in ('create','update','delete','restore')),
 saved_at timestamptz not null default now(),saved_by uuid,
 primary key(order_id,version)
);
alter table zy_private.orders enable row level security;
alter table zy_private.order_history enable row level security;
create function zy_private.record_order_history() returns trigger language plpgsql security definer set search_path='' as $$
declare act text;
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.data->'raw' is distinct from old.data->'raw' or new.data->'createdAt' is distinct from old.data->'createdAt' then raise exception '不能更改原单、ID或创建时间';end if;
  insert into zy_private.order_history(order_id,version,data,action,saved_at,saved_by) values(old.id,old.version,old.data,'update',old.updated_at,old.updated_by) on conflict do nothing;
 end if;
 if tg_op='INSERT' and current_setting('zy.order_action',true)='import' and exists(select 1 from zy_private.order_history where order_id=new.id and version=new.version and data=new.data) then return new;end if;
 act=case when tg_op='INSERT' then 'create' when new.deleted_at is not null then 'delete' when current_setting('zy.order_action',true)='restore' then 'restore' else 'update' end;
 insert into zy_private.order_history(order_id,version,data,action,saved_at,saved_by) values(new.id,new.version,new.data,act,new.updated_at,new.updated_by);
 return new;
end $$;
create trigger order_history_snapshot before insert or update on zy_private.orders for each row execute function zy_private.record_order_history();
create function zy_private.reject_archive_write() returns trigger language plpgsql set search_path='' as $$begin raise exception '只读历史备份，禁止覆盖或删除';end $$;
create trigger order_history_immutable before update or delete on zy_private.order_history for each row execute function zy_private.reject_archive_write();
insert into zy_private.orders(id,data,sort_position) select value->>'id',value,ordinality from zy_private.order_state cross join lateral jsonb_array_elements(orders) with ordinality where id=1;
do $$begin
 if (select count(*) from zy_private.orders)<>(select jsonb_array_length(orders) from zy_private.order_state where id=1) or exists(select 1 from zy_private.order_state s cross join lateral jsonb_array_elements(s.orders) j where not exists(select 1 from zy_private.orders o where o.id=j->>'id' and o.data=j)) then raise exception 'Exact migration verification failed';end if;
end $$;
drop trigger order_auto_ai on zy_private.order_state;
create trigger order_state_archive before insert or update or delete on zy_private.order_state for each row execute function zy_private.reject_archive_write();
create function zy_private.validate_human_order(o jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;
begin
 if jsonb_typeof(o) is distinct from 'object' or octet_length(o::text)>1048576 then raise exception '公司单格式或大小无效';end if;
 if jsonb_typeof(o->'id') is distinct from 'string' or (o->>'id') !~ '^[A-Za-z0-9_-]{1,100}$' then raise exception '记录ID无效';end if;
 foreach k in array array['code','title','raw','createdAt','gender'] loop
  if jsonb_typeof(o->k) is distinct from 'string' then raise exception '公司单字段类型无效';end if;
 end loop;
 if btrim(o->>'title',E' \t\n\r')='' then raise exception '请填写职位名称';end if;
 if o->>'gender' not in ('男','女','男女不限') then raise exception '请选择招聘性别';end if;
 for k,v in select * from jsonb_each(o) loop
  if k in ('__proto__','constructor','prototype','_version') or length(k)>100 or octet_length(v::text)>524288 then raise exception '公司单字段类型或大小无效';end if;
  if k in ('matchProfile','recognitionReview') then
   if jsonb_typeof(v) not in ('object','null') then raise exception '元数据类型无效';end if;
  elsif jsonb_typeof(v) not in ('string','number','boolean','null') then raise exception '公司单字段类型无效';end if;
  if k in ('salary','employer','age','language','hours','rest','workContent','requirements','notes','interview') and jsonb_typeof(v) not in ('string','null') then raise exception '文字字段类型无效';end if;
 end loop;
end $$;
create function zy_private.order_conflict(r zy_private.orders) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('conflict',true,'current',jsonb_build_object('data',r.data,'version',r.version,'updated_by',r.updated_by,'updated_at',r.updated_at,'deleted',r.deleted_at is not null))
$$;
create function public.zy_order_save(p_order jsonb,p_base_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r zy_private.orders;v bigint;
begin
 perform zy_private.require_writable();perform zy_private.validate_human_order(p_order);
 perform pg_advisory_xact_lock(hashtextextended(p_order->>'id',0));
 select * into r from zy_private.orders where id=p_order->>'id' for update;
 if found then
  if p_base_version is distinct from r.version or r.deleted_at is not null then return zy_private.order_conflict(r);end if;
  if p_order->'raw' is distinct from r.data->'raw' or p_order->'createdAt' is distinct from r.data->'createdAt' then raise exception '不能更改原单或创建时间';end if;
 elsif p_base_version is not null then return jsonb_build_object('conflict',true,'current',jsonb_build_object('data',null,'deleted',true));end if;
 v=nextval('zy_private.order_version_seq');
 perform set_config('zy.order_action','update',true);
 if r.id is not null then update zy_private.orders set data=p_order,version=v,updated_at=now(),updated_by=auth.uid() where id=r.id;
 else insert into zy_private.orders(id,data,version,updated_by) values(p_order->>'id',p_order,v,auth.uid());end if;
 return jsonb_build_object('order',p_order||jsonb_build_object('_version',v),'version',v,'revision',v);
 exception when unique_violation then raise exception using errcode='23505',message='公司单号已存在，请修改';
end $$;
create function public.zy_order_delete(p_id text,p_base_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r zy_private.orders;v bigint;
begin
 perform zy_private.require_writable();perform pg_advisory_xact_lock(hashtextextended(p_id,0));select * into r from zy_private.orders where id=p_id for update;
 if not found then return jsonb_build_object('conflict',true,'current',jsonb_build_object('data',null,'deleted',true));end if;
 if r.version is distinct from p_base_version or r.deleted_at is not null then return zy_private.order_conflict(r);end if;
 v=nextval('zy_private.order_version_seq');update zy_private.orders set deleted_at=now(),updated_at=now(),updated_by=auth.uid(),version=v where id=p_id;
 return jsonb_build_object('version',v,'revision',v);
end $$;
create function public.zy_order_history(p_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform zy_private.require_member(true);
 if p_id is null then return jsonb_build_object('orders',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',data->>'code','title',data->>'title','deleted',deleted_at is not null) order by updated_at desc),'[]') from zy_private.orders));end if;
 return jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('saved_by_name',m.username) order by h.version desc),'[]') from zy_private.order_history h left join zy_private.members m on m.id=h.saved_by where order_id=p_id));
end $$;
create function public.zy_order_restore(p_id text,p_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare r zy_private.orders;snapshot jsonb;v bigint;
begin
 perform zy_private.require_member(true);perform zy_private.require_writable();perform pg_advisory_xact_lock(hashtextextended(p_id,0));select * into r from zy_private.orders where id=p_id for update;
 if not found then raise exception '公司单不存在';end if;
 select data into snapshot from zy_private.order_history where order_id=p_id and version=p_version;if not found then raise exception '历史版本不存在';end if;
 perform zy_private.validate_human_order(snapshot);perform set_config('zy.order_action','restore',true);v=nextval('zy_private.order_version_seq');
 update zy_private.orders set data=snapshot,version=v,updated_at=now(),updated_by=auth.uid(),deleted_at=null where id=p_id;
 return jsonb_build_object('order',snapshot||jsonb_build_object('_version',v),'version',v,'revision',v);
 exception when unique_violation then raise exception using errcode='23505',message='公司单号已存在，请先核对当前公司单';
end $$;
create or replace function public.zy_orders_get() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform zy_private.require_member();return jsonb_build_object('orders',(select coalesce(jsonb_agg(data||jsonb_build_object('_version',version) order by sort_position,updated_at desc,id),'[]') from zy_private.orders where deleted_at is null),'revision',(select coalesce(max(version),0) from zy_private.orders),'orderStorage','rows-v1');end $$;
create or replace function public.zy_orders_save(p_orders jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$begin perform zy_private.require_member();raise exception '保存接口已更新，请刷新页面；当前输入请先保留';end $$;
create or replace function public.zy_job_profiles_apply(p_orders jsonb,p_workers jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$begin perform zy_private.require_member(true);raise exception '分类仅写缓存，禁止回填业务资料';end $$;
-- Preserve existing function bodies and grants, changing only their data source. Fail closed on drift.
do $$declare fn text;body text;old_source text;new_source text;begin
 foreach fn in array array['public.zy_classification_task_control(text)','public.zy_ai_worker_context(text)'] loop
  body=pg_get_functiondef(fn::regprocedure);
  if fn like '%task_control%' then
   old_source='select value from zy_private.order_state s cross join lateral jsonb_array_elements(s.orders) where s.id=1';
   new_source='select data as value from zy_private.orders where deleted_at is null';
  else
   old_source='select orders from zy_private.order_state where id=1';
   new_source='select coalesce(jsonb_agg(data),''[]''::jsonb) from zy_private.orders where deleted_at is null';
  end if;
  if position(old_source in body)=0 then raise exception 'Unexpected function source: %',fn;end if;
  execute replace(body,old_source,new_source);
 end loop;
end $$;
create function zy_private.enqueue_saved_order_ai() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.deleted_at is not null or coalesce(new.data->>'status','')<>'ready' then return new;end if;
 if tg_op='UPDATE' then if old.deleted_at is null and jsonb_build_array(new.data->>'title',new.data->>'workContent')=jsonb_build_array(old.data->>'title',old.data->>'workContent') then return new;end if;end if;
 perform zy_private.enqueue_classification('order',jsonb_build_object('title',coalesce(new.data->>'title',''),'workContent',coalesce(new.data->>'workContent',''),'requirements',''));
 return new;
end $$;
create trigger order_auto_ai after insert or update of data,deleted_at on zy_private.orders for each row execute function zy_private.enqueue_saved_order_ai();
create or replace function public.zy_export() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform zy_private.require_member(true);return jsonb_build_object('format','zy-labour-portable','version',1,'exportedAt',now(),'orders',(select coalesce(jsonb_agg(data order by sort_position,id),'[]') from zy_private.orders where deleted_at is null),'workers',(select coalesce(jsonb_agg(data order by id),'[]') from zy_private.workers),'orderHistory',(select coalesce(jsonb_agg(to_jsonb(h) order by order_id,version),'[]') from zy_private.order_history h),'deletedOrders',(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from zy_private.orders o where deleted_at is not null));end $$;
-- Imports remain explicit administrator actions and restore only to a completely empty target.
create or replace function public.zy_import(p_payload jsonb,p_revision bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare o jsonb;w jsonb;h jsonb;v bigint;total integer=0;last_saved timestamptz;last_actor uuid;
begin
 perform zy_private.require_member(true);perform zy_private.require_writable();
 if p_payload->>'format' is distinct from 'zy-labour-portable' or p_payload->'version' is distinct from '1'::jsonb or jsonb_typeof(p_payload->'orders') is distinct from 'array' or jsonb_typeof(p_payload->'workers') is distinct from 'array' then raise exception '备份格式无效';end if;
 if jsonb_typeof(coalesce(p_payload->'orderHistory','[]'))<>'array' or jsonb_typeof(coalesce(p_payload->'deletedOrders','[]'))<>'array' then raise exception '历史备份格式无效';end if;
 lock table zy_private.orders,zy_private.workers,zy_private.order_history in exclusive mode;
 if exists(select 1 from zy_private.orders) or exists(select 1 from zy_private.workers) or exists(select 1 from zy_private.order_history) then raise exception '只允许恢复到空数据库';end if;
 if p_revision is distinct from 0::bigint then raise exception '目标资料已变化，请刷新';end if;
 for h in select value from jsonb_array_elements(coalesce(p_payload->'orderHistory','[]')) loop
  if jsonb_typeof(h->'data') is distinct from 'object' or h->>'order_id' is distinct from h->'data'->>'id' or (h->>'version')::bigint<1 or octet_length(h::text)>2097152 then raise exception '历史快照格式无效';end if;
  insert into zy_private.order_history(order_id,version,data,action,saved_at,saved_by) values(h->>'order_id',(h->>'version')::bigint,h->'data',h->>'action',(h->>'saved_at')::timestamptz,(h->>'saved_by')::uuid);
 end loop;
 perform set_config('zy.order_action','import',true);
 for o in select value from jsonb_array_elements(p_payload->'orders') loop
  perform zy_private.validate_human_order(o-'_version');
  select version,saved_at,saved_by into v,last_saved,last_actor from zy_private.order_history where order_id=o->>'id' order by version desc limit 1;
  if v is not null and not exists(select 1 from zy_private.order_history where order_id=o->>'id' and version=v and data=o-'_version') then raise exception '当前单与历史末版不一致';end if;
  insert into zy_private.orders(id,data,version,updated_at,updated_by,sort_position) values(o->>'id',o-'_version',coalesce(v,nextval('zy_private.order_version_seq')),coalesce(last_saved,now()),coalesce(last_actor,auth.uid()),total+1);total=total+1;
 end loop;
 for o in select value from jsonb_array_elements(coalesce(p_payload->'deletedOrders','[]')) loop
  if o->>'deleted_at' is null or o->>'id' is distinct from o->'data'->>'id' or not exists(select 1 from zy_private.order_history where order_id=o->>'id' and version=(o->>'version')::bigint and data=o->'data') then raise exception '删除记录与历史不一致';end if;
  insert into zy_private.orders(id,data,version,updated_at,updated_by,deleted_at,sort_position) values(o->>'id',o->'data',(o->>'version')::bigint,(o->>'updated_at')::timestamptz,(o->>'updated_by')::uuid,(o->>'deleted_at')::timestamptz,(o->>'sort_position')::bigint);
 end loop;
 if exists(select 1 from zy_private.order_history h where not exists(select 1 from zy_private.orders o where o.id=h.order_id)) then raise exception '备份含无对应公司单的历史';end if;
 perform setval('zy_private.order_version_seq',greatest((select coalesce(max(version),1) from zy_private.orders),(select coalesce(max(version),1) from zy_private.order_history),2),true);
 for w in select value from jsonb_array_elements(p_payload->'workers') loop perform zy_private.validate_worker(w);insert into zy_private.workers values(w->>'id',1,w-'_version');end loop;
 return jsonb_build_object('orders',total,'workers',jsonb_array_length(p_payload->'workers'),'revision',(select coalesce(max(version),0) from zy_private.orders));
end $$;
revoke all on zy_private.orders,zy_private.order_history,zy_private.order_state,zy_private.workers from public,anon,authenticated,service_role;
revoke all on sequence zy_private.order_version_seq from public,anon,authenticated,service_role;
revoke all on all functions in schema zy_private from public,anon,authenticated,service_role;
revoke all on function public.zy_order_save(jsonb,bigint),public.zy_order_delete(text,bigint),public.zy_order_history(text),public.zy_order_restore(text,bigint),public.zy_orders_save(jsonb,bigint),public.zy_job_profiles_apply(jsonb,jsonb,bigint),public.zy_worker_save(jsonb),public.zy_worker_delete(text,bigint),public.zy_import(jsonb,bigint) from public,anon,service_role;
grant execute on function public.zy_order_save(jsonb,bigint),public.zy_order_delete(text,bigint),public.zy_order_history(text),public.zy_order_restore(text,bigint) to authenticated;
commit;
