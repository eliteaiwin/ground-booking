/** App version history shown under "What's new". Add a new entry at the top for every release. */
export interface Release { version: string; date: string; changes: string[] }

export const CHANGELOG: Release[] = [
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
