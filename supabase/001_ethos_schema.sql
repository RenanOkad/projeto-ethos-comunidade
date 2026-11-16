-- Ethos Tribo: schema inicial para Supabase/PostgreSQL.
-- Execute no SQL Editor do projeto Supabase, usando o role postgres.
-- O backend da aplicacao deve ser o unico cliente a usar a service/secret key.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  phone text not null unique check (phone ~ '^55[1-9][0-9]{9,10}$'),
  pin_hash text not null,
  pin_reset_required boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

create table if not exists public.organizers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  email text not null unique,
  role text not null check (role in ('owner', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null check (role in ('owner', 'admin')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.organizers(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists invitations_one_pending_per_email
  on public.invitations (lower(email))
  where used_at is null and cancelled_at is null;

create table if not exists public.sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('person', 'organizer')),
  person_id uuid references public.people(id) on delete cascade,
  organizer_id uuid references public.organizers(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint sessions_one_subject check (
    (kind = 'person' and person_id is not null and organizer_id is null)
    or (kind = 'organizer' and organizer_id is not null and person_id is null)
  )
);
create index if not exists sessions_expiration_idx on public.sessions (expires_at);

create table if not exists public.modalities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists modalities_slug_unique_idx on public.modalities (slug);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  modality_id uuid not null references public.modalities(id) on delete restrict,
  type text not null check (type in ('recorrente', 'sazonal')),
  weekday smallint check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  seats integer not null check (seats between 1 and 1000),
  price_cents integer not null default 0 check (price_cents >= 0),
  pix_key text not null default '' check (char_length(pix_key) <= 200),
  location text not null default '' check (char_length(location) <= 200),
  cutoff_hours integer not null default 5 check (cutoff_hours between 0 and 168),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint events_schedule_check check (
    (type = 'recorrente' and weekday is not null)
    or (type = 'sazonal' and weekday is null)
  ),
  constraint events_times_differ check (start_time <> end_time)
);

create table if not exists public.occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  seats integer not null check (seats between 1 and 1000),
  price_cents integer not null check (price_cents >= 0),
  pix_key text not null default '' check (char_length(pix_key) <= 200),
  location text not null default '' check (char_length(location) <= 200),
  cutoff_hours integer not null default 5 check (cutoff_hours between 0 and 168),
  open boolean not null default true,
  created_at timestamptz not null default now(),
  constraint occurrences_end_after_start check (ends_at > starts_at),
  constraint occurrences_per_event_date unique (event_id, starts_at)
);
create index if not exists occurrences_starts_at_idx on public.occurrences (starts_at);
create index if not exists occurrences_event_starts_idx on public.occurrences (event_id, starts_at desc);

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.occurrences(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  situation text not null check (situation in ('confirmed', 'waitlist')),
  payment text not null default 'pending' check (payment in ('pending', 'paid')),
  wait_position integer,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  notice_seen boolean not null default true,
  paid_at timestamptz,
  paid_by uuid references public.organizers(id) on delete set null,
  constraint registrations_unique_person_per_occurrence unique (occurrence_id, person_id),
  constraint registrations_wait_position_check check (
    (situation = 'waitlist' and wait_position > 0)
    or (situation = 'confirmed' and wait_position is null)
  ),
  constraint registrations_payment_actor_check check (
    (payment = 'pending' and paid_at is null and paid_by is null)
    or (payment = 'paid' and paid_at is not null and paid_by is not null)
  )
);
create index if not exists registrations_occurrence_order_idx
  on public.registrations (occurrence_id, situation, wait_position, created_at);
create index if not exists registrations_person_idx on public.registrations (person_id, created_at desc);

create table if not exists public.audit (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null check (actor_kind in ('person', 'organizer', 'system')),
  actor_id uuid,
  action text not null,
  target_kind text not null,
  target_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_created_at_idx on public.audit (created_at desc);

create table if not exists public.settings (
  key text primary key,
  value text not null default ''
);
insert into public.settings (key, value)
values ('owner_whatsapp', ''), ('owner_name', 'Murilo'), ('default_pix', '')
on conflict (key) do nothing;

create table if not exists public.login_attempts (
  attempt_key text primary key,
  failed_count integer not null default 0 check (failed_count between 0 and 5),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function public.is_active_organizer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizers o
    where o.user_id = (select auth.uid()) and o.active
  );
$$;

create or replace function public.is_active_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizers o
    where o.user_id = (select auth.uid()) and o.active and o.role = 'owner'
  );
$$;

create or replace function public.enforce_last_active_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'owner' and old.active
         and (new.role <> 'owner' or not new.active)) then
    perform pg_advisory_xact_lock(73194821);
    if not exists (
      select 1 from public.organizers o
      where o.id <> old.id and o.role = 'owner' and o.active
    ) then
      raise exception 'O sistema precisa manter pelo menos um owner ativo.'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists organizers_keep_an_owner on public.organizers;
