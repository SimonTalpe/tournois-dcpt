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

## Configuration
Copier `.env.example` en `.env.local` et renseigner l'URL et la clé « anon » du projet Supabase.
Sans configuration, le site s'affiche en mode maquette.

## Organisation du code
```
src/
├── components/   composants réutilisables (mise en page, pastilles…)
├── features/     une fonctionnalité = un dossier (à venir)
├── pages/        une page = une route (voir src/router.tsx)
├── lib/          client Supabase, utilitaires
supabase/         migrations SQL et Edge Functions (à venir)
public/           icônes et favicon
```

## Fonctionnement
- `main` = version stable, déployée en production.
- Chaque fonctionnalité est développée sur une branche (`feat/…`, `fix/…`) et fusionnée via Pull Request après test sur l'URL de prévisualisation.
- Messages de commit au format Conventional Commits, en français.
