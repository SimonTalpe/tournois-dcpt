# Consignes pour Claude — Mini-pong et fléchettes

- Référence fonctionnelle et technique : documents du Projet claude.ai « Tournoi DCPT » (`claude/01-cahier-des-charges.md` à `claude/05-conventions.md`). Les lire avant toute nouvelle étape.
- Sim pilote et teste ; Claude code. Répondre en français.
- Jamais de commit direct sur `main` : une branche par fonctionnalité + Pull Request avec instructions de test (URL de prévisualisation, parcours mobile et desktop).
- **Fusion automatique (décision de Sim du 17/11/2026)** : Claude fusionne lui-même ses PR (squash) dès que les vérifications GitHub sont vertes. Ne jamais fusionner une PR dont les vérifications échouent. Signaler à Sim chaque fusion avec ce qu'il faut tester en production.
- Avant de pousser : `npm run lint`, `npm test`, `npm run build` doivent passer.
- Code : TypeScript strict, identifiants en anglais, textes affichés en français, mobile first.
- **Design « Ordre du jeu » (validé le 23/11/2026)** : toute interface nouvelle ou modifiée suit `docs/DESIGN.md` (couleurs FFT, Big Shoulders Display + Schibsted Grotesk, angles droits, filets noirs, pas d'émojis ni d'ombres) et réutilise les composants de `src/components/ui.tsx`. Le test `src/design.test.ts` vérifie les règles principales. Un écran sans maquette : proposer d'abord des options à Sim dans le canevas de maquettes (lien dans `docs/DESIGN.md`), puis coder l'option retenue.
- Toute modification de base = migration SQL dans `supabase/migrations/`. Droits appliqués en base (RLS), jamais seulement dans l'interface.
- Aucun secret dans le dépôt.
- Logique de tableaux/poules/classements : toujours couverte par des tests automatiques.
- En fin d'étape : mettre à jour la roadmap et le journal des décisions du Projet.
