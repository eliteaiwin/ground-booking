App Review reply for Elite Turf Booking (iOS) — Guidelines 4.8 and 2.1

Thank you for reviewing Elite Turf Booking. We have addressed both issues in the new build.

Guideline 4.8 – Login Services
The new build adds Sign in with Apple as a login option on the login screen (shown above Google Sign-In). It requests only name and email, supports Hide My Email, and does not collect interactions for advertising. Sign in with Apple, Google Sign-In, phone OTP (SMS) and email OTP are all available; there are no passwords.

Guideline 2.1 – Information Needed

1. Screen recordings (made on a physical iPhone 13 Pro Max)
- Recording 1 (attached, 28 s): the app opened from TestFlight, then Sign in with Apple with Face ID. The Apple sheet offers Share My Email and Hide My Email. The user lands on the Dashboard with no errors.
- Recording 2 (attached): [launch from the Home Screen, Login with OTP using demo phone 9990000001 and code 246810, Dashboard, open and join a game, game detail (teams, payments, discussion), Profile, Profile > Delete Account (cancel at the confirmation step)]
The app requests no sensitive permissions (no location, camera, contacts or tracking). There are no purchases or subscriptions.

2. Devices and operating systems tested
- iPhone 13 Pro Max, iOS 26.7.2

3. App purpose and target audience
Elite Turf Booking organizes amateur turf/sports games (soccer by default) for groups of players in India. Moderators schedule games at a ground, players confirm attendance, teams are split, ground costs are shared and tracked, and players vote Player of the Day. Rankings are recalculated after each game. Target audience: adult amateur players and their game organizers. The app is free with no in-app purchases or paid content.

4. Setting up and accessing main features
The app has no passwords: choose Login with OTP, enter a phone number, and enter the 6-digit code (a new number gets an account automatically). For review, these demo accounts accept the fixed code 246810 instead of a real SMS:
- Regular player: phone 9990000001, code 246810
- Moderator: phone 9990000002, code 246810
Or use Sign in with Apple / Google / email OTP to create a new account.
After login the Dashboard lists games. Tap a game to join, view teams, payments, and discussion. Moderators can create games, edit results, and mark payments. Profile contains Edit Profile and Delete Account.

5. External services, tools and platforms
- Fly.io – hosts the FastAPI + SQLite backend (https://elite-turf-booking.fly.dev)
- Sign in with Apple – authentication
- Google Identity Services – authentication
- Twilio Verify – SMS one-time passcodes for login
- Twilio SendGrid – email one-time passcodes for login
- Codemagic – CI/CD, iOS/Android builds
- WhatsApp (wa.me links) – sharing game invites
- Cashfree Payments – integrated but disabled; payments are recorded offline by the moderator
No AI services or advertising SDKs are used.

6. Regional differences
None. The app functions identically in all regions. English only. Content (grounds, costs, schedules) is set by each group's moderator.

7. Regulated industry / protected third-party material
Not applicable.

Account deletion
Profile > Delete Account inside the app. Data is retained for a 90-day grace period, then personal identifiers are permanently removed. Public page: https://elite-turf-booking.fly.dev/#delete-account

Support: https://elite-turf-booking.fly.dev/support.html
Privacy: https://elite-turf-booking.fly.dev/privacy-policy.html
Contact: eliteaiwin@gmail.com
