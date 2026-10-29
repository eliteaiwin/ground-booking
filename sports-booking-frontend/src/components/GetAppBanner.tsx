import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from '../services/api';
import { mobilePlatform } from '@/lib/invite';
import { X } from 'lucide-react';

/** Shown on phones' browsers after opening an invite link, once store links are set in Admin → App Links. */
export function GetAppBanner() {
  const [links, setLinks] = useState<{ play_store_url: string; app_store_url: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  const platform = mobilePlatform();
  useEffect(() => {
    if (Capacitor.isNativePlatform() || !platform) return;
    api.getAppLinks().then(setLinks).catch(() => undefined);
  }, [platform]);
  const href = platform === 'android' ? links?.play_store_url : platform === 'ios' ? links?.app_store_url : '';
  if (hidden || !href) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-green-700 text-white px-3 py-2 flex items-center gap-2 text-sm" data-testid="get-app-banner">
      <span className="flex-1">Get the Elite Turf Booking app</span>
      <a href={href} className="bg-white text-green-800 font-semibold rounded px-3 py-1">{platform === 'ios' ? 'App Store' : 'Google Play'}</a>
      <button type="button" aria-label="Continue in browser" onClick={() => setHidden(true)}><X size={16} /></button>
    </div>
  );
}
