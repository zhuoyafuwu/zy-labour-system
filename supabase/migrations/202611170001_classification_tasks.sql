-- Durable classification work. No business rows or existing caches are rewritten.
begin;
create table zy_private.classification_tasks (
 id uuid primary key default gen_random_uuid(), actor uuid not null references auth.users(id),
 status text not null default 'queued' check(status in ('queued','running','waiting','paused','completed','completed_with_errors')),
 batch_size integer not null default 8 check(batch_size between 1 and 8),
 lease uuid, lease_until timestamptz, next_run_at timestamptz not null default now(),
 last_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index classification_one_active on zy_private.classification_tasks ((true))
 where status in ('queued','running','waiting','paused');
create table zy_private.classification_task_items (
 id bigint generated always as identity primary key,
 task_id uuid not null references zy_private.classification_tasks(id),
 kind text not null check(kind in ('order','history','intent','certificate')),
 input jsonb not null, status text not null default 'pending' check(status in ('pending','done','failed')),
 attempts integer not null default 0, last_code text
);
create index classification_pending on zy_private.classification_task_items(task_id,id) where status='pending';
alter table zy_private.classification_tasks enable row level security;
alter table zy_private.classification_task_items enable row level security;
revoke all on zy_private.classification_tasks,zy_private.classification_task_items from public,anon,authenticated;

-- Admin start/resume is a single transaction. The browser supplies no source data.
create function public.zy_classification_task_control(p_action text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t zy_private.classification_tasks; r jsonb; h jsonb; x text;
begin
 perform zy_private.require_member(true);
 if p_action not in ('start','resume','pause','status') then raise exception '任务操作无效'; end if;
 if p_action<>'status' then perform zy_private.require_writable(); end if;
 perform pg_advisory_xact_lock(hashtextextended('zy-classification-tasks',0));
 select * into t from zy_private.classification_tasks order by created_at desc limit 1 for update;
 if p_action in ('start','resume') then
  if t.id is not null and t.status in ('queued','running','waiting','paused') then
   -- Do not invalidate an in-flight lease or quota waiting period.
   update zy_private.classification_tasks set actor=auth.uid(),
    status=case when status='paused' then 'queued' else status end,
    next_run_at=case when status='paused' then now() else next_run_at end,updated_at=now() where id=t.id;
  elsif p_action='resume' then
   if t.id is null then raise exception '没有可恢复任务'; end if;
   update zy_private.classification_task_items set status='pending',attempts=0,last_code=null where task_id=t.id and status='failed';
   update zy_private.classification_tasks set actor=auth.uid(),status='queued',next_run_at=now(),last_code=null,updated_at=now() where id=t.id;
  else
   insert into zy_private.classification_tasks(actor) values(auth.uid()) returning * into t;
   -- Only occupation inputs are copied. No names, contacts, amounts, originals or review fields.
   for r in select value from zy_private.order_state s cross join lateral jsonb_array_elements(s.orders) where s.id=1 loop
    if r->'matchProfile'->>'by'='user' then continue; end if;
    if btrim(coalesce(r->>'title','')||coalesce(r->>'workContent',''))<>'' then
     insert into zy_private.classification_task_items(task_id,kind,input) values(t.id,'order',jsonb_build_object('title',coalesce(r->>'title',''),'workContent',coalesce(r->>'workContent',''),'requirements',''));
    end if;
   end loop;
   for r in select data from zy_private.workers loop
    if r->'matchProfile'->>'by'='user' then continue; end if;
    for h in select value from jsonb_array_elements(coalesce(r->'workHistory','[]')) loop
     if h->>'by'='user' then continue; end if;
     if btrim(coalesce(h->>'position','')||coalesce(h->>'duties',''))<>'' then
      insert into zy_private.classification_task_items(task_id,kind,input) values(t.id,'history',jsonb_build_object('position',coalesce(h->>'position',''),'duties',coalesce(h->>'duties',''),'employer',coalesce(h->>'employer','')));
     end if;
    end loop;
    foreach x in array array[coalesce(r->>'desiredJob1',r->>'desiredJob',''),coalesce(r->>'desiredJob2',''),coalesce(r->>'desiredJob3','')] loop
     if btrim(x)<>'' then insert into zy_private.classification_task_items(task_id,kind,input) values(t.id,'intent',jsonb_build_object('text',x)); end if;
    end loop;
    -- Same certificate delimiter contract as the v2 client; health-only certificates are excluded.
    for x in select btrim(v) from regexp_split_to_table(regexp_replace(coalesce(r->>'certificates',''),'([证證](?:书|書)?)(?:\s*(?:和|及|与|與|/|&)\s*|\s+)','\1、','g'),'[，,；;、\n]+') v loop
     if x<>'' and x !~ '^健康[证證]$' then insert into zy_private.classification_task_items(task_id,kind,input) values(t.id,'certificate',jsonb_build_object('text',x)); end if;
    end loop;
   end loop;
   -- Identical input units need only one queue item. Canonical-equivalent inputs reuse the shared hash cache.
   delete from zy_private.classification_task_items a using zy_private.classification_task_items b
    where a.task_id=t.id and b.task_id=t.id and a.kind=b.kind and a.input=b.input and a.id>b.id;
  end if;
 elsif p_action='pause' and t.id is not null then
  update zy_private.classification_tasks set status='paused',updated_at=now() where id=t.id and status in ('queued','running','waiting');
 end if;
 if t.id is null then return jsonb_build_object('task',null); end if;
 return jsonb_build_object('task',(select jsonb_build_object('id',q.id,'status',q.status,'total',count(i.id),'done',count(i.id) filter(where i.status='done'),'failed',count(i.id) filter(where i.status='failed')) from zy_private.classification_tasks q left join zy_private.classification_task_items i on i.task_id=q.id where q.id=t.id group by q.id));
end $$;

-- One bounded batch per scheduled invocation. Expired leases are recoverable after process death.
create function public.zy_classification_task_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare t zy_private.classification_tasks; rows jsonb; token uuid:=gen_random_uuid();
begin
 if (select read_only from zy_private.settings where id=1) then return null; end if;
 select * into t from zy_private.classification_tasks
 where status in ('queued','running','waiting') and next_run_at<=now() and (lease_until is null or lease_until<now())
 order by created_at for update skip locked limit 1;
 if t.id is null then return null; end if;
 if not exists(select 1 from zy_private.members where id=t.actor and active and role='admin') then
  update zy_private.classification_tasks set status='paused',last_code='ACTOR_DISABLED',updated_at=now() where id=t.id;return null;
 end if;
 update zy_private.classification_task_items set status='failed',last_code='ATTEMPTS_EXHAUSTED' where task_id=t.id and status='pending' and attempts>=6;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'input',input) order by id),'[]') into rows
 from (select * from zy_private.classification_task_items where task_id=t.id and status='pending' order by id limit t.batch_size) s;
 if jsonb_array_length(rows)=0 then
  update zy_private.classification_tasks set status=case when exists(select 1 from zy_private.classification_task_items where task_id=t.id and status='failed') then 'completed_with_errors' else 'completed' end,lease=null,lease_until=null,updated_at=now() where id=t.id;return null;
 end if;
 update zy_private.classification_tasks set status='running',lease=token,lease_until=now()+interval '180 seconds',updated_at=now() where id=t.id;
 update zy_private.classification_task_items set attempts=attempts+1 where id in (select (v->>'id')::bigint from jsonb_array_elements(rows) v);
 return jsonb_build_object('id',t.id,'actor',t.actor,'lease',token,'items',rows,
  'taxonomy',jsonb_build_object('subcategories',(select coalesce(jsonb_agg(s),'[]') from public.zy_job_subcategories s),'cache',(select coalesce(jsonb_agg(c),'[]') from public.zy_job_classification_cache c)));
