# Google integrations

Savingroup connects to Google directly with OAuth, without a hosted broker. Each user
connects their own Google accounts from **Integrations**, one app at a time, and bots
use them through tools that the server runs on the user's behalf.

| App | What bots can do | Permissions a user can grant |
| --- | --- | --- |
| Gmail | Search, read threads and attachments, draft, send, reply, label, archive, trash | Read · Draft and send · Label, archive, and trash |
| Google Calendar | List calendars and events, check availability, create, change, delete events | See · Create, change, and delete events |
| Google Drive | Search, read and export files, save files to the bot's computer, upload, create folders, share, move, trash | See and download · Upload and create · Edit, move, share, and trash any file |
| Google Sheets | Read and write ranges, append rows, clear, create spreadsheets, batch updates | See · Create and edit |
| Google Docs | Read as text, create, append, replace text, batch updates | See · Create and edit |
| Google Slides | Read slide text, create, add slides, replace text, batch updates | See · Create and edit |
| YouTube | List channels and uploads, search, upload videos (resumable), schedule publishing, thumbnails, update metadata, playlists, comments, delete | See · Upload videos and thumbnails · Edit videos, playlists, and comments |
| YouTube Analytics | Channel reports by date, video, country, traffic source | See |
| Google Tasks | List, create, complete, delete tasks | See · Create, complete, and delete |
| Google Contacts | Search, list, create contacts | See · Create |
| Google Forms | Read questions and responses, create forms, add questions | See · Create and edit |
| Google Search Console | Search analytics, URL inspection, sitemaps | See · Submit sitemaps |

Google Ads is not included. Its API also needs a developer token approved in the Google
Ads API Center and a manager account, which a self-hosted deployment has to obtain
itself before an adapter could be tested.

## Set up a Google OAuth client

These steps are done once per deployment, by whoever owns its Google Cloud project.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. Under **APIs & Services → Library**, enable the API behind each app you want users to
   connect: Gmail API, Google Calendar API, Google Drive API, Google Sheets API, Google
   Docs API, Google Slides API, YouTube Data API v3, YouTube Analytics API, Google Tasks
   API, People API (Contacts), Google Forms API, and Google Search Console API. A tool for
   an app whose API is off fails with a message telling the owner to enable it.
3. Under **Google Auth Platform**, configure the consent screen:
   - **Branding**: app name, support email, and your domain under authorized domains.
   - **Audience**: *Internal* if everyone is in your Google Workspace organization (no
     verification needed), otherwise *External*. An External app in *Testing* only
     admits the test users you list, at most 100.
   - **Data access**: add the scopes from the table below for the apps you offer.
4. Under **Clients**, create an OAuth client of type **Web application** and add this
   **Authorized redirect URI**, exactly:

   ```text
   <WEB_ORIGIN>/api/integrations/google/callback
   ```

   For example `https://app.example.com/api/integrations/google/callback`, or
   `http://127.0.0.1:5173/api/integrations/google/callback` for local development. The
   server setup screen in Savingroup shows the exact value for your deployment.
