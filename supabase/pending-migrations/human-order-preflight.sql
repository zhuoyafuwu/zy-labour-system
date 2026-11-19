-- READ ONLY. Run with the approved operator account; print aggregates only.
begin read only;
select revision,jsonb_array_length(orders) as legacy_count,md5(orders::text) as legacy_digest from zy_private.order_state where id=1;
select count(*) as workers_count,md5(coalesce(jsonb_agg(jsonb_build_array(id,version,data) order by id),'[]')::text) as workers_digest from zy_private.workers;
select read_only from zy_private.settings where id=1;
select status,count(*) as tasks,count(*) filter(where lease_until>now()) as live_leases from zy_private.classification_tasks group by status;
select kind,count(*) as jobs,count(*) filter(where lease_until>now()) as live_leases from zy_private.ai_inference_jobs group by kind;
select count(*) as cached_classifications,count(*) filter(where by='user') as human_classifications from public.zy_job_classification_cache;
select n.nspname,p.proname,md5(pg_get_functiondef(p.oid)) as definition_digest from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('zy_orders_get','zy_orders_save','zy_import','zy_export','zy_job_profiles_apply','zy_classification_task_control','zy_ai_worker_context');
select exists(select 1 from zy_private.order_state s cross join lateral jsonb_array_elements(s.orders) j group by lower(btrim(j->>'code')) having count(*)>1) as duplicate_codes;
commit;
