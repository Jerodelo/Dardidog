# Dardidog Website

Site web pour Dardidog, service professionnel de garde d'animaux à Dardilly.

## 📁 Structure du Projet

```
DARDIDOG/
├── index.html                    # Page d'accueil
├── prestations.html              # Prestations et tarifs
├── contact.html                  # Avis clients et contact
├── Secteur-dintervention.html    # Carte des zones d'intervention
├── script.js                     # JavaScript (menu mobile, carousel, lightbox)
├── css/
│   ├── style.min.css            # CSS minifié pour production (19KB)
│   ├── base/
│   │   ├── variables.css        # Variables CSS (couleurs, espacements)
│   │   └── typography.css       # Typographie et fonts
│   ├── layout/
│   │   ├── header.css           # Styles de l'en-tête
│   │   ├── footer.css           # Styles du pied de page
│   │   └── main.css             # Mise en page principale
│   ├── components/
│   │   ├── buttons.css          # Styles des boutons
│   │   ├── cards.css            # Cartes de contenu
│   │   ├── carousel.css         # Carrousel d'avis
│   │   ├── gallery.css          # Galerie photos avec lightbox
│   │   ├── grids.css            # Grilles de contenu
│   │   └── tables.css           # Tableaux de tarifs
│   ├── animations.css           # Animations et transitions
│   └── responsive.css           # Styles responsive
├── partials/
│   ├── header.html              # En-tête réutilisable
│   └── footer.html              # Pied de page réutilisable
├── images/                      # Logos, photos, favicons
├── fichiers/
│   ├── mentions-legales.pdf     # Mentions légales
│   └── cgv.pdf                  # Conditions générales de vente
├── sitemap.xml                  # Plan du site pour SEO
├── robots.txt                   # Instructions pour les robots d'indexation
└── README.md                    # Ce fichier
```

## 📄 Description des Fichiers

### Fichiers HTML

Le site est composé de 4 pages HTML principales + des partials réutilisables.

#### Structure Générale

```html
<!DOCTYPE html>
<html lang="fr">
  <head>
    <!-- Métadonnées et liens vers ressources externes -->
  </head>
  <body>
    <!-- Contenu du site -->
  </body>
</html>
```

#### Sections Principales

1. **Header (En-tête fixe)** - `partials/header.html`
   - Logo SVG vectorisé
   - Nom de l'entreprise "Dardidog"
   - Navigation desktop avec 4 liens:
     - Accueil
     - Prestations et tarifs (avec sous-menu déroulant)
     - Secteur d'intervention
     - Avis et contact
   - Menu burger pour mobile
   - Chargé dynamiquement via JavaScript

2. **Page Accueil** - `index.html`
   - **"Qui est Dardidog ?"** - Présentation avec photo
   - **"Pourquoi faire appel à Dardidog ?"** - 5 cartes explicatives:
     - Chien qui s'ennuie
     - Troubles comportementaux
     - Apprentissage des ordres de base
     - Accueil d'un chiot
     - Départ en vacances
   - Métadonnées SEO complètes (Open Graph, Twitter Card, JSON-LD)

3. **Page Prestations** - `prestations.html`
   - 5 sections de services détaillées:
     - Balades canines (collectives et individuelles)
     - Visites à domicile
     - Pension canine
     - Pension NAC
     - Portraits photos
   - Tableaux de tarifs responsive pour chaque service
   - Galerie photos avec lightbox
   - Note sur la première rencontre offerte

4. **Page Contact** - `contact.html`
   - Carrousel d'avis Google clients
   - Informations de contact:
     - Email: contact@dardidog.fr
     - Téléphone: +33 7 50 91 31 77
   - Bouton d'appel direct
   - Lien vers les avis Google

5. **Page Secteur d'intervention** - `Secteur-dintervention.html`
   - Liste des 14 communes desservies
   - Informations de déplacement
   - Possibilité d'étendre la zone

6. **Footer** - `partials/footer.html`
   - Liens vers documents PDF:
     - Mentions légales
     - Conditions générales de vente
   - Copyright © 2026 Dardidog
   - Chargé dynamiquement via JavaScript

#### JavaScript - `script.js`

Fonctionnalités principales:
- **Chargement des partials** (header et footer)
- **Menu mobile burger** avec addEventListener
- **Carrousel d'avis** automatique
- **Galerie lightbox** pour les photos
- Pas d'onclick inline (JavaScript moderne)

---

### CSS

Architecture CSS modulaire avec fichier minifié pour production.

#### Organisation du CSS

**Fichier de production**: `css/style.min.css` (19KB)
- Concatenation de tous les modules CSS
- Minifié manuellement via cssminifier.com

