-- Normalize legacy event modality text and move events to the shared catalog.
-- Run after 001_ethos_schema.sql and 004_backend_integration.sql.

create table if not exists public.modalities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  slug text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists modalities_slug_unique_idx on public.modalities (slug);

create or replace function public.normalize_modality_slug(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(regexp_replace(
      translate(
        lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+', '-', 'g'
    ), '-'), ''),
    'modalidade-sem-nome'
  );
$$;

create or replace function public.normalize_modality_name(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select initcap(replace(public.normalize_modality_slug(value), '-', ' '));
$$;

alter table public.events
  add column if not exists modality_id uuid references public.modalities(id) on delete restrict;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'modality'
  ) then
    insert into public.modalities (name, slug)
    select public.normalize_modality_name(grouped.slug), grouped.slug
    from (
      select distinct public.normalize_modality_slug(e.modality) as slug
      from public.events e
    ) grouped
    on conflict (slug) do update set name = excluded.name;

    update public.events e
    set modality_id = m.id
    from public.modalities m
    where m.slug = public.normalize_modality_slug(e.modality);
  end if;

  if exists (select 1 from public.events where modality_id is null) then
    raise exception 'Não foi possível vincular a modalidade de todos os eventos.';
  end if;
end;
$$;

alter table public.events alter column modality_id set not null;
alter table public.events drop column if exists modality;

drop function public.normalize_modality_name(text);
drop function public.normalize_modality_slug(text);

alter table public.modalities enable row level security;
drop policy if exists modalities_read_authenticated on public.modalities;
create policy modalities_read_authenticated on public.modalities
  for select to authenticated using (true);

revoke all on table public.modalities from anon, authenticated;
grant select on public.modalities to authenticated;
grant all on table public.modalities to service_role;