end $$;

create function public.zy_classification_task_finish(p_id uuid,p_lease uuid,p_done bigint[],p_code text) returns void
language plpgsql security definer set search_path='' as $$
declare t zy_private.classification_tasks; ids bigint[];
begin
 select * into t from zy_private.classification_tasks where id=p_id for update;
 if t.lease is distinct from p_lease or t.lease_until<now() then raise exception '任务租约失效'; end if;
 -- The leased items are exactly the earliest pending batch; no other batch can run under this lease.
 select array_agg(id) into ids from (select id from zy_private.classification_task_items where task_id=p_id and status='pending' order by id limit t.batch_size) s;
 if not coalesce(p_done,'{}') <@ coalesce(ids,'{}') then raise exception '任务结果无效'; end if;
 update zy_private.classification_task_items set status='done',last_code=null where task_id=p_id and id=any(p_done);
 if p_code in ('CLASSIFICATION_QUOTA_EXHAUSTED','CLASSIFICATION_READ_ONLY','CLASSIFICATION_PERMISSION_DENIED','CLASSIFICATION_BUSY') then
  -- Waiting without a paid request must not exhaust the retry allowance.
  update zy_private.classification_task_items set attempts=greatest(0,attempts-1) where task_id=p_id and id=any(ids) and status='pending';
 end if;
 update zy_private.classification_task_items set last_code=left(p_code,80),
  status=case when attempts>=6 or (p_code in ('CLASSIFICATION_RESPONSE_INCOMPLETE','CLASSIFICATION_RESPONSE_INVALID','CLASSIFICATION_RESPONSE_TOO_LARGE','CLASSIFICATION_INPUT_INVALID') and cardinality(ids)=1) or p_code='CLASSIFICATION_UNCLASSIFIABLE' then 'failed' else 'pending' end
 where task_id=p_id and id=any(ids) and status='pending';
 update zy_private.classification_tasks set lease=null,lease_until=null,last_code=left(p_code,80),updated_at=now(),
  batch_size=case when p_code in ('CLASSIFICATION_RESPONSE_INCOMPLETE','CLASSIFICATION_RESPONSE_INVALID','CLASSIFICATION_RESPONSE_TOO_LARGE','CLASSIFICATION_INPUT_INVALID') then greatest(1,batch_size/2) else batch_size end,
  status=case when t.status='paused' or p_code in ('CLASSIFICATION_PERMISSION_DENIED','CLASSIFICATION_READ_ONLY','CLASSIFICATION_PROVIDER_AUTH') then 'paused' else 'waiting' end,
  next_run_at=case when p_code='CLASSIFICATION_QUOTA_EXHAUSTED' then (((now() at time zone 'Asia/Shanghai')::date+1)::timestamp at time zone 'Asia/Shanghai') else now()+interval '1 minute' end
 where id=p_id;
 if not exists(select 1 from zy_private.classification_task_items where task_id=p_id and status='pending') then
  update zy_private.classification_tasks set status=case when exists(select 1 from zy_private.classification_task_items where task_id=p_id and status='failed') then 'completed_with_errors' else 'completed' end where id=p_id;
 end if;
end $$;
revoke all on function public.zy_classification_task_control(text) from public,anon;
grant execute on function public.zy_classification_task_control(text) to authenticated;
revoke all on function public.zy_classification_task_claim(),public.zy_classification_task_finish(uuid,uuid,bigint[],text) from public,anon,authenticated;
grant execute on function public.zy_classification_task_claim(),public.zy_classification_task_finish(uuid,uuid,bigint[],text) to service_role;
-- Dedicated scheduler auth stays entirely in Vault; no Edge secret provisioning is required.
create function public.zy_classification_worker_authorized(p_secret text) returns boolean
language sql stable security definer set search_path='' as $$
 select length(p_secret)=64 and exists(select 1 from vault.decrypted_secrets where name='zy_classification_worker_secret' and decrypted_secret=p_secret)
$$;
revoke all on function public.zy_classification_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.zy_classification_worker_authorized(text) to service_role;
commit;