**Modules CSS** (pour développement):

1. **base/variables.css** - Variables CSS
   ```css
   :root {
     --color-primary: #154734;
     --color-card: #FBF5ED;
     --color-background: #FAF3E8;
     --spacing-md: 40px;
     --border-radius-md: 15px;
   }
   ```

2. **base/typography.css** - Polices et typographie
   - Polices: Open Sans (texte), Great Vibes (cursive)
   - Chargées via Google Fonts dans le HTML
   - Smooth scroll configuré

3. **layout/** - Structure de page
   - header.css: En-tête fixe, navigation desktop/mobile
   - footer.css: Pied de page
   - main.css: Conteneurs et mise en page

4. **components/** - Composants réutilisables
   - buttons.css: Styles des boutons CTA
   - cards.css: Cartes de contenu avec hover
   - carousel.css: Carrousel d'avis automatique
   - gallery.css: Galerie photos avec lightbox
   - grids.css: Grilles de contenu responsive
   - tables.css: Tableaux de tarifs (utilise var(--color-card))

5. **animations.css** - Animations fadeIn, slideIn, etc.

6. **responsive.css** - Media queries pour mobile/tablette

#### Palette de Couleurs

| Couleur | Code | Usage |
|---------|------|-------|
| Vert profond | `#154734` | Couleur primaire, header, boutons |
| Vert foncé | `#0b3314` | Texte principal, titres |
| Vert clair | `#214B36` | Dégradés, hover |
| Beige clair | `#FAF3E8` | Fond de page (--color-background) |
| Beige chaud | `#FBF5ED` | Cartes, tableaux (--color-card) |
| Brun accent | `#8B7355` | Accent |

#### Responsive Design

Le site est entièrement responsive:
- Menu burger sur mobile
- Tableaux adaptés en cartes empilées
- Carrousel ajusté selon la taille d'écran
- Images optimisées avec srcset et WebP

---

## 🎨 Fonctionnalités Clés

### 1. Navigation Smooth Scroll
- Défilement fluide entre les pages et sections
- `scroll-padding-top` évite que le header fixe cache les titres

### 2. Menu Mobile
- Bouton burger animé
- Navigation qui se déploie
- Gestion via addEventListener (pas d'onclick inline)

### 3. Galerie Lightbox
- Clic sur une photo = agrandissement en plein écran
- Fermeture par clic sur X ou en dehors de l'image

### 4. Carousel Automatique
- Défilement automatique des avis clients
- Animation CSS smooth
- Responsive

### 5. Architecture Modulaire
- Header et footer en partials HTML
- CSS organisé en modules
- Variables CSS pour cohérence

---

## 🚀 Déploiement

### CSS Minifié
Le fichier `css/style.min.css` est déjà créé (19KB) en production.

**Pour recréer le CSS minifié après modifications:**
1. Concaténer tous les fichiers CSS des dossiers base/, layout/, components/
2. Minifier via cssminifier.com
3. Sauvegarder dans css/style.min.css

### Actualiser le cache après modifications
Ajouter une version au fichier CSS:
```html
<link rel="stylesheet" href="css/style.min.css?v=2">
```

### Mise en ligne
1. Uploader via FTP
2. Soumettre sitemap.xml à Google Search Console
3. Vérifier robots.txt

---

## 📱 Compatibilité

- ✅ Chrome / Edge (dernières versions)
- ✅ Firefox (dernières versions)
- ✅ Safari (dernières versions)
- ✅ Mobile (iOS / Android)

---

## 🔧 Technologies Utilisées

- **HTML5** - Structure sémantique avec métadonnées SEO
- **CSS3** - Styles modulaires avec variables CSS
- **JavaScript Vanilla** - Menu mobile, carousel, lightbox
- **Google Fonts** - Open Sans, Great Vibes
- **SVG** - Logo vectorisé et favicons
- **WebP** - Images optimisées avec fallback JPG

---

## 📝 Notes Importantes

### Fichiers PDF
Le footer référence:
- `fichiers/mentions-legales.pdf` ✅
- `fichiers/cgv.pdf` ✅

### Performance
- CSS minifié (19KB)
- Images WebP avec fallback
- Favicon multi-formats (SVG, PNG)
- Smooth scroll natif
- Pas de dépendances lourdes

---

## 👤 Contact

**Dardidog**
- 📧 Email: contact@dardidog.fr
- 📱 Téléphone: +33 7 50 91 31 77
- 📍 Secteur: Dardilly et ouest lyonnais (14 communes)
- 🌐 Site: https://dardidog.fr

---

## 📄 Licence

© 2026 Dardidog – Tous droits réservés

