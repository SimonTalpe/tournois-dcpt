-- =====================================================================
-- Noms de comptes uniques (décision de Sim, 26/11/2026)
-- Un compte ne peut pas prendre le nom d'un autre compte (non supprimé), sans tenir compte
-- des majuscules, des accents ni des espaces en trop. Les « noms seuls » ne sont pas concernés
-- (ils ont déjà leur propre règle d'unicité entre eux).
-- - Changement de nom (joueur ou admin) : refusé avec NAME_TAKEN.
-- - Inscription : le nom choisi est déjà pris → suffixe « 2 », « 3 »… (l'inscription ne doit
--   pas échouer sans message ; le joueur peut ensuite changer son nom).
-- - Les doublons déjà présents ne sont pas modifiés ; ils restent possibles tant qu'aucun
--   des deux noms ne change.
-- =====================================================================

-- Clé de comparaison d'un nom : minuscules, sans accents, espaces normalisés.
create function public.account_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(
    lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')),
    'àáâãäåāçćčèéêëēėęìíîïīñńòóôõöøōœùúûüūýÿžźż',
    'aaaaaaaccceeeeeeeiiiiinnoooooooouuuuuyyzzz'
  );
$$;

create function public.profiles_unique_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
begin
  if new.status = 'deleted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.full_name is not distinct from old.full_name then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if exists (
      select 1 from public.profiles p
      where p.id <> new.id and p.status <> 'deleted'
        and public.account_name_key(p.full_name) = public.account_name_key(new.full_name)
    ) then
      raise exception 'NAME_TAKEN' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Inscription : nom libre, sinon premier suffixe libre.
  v_base := left(btrim(new.full_name), 76);
  v_candidate := btrim(new.full_name);
  while exists (
    select 1 from public.profiles p
    where p.id <> new.id and p.status <> 'deleted'
      and public.account_name_key(p.full_name) = public.account_name_key(v_candidate)
  ) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || ' ' || v_suffix;
  end loop;
  new.full_name := v_candidate;
  return new;
end;
$$;

create trigger profiles_unique_name
  before insert or update of full_name, status on public.profiles
  for each row execute function public.profiles_unique_name();

revoke execute on function public.account_name_key(text) from public, anon, authenticated;
revoke execute on function public.profiles_unique_name() from public, anon, authenticated;
