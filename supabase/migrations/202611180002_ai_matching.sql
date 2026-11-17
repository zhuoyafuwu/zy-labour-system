-- Separate private AI metadata and durable retry state. Business data is never rewritten.
begin;
create table zy_private.ai_worker_profiles(worker_id text primary key references zy_private.workers(id) on delete cascade,input_hash text not null,profile jsonb not null,updated_at timestamptz not null default now());
create table zy_private.ai_match_results(cache_key text primary key,worker_id text not null references zy_private.workers(id) on delete cascade,profile_hash text not null,order_id text not null,order_hash text not null,result jsonb not null,updated_at timestamptz not null default now());
create index ai_matches_worker on zy_private.ai_match_results(worker_id);
create table zy_private.ai_inference_jobs(kind text not null check(kind in ('profile','match')),cache_key text not null,worker_id text not null references zy_private.workers(id) on delete cascade,actor uuid not null,attempts integer not null default 0,lease uuid,lease_until timestamptz,next_run_at timestamptz not null default now(),last_code text,primary key(kind,cache_key));
alter table zy_private.ai_worker_profiles enable row level security;
alter table zy_private.ai_match_results enable row level security;
alter table zy_private.ai_inference_jobs enable row level security;
revoke all on zy_private.ai_worker_profiles,zy_private.ai_match_results,zy_private.ai_inference_jobs from public,anon,authenticated;
create function zy_private.ai_worker_input(w jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb; text_value text; key text; secret text;
begin
 select jsonb_build_object('history',coalesce((select jsonb_agg(jsonb_build_object('position',h->>'position','duties',h->>'duties','employer',h->>'employer','period',h->>'period')) from jsonb_array_elements(coalesce(w->'workHistory','[]')) h),'[]'::jsonb),'certificates',w->>'certificates','cantonese',w->>'cantonese','mandarin',w->>'mandarin','english',w->>'english','otherLanguages',w->>'otherLanguages','education',w->>'education','skills',w->>'skills','hobbies',w->>'hobbies','intents',jsonb_build_array(coalesce(w->>'desiredJob1',w->>'desiredJob'),w->>'desiredJob2',w->>'desiredJob3'),'desiredSalary',w->>'desiredSalary','workedHongKong',w->>'workedHongKong') into v;
 text_value=v::text;
 foreach key in array array['name','phone','idNumber','idAddress','currentAddress','alternateContact'] loop
  secret=w->>key;if length(coalesce(secret,''))>=2 then text_value=replace(text_value,substr(to_jsonb(secret)::text,2,length(to_jsonb(secret)::text)-2),'[redacted]');end if;
 end loop;
 return text_value::jsonb;
end $$;
create function zy_private.ai_input_hash(v jsonb) returns text language sql immutable set search_path='' as $$select encode(sha256(convert_to(v::text,'UTF8')),'hex')$$;
revoke all on function zy_private.ai_worker_input(jsonb),zy_private.ai_input_hash(jsonb) from public,anon,authenticated;
create function public.zy_ai_worker_context(p_worker_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w jsonb; inp jsonb; h text; cached jsonb;
begin
 perform zy_private.require_member();select data into w from zy_private.workers where id=p_worker_id;
 if w is null then raise exception 'Worker not found';end if;
 inp=zy_private.ai_worker_input(w);h=zy_private.ai_input_hash(inp);
 select profile into cached from zy_private.ai_worker_profiles where worker_id=p_worker_id and input_hash=h;
 return jsonb_build_object('input',inp,'input_hash',h,'profile',cached,'taxonomy',public.zy_job_taxonomy(),'worker',jsonb_build_object('gender',w->>'gender','age',w->>'age','birthDate',w->>'birthDate'),'orders',(select orders from zy_private.order_state where id=1),'taxonomy_hash',(select zy_private.ai_input_hash(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')) from public.zy_job_subcategories s));
end $$;
create function public.zy_ai_cached_matches(p_worker_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform zy_private.require_member();return coalesce((select jsonb_agg(to_jsonb(r)) from zy_private.ai_match_results r where worker_id=p_worker_id),'[]');end $$;
-- Actor identity is rechecked for every service-only cache/job operation.
create function public.zy_ai_inference_claim(p_actor uuid,p_worker_id text,p_kind text,p_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j zy_private.ai_inference_jobs; token uuid:=gen_random_uuid();
begin
 if not exists(select 1 from zy_private.members where id=p_actor and active) then raise exception using errcode='42501',message='Unauthorized';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);perform zy_private.require_writable();
 if p_kind not in ('profile','match') or p_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid inference key';end if;
 insert into zy_private.ai_inference_jobs(kind,cache_key,worker_id,actor) values(p_kind,p_key,p_worker_id,p_actor) on conflict do nothing;
 select * into j from zy_private.ai_inference_jobs where kind=p_kind and cache_key=p_key for update;
 if j.attempts>=6 or j.next_run_at>now() or j.lease_until>now() then return null;end if;
 update zy_private.ai_inference_jobs set lease=token,lease_until=now()+interval '90 seconds',attempts=attempts+1 where kind=p_kind and cache_key=p_key;
 return jsonb_build_object('lease',token);
end $$;
create function public.zy_ai_inference_finish(p_actor uuid,p_worker_id text,p_kind text,p_key text,p_lease uuid,p_profile_hash text,p_order_id text,p_order_hash text,p_result jsonb,p_code text) returns boolean language plpgsql security definer set search_path='' as $$
declare j zy_private.ai_inference_jobs; w jsonb;
begin
 if not exists(select 1 from zy_private.members where id=p_actor and active) then raise exception using errcode='42501',message='Unauthorized';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);perform zy_private.require_writable();
 select * into j from zy_private.ai_inference_jobs where kind=p_kind and cache_key=p_key for update;
 if j.lease is distinct from p_lease or j.lease_until<now() or j.worker_id<>p_worker_id then raise exception 'Stale lease';end if;
 select data into w from zy_private.workers where id=p_worker_id;
 if w is null or zy_private.ai_input_hash(zy_private.ai_worker_input(w))<>p_profile_hash then
  delete from zy_private.ai_inference_jobs where kind=p_kind and cache_key=p_key;return false;
 end if;
 if p_result is not null and p_code is null then
  if p_kind='profile' then
   insert into zy_private.ai_worker_profiles values(p_worker_id,p_profile_hash,p_result,now()) on conflict(worker_id) do update set input_hash=excluded.input_hash,profile=excluded.profile,updated_at=now();
  else
   insert into zy_private.ai_match_results values(p_key,p_worker_id,p_profile_hash,p_order_id,p_order_hash,p_result,now()) on conflict(cache_key) do nothing;
  end if;
  delete from zy_private.ai_inference_jobs where kind=p_kind and cache_key=p_key;
 else
  update zy_private.ai_inference_jobs set lease=null,lease_until=null,last_code=left(p_code,80),next_run_at=now()+interval '1 minute' where kind=p_kind and cache_key=p_key;
 end if;
 return true;
end $$;
-- Scheduled workers pick profile jobs independently of the browser.
create function public.zy_ai_pending_profiles() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select worker_id,actor from zy_private.ai_inference_jobs where kind='profile' and attempts<6 and next_run_at<=now() and (lease_until is null or lease_until<now()) order by next_run_at limit 4) s
$$;
revoke all on function public.zy_ai_worker_context(text),public.zy_ai_cached_matches(text) from public,anon;
grant execute on function public.zy_ai_worker_context(text),public.zy_ai_cached_matches(text) to authenticated;
revoke all on function public.zy_ai_inference_claim(uuid,text,text,text),public.zy_ai_inference_finish(uuid,text,text,text,uuid,text,text,text,jsonb,text),public.zy_ai_pending_profiles() from public,anon,authenticated;
grant execute on function public.zy_ai_inference_claim(uuid,text,text,text),public.zy_ai_inference_finish(uuid,text,text,text,uuid,text,text,text,jsonb,text),public.zy_ai_pending_profiles() to service_role;
-- A service context function performs the same identity check without requiring a user JWT in storage.
create function public.zy_ai_service_context(p_actor uuid,p_worker_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from zy_private.members where id=p_actor and active) then raise exception using errcode='42501',message='Unauthorized';end if;
 perform set_config('request.jwt.claim.sub',p_actor::text,true);return public.zy_ai_worker_context(p_worker_id);
end $$;
revoke all on function public.zy_ai_service_context(uuid,text) from public,anon,authenticated;
grant execute on function public.zy_ai_service_context(uuid,text) to service_role;
create table zy_private.ai_inference_usage(day date not null,actor uuid not null,kind text not null,calls integer not null default 0,last_manual timestamptz not null default '-infinity',primary key(day,actor,kind));
alter table zy_private.ai_inference_usage enable row level security;
revoke all on zy_private.ai_inference_usage from public,anon,authenticated;
create function public.zy_ai_inference_meter(p_actor uuid,p_kind text,p_manual boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'Asia/Shanghai')::date; previous timestamptz;
begin
 if p_kind not in ('profile','match') or not exists(select 1 from zy_private.members where id=p_actor and active) then raise exception using errcode='42501',message='Unauthorized';end if;
 insert into zy_private.ai_inference_usage(day,actor,kind) values(d,p_actor,p_kind) on conflict do nothing;
 select last_manual into previous from zy_private.ai_inference_usage where day=d and actor=p_actor and kind=p_kind for update;
 if p_manual and now()-previous<interval '2 seconds' then raise exception using errcode='54000',message='Please wait 2 seconds';end if;
 update zy_private.ai_inference_usage set calls=calls+1,last_manual=case when p_manual then now() else last_manual end where day=d and actor=p_actor and kind=p_kind;
end $$;
revoke all on function public.zy_ai_inference_meter(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.zy_ai_inference_meter(uuid,text,boolean) to service_role;
-- Batch lease/commit RPCs keep thirty-pair matching to a bounded number of database round trips.
create function public.zy_ai_match_claim_batch(p_actor uuid,p_worker_id text,p_keys text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare k text; claim jsonb; result jsonb:='[]';
begin
 if cardinality(p_keys)>30 then raise exception 'Invalid batch';end if;
 for k in select distinct x from unnest(p_keys) x order by x loop
  claim=public.zy_ai_inference_claim(p_actor,p_worker_id,'match',k);
  if claim is not null then result=result||jsonb_build_array(jsonb_build_object('key',k,'lease',claim->>'lease'));end if;
 end loop;return result;
end $$;
create function public.zy_ai_match_finish_batch(p_actor uuid,p_worker_id text,p_profile_hash text,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; saved boolean; result jsonb:='[]';
begin
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>30 then raise exception 'Invalid batch';end if;
 for r in select value from jsonb_array_elements(p_items) loop
  saved=public.zy_ai_inference_finish(p_actor,p_worker_id,'match',r->>'key',(r->>'lease')::uuid,p_profile_hash,r->>'orderId',r->>'orderHash',nullif(r->'result','null'::jsonb),r->>'code');
  result=result||jsonb_build_array(jsonb_build_object('key',r->>'key','saved',saved));
 end loop;return result;
end $$;
revoke all on function public.zy_ai_match_claim_batch(uuid,text,text[]),public.zy_ai_match_finish_batch(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.zy_ai_match_claim_batch(uuid,text,text[]),public.zy_ai_match_finish_batch(uuid,text,text,jsonb) to service_role;
commit;
