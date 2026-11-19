-- =====================================================================
-- Étape 5 — Annonces et notifications in-app ; description de tournoi en mise en forme riche
--
-- Contenus riches : HTML produit par l'éditeur du site (admin uniquement), nettoyé
-- à l'affichage (DOMPurify). La base limite seulement la taille.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Description de tournoi : HTML (mise en forme riche)
-- ---------------------------------------------------------------------
alter table public.tournaments drop constraint tournaments_description_check;
alter table public.tournaments
  add constraint tournaments_description_check check (char_length(description) <= 20000);

-- Descriptions existantes en texte simple → paragraphes HTML (caractères spéciaux échappés).
update public.tournaments
set description = (
  select string_agg('<p>' || replace(replace(replace(line, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>', '' order by n)
  from unnest(string_to_array(description, E'\n')) with ordinality as l(line, n)
  where btrim(line) <> ''
)
where btrim(description) <> '' and left(btrim(description), 1) <> '<';

-- ---------------------------------------------------------------------
-- Annonces
-- ---------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint announcements_title_check check (char_length(btrim(title)) between 2 and 120),
  body text not null default '' constraint announcements_body_check check (char_length(body) <= 20000),
  -- Visible à partir de published_at (publication programmée possible) et jusqu'à expires_at (exclu).
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  -- Notifier les joueurs (notification in-app à la publication).
  notify boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_expiry_check check (expires_at is null or expires_at > published_at)
);
create index announcements_published_idx on public.announcements (published_at desc);

create trigger announcements_touch_updated_at
  before update on public.announcements
  for each row execute function public.touch_updated_at();

-- Auteur fixé par la base.
create function public.announcements_set_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

create trigger announcements_set_author
  before insert on public.announcements
  for each row execute function public.announcements_set_author();

-- Annonce en ligne : publiée et pas expirée.
create function public.announcement_is_live(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.published_at <= now()
      and (a.expires_at is null or a.expires_at > now())
  );
$$;

-- ---------------------------------------------------------------------
-- Notifications in-app
-- ---------------------------------------------------------------------
-- Une ligne par destinataire. Seul type en V1 : 'announcement' (V2 : défis…).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null constraint notifications_kind_check check (kind in ('announcement')),
  announcement_id uuid references public.announcements (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, announcement_id),
  constraint notifications_target_check check (kind <> 'announcement' or announcement_id is not null)
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at);

-- Annonce avec « notifier » : une notification pour chaque compte actif (y compris l'admin).
-- Décochée ensuite : les notifications non lues sont retirées.
-- Une annonce programmée notifie dès maintenant, mais la notification n'apparaît qu'à la publication.
create function public.announcements_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.notify and (tg_op = 'INSERT' or not old.notify) then
    insert into public.notifications (recipient_id, kind, announcement_id)
    select p.id, 'announcement', new.id
    from public.profiles p
    where p.status = 'active'
    on conflict (recipient_id, announcement_id) do nothing;
  elsif tg_op = 'UPDATE' and old.notify and not new.notify then
    delete from public.notifications where announcement_id = new.id and read_at is null;
  end if;
  return null;
end;
$$;

create trigger announcements_notify
  after insert or update of notify on public.announcements
  for each row execute function public.announcements_notify();

-- Marque comme lues toutes les notifications de la session courante (ou celles d'une annonce).
create function public.mark_notifications_read(p_announcement_id uuid default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and (p_announcement_id is null or announcement_id = p_announcement_id)
    and (announcement_id is null or public.announcement_is_live(announcement_id));
$$;

-- ---------------------------------------------------------------------
-- Règles de sécurité
-- ---------------------------------------------------------------------
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;

-- Annonces en ligne : joueurs et spectateurs. L'admin voit aussi les programmées et expirées.
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    public.is_admin()
    or (public.can_view_site() and published_at <= now() and (expires_at is null or expires_at > now()))
  );
create policy announcements_admin_insert on public.announcements
  for insert to authenticated with check (public.is_admin());
create policy announcements_admin_update on public.announcements
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy announcements_admin_delete on public.announcements
  for delete to authenticated using (public.is_admin());

-- Notifications : chacun les siennes, seulement pour une annonce en ligne, compte actif.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    recipient_id = auth.uid()
    and public.is_active_player()
    and (announcement_id is null or public.announcement_is_live(announcement_id))
  );

revoke all on public.announcements, public.notifications from anon, authenticated;
grant select, delete on public.announcements to authenticated;
grant insert (id, title, body, published_at, expires_at, notify) on public.announcements to authenticated;
grant update (title, body, published_at, expires_at, notify) on public.announcements to authenticated;
grant select on public.notifications to authenticated;

grant execute on function
  public.announcement_is_live(uuid),
  public.mark_notifications_read(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- Temps réel : annonces et notifications (RLS appliquée aux événements)
-- ---------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime absente : temps réel non activé.';
    return;
  end if;
  foreach v_table in array array['announcements', 'notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
