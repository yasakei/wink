# Wink authentication setup

Wink uses Supabase Auth for one shared session across email/password and Google. The desktop application uses PKCE and returns from the system browser through a loopback callback in development and `recordly://auth/callback` in production. The `recordly://` scheme is retained for compatibility with existing sessions and integrations. X is shown in the sign-in dialog and requires its provider to be enabled in Supabase. SAML is intentionally hidden until configured.

## 1. Create the project

1. Create a Supabase project.
2. In **Project settings → API**, copy the project URL and publishable key.
3. Copy `.env.example` to `.env.local` and fill in both values. Never use the service-role key in the desktop application.
4. In **Authentication → URL configuration**, add `recordly://auth/callback` and `http://127.0.0.1:43821/auth/callback` to the redirect allow list.

Email/password works once email authentication is enabled and a user has been created. Password-reset emails use the same desktop callback.

## 2. Google

1. Create a Web OAuth client in Google Auth Platform.
2. Add Supabase's callback URL, `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`, as an authorized redirect URI.
3. Enable Google under **Supabase → Authentication → Sign In / Providers** and paste the Google client ID and secret.
4. Keep the requested scopes to `openid`, email, and profile unless Wink genuinely needs more.

## 3. X

1. Create an OAuth 2.0 app in the X Developer Dashboard and enable requesting the user's email.
2. Set its callback URL to `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
3. Enable X/Twitter OAuth 2.0 in Supabase and paste the client ID and secret.

## 4. SAML SSO (currently hidden)

SAML is configured per customer workspace. Supabase's SAML support requires Pro or above.

1. Enable SAML in the Supabase Auth provider settings.
2. Obtain the customer's IdP metadata URL or metadata XML file.
3. Register the connection and its email domain with the Supabase CLI, for example:

   ```sh
   supabase sso add --type saml --project-ref YOUR_PROJECT_REF \
     --metadata-url 'https://customer.example/idp/metadata' \
     --domains customer.example
   ```

The Wink modal extracts the domain from the entered email address and starts the matching SAML connection.

## 5. Verify locally

Restart `npm run dev` after creating `.env.local`. Open an editor and verify:

1. The account button opens **Sign into Wink**.
2. Email/password creates a persistent Supabase session.
3. Google opens the system browser and returns to Wink.
4. Clicking **Create link** while signed out opens this modal; after successful authentication it continues to the share dialog.

Add the same `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values to the share Worker's secrets or variables. Set `OWNER_USER_ID` to the owner’s Supabase user ID. The Worker validates the access token with Supabase and requires that owner identity before accepting API requests. `API_SECRET` is server-side only and remains available for library administration and explicitly enabled local integration tests; it is never entered into or exposed by the Wink desktop app.
