# Mini-pong et fléchettes (MPF)

Site web (mobile et desktop, installable sur téléphone) pour organiser des tournois de **mini-pong** et de **fléchettes** entre collègues, sur les temps de pause.

## Stack
- React + Vite + TypeScript + Tailwind CSS, React Router
- PWA (vite-plugin-pwa) — nom court « MPF »
- Supabase (base de données, authentification, temps réel)
- Cloudflare Pages (hébergement, une URL de prévisualisation par branche)

## Commandes
| Commande | Rôle |
|---|---|
| `npm install` | Installer les dépendances |
| `npm run dev` | Lancer le site en local |
| `npm test` | Lancer les tests automatiques |
| `npm run lint` | Vérifier la qualité du code |
| `npm run build` | Construire la version de production (`dist/`) |
| `./scripts/test-sql.sh` | Tester migrations et règles de sécurité sur un PostgreSQL (variables `PG*`) |

## Configuration
Copier `.env.example` en `.env.local` et renseigner l'URL et la clé « anon » du projet Supabase.
Sans configuration, le site s'affiche en mode maquette.

### Base de données (Supabase)
- `supabase/migrations/` : schéma, règles de sécurité (RLS) et fonctions. Testés à chaque PR (`supabase/tests/`).
- `supabase/functions/` : Edge Functions (mot de passe provisoire généré par l'admin).
- `supabase/templates/` : emails en français avec code à 6 chiffres.
- Après fusion sur `main`, le workflow « Déploiement Supabase » applique migrations, fonctions et réglages
  d'authentification (voir l'en-tête de `.github/workflows/supabase.yml` pour les secrets nécessaires).
- Réglé à la main dans le tableau de bord Supabase : SMTP Brevo, limites d'envoi d'emails.

### Accès
| Rôle | Comment | Droits |
|---|---|---|
| Spectateur | « Regarder » + code commun (session anonyme Supabase) | Tournois, tableaux, annonces, règles |
| Joueur | Inscription @fft.fr (ou adresse autorisée) + code reçu par email | + profils, saisie de ses scores |
| Admin | Joueur avec `profiles.role = 'admin'` | Tout |

## Organisation du code
```
src/
├── components/   composants réutilisables (mise en page, pastilles…)
├── features/     une fonctionnalité = un dossier (auth/, admin/…)
├── pages/        une page = une route (voir src/router.tsx)
├── lib/          client Supabase, utilitaires
supabase/         migrations SQL, tests SQL, Edge Functions, modèles d'emails
scripts/          outils (tests SQL)
public/           icônes et favicon
```

## Fonctionnement
- `main` = version stable, déployée en production.
- Chaque fonctionnalité est développée sur une branche (`feat/…`, `fix/…`) et fusionnée via Pull Request après test sur l'URL de prévisualisation.
- Messages de commit au format Conventional Commits, en français.
