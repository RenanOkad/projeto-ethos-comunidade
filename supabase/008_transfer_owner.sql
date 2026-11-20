-- Transferência manual do owner.
-- Execute no SQL Editor do Supabase enquanto estiver conectado como postgres.
-- Antes de executar: o novo owner precisa existir em public.organizers como admin ativo.
-- Troque os dois e-mails abaixo e execute todo o bloco.

begin;

do $$
declare
  v_old_email constant text := lower(btrim('antigo@exemplo.com'));
  v_new_email constant text := lower(btrim('novo@exemplo.com'));
  v_old_owner public.organizers%rowtype;
  v_new_owner public.organizers%rowtype;
  v_active_owner_count integer;
begin
  if v_old_email = v_new_email then
    raise exception 'O e-mail antigo e o e-mail novo devem ser diferentes.';
  end if;

  select count(*) into v_active_owner_count
  from public.organizers
  where role = 'owner' and active;

  if v_active_owner_count <> 1 then
    raise exception 'Transferência segura requer exatamente 1 owner ativo; foram encontrados %.', v_active_owner_count;
  end if;

  select o.* into v_old_owner
  from public.organizers o
  where lower(o.email) = v_old_email
    and o.role = 'owner'
    and o.active;

  if v_old_owner.id is null then
    raise exception 'Owner atual não encontrado pelo e-mail: %', v_old_email;
  end if;

  select o.* into v_new_owner
  from public.organizers o
  where lower(o.email) = v_new_email
    and o.role = 'admin'
    and o.active;

  if v_new_owner.id is null then
    raise exception 'Novo owner não encontrado como admin ativo pelo e-mail: %', v_new_email;
  end if;

  -- Promove o novo primeiro; o gatilho impede desativar o antigo sem outro owner ativo.
  update public.organizers
  set role = 'owner', active = true
  where id = v_new_owner.id;

  update public.organizers
  set role = 'admin', active = false
  where id = v_old_owner.id;

  -- Nenhum convite pendente de owner deve continuar valendo.
  update public.invitations
  set cancelled_at = now()
  where role = 'owner'
    and used_at is null
    and cancelled_at is null;

  insert into public.audit (
    actor_kind,
    actor_id,
    action,
    target_kind,
    target_id,
    details
  )
  values (
    'organizer',
    v_old_owner.id,
    'transfer_owner',
    'organizer',
    v_new_owner.id,
    jsonb_build_object(
      'old_owner_email', v_old_email,
      'new_owner_email', v_new_email,
      'old_owner_id', v_old_owner.id,
      'new_owner_id', v_new_owner.id
    )
  );

  raise notice 'Transferência concluída: % é o novo owner; % foi desativado.', v_new_email, v_old_email;
end;
$$;

commit;

-- Verificação opcional:
-- select id, name, email, role, active from public.organizers order by role, name;
