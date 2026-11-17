-- Remove daily caps; retain counters, membership, maintenance and anti-click interval.
begin;
create or replace function public.zy_ai_reserve() returns jsonb language plpgsql security definer set search_path='' as $$
declare d date := (now() at time zone 'Asia/Shanghai')::date; total integer; personal integer; last_time timestamptz;
begin
 perform zy_private.require_writable();
 insert into zy_private.ai_daily_usage(day) values(d) on conflict do nothing;
 select calls into total from zy_private.ai_daily_usage where day=d for update;
 insert into zy_private.ai_member_usage(day,member) values(d,auth.uid()) on conflict do nothing;
 select calls,last_call into personal,last_time from zy_private.ai_member_usage where day=d and member=auth.uid() for update;
 if now()-last_time<interval '2 seconds' then raise exception using errcode='54000',message='请间隔2秒后重试'; end if;
 update zy_private.ai_daily_usage set calls=calls+1 where day=d;
 update zy_private.ai_member_usage set calls=calls+1,last_call=now() where day=d and member=auth.uid();
 return jsonb_build_object('ok',true,'remaining',9999);
end $$;
create or replace function public.zy_job_reserve(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; total integer;
begin
 if not exists(select 1 from zy_private.members where id=p_actor and active) then raise exception using errcode='42501',message='账号未获授权'; end if;
 if (select read_only from zy_private.settings where id=1) then raise exception using errcode='55000',message='系统暂停写入'; end if;

 insert into zy_private.job_classification_usage(day) values(d) on conflict do nothing;
 select calls into total from zy_private.job_classification_usage where day=d for update;

 update zy_private.job_classification_usage set calls=calls+1 where day=d;
 return jsonb_build_object('remaining',9999);
end $$;
create or replace function public.zy_job_taxonomy() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare calls integer;
begin
 perform zy_private.require_member();
 select u.calls into calls from zy_private.job_classification_usage u where day=(now() at time zone 'Asia/Shanghai')::date;
 return jsonb_build_object('version',2,'subcategories',(select coalesce(jsonb_agg(s order by s.major,s.name),'[]') from public.zy_job_subcategories s),
 'cache',(select coalesce(jsonb_agg(c),'[]') from public.zy_job_classification_cache c),'remaining',9999);
end $$;
alter table zy_private.classification_tasks add column success_streak integer not null default 0, add column leased_item_ids bigint[];
create or replace function public.zy_classification_task_claim() returns jsonb
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
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'input',input) order by case kind when 'history' then 0 when 'intent' then 1 when 'certificate' then 2 else 3 end,id),'[]') into rows
 from (select * from zy_private.classification_task_items where task_id=t.id and status='pending' order by case kind when 'history' then 0 when 'intent' then 1 when 'certificate' then 2 else 3 end,id limit t.batch_size) s;
 if jsonb_array_length(rows)=0 then
  update zy_private.classification_tasks set status=case when exists(select 1 from zy_private.classification_task_items where task_id=t.id and status='failed') then 'completed_with_errors' else 'completed' end,lease=null,lease_until=null,updated_at=now() where id=t.id;return null;
 end if;
 update zy_private.classification_tasks set status='running',lease=token,leased_item_ids=array(select (v->>'id')::bigint from jsonb_array_elements(rows) v),lease_until=now()+interval '180 seconds',updated_at=now() where id=t.id;
 update zy_private.classification_task_items set attempts=attempts+1 where id in (select (v->>'id')::bigint from jsonb_array_elements(rows) v);
 return jsonb_build_object('id',t.id,'actor',t.actor,'lease',token,'items',rows,
  'taxonomy',jsonb_build_object('subcategories',(select coalesce(jsonb_agg(s),'[]') from public.zy_job_subcategories s),'cache',(select coalesce(jsonb_agg(c),'[]') from public.zy_job_classification_cache c)));
end $$;

create or replace function public.zy_classification_task_finish(p_id uuid,p_lease uuid,p_done bigint[],p_code text) returns void
language plpgsql security definer set search_path='' as $$
declare t zy_private.classification_tasks; ids bigint[];
begin
 select * into t from zy_private.classification_tasks where id=p_id for update;
 if t.lease is distinct from p_lease or t.lease_until<now() then raise exception '任务租约失效'; end if;
 -- The leased items are exactly the earliest pending batch; no other batch can run under this lease.
 ids=t.leased_item_ids;
 if not coalesce(p_done,'{}') <@ coalesce(ids,'{}') then raise exception '任务结果无效'; end if;
 update zy_private.classification_task_items set status='done',last_code=null where task_id=p_id and id=any(p_done);
 if p_code in ('CLASSIFICATION_READ_ONLY','CLASSIFICATION_PERMISSION_DENIED','CLASSIFICATION_BUSY') then
  -- Waiting without a paid request must not exhaust the retry allowance.
  update zy_private.classification_task_items set attempts=greatest(0,attempts-1) where task_id=p_id and id=any(ids) and status='pending';
 end if;
 update zy_private.classification_task_items set last_code=left(p_code,80),
  status=case when attempts>=6 or (p_code in ('CLASSIFICATION_RESPONSE_INCOMPLETE','CLASSIFICATION_RESPONSE_INVALID','CLASSIFICATION_RESPONSE_TOO_LARGE','CLASSIFICATION_INPUT_INVALID') and cardinality(ids)=1) or p_code='CLASSIFICATION_UNCLASSIFIABLE' then 'failed' else 'pending' end
 where task_id=p_id and id=any(ids) and status='pending';
 update zy_private.classification_tasks set lease=null,lease_until=null,last_code=left(p_code,80),updated_at=now(),
  batch_size=case when p_code in ('CLASSIFICATION_RESPONSE_INCOMPLETE','CLASSIFICATION_RESPONSE_INVALID','CLASSIFICATION_RESPONSE_TOO_LARGE','CLASSIFICATION_INPUT_INVALID') and cardinality(ids)>1 then greatest(1,batch_size/2) when p_code is null and success_streak>=2 then least(8,batch_size*2) else batch_size end,
  success_streak=case when p_code is null then (success_streak+1)%3 else 0 end,
  status=case when t.status='paused' or p_code in ('CLASSIFICATION_PERMISSION_DENIED','CLASSIFICATION_READ_ONLY','CLASSIFICATION_PROVIDER_AUTH') then 'paused' else 'waiting' end,
  next_run_at=now()+interval '2 seconds'
 where id=p_id;
 if not exists(select 1 from zy_private.classification_task_items where task_id=p_id and status='pending') then
  update zy_private.classification_tasks set status=case when exists(select 1 from zy_private.classification_task_items where task_id=p_id and status='failed') then 'completed_with_errors' else 'completed' end where id=p_id;
 end if;
end $$;
update zy_private.job_classification_settings set daily_limit=10000 where id=1;
-- Clear only retired quota waiting metadata; no business rows or attempts are reset.
update zy_private.classification_tasks set next_run_at=now(),last_code=null,status='queued' where status='waiting' and last_code='CLASSIFICATION_QUOTA_EXHAUSTED';
-- Extend only aliases, preserving administrator names, majors, merge destinations and manual cache rows.
update public.zy_job_subcategories set aliases=array(select distinct x from unnest(aliases||array['仓管','倉管','仓务','倉務','货仓','貨倉','理货','理貨','分拣','分揀','冷仓','冷倉','冻仓','凍倉']) x) where id='seed:warehouse';
commit;
