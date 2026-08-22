# Push notifications (FCM) — setup

The code is fully wired on both the backend and the mobile app. Push stays
**disabled** until the Firebase artifacts below are added — the app builds and
runs normally without them.

## What's already done (in code)

**Backend**
- `DeviceToken` model + `POST/DELETE /api/v1/devices/` to register/unregister a
  device's FCM token (per authenticated user).
- `core/push.py` — sends via Firebase Admin (`firebase-admin`), env-guarded.
- Every `notify(...)` (matter events, retainer invoices, bookings, etc.) also
  fires a best-effort push to the recipient's devices.
- Admin: **AI/Core → Device tokens** to inspect registrations.

**Mobile**
- `firebase_core` + `firebase_messaging` added.
- `PushService` + `PushRegistrar`: initialises Firebase, asks permission, gets
  the token, registers it after sign-in, unregisters on logout, shows a toast
  for foreground pushes, and routes to a push's `link` on tap.
- Android: `com.google.gms.google-services` applied **only if**
  `android/app/google-services.json` exists (so builds never break).
- iOS: `UIBackgroundModes` (remote-notification) + `Runner.entitlements`
  (`aps-environment`).

## 1. Create a Firebase project
console.firebase.google.com → Add project (reuse an existing one if you have it).

## 2. Backend service-account credentials
Firebase console → Project settings → **Service accounts** → *Generate new
private key* (downloads a JSON). Then set ONE of these env vars on the API host:

```
FCM_CREDENTIALS_FILE=/secure/path/attorney-fcm.json   # path to the JSON, or
FCM_CREDENTIALS_JSON={...}                              # the JSON inline
```

`pip install -r requirements.txt` (adds `firebase-admin`), then restart the API.
That's all the server needs.

## 3. Android
- Firebase console → Add app → **Android**, package name **`com.dataimprint.legalonline`**.
- Download **`google-services.json`** → put it at **`attorney_mobile/android/app/google-services.json`** (gitignored — do not commit).
- Rebuild. The google-services plugin auto-activates because the file now exists.

## 4. iOS
- Firebase console → Add app → **iOS**, bundle ID **`com.dataimprint.legalonline`**.
- Download **`GoogleService-Info.plist`** → add it to the **Runner** target in Xcode (drag into the Runner group, "Copy items if needed", target = Runner). Do not commit.
- **APNs key**: Apple Developer → Certificates, IDs & Profiles → Keys → create an **APNs Auth Key (.p8)**. Upload it in Firebase → Project settings → **Cloud Messaging** → *Apple app configuration* (with your Team ID + Key ID).
- In Xcode → Runner target → **Signing & Capabilities**: add **Push Notifications**, and add **Background Modes** with *Remote notifications* checked. (Info.plist + entitlements are already in the repo; this wires the capability to your provisioning profile.)

## 5. Verify
- Sign in on a device → the app registers a token (visible under Django admin →
  Device tokens).
- Trigger any notification (e.g. a booking, or a retainer invoice run) — a push
  should arrive. Or send a test from Firebase console → Cloud Messaging.

## Notes
- Keep `google-services.json`, `GoogleService-Info.plist`, and the service-account
  JSON **out of git** (they're secrets / project-specific).
- Without the backend creds, tokens still register but no push is sent. Without
  the mobile config files, the app runs but won't obtain a token.
