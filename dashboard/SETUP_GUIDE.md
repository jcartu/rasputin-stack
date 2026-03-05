# Google OAuth 2.0 Setup Guide for ALFIE Nexus Dashboard

## Overview

This guide walks you through setting up Google OAuth 2.0 authentication for the ALFIE Nexus Dashboard. After setup, users will be able to sign in with their Google accounts.

---

## Prerequisites

- A Google Cloud Platform account
- Access to the [Google Cloud Console](https://console.cloud.google.com/)
- The ALFIE Nexus Dashboard deployed at `https://dash.rasputin.to`

---

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top
3. Click **"New Project"**
4. Enter project name: `ALFIE Nexus Dashboard`
5. Click **"Create"**
6. Wait for the project to be created, then select it

---

## Step 2: Configure OAuth Consent Screen

1. In the left sidebar, navigate to **"APIs & Services" → "OAuth consent screen"**
2. Select **"External"** user type (unless you have a Google Workspace)
3. Click **"Create"**

### App Information:
- **App name:** `ALFIE Nexus Dashboard`
- **User support email:** `admin@operator.com`
- **App logo:** (optional) Upload a logo if desired
- **Application home page:** `https://dash.rasputin.to`
- **Application privacy policy:** (optional) Add if you have one
- **Application terms of service:** (optional) Add if you have one
- **Authorized domains:**
  - `rasputin.to`
- **Developer contact email:** `admin@operator.com`

4. Click **"Save and Continue"**

### Scopes:
5. Click **"Add or Remove Scopes"**
6. Select the following scopes:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
7. Click **"Update"**
8. Click **"Save and Continue"**

### Test Users:
9. Click **"Add Users"**
10. Add: `admin@operator.com`
11. Click **"Add"**
12. Click **"Save and Continue"**
13. Review summary and click **"Back to Dashboard"**

---

## Step 3: Create OAuth 2.0 Credentials

1. In the left sidebar, navigate to **"APIs & Services" → "Credentials"**
2. Click **"+ Create Credentials"** at the top
3. Select **"OAuth 2.0 Client ID"**
4. **Application type:** Select **"Web application"**
5. **Name:** `ALFIE Nexus Web Client`

### Authorized JavaScript origins:
6. Add:
   - `https://dash.rasputin.to`
   - `http://localhost:9001` (for local testing)

### Authorized redirect URIs:
7. Add:
   - `https://dash.rasputin.to/auth/google/callback`
   - `http://localhost:9001/auth/google/callback` (for local testing)

8. Click **"Create"**
9. A modal will appear with your Client ID and Client Secret
10. **Copy both values** — you'll need them next

---

## Step 4: Configure Environment Variables

1. SSH into your server:
   ```bash
   ssh admin@rasputin.to
   ```

2. Create or edit the `.env` file for the dashboard:
   ```bash
   nano ~/.openclaw/workspace/alfie-dashboard/.env
   ```

3. Add the following lines (replace with your actual values):
   ```bash
   GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret-here
   GOOGLE_JWT_SECRET=generate-a-random-secret-here
   ```

4. Generate a secure JWT secret:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the output and use it as `GOOGLE_JWT_SECRET`

5. Save the file (`Ctrl+O`, `Enter`, `Ctrl+X`)

6. **Set secure permissions:**
   ```bash
   chmod 600 ~/.openclaw/workspace/alfie-dashboard/.env
   ```

---

## Step 5: Restart the Dashboard Server

1. Restart the ALFIE Nexus server via pm2:
   ```bash
   pm2 restart alfie-nexus
   ```

2. Check the logs to ensure no errors:
   ```bash
   pm2 logs alfie-nexus --lines 50
   ```

3. You should see a log line like:
   ```
   {"ts":"...","level":"info","msg":"Google OAuth configured","clientId":"..."}
   ```

---

## Step 6: Test the OAuth Flow

1. Open your browser and navigate to:
   ```
   https://dash.rasputin.to
   ```

2. You should be redirected to the login page

3. Click **"Sign in with Google"**

4. You'll be redirected to Google's consent screen

5. Sign in with `admin@operator.com`

6. Grant permissions

7. You should be redirected back to the dashboard and logged in

---

## Troubleshooting

### Error: "redirect_uri_mismatch"
- Check that the callback URL in Google Console **exactly** matches:
  - `https://dash.rasputin.to/auth/google/callback`
- No trailing slashes, correct protocol (https)

### Error: "Access blocked: This app's request is invalid"
- Ensure the **OAuth consent screen** is configured correctly
- Verify `admin@operator.com` is added as a test user
- Check that authorized domains include `rasputin.to`

### Error: "User not whitelisted"
- Only `admin@operator.com` is allowed by default
- To add more emails, edit `server.js` and add to the `WHITELISTED_EMAILS` array

### Login loops or cookie issues
- Ensure cookies are enabled in your browser
- Check browser console for errors
- Verify `.env` file has `GOOGLE_JWT_SECRET` set
- Try clearing cookies for `dash.rasputin.to`

### OAuth credentials not loading
- Check `.env` file exists: `ls -la ~/.openclaw/workspace/alfie-dashboard/.env`
- Verify environment variables are set:
  ```bash
  pm2 restart alfie-nexus
  pm2 logs alfie-nexus | grep -i google
  ```

---

## Security Notes

1. **Never commit `.env` to git** — it contains secrets
2. The `.env` file should have `600` permissions (owner read/write only)
3. JWT tokens expire after 30 days — users will need to re-login
4. The hash secret (`#rasputin-neural-2026`) still works as a backup authentication method
5. Only `admin@operator.com` is whitelisted — edit `server.js` to add more users

---

## Adding More Whitelisted Emails

Edit `server.js` and find the `WHITELISTED_EMAILS` array:

```javascript
const WHITELISTED_EMAILS = [
  'admin@operator.com',
  'another-user@example.com', // Add more here
];
```

Then restart:
```bash
pm2 restart alfie-nexus
```

---

## PWA Installation

Once logged in, users can install the dashboard as a PWA:

**Desktop (Chrome/Edge):**
1. Click the install icon (⊕) in the address bar
2. Click "Install"

**Mobile (iOS Safari):**
1. Tap the Share button
2. Tap "Add to Home Screen"

**Mobile (Android Chrome):**
1. Tap the menu (⋮)
2. Tap "Install app" or "Add to Home Screen"

---

## Done!

Your ALFIE Nexus Dashboard now has:
- ✅ Google OAuth 2.0 authentication
- ✅ JWT session cookies
- ✅ PWA support (installable on desktop and mobile)
- ✅ Backward compatibility with hash secret auth
- ✅ Secure, zero-dependency implementation

For support, contact: admin@operator.com
