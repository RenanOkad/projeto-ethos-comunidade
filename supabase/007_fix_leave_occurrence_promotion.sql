begin;

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
    v_promoted_person := public.promote_next_waitlisted(p_occurrence_id, 'person', p_person_id);
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

revoke all on function public.leave_occurrence(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_occurrence(uuid, uuid) to service_role;

commit;
