/** App version history shown under "What's new". Add a new entry at the top for every release. */
export interface Release { version: string; date: string; changes: string[] }

export const CHANGELOG: Release[] = [
  { version: '1.37', date: '2026-10-29', changes: [
    'Game page: Edit and Delete are icons at the top right; on a completed game they ask "completed 2d ago, modify/delete it?" first',
    'Player of the Day: big card at the top removed; Rankings show gold, silver and bronze medals with profile photos (tap for profile)',
    '"Player of the Day nominations have closed" line removed',
    'Discussion is now two collapsed rows, Chat and Photos, with an unread count when there is something new',
    'Pending amount of 0 shows in grey instead of red',
    'WhatsApp status and payment reminders end with the game reference and a link that opens the game in the app',
    'Remind Unpaid via WhatsApp now shows every player with a tick (paid) or box (due) and the amount, ready to share or copy',
  ] },
  { version: '1.36', date: '2026-10-29', changes: [
    'A moderator who owes for a game now sees just one Mark as paid on their own name',
    'New app icon: the same turf with a football, bat and ball, shuttle and basketball',
    'Short pages no longer scroll on iPhone (the app was taller than the screen)',
    'The page header stays on top and shrinks to one line while you scroll, like messaging apps',
    'Tapping a notification marks it read and lowers the count',
    'If you still owe for a completed game, Payment Details opens ticked with Mark as paid by your name; once paid it stays unticked',
  ] },
  { version: '1.35', date: '2026-10-29', changes: [
    'New full-screen turf app icon (no white border)',
    'Each sport now shows the same green turf with its own equipment on top: football, bat and ball, shuttle, basketball and more',
    'Hall of Fame shows each player\'s photo; tap it to open their profile',
    'Adding a player after the game raises Max players too, so it reads 17/17, never 17/16',
    'A paid cash icon looks the same with or without the receiver tick; the tooltip says who verified it',
  ] },
  { version: '1.34', date: '2026-10-29', changes: [
    'New Payment Receiver role: each wallet belongs to an app user, who can switch to this role to see every game paying to the wallet',
    'Settle Offline: the receiver confirms each player\'s payment (Received / Not received); confirmed payments show a tick on the green cash icon',
    'Receivers can send payment reminders like moderators',
  ] },
  { version: '1.33', date: '2026-10-29', changes: [
    'New Payment Receivers page (Dashboard → Receivers): a nick name plus one or more UPI IDs or Paytm / PhonePe / Google Pay numbers, tagged to grounds',
    'Create / Edit Game: choose who players pay ("Pay to"); players see only the nick name and a wallet popup with every way to pay and copy buttons',
  ] },
  { version: '1.32', date: '2026-10-29', changes: [
    'Waiting-list players can leave a game any time, even just before or during it, with no warning or quit fee',
    'Game Log keeps the original join of players who later quit, so every quit has its join before it',
  ] },
  { version: '1.31', date: '2026-10-29', changes: [
    'When a confirmed player quits, the first waiting player takes their exact place in the list; the Log shows "X is confirmed from WL in Y\'s place"',
    'Game Log times now include seconds (e.g. 1-Jan 10:10:10 AM)',
    'Game Log for older games lists joins in the order people arrived: the first ones in the game, later ones on the waiting list',
  ] },
  { version: '1.30', date: '2026-10-29', changes: [
    'Game page: Current / Log tabs above Confirmed Players. Log shows everything that happened in the game (joins, quits, start, finish, POTD, payments and how long after the game they were paid); tap a heading to sort',
  ] },
  { version: '1.29', date: '2026-10-29', changes: [
    'Confirmed players can\'t unjoin in the last 2 hours before the game (change it in Preferences); they\'re asked to contact a moderator',
    'If a moderator removes a late quitter and nobody is waiting to take the spot, the player still pays',
  ] },
  { version: '1.28', date: '2026-10-29', changes: [
    'App fee on online payments is now 3%, shown as "App Fee (3%)" in the payment popup',
    'A player who has paid can no longer be removed or unjoin',
    'Adding or removing a player after the game warns how each player\'s share changes',
    'Players of a completed game lock 3 days after it (change the days in Preferences)',
    'Completed games without a score now have "Edit who played"',
  ] },
  { version: '1.27', date: '2026-10-28', changes: [
    'Before paying online, a popup shows where the money goes: receiver, Elizoph app fee and Cashfree fee',
    'Saving your UPI ID in Profile now also sets it up with Cashfree, so online payments reach you',
    'Online payment is offered only for India (₹) grounds; other grounds settle offline',
  ] },
  { version: '1.26', date: '2026-10-28', changes: [
    'Refer a friend (profile menu): share a link or QR code to the app on WhatsApp, or copy it',
    'Invite to this game: a link / QR code that opens the game straight away (after login) so friends can nominate themselves',
    'Admin → App Links: add the Google Play and App Store links once the apps are live; invite links then offer the install button on phones',
  ] },
  { version: '1.25', date: '2026-10-28', changes: [
    'Jerseys: Blue and Black count as the same colour, so if one team wears Blue, Black, Blue/Black or Black/White the other team picks something else (e.g. White)',
    'New jersey option "Bibs - Green or Red". The other team then can\'t pick Green or Red',
    'Discussion: tag players with @ (they get a notification), add smileys, and attach a photo or video to a message',
    'Discussion: tick "Add to today\'s game images" on a photo/video to show it in the game\'s Photos & Videos tab',
    'Discussion: full-screen view with a single header line: Back, Chat, Images, Smaller view and Close icons',
    'Admins, moderators and super admins can permanently delete any message, photo or video',
    'Admin → Chat Storage: see how much space chats and photos/videos use, and clear older ones together or one by one',
  ] },
  { version: '1.24', date: '2026-10-28', changes: [
    'Create Teams: the game page shows a short "16/16 confirmed – Create Teams" line, and the team options only open after tapping Create Teams',
    'Each team can pick a jersey colour (Blue, Green, Yellow, Red, White, Black, Blue/Black, Black/White). Two teams can never pick the same colour, and moderators can change it later',
  ] },
  { version: '1.23', date: '2026-10-28', changes: [
    'Game page: "Send Current Status" is now a button that opens a popup with the message, Share on WhatsApp, Copy and Send as In-App Notification, so the page is shorter',
  ] },
  { version: '1.22', date: '2026-10-28', changes: [
    'Create Game and Edit Game: choose "Pay through App" or "Settle Offline" with radio buttons',
    'Settle Offline: each player gets a "Mark as paid" button next to their name, before or after the game. It asks for a payment screenshot and tells the moderator',
    'Moderators can open the payment screenshot from the payment icon next to the player',
    'Pay through App: unpaid players see a Pay button instead. A moderator can switch a game between the two any time',
  ] },
  { version: '1.21', date: '2026-10-28', changes: [
    'Ground Details: picking the ground\'s Country now shows its currency right away (e.g. USA / Canada → $, United Kingdom → £)',
  ] },
  { version: '1.20', date: '2026-10-28', changes: [
    'Money shows in the currency of the ground\'s country: ₹ for India grounds, $ for US grounds, £ for UK and so on, instead of "Rs" or "$"',
    'The currency follows the ground, not the player: someone with a UK phone number playing on an India ground pays in ₹',
    'Payment screens and admin totals add up each currency separately, e.g. "−₹6,000 · −$15"',
  ] },
  { version: '1.19', date: '2026-10-27', changes: [
    'Player info popup has a Payment tab: Balance (− due / + excess), Paid, Due and average paying time, with a sortable table of Date, Owed, Paid, Balance and Done in (time after the game ended)',
    'Your own unpaid rows have a Pay button; moderators get a Settle button on other players\' rows. Each payment goes against that row\'s game',
    'Opened from a game, the Payment tab shows only that game series (e.g. only "Wed Blr united" games)',
    'My Profile → My Payments shows the same for all your games, with a Game column',
    'Settle confirms a due or excess was settled offline (Balance becomes 0); the bell sends a payment reminder',
  ] },
  { version: '1.18', date: '2026-10-26', changes: [
    'Ground Mgmt → Groups: a group can sit under a parent group (e.g. "Lobo Sun Mod" under "Lobo Mod Gang"); loops are blocked',
    'A slot allotted to a parent group covers everyone in its sub-groups; a sub-group slot covers only that sub-group',
    'Moderators tab shows each person\'s groups with their parent (e.g. "Lobo Mod Gang › Lobo Tue Mod") and the days they manage',
  ]},
  { version: '1.17', date: '2026-10-25', changes: [
    'About: tap the ⚽ icon or Profile menu → About to see Elizoph Technologies, www.elizoph.com, email and mobile (tap to mail or call)',
  ]},
  { version: '1.16', date: '2026-10-25', changes: [
    'Version number in the header; tap it to see what changed in every version',
    'My Photos: each photo keeps its own category (Profile, Soccer, Cricket, ...); uploading a sport photo no longer replaces the Profile photo',
    'Profile photo is used for small icons; the sport photo shows first in the player popup opened from that sport\'s game',
    'Tapping the (i) icon shows who nominated the player and when; tapping the photo opens player Info',
    'iPhone no longer zooms the screen in when tapping a text box',
  ]},
  { version: '1.15', date: '2026-10-24', changes: [
    'App stays clear of the iPhone notch and home bar; date boxes no longer overflow',
    'Game Defaults in Preferences: payment receiver, quit penalty, POTD window, position selection',
    'Show quit penalty switch (off by default)',
    'Pay first: off by default, moderators switch it on and pick players in Preferences',
    'Payouts need only a UPI ID',
    'Country code stored separately from the phone number',
    'Create Game: notes under collapsible Additional options',
    'Game page: Google Maps icon in the header, one-line "You are playing / nominated, WL" status with Unjoin, red quit confirmation',
    'Players see only the per-person fee',
    'Ground Mgmt: pasted Google Maps link shows the pin, details stay after save, Schedule warns about unallotted games with one-tap Allot',
    'Groups: members become moderators automatically; groups can be renamed',
    'Notifications: tap "Join now" to open the game; "Too late" when it has started',
    'User menu: full name, login phone/email and current role only',
    'Profile: phone verification by OTP, location dropdown with Other, collapsible Payment section, already-added sports hidden from Add a sport',
    'Player popup is the same everywhere; photo opens it too',
  ]},
  { version: '1.14', date: '2026-10-22', changes: [
    'Pay-first players join only after paying',
    'Past games hide Open for Nomination, Cancel and Delete',
  ]},
  { version: '1.13', date: '2026-10-20', changes: [
    'Ground allotments and moderator groups',
    'Pay online with Cashfree, Pay first badge, display name',
    'Player popup with photos, age, stats and Insights',
    'Ask Admin to add a new turf; register a ground after approval',
    'Whole-rupee amounts, payment status cash icon, green/blue (i) icon',
    'POTD points breakdown, masked phone numbers with reveal for moderators',
    'Completed games: add late or waiting-list players beyond max; cost re-split',
    'Grey avatar for players without a photo, crop profile photo, allot up to 52 weeks',
  ]},
  { version: '1.12', date: '2026-10-04', changes: [
    'Player Insights tab',
    'Grounds: location pin, owner contact, amenities, nearby search, public ground page, owner self-registration',
    'Pickleball, Lawn Tennis and Swimming; soccer pitch splits with clash checks; Ground Managers',
  ]},
  { version: '1.11', date: '2026-09-25', changes: [
    'Moved hosting to Fly.io; admin data backup',
    'Login codes by SMS (Twilio) and email; passwordless login',
    'Sign in with Apple',
  ]},
  { version: '1.10', date: '2026-08-24', changes: [
    'Edit completed games: roster, teams, score, goals and own goals',
    'Android app build',
    'Renamed to Elite Turf Booking',
  ]},
  { version: '1.09', date: '2026-08-04', changes: [
    'New icon and login screen, first-time profile setup',
    'No overlapping games on the same ground',
    'Game series with combined POTD and win/loss streaks',
    'Delete draft or cancelled games; payments on/off switch',
    'Add players while creating a game or anytime from the game page',
    'Sport on/off switch, max-player cap, player profile popup, notes, cost recalculation',
  ]},
  { version: '1.08', date: '2026-07-14', changes: [
    'Choose who played when completing a game; per-person cost split',
    'iPhone app',
    'Import users from a WhatsApp group',
  ]},
  { version: '1.07', date: '2026-04-22', changes: [
    'Admin can disable users; moderators can block users per ground',
    'Delete account (90-day recovery)',
    'Renamed to Turf Booking',
  ]},
  { version: '1.06', date: '2026-04-03', changes: [
    'Ground photos with a main photo',
    'Multiple profile photos with sport categories',
  ]},
  { version: '1.05', date: '2026-03-31', changes: [
    'Google login',
    'Sports and positions in profile',
    'Admin user management, forgot password',
    'Add grounds with moderators; role colour themes; welcome page',
  ]},
  { version: '1.04', date: '2026-03-29', changes: [
    'Soccer score and goal scorers',
    'Five roles, schedule chart, ranked POTD voting, Hall of Fame',
    'Unique IDs, profile picture, player persona, join requests',
    'Nomination limit, notification settings (vacation mode, alerts)',
    'iPhone and Android app support',
  ]},
  { version: '1.03', date: '2026-03-20', changes: [
    'Switch between accounts',
    'Discussion board, Player of the Day, auto-archive of old games',
  ]},
  { version: '1.02', date: '2026-03-19', changes: [
    'Edit and cancel games with refunds',
    'Game search',
  ]},
  { version: '1.01', date: '2026-03-14', changes: [
    'Separate test and live sites',
  ]},
  { version: '1.00', date: '2026-03-11', changes: [
    'First release: grounds, games, nominations, waiting list, payments and POTD voting',
  ]},
];

export const APP_VERSION = CHANGELOG[0].version;
