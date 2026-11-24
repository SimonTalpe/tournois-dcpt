-- =====================================================================
-- Format « Qualification puis élimination directe » — types
-- (fichier séparé : une nouvelle valeur d'énumération n'est utilisable qu'une fois validée)
-- =====================================================================

alter type public.tournament_format add value if not exists 'qualification_knockout';
alter type public.bracket_kind add value if not exists 'qualification';

-- Création des matchs de qualification après le 1er round :
-- continuous : au fil de l'eau (dès que deux joueurs de même bilan sont disponibles) ;
-- end_of_round : automatiquement, quand tous les matchs du round sont joués ;
-- manual : par l'admin (bouton « Créer le round suivant »), une fois le round terminé.
create type public.qualification_pairing as enum ('continuous', 'end_of_round', 'manual');

-- Étape entre la qualification et le tableau final :
-- preliminary : tour préliminaire, les mieux classés exemptés (têtes de série) ;
-- groups : parties à plusieurs (fléchettes, à venir) ;
-- none : tous les qualifiés au tableau, placés au tirage au sort.
create type public.qualification_next_stage as enum ('preliminary', 'groups', 'none');
