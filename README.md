# Shvft2.0 website

Static multi-page site for www.shvft20.org. No build step: each page is an `index.html` in its own folder (`about/`, `services/`, `how-we-work/`, `impact/`, `training/`, `for-businesses/`, `contact/`, `governance/`), sharing `styles.css`, `site.js` and `assets/`. The header and footer are repeated in every page, so change them in all of them.

Links use root paths (`/about/`), so preview with a local server rather than opening the file:

    python3 -m http.server 8000
