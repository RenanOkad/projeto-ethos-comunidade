-- Execute uma unica vez depois de 001_ethos_schema.sql.
-- Troque o e-mail pelo e-mail do Murilo antes de executar.
-- Copie o token retornado para montar o link do convite. Ele nao fica salvo em texto no banco.
-- Nao compartilhe nem publique o resultado da consulta.

update public.invitations
set cancelled_at = now()
where role = 'owner' and used_at is null and cancelled_at is null and expires_at <= now();

with generated as (
  select encode(extensions.gen_random_bytes(32), 'hex') as token
),
saved as (
  insert into public.invitations (email, role, token_hash, expires_at)
  select
    lower('REPLACE_WITH_MURILO_EMAIL'),
    'owner',
    encode(extensions.digest(generated.token, 'sha256'), 'hex'),
    now() + interval '7 days'
  from generated
  where not exists (
    select 1 from public.organizers where role = 'owner' and active
  )
  and lower('REPLACE_WITH_MURILO_EMAIL') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and not exists (
    select 1 from public.invitations i
    where lower(i.email) = lower('REPLACE_WITH_MURILO_EMAIL')
      and i.used_at is null and i.cancelled_at is null and i.expires_at > now()
  )
  returning id, email, token_hash, expires_at
)
select saved.email, generated.token as invite_token, saved.expires_at
from saved
cross join generated;

-- Se a consulta nao retornar linha, confira o e-mail e verifique se ja existe
-- um owner. O token so pode ser obtido nesta execucao.
