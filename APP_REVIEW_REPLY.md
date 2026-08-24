# App Review Reply — Turf Bookingg (iOS)

Use the text below in **App Store Connect → Turf Bookingg → App Review Information → Notes** and as a reply to the current Guideline 2.1 rejection.

---

## Reply to App Review (Guideline 2.1 — Information Needed)

Thank you for reviewing Turf Bookingg. We have added all the information requested below. The app is a private group-management tool for turf/sports games, currently used for soccer in India. It lets players confirm games, split ground costs, track payments, vote for player of the day, and view rankings. There are no in-app purchases, subscriptions, or paid digital content.

### 1. Screen recording demonstrating core functionality

**Video URL:** [PASTE LINK TO SCREEN RECORDING HERE]

We have prepared a physical-device recording that begins at app launch and walks through the typical user flow:

1. Launch the app → splash screen.
2. **Registration flow (optional):** Tap Register, enter any 10-digit phone number, request OTP, and use the demo OTP shown on screen. Set name, password, and preferred sport/location.
3. **Login flow:** Use the demo credentials below, or log in with a registered phone number/email and password. You can also log in with OTP (demo OTP is displayed).
4. **Dashboard / game list:** Browse upcoming games, search/filter by ground, date, or sport.
5. **Join a game:** Tap a game, review per-player cost and payment-receiver details, then tap Join.
6. **Game detail:** View confirmed/waiting players, teams (when assigned), ground cost split, payment status, and discussion/media section. Tap the info icon next to a player to view profile details.
7. **Payments:** A moderator/admin can mark players as paid or unpaid; any overpayment or underpayment is shown per player.
8. **Game completion / editing result (moderator/admin):** Mark the game completed, edit teams, move players, enter score, mark goal scorers, and save. Rankings and per-player costs are recalculated.
9. **Profile / settings:** Edit profile, upload a profile photo (camera/photo-library permission prompt shown only if you choose to upload), change notification preferences.
10. **Account deletion:** Go to **Profile → Delete Account**, confirm. The account is scheduled for deletion; personal data is retained for a 90-day grace period and then permanently purged. You can log back in within 90 days to restore.
11. **Logout.**

The recording was captured on a physical iPhone running the latest public iOS. No App Tracking Transparency prompt is shown because the app does not track users across third-party apps/websites.

### 2. Device models and operating systems tested

- iPhone 14 Pro — iOS 17.5.1
- iPhone 15 Pro Max — iOS 18.0 (latest public beta at time of testing)
- iPhone SE (3rd generation) — iOS 17.6
- iPad mini (6th generation) — iPadOS 17.6 (app runs in compatible iPhone mode)

*[Please replace with the exact devices and iOS versions you tested on.]*

### 3. App function, target audience, and value

Turf Bookingg is a turf/ground booking and game-management app for amateur sports groups. It solves three common problems for organizers and players:

- **Organizing games:** Moderators create games, invite players, and split players into balanced teams.
- **Cost splitting:** The moderator enters the total ground cost; the app calculates the per-player amount dynamically as players join or leave and tracks who has paid.
- **Rankings and engagement:** After a game, the moderator records the score and goal scorers (including own goals); the app recalculates player and team rankings and lets players vote for "Player of the Day" (POTD).

The target audience is adult amateur sports players and group organizers in India. The app is free; all money movement between players is handled offline by the group moderator.

### 4. Instructions for setting up and accessing main features

#### Demo accounts

| Account type | Login | Password |
|---|---|---|
| Regular player | `9990000001` | `password123` |
| Admin / Moderator / Ground manager | `8951575798` | `password123` |
| Admin email alternative | `tittlejoseph@gmail.com` | `password123` |

The admin account has all roles (user, moderator, admin, ground_management) and can create games, edit completed game results, manage users, and configure preferences. The regular account can join games, view/pay splits, vote POTD, and edit its own profile.

#### Main feature walkthrough

1. **Log in** with one of the demo accounts.
2. From the **Dashboard**, tap a game card to open the **Game Detail** screen.
3. If not already joined, tap **Join** (if the max-player limit is reached, you will be added to the waiting list).
4. Moderators see extra action buttons: **Edit Game**, **Mark Complete**, **Edit Result**, and **Manage Players**.
5. After a game is completed, any player can vote for POTD from the game detail screen.
6. Go to **My Payments** to see your payment history and any amount due.
7. Go to **Hall of Fame** to view overall rankings, streaks, and badges.
8. Go to **Profile** to edit details or delete the account.

#### Account registration

Tap **Register** on the login screen, enter a 10-digit phone number, and the app will display a demo OTP (the production SMS provider is still being configured, so the OTP is shown in the UI for testing). Complete profile, password, and preferred sport/location. You can then log in with that phone number and password.

### 5. External services, tools, and platforms

- **Render** (`https://render.com`) — FastAPI + SQLite backend hosting and production API (`https://ground-booking-eleg.onrender.com`).
- **Cloudflare** — DNS and CDN for the Render origin.
- **Codemagic** (`https://codemagic.io`) — CI/CD for iOS and Android builds and App Store Connect upload.
- **Google Identity Services** — Optional Google sign-in; the button is hidden until a `GOOGLE_CLIENT_ID` is configured.
- **Cashfree Payments** — Optional online payment gateway; currently disabled by the admin, so the app tracks offline payments only.
- **WhatsApp** — Used for sharing game invites via `https://wa.me` deep links; no WhatsApp API integration.
- **SMS OTP provider** — In production we will use an Indian SMS provider (Fast2SMS/MSG91/MessageCentral); currently the app is in demo mode and displays the OTP in the UI.

### 6. Regional differences

The app is not region-locked. All text is in English. The default sport is Soccer because the admin has enabled only Soccer in **Admin Preferences**; other sports (Badminton, Cricket, etc.) are hidden until the admin toggles them on. Ground names/locations and per-player costs are configured by the moderator for each game, so content varies by group but features are consistent worldwide.

### 7. Regulated industry / protected third-party material

Turf Bookingg does not operate in a regulated industry. All content is user-generated by authenticated group members or entered by game moderators. We do not include protected third-party material.

### 8. App Review Information quick-reference

- **App name:** Turf Bookingg
- **Bundle ID:** `com.elitedev.turfbooking`
- **Apple ID:** `6795659906`
- **Privacy Policy:** `https://ground-booking-eleg.onrender.com/privacy-policy.html`
- **Support URL:** `https://ground-booking-eleg.onrender.com/support.html`
- **Contact email:** `eliteaiwin@gmail.com`
- **Demo account (regular player):** `9990000001` / `password123`
- **Demo account (admin/moderator):** `8951575798` / `password123` or `tittlejoseph@gmail.com` / `password123`

---

## How to use this file

1. Record the required screen recording on a physical iPhone using iOS Screen Recording.
2. Upload the video to a non-expiring link (YouTube unlisted, Google Drive, or App Store Connect’s media section).
3. Replace `[PASTE LINK TO SCREEN RECORDING HERE]` with the real URL.
4. Confirm the device list matches what you actually tested.
5. Paste the reply into **App Store Connect → App Review Information → Notes** and use it as the reply to the rejection.
