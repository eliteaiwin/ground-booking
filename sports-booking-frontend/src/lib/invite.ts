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

export interface AppLinks { play_store_url: string; app_store_url: string }

/** "Install the app" message; adds the game link only when gameUrl is given. */
export function installMessage(links: AppLinks | null, signUpUrl: string, gameUrl?: string): string {
  let msg = 'Join me on Elite Turf Booking to book and play games.\n';
  if (links?.play_store_url) msg += `\nAndroid: ${links.play_store_url}`;
  if (links?.app_store_url) msg += `\niPhone: ${links.app_store_url}`;
  if (gameUrl) msg += `\n${links?.play_store_url || links?.app_store_url ? 'Then join this game' : 'Open the app and join this game'}: ${gameUrl}`;
  else msg += `\n${links?.play_store_url || links?.app_store_url ? 'Or open in browser' : 'Open the app'}: ${signUpUrl}`;
  return msg;
}
