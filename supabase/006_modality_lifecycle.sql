-- Adds modality archival and owner-only merge/delete operations.
-- Safe to apply more than once.

alter table public.modalities
  add column if not exists archived_at timestamptz;

create or replace function public.merge_modalities(p_source_id uuid, p_target_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_name text;
  v_target_name text;
  v_affected integer;
begin
  if p_source_id = p_target_id then
    raise exception 'A modalidade de origem e destino devem ser diferentes.' using errcode = '22023';
  end if;

  perform 1 from public.modalities m
  where m.id in (p_source_id, p_target_id)
  order by m.id for update;

  select m.name into v_source_name from public.modalities m where m.id = p_source_id;
  if not found then raise exception 'Modalidade de origem não encontrada.' using errcode = 'P0002'; end if;
  select m.name into v_target_name from public.modalities m where m.id = p_target_id;
  if not found then raise exception 'Modalidade de destino não encontrada.' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.modalities m where m.id = p_target_id and m.archived_at is not null
  ) then
    raise exception 'A modalidade de destino precisa estar ativa.' using errcode = 'P0001';
  end if;

  update public.events e set modality_id = p_target_id where e.modality_id = p_source_id;
  get diagnostics v_affected = row_count;

  update public.modalities m set archived_at = coalesce(m.archived_at, now())
  where m.id = p_source_id;

  return v_affected;
end;
$$;

create or replace function public.enforce_active_event_modality()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived_at timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.modality_id = old.modality_id then
      return new;
    end if;
  end if;

  select m.archived_at into v_archived_at
  from public.modalities m where m.id = new.modality_id for share;
  if not found then raise exception 'Modalidade não encontrada.' using errcode = '23503'; end if;
  if v_archived_at is not null then
    raise exception 'Modalidades arquivadas não podem receber novos eventos.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists events_require_active_modality on public.events;
create trigger events_require_active_modality
  before insert or update of modality_id on public.events
  for each row execute function public.enforce_active_event_modality();

create or replace function public.delete_unused_modality(p_modality_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.modalities m
  where m.id = p_modality_id
    and not exists (select 1 from public.events e where e.modality_id = m.id);
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    if not exists (select 1 from public.modalities m where m.id = p_modality_id) then
      raise exception 'Modalidade não encontrada.' using errcode = 'P0002';
    end if;
    raise exception 'Modalidades vinculadas a eventos não podem ser excluídas.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.merge_modalities(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enforce_active_event_modality() from public, anon, authenticated;
revoke all on function public.delete_unused_modality(uuid) from public, anon, authenticated;
grant execute on function public.merge_modalities(uuid, uuid) to service_role;
grant execute on function public.delete_unused_modality(uuid) to service_role;

-- Rollback (before rolling back the application): update public.modalities
-- set archived_at = null; drop trigger events_require_active_modality on public.events;
-- drop function public.enforce_active_event_modality();
-- drop function public.merge_modalities(uuid, uuid);
-- drop function public.delete_unused_modality(uuid);
-- alter table public.modalities drop column archived_at;