create trigger organizers_keep_an_owner
  before update or delete on public.organizers
  for each row execute function public.enforce_last_active_owner();

create or replace function public.enforce_occurrence_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats integer;
  v_confirmed integer;
begin
  select o.seats into v_seats
  from public.occurrences o
  where o.id = new.occurrence_id
  for update;
  if not found then
    raise exception 'Ocorrência não encontrada.' using errcode = '23503';
  end if;

  if new.situation = 'confirmed' then
    select count(*) into v_confirmed
    from public.registrations r
    where r.occurrence_id = new.occurrence_id
      and r.situation = 'confirmed'
      and r.id <> new.id;
    if v_confirmed >= v_seats then
      raise exception 'Não há vagas confirmadas disponíveis.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists registrations_enforce_capacity on public.registrations;
create trigger registrations_enforce_capacity
  before insert or update of occurrence_id, situation on public.registrations
  for each row execute function public.enforce_occurrence_capacity();

create or replace function public.enforce_occurrence_minimum_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmed integer;
begin
  if new.seats < old.seats then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
    select count(*) into v_confirmed
    from public.registrations r
    where r.occurrence_id = new.id and r.situation = 'confirmed';
    if v_confirmed > new.seats then
      raise exception 'O limite nao pode ser menor que o numero de pessoas confirmadas.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists occurrences_preserve_capacity on public.occurrences;
create trigger occurrences_preserve_capacity
  before update of seats on public.occurrences
  for each row execute function public.enforce_occurrence_minimum_seats();

