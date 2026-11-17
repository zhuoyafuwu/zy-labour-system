-- Enqueue changed inputs transactionally with the existing business save; never modify the saved record.
begin;
create function zy_private.enqueue_classification(p_kind text,p_input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare t uuid; actor uuid;
begin
 if p_input is null or p_input='{}'::jsonb then return;end if;
 select id into actor from zy_private.members where active and role='admin' order by id limit 1;if actor is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended('zy-classification-tasks',0));
 select id into t from zy_private.classification_tasks where status in ('queued','running','waiting','paused') order by created_at desc limit 1;
 if t is null then insert into zy_private.classification_tasks(actor) values(actor) returning id into t;end if;
 if not exists(select 1 from zy_private.classification_task_items where task_id=t and kind=p_kind and input=p_input) then
  insert into zy_private.classification_task_items(task_id,kind,input) values(t,p_kind,p_input);
 end if;
end $$;
create function zy_private.enqueue_saved_ai() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb; h jsonb; x text; previous jsonb; actor uuid; inp jsonb; hashed text;
begin
 if tg_table_name='workers' then
  if tg_op='UPDATE' and zy_private.ai_worker_input(new.data)=zy_private.ai_worker_input(old.data) then return new;end if;
  inp=zy_private.ai_worker_input(new.data);hashed=zy_private.ai_input_hash(inp);
  select id into actor from zy_private.members where id=auth.uid() and active;
  if actor is null then select id into actor from zy_private.members where active and role='admin' order by id limit 1;end if;
  if actor is not null then delete from zy_private.ai_inference_jobs where kind='profile' and worker_id=new.id and cache_key<>zy_private.ai_input_hash(to_jsonb(new.id||':'||hashed));insert into zy_private.ai_inference_jobs(kind,cache_key,worker_id,actor) values('profile',zy_private.ai_input_hash(to_jsonb(new.id||':'||hashed)),new.id,actor) on conflict do nothing;end if;
  r=new.data;
  for h in select value from jsonb_array_elements(coalesce(r->'workHistory','[]')) loop
   if btrim(coalesce(h->>'position','')||coalesce(h->>'duties',''))<>'' then perform zy_private.enqueue_classification('history',jsonb_build_object('position',coalesce(h->>'position',''),'duties',coalesce(h->>'duties',''),'employer',coalesce(h->>'employer','')));end if;
  end loop;
  foreach x in array array[coalesce(r->>'desiredJob1',r->>'desiredJob',''),coalesce(r->>'desiredJob2',''),coalesce(r->>'desiredJob3','')] loop
   if btrim(x)<>'' then perform zy_private.enqueue_classification('intent',jsonb_build_object('text',x));end if;
  end loop;
  for x in select btrim(v) from regexp_split_to_table(coalesce(r->>'certificates',''),'[，,；;、\n]+') v loop
   if x<>'' and x !~ '^健康[证證]$' then perform zy_private.enqueue_classification('certificate',jsonb_build_object('text',x));end if;
  end loop;
 else
  for r in select value from jsonb_array_elements(new.orders) loop
   if r->>'status'<>'ready' or btrim(coalesce(r->>'title',''))='' then continue;end if;
   select value into previous from jsonb_array_elements(old.orders) where value->>'id'=r->>'id';
   if previous is not null and jsonb_build_array(previous->>'title',previous->>'workContent')=jsonb_build_array(r->>'title',r->>'workContent') then continue;end if;
   perform zy_private.enqueue_classification('order',jsonb_build_object('title',coalesce(r->>'title',''),'workContent',coalesce(r->>'workContent',''),'requirements',''));
  end loop;
 end if;
 return new;
end $$;
revoke all on function zy_private.enqueue_classification(text,jsonb),zy_private.enqueue_saved_ai() from public,anon,authenticated;
create trigger worker_auto_ai after insert or update of data on zy_private.workers for each row execute function zy_private.enqueue_saved_ai();
create trigger order_auto_ai after update of orders on zy_private.order_state for each row execute function zy_private.enqueue_saved_ai();
commit;
