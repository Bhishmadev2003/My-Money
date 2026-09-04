# My Money V13 — Professional Web Design

This version focuses on the dark professional dashboard design you provided.

## Files
- index.html
- css/style.css
- js/app.js
- js/firebase.js
- firestore.rules

## Firebase setup
1. Open Firebase Console → Project settings → Your apps → Web app.
2. Copy the Firebase configuration object.
3. Open `js/firebase.js`.
4. Replace the placeholder `apiKey`, `messagingSenderId`, and `appId` with your existing web-app values.
5. Keep the existing projectId/authDomain if they match your My Money Firebase project.
6. Firebase Authentication → Sign-in method → Google must be enabled.
7. Authentication → Settings → Authorized domains: keep `localhost` and your deployed domain.
8. Firestore Database → Rules: paste `firestore.rules` and click Publish.

## Run locally
Use VS Code Live Server or another local HTTP server. Do not open index.html directly with file://.

Example:
http://127.0.0.1:5500/index.html

## Important
The dashboard deliberately does NOT use your total accumulated account balance to calculate weekly safe-to-spend. Total balance is displayed separately as your long-term financial position.

Weekly Spending = actual expense transactions from Monday through Sunday.

EMI Paid and Goal Contribution are separate transaction types and require selecting the specific EMI/Goal.
