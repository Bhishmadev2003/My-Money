# My Money — GitHub Pages

## Deploy
1. Upload the contents of this folder to the root of your GitHub repository.
2. In GitHub: **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your main branch and `/ (root)`, then Save.
5. Open the generated `https://<username>.github.io/<repository>/` URL.

## Firebase
For Google Sign-In on GitHub Pages, add your GitHub Pages domain to:
Firebase Console → Authentication → Settings → Authorized domains.

For example:
`bhishmadev2003.github.io`

Do not commit Firebase service-account private keys, Gemini Developer API keys, or App Check debug tokens.


### EMI date behavior (V37)
The next EMI date is derived from EMI-payment transaction dates. Editing or deleting an EMI payment moves the paid/unpaid cycle accordingly.
