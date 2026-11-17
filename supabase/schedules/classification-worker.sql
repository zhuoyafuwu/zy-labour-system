-- REVIEW / APPLY SEPARATELY after migration, function and Vault provisioning.
-- This creates a DISABLED schedule; it never starts classification by itself.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='zy_classification_worker_url')
 or not exists(select 1 from vault.decrypted_secrets where name='zy_classification_worker_secret') then
  raise exception 'Provision worker URL and dedicated scheduler secret in Vault first';
 end if;
end $$;
select cron.schedule('zy-classification-worker','* * * * *',$cron$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='zy_classification_worker_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='zy_classification_worker_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 ) where exists (
  select 1 from zy_private.classification_tasks
  where status in ('queued','running','waiting') and next_run_at<=now() and (lease_until is null or lease_until<now())
 ) and not (select read_only from zy_private.settings where id=1);
$cron$);
select cron.alter_job(jobid,active:=false) from cron.job where jobname='zy-classification-worker';
commit;
-- Enable only after deployment approval and verification:
-- select cron.alter_job(jobid,active:=true) from cron.job where jobname='zy-classification-worker';
-- Pause without deleting anything:
-- select cron.alter_job(jobid,active:=false) from cron.job where jobname='zy-classification-worker';
