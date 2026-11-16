-- Compatibilidade e funcoes utilizadas pelo backend Supabase desta aplicacao.
-- Execute apos 001_ethos_schema.sql. Pode ser executado novamente.

alter table public.sessions alter column person_id drop not null;
alter table public.sessions add column if not exists kind text;
alter table public.sessions add column if not exists organizer_id uuid references public.organizers(id) on delete cascade;
update public.sessions set kind = 'person' where kind is null;
alter table public.sessions alter column kind set not null;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sessions'::regclass
      and conname = 'sessions_one_subject'
  ) then
    alter table public.sessions add constraint sessions_one_subject check (
      (kind = 'person' and person_id is not null and organizer_id is null)
      or (kind = 'organizer' and organizer_id is not null and person_id is null)
    );
  end if;
end;
$$;

create or replace function public.set_registration_payment(
  p_registration_id uuid, p_paid boolean, p_organizer_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer public.organizers%rowtype;
begin
  select o.* into v_organizer from public.organizers o
  where o.id = p_organizer_id and o.active;
  if not found then raise exception 'Acesso exclusivo para organizadores.' using errcode = '42501'; end if;
  perform 1 from public.registrations r
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

create or replace function public.remove_registration(
  p_registration_id uuid, p_organizer_id uuid
)
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
  where o.id = p_organizer_id and o.active;
  if not found then raise exception 'Acesso exclusivo para organizadores.' using errcode = '42501'; end if;
  select r.* into v_registration from public.registrations r
  where r.id = p_registration_id for update;
  if not found then raise exception 'Inscrição não encontrada.' using errcode = 'P0002'; end if;
  perform 1 from public.occurrences o where o.id = v_registration.occurrence_id for update;
  delete from public.registrations where id = v_registration.id;
  if v_registration.situation = 'confirmed' then
    v_promoted_person := public.promote_next_waitlisted(v_registration.occurrence_id, 'organizer', v_organizer.id);
  else
    update public.registrations set wait_position = wait_position - 1
    where occurrence_id = v_registration.occurrence_id
      and situation = 'waitlist' and wait_position > v_registration.wait_position;
  end if;
  perform public.write_audit('organizer', v_organizer.id, 'remove_registration',
    'registration', v_registration.id,
    jsonb_build_object('person_id', v_registration.person_id, 'promoted_person_id', v_promoted_person));
  return v_promoted_person;
end;
$$;

create or replace function public.remove_person(p_person_id uuid, p_organizer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organizer public.organizers%rowtype;
  v_person public.people%rowtype;
  v_registration public.registrations%rowtype;
begin
  select o.* into v_organizer from public.organizers o
  where o.id = p_organizer_id and o.active;
  if not found then raise exception 'Acesso exclusivo para organizadores.' using errcode = '42501'; end if;
  select p.* into v_person from public.people p where p.id = p_person_id for update;
  if not found then raise exception 'Pessoa não encontrada.' using errcode = 'P0002'; end if;

  for v_registration in
    select r.* from public.registrations r
    where r.person_id = p_person_id order by r.occurrence_id
  loop
    perform 1 from public.occurrences o where o.id = v_registration.occurrence_id for update;
    delete from public.registrations where id = v_registration.id;
    if v_registration.situation = 'confirmed' then
      perform public.promote_next_waitlisted(v_registration.occurrence_id, 'organizer', v_organizer.id);
    else
      update public.registrations set wait_position = wait_position - 1
      where occurrence_id = v_registration.occurrence_id
        and situation = 'waitlist' and wait_position > v_registration.wait_position;
    end if;
  end loop;
  perform public.write_audit('organizer', v_organizer.id, 'remove_person',
    'person', p_person_id, jsonb_build_object('name', v_person.name));
  delete from public.people where id = p_person_id;
end;
$$;

create or replace function public.create_admin_invitation(p_email text, p_owner_id uuid)
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
  where o.id = p_owner_id and o.active and o.role = 'owner' for update;
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  if p_email is null or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Informe um e-mail válido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organizers o where lower(o.email) = lower(p_email)) then
    raise exception 'Este e-mail já pertence a um organizador.' using errcode = '23505';
  end if;
  update public.invitations set cancelled_at = now()
  where lower(email) = lower(trim(p_email)) and used_at is null and cancelled_at is null;
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

create or replace function public.accept_organizer_invitation(
  p_token text, p_name text, p_user_id uuid, p_email text
)
returns public.organizers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations%rowtype;
  v_organizer public.organizers%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if p_user_id is null or char_length(btrim(coalesce(p_name, ''))) not between 2 and 100 then
    raise exception 'Nome ou conta inválidos.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    raise exception 'Conta de autenticação inválida.' using errcode = '42501';
  end if;
  select i.* into v_invitation from public.invitations i
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and lower(i.email) = v_email and i.used_at is null
    and i.cancelled_at is null and i.expires_at > now()
  for update;
  if not found then raise exception 'Convite inválido, usado ou expirado.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.organizers o where o.user_id = p_user_id or lower(o.email) = v_email) then
    raise exception 'Esta conta já está vinculada a um organizador.' using errcode = '23505';
  end if;
  if v_invitation.role = 'owner' and exists (
    select 1 from public.organizers o where o.role = 'owner' and o.active
  ) then
    raise exception 'Já existe um owner ativo.' using errcode = '23505';
  end if;
  insert into public.organizers (user_id, name, email, role)
  values (p_user_id, btrim(p_name), v_email, v_invitation.role)
  returning * into v_organizer;
  update public.invitations set used_at = now() where id = v_invitation.id;
  perform public.write_audit('organizer', v_organizer.id,
    'accept_invitation', 'organizer', v_organizer.id,
    jsonb_build_object('email', v_email, 'role', v_invitation.role));
  return v_organizer;
end;
$$;

create or replace function public.cancel_invitation(p_invitation_id uuid, p_owner_id uuid)
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
  where o.id = p_owner_id and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  update public.invitations set cancelled_at = now()
  where id = p_invitation_id and used_at is null and cancelled_at is null
  returning * into v_invitation;
  if not found then raise exception 'Convite pendente não encontrado.' using errcode = 'P0002'; end if;
  perform public.write_audit('organizer', v_owner.id, 'cancel_invitation',
    'invitation', p_invitation_id, jsonb_build_object('email', v_invitation.email));
end;
$$;

create or replace function public.remove_organizer(p_organizer_id uuid, p_owner_id uuid)
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
  where o.id = p_owner_id and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  select o.* into v_target from public.organizers o
  where o.id = p_organizer_id and o.active for update;
  if not found then raise exception 'Organizador não encontrado.' using errcode = 'P0002'; end if;
  update public.organizers set active = false where id = p_organizer_id;
  perform public.write_audit('organizer', v_owner.id, 'remove_organizer',
    'organizer', p_organizer_id, jsonb_build_object('name', v_target.name));
end;
$$;

create or replace function public.update_owner_settings(p_whatsapp text, p_default_pix text, p_owner_id uuid)
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
  where o.id = p_owner_id and o.active and o.role = 'owner';
  if not found then raise exception 'Esta ação é exclusiva do owner.' using errcode = '42501'; end if;
  if v_whatsapp <> '' and char_length(v_whatsapp) not between 10 and 15 then
    raise exception 'Confira o número de WhatsApp.' using errcode = '22023';
  end if;
  insert into public.settings (key, value) values ('owner_whatsapp', v_whatsapp)
  on conflict (key) do update set value = excluded.value;
  insert into public.settings (key, value)
  values ('default_pix', left(coalesce(p_default_pix, ''), 200))
  on conflict (key) do update set value = excluded.value;
  perform public.write_audit('organizer', v_owner.id, 'update_owner_settings',
    'settings', null, '{}'::jsonb);
end;
$$;

create or replace function public.record_login_failure(p_attempt_keys text[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_blocked boolean := false;
begin
  foreach v_key in array p_attempt_keys loop
    insert into public.login_attempts (attempt_key, failed_count, blocked_until, updated_at)
    values (v_key, 1, null, now())
    on conflict (attempt_key) do update
      set failed_count = case
        when public.login_attempts.blocked_until > now() then 0
        when public.login_attempts.failed_count >= 4 then 0
        else public.login_attempts.failed_count + 1
      end,
      blocked_until = case
        when public.login_attempts.blocked_until > now() then public.login_attempts.blocked_until
        when public.login_attempts.failed_count >= 4 then now() + interval '10 minutes'
        else null
      end,
      updated_at = now();
    if exists (select 1 from public.login_attempts a where a.attempt_key = v_key and a.blocked_until > now()) then
      v_blocked := true;
    end if;
  end loop;
  return v_blocked;
end;
$$;

create or replace function public.clear_login_failures(p_attempt_keys text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_attempts where attempt_key = any(p_attempt_keys);
$$;

revoke all on function public.set_registration_payment(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.remove_registration(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_person(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_admin_invitation(text, uuid) from public, anon, authenticated;
revoke all on function public.accept_organizer_invitation(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_invitation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_organizer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_owner_settings(text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_login_failure(text[]) from public, anon, authenticated;
revoke all on function public.clear_login_failures(text[]) from public, anon, authenticated;

grant execute on function public.set_registration_payment(uuid, boolean, uuid) to service_role;
grant execute on function public.remove_registration(uuid, uuid) to service_role;
grant execute on function public.remove_person(uuid, uuid) to service_role;
grant execute on function public.create_admin_invitation(text, uuid) to service_role;
grant execute on function public.accept_organizer_invitation(text, text, uuid, text) to service_role;
grant execute on function public.cancel_invitation(uuid, uuid) to service_role;
grant execute on function public.remove_organizer(uuid, uuid) to service_role;
grant execute on function public.update_owner_settings(text, text, uuid) to service_role;
grant execute on function public.record_login_failure(text[]) to service_role;
grant execute on function public.clear_login_failures(text[]) to service_role;
