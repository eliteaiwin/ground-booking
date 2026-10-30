import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { api } from '../services/api';

const TOKEN_KEY = 'push_token';

export interface PushTarget {
  gameId: number;
  open: string;
}

let started = false;

/** Ask for permission, register this phone's token with the server and route taps on a push. */
export async function initPush(onOpen: (target: PushTarget) => void) {
  if (!Capacitor.isNativePlatform()) return;
  if (!started) {
    started = true;
    await FirebaseMessaging.addListener('notificationActionPerformed', e => {
      const data = (e.notification.data ?? {}) as Record<string, string>;
      const gameId = Number(data.game_id);
      if (gameId) onOpen({ gameId, open: data.open ?? '' });
    });
  }
  try {
    const perm = await FirebaseMessaging.requestPermissions();
    if (perm.receive !== 'granted') return;
    if (Capacitor.getPlatform() === 'android') {
      await FirebaseMessaging.createChannel({
        id: 'voting', name: 'Game voting', description: 'A new game is open to join',
        importance: 5, sound: 'whistle', vibration: true, visibility: 1,
      });
      await FirebaseMessaging.createChannel({
        id: 'payment', name: 'Payment reminders', description: 'Payment due for a game',
        importance: 3, sound: 'coin', vibration: false, visibility: 1,
      });
    }
    const { token } = await FirebaseMessaging.getToken();
    if (!token) return;
    await api.registerPushToken(token, Capacitor.getPlatform());
    localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.warn('Push setup failed', err);
  }
}

/** Stop pushes to this phone for the account that is logging out. */
export async function stopPush() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  localStorage.removeItem(TOKEN_KEY);
  try {
    await api.unregisterPushToken(token);
  } catch {
    // signed-out or offline: the server drops dead tokens on the next send
  }
}