create or replace function public.write_audit(
  p_actor_kind text,
  p_actor_id uuid,
  p_action text,
  p_target_kind text,
  p_target_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit (actor_kind, actor_id, action, target_kind, target_id, details)
  values (p_actor_kind, p_actor_id, p_action, p_target_kind, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.promote_next_waitlisted(p_occurrence_id uuid, p_actor_kind text, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats integer;
  v_confirmed integer;
  v_registration public.registrations%rowtype;
begin
  select o.seats into v_seats
  from public.occurrences o
  where o.id = p_occurrence_id
  for update;
  if not found then return null; end if;

  select count(*) into v_confirmed
  from public.registrations r
  where r.occurrence_id = p_occurrence_id and r.situation = 'confirmed';
  if v_confirmed >= v_seats then return null; end if;

  select r.* into v_registration
  from public.registrations r
  where r.occurrence_id = p_occurrence_id and r.situation = 'waitlist'
  order by r.wait_position, r.created_at
  limit 1
  for update;
  if not found then return null; end if;

  update public.registrations
  set situation = 'confirmed',
      payment = 'pending',
      paid_at = null,
      paid_by = null,
      wait_position = null,
      promoted_at = now(),
      notice_seen = false
  where id = v_registration.id;

  update public.registrations
  set wait_position = wait_position - 1
  where occurrence_id = p_occurrence_id
    and situation = 'waitlist'
    and wait_position > v_registration.wait_position;

  perform public.write_audit(p_actor_kind, p_actor_id, 'promote_waitlist',
    'registration', v_registration.id,
    jsonb_build_object('occurrence_id', p_occurrence_id, 'automatic', true));
  return v_registration.person_id;
end;
$$;

create or replace function public.join_occurrence(p_occurrence_id uuid, p_person_id uuid)
returns table (registration_id uuid, situation text, wait_position integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occurrence public.occurrences%rowtype;
  v_confirmed integer;
  v_wait_position integer;
  v_situation text;
  v_registration_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operação disponível somente pelo backend autenticado.'
      using errcode = '42501';
  end if;

  select o.* into v_occurrence
  from public.occurrences o
  where o.id = p_occurrence_id and o.open
  for update;
  if not found then
    raise exception 'Este evento não está recebendo inscrições.' using errcode = 'P0002';
  end if;
  if v_occurrence.starts_at - make_interval(hours => v_occurrence.cutoff_hours) <= now() then
    raise exception 'As inscrições e desistências deste evento já fecharam.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.people p where p.id = p_person_id) then
    raise exception 'Pessoa não encontrada.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.registrations r where r.occurrence_id = p_occurrence_id and r.person_id = p_person_id) then
    raise exception 'Você já está na lista deste evento.' using errcode = '23505';
  end if;

  select count(*) into v_confirmed from public.registrations r
  where r.occurrence_id = p_occurrence_id and r.situation = 'confirmed';
  if v_confirmed < v_occurrence.seats then
    v_situation := 'confirmed';
    v_wait_position := null;
  else
    v_situation := 'waitlist';
    select coalesce(max(r.wait_position), 0) + 1 into v_wait_position
    from public.registrations r
    where r.occurrence_id = p_occurrence_id and r.situation = 'waitlist';
  end if;

  insert into public.registrations (occurrence_id, person_id, situation, payment, wait_position)
  values (p_occurrence_id, p_person_id, v_situation, 'pending', v_wait_position)
  returning id into v_registration_id;

  perform public.write_audit('person', p_person_id, 'join_event',
    'occurrence', p_occurrence_id, jsonb_build_object('situation', v_situation));
  return query select v_registration_id, v_situation, v_wait_position;
end;
$$;

create or replace function public.leave_occurrence(p_occurrence_id uuid, p_person_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occurrence public.occurrences%rowtype;
  v_registration public.registrations%rowtype;
  v_promoted_person uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operação disponível somente pelo backend autenticado.'
      using errcode = '42501';
  end if;
  select o.* into v_occurrence from public.occurrences o
  where o.id = p_occurrence_id for update;
  if not found then raise exception 'Evento não encontrado.' using errcode = 'P0002'; end if;

  select r.* into v_registration from public.registrations r
  where r.occurrence_id = p_occurrence_id and r.person_id = p_person_id
  for update;
  if not found then raise exception 'Sua inscrição não foi encontrada.' using errcode = 'P0002'; end if;
  if v_registration.situation = 'confirmed' and v_registration.payment = 'paid' then
    raise exception 'Como você já pagou, fale com o organizador para combinar a retirada e o reembolso.'
      using errcode = 'P0001';
  end if;
  if v_occurrence.starts_at - make_interval(hours => v_occurrence.cutoff_hours) <= now() then
    raise exception 'As inscrições e desistências deste evento já fecharam.' using errcode = 'P0001';
  end if;

  delete from public.registrations where id = v_registration.id;
  if v_registration.situation = 'confirmed' then
    v_promoted_person := public.promote_next(p_occurrence_id, 'person', p_person_id);
  else
    update public.registrations
    set wait_position = wait_position - 1
    where occurrence_id = p_occurrence_id
      and situation = 'waitlist'
      and wait_position > v_registration.wait_position;
  end if;

  perform public.write_audit('person', p_person_id, 'leave_event',
    'occurrence', p_occurrence_id,
    jsonb_build_object('registration_id', v_registration.id, 'promoted_person_id', v_promoted_person));
  return v_promoted_person;
end;
$$;

create or replace function public.set_registration_payment(p_registration_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer public.organizers%rowtype;
  v_registration public.registrations%rowtype;
begin
  select o.* into v_organizer from public.organizers o
  where o.user_id = (select auth.uid()) and o.active;
  if not found then raise exception 'Acesso exclusivo para organizadores.' using errcode = '42501'; end if;

  select r.* into v_registration from public.registrations r
  where r.id = p_registration_id and r.situation = 'confirmed'
  for update;
  if not found then raise exception 'Inscrição confirmada não encontrada.' using errcode = 'P0002'; end if;

  update public.registrations
  set payment = case when p_paid then 'paid' else 'pending' end,
      paid_at = case when p_paid then now() else null end,
      paid_by = case when p_paid then v_organizer.id else null end
  where id = p_registration_id;
  perform public.write_audit('organizer', v_organizer.id,
    case when p_paid then 'mark_paid' else 'mark_pending' end,
    'registration', p_registration_id, '{}'::jsonb);
end;
$$;

create or replace function public.remove_registration(p_registration_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer public.organizers%rowtype;
  v_registration public.registrations%rowtype;
  v_promoted_person uuid;
begin
  select o.* into v_organizer from public.organizers o
  where o.user_id = (select auth.uid()) and o.active;
  if not found then raise exception 'Acesso exclusivo para organizadores.' using errcode = '42501'; end if;

  select r.* into v_registration from public.registrations r
  where r.id = p_registration_id for update;
  if not found then raise exception 'Inscrição não encontrada.' using errcode = 'P0002'; end if;
  perform 1 from public.occurrences o where o.id = v_registration.occurrence_id for update;

  delete from public.registrations where id = v_registration.id;
  if v_registration.situation = 'confirmed' then
    v_promoted_person := public.promote_next(v_registration.occurrence_id, 'organizer', v_organizer.id);
  else
    update public.registrations
    set wait_position = wait_position - 1
    where occurrence_id = v_registration.occurrence_id
      and situation = 'waitlist'
      and wait_position > v_registration.wait_position;
  end if;
  perform public.write_audit('organizer', v_organizer.id, 'remove_registration',
    'registration', v_registration.id,
    jsonb_build_object('person_id', v_registration.person_id, 'promoted_person_id', v_promoted_person));
  return v_promoted_person;
end;
$$;

create or replace function public.remove_person(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer public.organizers%rowtype;
  v_person public.people%rowtype;
  v_registration public.registrations%rowtype;
  v_promoted_person uuid;
begin
  select o.* into v_organizer from public.organizers o
  where o.user_id = (select auth.uid()) and o.active;
  if not found then raise exception 'Acesso exclusivo para organizadores.' using errcode = '42501'; end if;
  select p.* into v_person from public.people p where p.id = p_person_id for update;
  if not found then raise exception 'Pessoa não encontrada.' using errcode = 'P0002'; end if;

  for v_registration in
    select r.* from public.registrations r
    where r.person_id = p_person_id
    order by r.occurrence_id
  loop
    perform 1 from public.occurrences o where o.id = v_registration.occurrence_id for update;
    delete from public.registrations where id = v_registration.id;
    if v_registration.situation = 'confirmed' then
      v_promoted_person := public.promote_next(v_registration.occurrence_id, 'organizer', v_organizer.id);
    else
      update public.registrations
      set wait_position = wait_position - 1
      where occurrence_id = v_registration.occurrence_id
        and situation = 'waitlist'
        and wait_position > v_registration.wait_position;
    end if;
  end loop;

  perform public.write_audit('organizer', v_organizer.id, 'remove_person',
    'person', p_person_id, jsonb_build_object('name', v_person.name));
  delete from public.people where id = p_person_id;
end;
$$;

create or replace function public.create_admin_invitation(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.organizers%rowtype;
  v_token text;
  v_invitation_id uuid;
begin
  select o.* into v_owner from public.organizers o
  where o.user_id = (select auth.uid()) and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  if p_email is null or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizers o where lower(o.email) = lower(p_email)) then
    raise exception 'Este e-mail já pertence a um organizador.' using errcode = '23505';
  end if;

  update public.invitations
  set cancelled_at = now()
  where lower(email) = lower(p_email) and used_at is null and cancelled_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (email, role, token_hash, created_by, expires_at)
  values (lower(trim(p_email)), 'admin',
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_owner.id, now() + interval '7 days')
  returning id into v_invitation_id;
  perform public.write_audit('organizer', v_owner.id, 'invite_organizer',
    'invitation', v_invitation_id, jsonb_build_object('email', lower(trim(p_email))));
  return v_token;
end;
$$;

create or replace function public.accept_organizer_invitation(p_token text, p_name text)
returns public.organizers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_organizer public.organizers%rowtype;
  v_email text;
begin
  if (select auth.uid()) is null then raise exception 'Entre com o acesso criado pelo convite.' using errcode = '42501'; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if char_length(btrim(p_name)) not between 2 and 100 then raise exception 'Informe seu nome.' using errcode = '22023'; end if;
  select i.* into v_invitation from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and lower(i.email) = v_email
    and i.used_at is null and i.cancelled_at is null and i.expires_at > now()
  for update;
  if not found then raise exception 'Convite inválido, usado ou expirado.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.organizers o where o.user_id = (select auth.uid()) or lower(o.email) = v_email) then
    raise exception 'Esta conta já está vinculada a um organizador.' using errcode = '23505';
  end if;

  insert into public.organizers (user_id, name, email, role)
  values ((select auth.uid()), btrim(p_name), v_email, v_invitation.role)
  returning * into v_organizer;
  update public.invitations set used_at = now() where id = v_invitation.id;
  perform public.write_audit('organizer', v_organizer.id,
    'accept_invitation', 'organizer', v_organizer.id,
    jsonb_build_object('email', v_email, 'role', v_invitation.role));
  return v_organizer;
end;
$$;

create or replace function public.remove_organizer(p_organizer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.organizers%rowtype;
  v_target public.organizers%rowtype;
begin
  select o.* into v_owner from public.organizers o
  where o.user_id = (select auth.uid()) and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  select o.* into v_target from public.organizers o
  where o.id = p_organizer_id and o.active for update;
  if not found then raise exception 'Organizador não encontrado.' using errcode = 'P0002'; end if;
  update public.organizers set active = false where id = p_organizer_id;
  perform public.write_audit('organizer', v_owner.id,
    'remove_organizer', 'organizer', p_organizer_id,
    jsonb_build_object('name', v_target.name));
end;
$$;

create or replace function public.cancel_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.organizers%rowtype;
  v_invitation public.invitations%rowtype;
begin
  select o.* into v_owner from public.organizers o
  where o.user_id = (select auth.uid()) and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  update public.invitations set cancelled_at = now()
  where id = p_invitation_id and used_at is null and cancelled_at is null
  returning * into v_invitation;
  if not found then raise exception 'Convite pendente não encontrado.' using errcode = 'P0002'; end if;
  perform public.write_audit('organizer', v_owner.id, 'cancel_invitation',
    'invitation', p_invitation_id, jsonb_build_object('email', v_invitation.email));
end;
$$;

create or replace function public.update_owner_settings(p_whatsapp text, p_default_pix text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner public.organizers%rowtype;
  v_whatsapp text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
begin
  select o.* into v_owner from public.organizers o
  where o.user_id = (select auth.uid()) and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  if v_whatsapp <> '' and char_length(v_whatsapp) not between 10 and 15 then
    raise exception 'Confira o número de WhatsApp.' using errcode = '22023';
  end if;
  insert into public.settings(key, value) values ('owner_whatsapp', v_whatsapp)
  on conflict (key) do update set value = excluded.value;
  insert into public.settings(key, value) values ('default_pix', left(coalesce(p_default_pix, ''), 200))
  on conflict (key) do update set value = excluded.value;
  perform public.write_audit('organizer', v_owner.id, 'update_owner_settings', 'settings', null, '{}'::jsonb);
end;
$$;

create or replace function public.create_due_recurring_occurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_last public.occurrences%rowtype;
  v_local_date date;
  v_next_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_created integer := 0;
  v_days integer;
begin
  for v_event in
    select e.* from public.events e
    where e.active and e.type = 'recorrente'
    order by e.id
  loop
    select o.* into v_last from public.occurrences o
    where o.event_id = v_event.id
    order by o.starts_at desc limit 1;
    if not found or v_last.ends_at > now()
      or (now() at time zone 'America/Sao_Paulo')::date <=
         (v_last.ends_at at time zone 'America/Sao_Paulo')::date then
      continue;
    end if;

    v_local_date := (v_last.starts_at at time zone 'America/Sao_Paulo')::date;
    v_days := (v_event.weekday - extract(dow from v_local_date)::integer + 7) % 7;
    if v_days = 0 then v_days := 7; end if;
    v_next_date := v_local_date + v_days;
    v_start := (v_next_date + v_event.start_time) at time zone 'America/Sao_Paulo';
    v_end := (v_next_date + v_event.end_time) at time zone 'America/Sao_Paulo';
    if v_end <= v_start then v_end := v_end + interval '1 day'; end if;

    insert into public.occurrences
      (event_id, starts_at, ends_at, seats, price_cents, pix_key, location, cutoff_hours, open)
    values
      (v_event.id, v_start, v_end, v_event.seats, v_event.price_cents,
       coalesce(nullif(v_event.pix_key, ''), (select s.value from public.settings s where s.key = 'default_pix'), ''),
       v_event.location, v_event.cutoff_hours, true)
    on conflict (event_id, starts_at) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;
  return v_created;
end;
$$;

-- RLS: o participante usa sessoes proprias validadas pelo backend e nunca
-- acessa tabelas Supabase diretamente. O backend usa service_role somente no servidor.
alter table public.people enable row level security;
alter table public.organizers enable row level security;
alter table public.invitations enable row level security;
alter table public.sessions enable row level security;
alter table public.modalities enable row level security;
alter table public.events enable row level security;
alter table public.occurrences enable row level security;
alter table public.registrations enable row level security;
alter table public.audit enable row level security;
alter table public.settings enable row level security;
alter table public.login_attempts enable row level security;

drop policy if exists organizers_read_self_or_owner on public.organizers;
create policy organizers_read_self_or_owner on public.organizers
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_active_owner()));

drop policy if exists events_read_organizer on public.events;
create policy events_read_organizer on public.events
  for select to authenticated using ((select public.is_active_organizer()));
drop policy if exists modalities_read_authenticated on public.modalities;
create policy modalities_read_authenticated on public.modalities
  for select to authenticated using (true);
drop policy if exists events_insert_organizer on public.events;
create policy events_insert_organizer on public.events
  for insert to authenticated with check ((select public.is_active_organizer()));
drop policy if exists events_update_organizer on public.events;
create policy events_update_organizer on public.events
  for update to authenticated using ((select public.is_active_organizer()))
  with check ((select public.is_active_organizer()));

drop policy if exists occurrences_read_organizer on public.occurrences;
create policy occurrences_read_organizer on public.occurrences
  for select to authenticated using ((select public.is_active_organizer()));
drop policy if exists occurrences_insert_organizer on public.occurrences;
create policy occurrences_insert_organizer on public.occurrences
  for insert to authenticated with check ((select public.is_active_organizer()));
drop policy if exists occurrences_update_organizer on public.occurrences;
create policy occurrences_update_organizer on public.occurrences
  for update to authenticated using ((select public.is_active_organizer()))
  with check ((select public.is_active_organizer()));

drop policy if exists people_read_organizer on public.people;
create policy people_read_organizer on public.people
  for select to authenticated using ((select public.is_active_organizer()));
drop policy if exists registrations_read_organizer on public.registrations;
create policy registrations_read_organizer on public.registrations
  for select to authenticated using ((select public.is_active_organizer()));
drop policy if exists audit_read_organizer on public.audit;
create policy audit_read_organizer on public.audit
  for select to authenticated using ((select public.is_active_organizer()));
drop policy if exists invitations_read_owner on public.invitations;
create policy invitations_read_owner on public.invitations
  for select to authenticated using ((select public.is_active_owner()));
drop policy if exists settings_read_organizer on public.settings;
create policy settings_read_organizer on public.settings
  for select to authenticated using ((select public.is_active_organizer()));

revoke all on table public.people, public.organizers, public.invitations, public.sessions,
  public.modalities, public.events, public.occurrences, public.registrations, public.audit, public.settings,
  public.login_attempts from anon;
revoke all on table public.people, public.organizers, public.invitations, public.sessions,
  public.modalities, public.events, public.occurrences, public.registrations, public.audit, public.settings,
  public.login_attempts from authenticated;
grant select on public.organizers, public.modalities, public.events, public.occurrences, public.people,
  public.registrations, public.audit, public.settings to authenticated;
grant insert, update on public.events, public.occurrences to authenticated;
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke all on function public.is_active_organizer() from public, anon;
revoke all on function public.is_active_owner() from public, anon;
revoke all on function public.enforce_last_active_owner() from public, anon, authenticated;
revoke all on function public.enforce_occurrence_capacity() from public, anon, authenticated;
revoke all on function public.enforce_occurrence_minimum_seats() from public, anon, authenticated;
revoke all on function public.write_audit(text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.promote_next_waitlisted(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.join_occurrence(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_occurrence(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_registration_payment(uuid, boolean) from public, anon, authenticated;
revoke all on function public.remove_registration(uuid) from public, anon, authenticated;
revoke all on function public.remove_person(uuid) from public, anon, authenticated;
revoke all on function public.create_admin_invitation(text) from public, anon;
revoke all on function public.accept_organizer_invitation(text, text) from public, anon;
revoke all on function public.remove_organizer(uuid) from public, anon;
revoke all on function public.cancel_invitation(uuid) from public, anon;
revoke all on function public.update_owner_settings(text, text) from public, anon;
revoke all on function public.create_due_recurring_occurrences() from public, anon, authenticated;

grant execute on function public.is_active_organizer() to authenticated;
grant execute on function public.is_active_owner() to authenticated;
grant execute on function public.set_registration_payment(uuid, boolean) to authenticated;
grant execute on function public.remove_registration(uuid) to authenticated;
grant execute on function public.remove_person(uuid) to authenticated;
grant execute on function public.create_admin_invitation(text) to authenticated;
grant execute on function public.accept_organizer_invitation(text, text) to authenticated;
grant execute on function public.remove_organizer(uuid) to authenticated;
grant execute on function public.cancel_invitation(uuid) to authenticated;
grant execute on function public.update_owner_settings(text, text) to authenticated;

grant execute on function public.join_occurrence(uuid, uuid) to service_role;
grant execute on function public.leave_occurrence(uuid, uuid) to service_role;
grant execute on function public.create_due_recurring_occurrences() to service_role;
