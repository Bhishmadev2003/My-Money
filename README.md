# MoneyPilot

MoneyPilot is a static personal-finance dashboard built with HTML, CSS and JavaScript, with optional Firebase Authentication / Firestore integration.

## GitHub Pages deployment

This repository is already prepared for GitHub Pages using GitHub Actions.

1. Upload all files and folders in this repository to the `main` branch.
2. Open **GitHub → Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push/commit to `main`. The included workflow will publish the site automatically.

The application uses relative paths, so it works from a GitHub project-page URL such as:

`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

## Firebase Google login

If Google Sign-In is enabled, add your GitHub Pages hostname to Firebase Authentication:

**Firebase Console → Authentication → Settings → Authorized domains**

Add:

`YOUR-USERNAME.github.io`

The Firebase web configuration in `auth.js` is intentionally client-side. Firebase web API keys are not treated as server secrets; access should be protected by Authentication and Firestore Security Rules.

## Main files

- `index.html` — app shell
- `styles.css` — UI styling
- `app.js` — application logic
- `auth.js` — Firebase initialization and Google sign-in
- `firestore.rules` — per-user Firestore access rules
- `public/` — static images/assets
- `.github/workflows/pages.yml` — automatic GitHub Pages deployment
- `.nojekyll` — prevents Jekyll processing

## Firestore rules

Current rules allow an authenticated user to read/write only their own document at `/users/{uid}`.

Deploy Firestore rules separately with the Firebase CLI when required.