5. Give Savingroup the client ID and secret, either way:
   - As the deployment owner, open `<WEB_ORIGIN>/integrations/setup` (also offered during
     onboarding, and under Integrations in the desktop app's local settings), choose
     **Google**, and save. Savingroup checks the pair against Google and stores it encrypted.
   - Or set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in `.env` for the API
     and worker. A saved setup takes precedence over the environment.

`WEB_ORIGIN` must be the public URL people use, because Google redirects their browser
there. The callback reaches the API through the same proxy as `/api/auth`.

## Scopes and Google review

Savingroup asks for the narrowest scope that covers each permission, and only when a user
grants that permission. Adding an app first requests its read permission; bots ask for
more in the chat when a task needs it, and users can grant more under each account in
**Integrations**.

| Permission | Scope |
| --- | --- |
| Gmail read / draft and send / label | `gmail.readonly` / `gmail.compose` / `gmail.modify` |
| Calendar see / change | `calendar.readonly` / `calendar.events` |
| Drive see / upload / manage | `drive.readonly` / `drive.file` / `drive` |
| Sheets see / edit | `spreadsheets.readonly` / `spreadsheets` |
| Docs see / edit | `documents.readonly` / `documents` |
| Slides see / edit | `presentations.readonly` / `presentations` |
| YouTube see / upload / manage | `youtube.readonly` / `youtube.upload` / `youtube.force-ssl` |
| YouTube Analytics | `yt-analytics.readonly` |
| Tasks see / change | `tasks.readonly` / `tasks` |
| Contacts see / create | `contacts.readonly` / `contacts` |
| Forms see / edit | `forms.body.readonly` + `forms.responses.readonly` / `forms.body` |
| Search Console see / submit | `webmasters.readonly` / `webmasters` |

Every request also includes `openid email profile` so Savingroup learns which account consented.

What Google requires depends on the audience and on each scope's class, which the
**Data access** page labels:

- **Internal** apps need no verification.
- **External** apps in **Testing** work only for listed test users, and Google expires
  their refresh tokens after 7 days. Savingroup marks the account **Reconnect** when that
  happens.
- **External** apps in **Production** that use *sensitive* scopes (Calendar, Sheets,
  Docs, Slides, YouTube, Contacts, Tasks, Forms, Search Console, `gmail.send`) need
  OAuth verification before more than 100 people can use them without a warning.
- *Restricted* scopes, which include Gmail read, compose, and modify and Drive `drive`
  and `drive.readonly`, additionally need a yearly third-party security assessment
  for External production apps. Offer only the apps you can get approved, or keep the
  app Internal or in Testing.

## YouTube rules

- The YouTube Data API has a daily quota per Cloud project (10,000 units by default).
  Uploads and searches cost far more than other calls; check Google's quota calculator
  and request more through the YouTube API Services form. When the quota runs out,
  tools say so until it resets.
- Videos uploaded through an API project that has not passed the YouTube API Services
  audit are locked to **private**. Scheduled publishing (`publish_at`) also keeps the
  video private until its time.
- Custom thumbnails need a channel that YouTube has verified.
- Every upload must say whether it is made for children.
- Savingroup uploads in resumable chunks and resumes a dropped chunk where Google stopped.
  The file passes through server memory on its way from the bot's computer, so uploads
  are capped at 256 MiB.

## How it fits together

```text
bot tool call → approval gate → Google connector → account check → token vault → Google API
```

- **Connections.** Each app a user adds is a connection pointing at a Google account. One
  account can back several apps and is authorized once; adding Drive to an account that
  already has Gmail asks Google only for Drive.
- **Callback.** Google sends the browser to `/api/integrations/google/callback`. The API
  exchanges the code itself with the PKCE verifier and client secret, so the code never
  reaches app code. The OAuth state is random, stored only as a hash, single use, and
  valid for ten minutes. The browser must be signed in to Savingroup as the person who
  started the sign-in, so a sign-in link sent to someone else cannot attach their Google
  account to the sender. The ID token's issuer, audience, expiry, and nonce are checked.
- **Mobile.** A phone's browser has no Savingroup session, so a sign-in started in the app
  returns to the app (`savingroup://connections/done`), which finishes it through its own
  authenticated session, with the same same-person check.
- **Tokens.** Only the refresh token is stored, encrypted like other credentials
  (`ENCRYPTION_KEY`, or Infisical when configured). Access tokens stay in memory.
  Concurrent calls share one refresh. When Google rejects the refresh token, the account
  shows **Reconnect** and tools say how to fix it.
- **Disconnecting.** Removing an app keeps the Google grant while another app still uses
  the account; removing the last one deletes the stored token and revokes it at Google.
  Google revokes every scope of a grant at once, so it cannot drop one app's scope while
  keeping another's.
- **Tools.** Bots see only operations the account has granted, plus `google_get_access`,
  which reports what is connected and puts an **Authorize** button in the chat for a
  missing app or permission. With several accounts for an app, tools take an `account`
  parameter limited to that user's accounts. Past 20 tools, they are found through
  `google_search_tools`. Sending, uploading, sharing, editing, and deleting need the
  user's approval like other consequential tools; reads do not. Email, documents, and
  other Google content are treated as untrusted data, not instructions.
- **Files.** Upload, attachment, and download tools take paths on the bot's computer, so
  a video a bot rendered can go straight to YouTube. Files up to 256 MiB go to Google;
  files saved onto the computer are capped at 10 MiB, the platform's attachment limit.
- **Activity.** Integrations shows recent sign-ins and tool runs per app, with errors.
  Activity never stores tokens or retrieved content and is kept for 30 days.

## Add another Google API

1. Write a service definition in `packages/adapters/src/google-<app>.ts`: its
   permissions with scopes, and operations with a Zod input schema and a `run` that
   calls the API through `context.api`. Read operations use get, list, search, find, or
   read in their names and set `readOnly: true`.
2. Add it to `GOOGLE_SERVICES` in `packages/adapters/src/google-services.ts`.
3. Enable its API in the Cloud project and add its scopes to the consent screen.

The OAuth flow, vault, approvals, catalog, and UI need no changes.
`google-services.test.ts` checks naming, permissions, and schemas for every operation, and
`testing/google-emulator.ts` runs the connector offline.

## Troubleshooting

- **Error 400: redirect_uri_mismatch** — the redirect URI in the Cloud client does not
  match `<WEB_ORIGIN>/api/integrations/google/callback` exactly.
- **Access blocked / app not verified** — add the person as a test user, make the app
  Internal, or complete Google's verification.
- **"Sign in to Savingroup in this browser…"** — the browser that finished Google's consent
  was not signed in to Savingroup as the person who started it. Start again from that
  person's Savingroup session.
- **API not enabled / quota used up** — enable the API or raise the quota in the Cloud
  project; the tool error names the API.
