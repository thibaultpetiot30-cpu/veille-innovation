# Veille Innovation

Site statique affichant une veille quotidienne sur l'écosystème startup, venture capital, IA, tech et macro (France & Europe). HTML/CSS/JS vanilla, sans build step, déployable directement sur GitHub Pages.

## Fonctionnement

- Chaque matin, un automatisme dépose un fichier `data/YYYY-MM-DD.md` (voir `data/2026-07-09.md` pour la structure attendue : titre, avertissement méthodologique, résumé exécutif, sections thématiques).
- `data/index.json` liste les dates disponibles ; il est régénéré automatiquement par le workflow `.github/workflows/update-index.yml` à chaque push touchant `data/*.md`.
- La page lit `data/index.json`, charge le briefing le plus récent (ou celui indiqué par l'ancre `#YYYY-MM-DD`), et le transforme en composants visuels (encadré résumé, cartes par section, badges par catégorie).

## Développement local

```bash
python3 -m http.server 8000
```

puis ouvrir `http://localhost:8000`. Un serveur local est nécessaire car la page charge `data/*.md` et `data/index.json` via `fetch`, ce qui échoue en ouverture directe du fichier (`file://`).

Pour régénérer manuellement l'index après avoir ajouté un fichier dans `data/` :

```bash
node scripts/generate-index.js
```

## Déploiement GitHub Pages

Dans les paramètres du dépôt : **Settings → Pages → Build and deployment → Deploy from a branch**, choisir la branche `main` et le dossier `/ (root)`.
