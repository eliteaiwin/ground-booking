import { Capacitor } from '@capacitor/core';

const PUBLIC_APP_URL = 'https://elite-turf-booking.fly.dev';
const PENDING_KEY = 'pending_join_game';

/** Shareable link; opens the game (after login) when gameId is given. */
export function inviteUrl(refUserId?: number, gameId?: number): string {
  const base = Capacitor.isNativePlatform() ? PUBLIC_APP_URL : window.location.origin;
  const qs = new URLSearchParams();
  if (gameId) qs.set('join', String(gameId));
  if (refUserId) qs.set('ref', String(refUserId));
  const q = qs.toString();
  return `${base}/${q ? `?${q}` : ''}`;
}

/** Reads ?join= / ?ref= from the opened link, remembers the game and cleans the address bar. */
export function captureInviteFromUrl(): boolean {
  const params = new URLSearchParams(window.location.search);
  const join = params.get('join');
  const ref = params.get('ref');
  if (!join && !ref) return false;
  if (join && /^\d+$/.test(join)) localStorage.setItem(PENDING_KEY, join);
  if (ref && /^\d+$/.test(ref)) localStorage.setItem('referred_by', ref);
  params.delete('join');
  params.delete('ref');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  return true;
}

export function takePendingJoinGame(): number | null {
  const v = localStorage.getItem(PENDING_KEY);
  if (!v) return null;
  localStorage.removeItem(PENDING_KEY);
  return Number(v) || null;
}

export function mobilePlatform(): 'android' | 'ios' | null {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return null;
}
