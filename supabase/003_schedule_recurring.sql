-- Opcional: ative a extensao pg_cron no painel Supabase antes de executar.
-- O job roda de hora em hora. A funcao cria ocorrencias somente apos o dia
-- local de termino e usa America/Sao_Paulo para os horarios e idempotencia.

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'ethos-create-recurring-occurrences';

select cron.schedule(
  'ethos-create-recurring-occurrences',
  '0 * * * *',
  'select public.create_due_recurring_occurrences();'
);
