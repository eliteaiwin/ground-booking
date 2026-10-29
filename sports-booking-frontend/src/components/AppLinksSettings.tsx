import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function AppLinksSettings() {
  const [play, setPlay] = useState('');
  const [apple, setApple] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api.getAppLinks().then((l: { play_store_url: string; app_store_url: string }) => { setPlay(l.play_store_url); setApple(l.app_store_url); }).catch(() => undefined);
  }, []);
  const save = async () => {
    try {
      await api.updateAppLinks({ play_store_url: play, app_store_url: apple });
      setMsg('Saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  };
  return (
    <Card data-testid="app-links">
      <CardHeader className="pb-2"><CardTitle className="text-base">App store links</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-500">Used by invite links and QR codes. People opening an invite on a phone browser get a button to install the app. Leave blank until the apps are live.</p>
        <div className="space-y-1">
          <label className="text-sm font-medium">Google Play link</label>
          <Input value={play} onChange={e => setPlay(e.target.value)} placeholder="https://play.google.com/store/apps/details?id=com.elitedev.turfbooking" />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">App Store link</label>
          <Input value={apple} onChange={e => setApple(e.target.value)} placeholder="https://apps.apple.com/app/id..." />
        </div>
        <Button onClick={save} className="w-full">Save</Button>
        {msg && <p className="text-xs text-gray-600">{msg}</p>}
      </CardContent>
    </Card>
  );
}
