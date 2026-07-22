# Maquettes MVP

## Déploiement Vercel

1. Importer ce dépôt GitHub dans Vercel.
2. Dans **Settings > Environment Variables**, créer `METABASE_EMBEDDING_SECRET` avec la clé de *Guest embedding* de Metabase.
3. Déployer. La maquette front est disponible à `/front.html`.

La fonction `POST /api/metabase-guest-token` émet un JWT de dix minutes uniquement pour le dashboard Metabase `33`. La clé Metabase et les JWT ne sont pas stockés dans le dépôt.

Le front démo n'ayant pas encore d'authentification serveur, toute personne qui peut accéder à la maquette peut demander un jeton invité. Ajouter un contrôle de session dans `api/metabase-guest-token.js` avant d'utiliser cette configuration avec des données restreintes.
