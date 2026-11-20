import { useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { api } from '../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Session = { id: number; since: string; user: { id: number; name: string; phone: string } };

/** Profile: people currently impersonating me, with Log off. */
export default function ImpersonatedBy() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const load = () => api.impersonationSessions().then(setSessions).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <Card data-testid="impersonated-by">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><UserCheck size={18} className="text-blue-600" /> Who has impersonated me</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!sessions.length && <p className="text-sm text-gray-500">Nobody is signed in as you.</p>}
        {sessions.map(s => (
          <div key={s.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{s.user.name}</p>
              <p className="text-xs text-gray-500">since {new Date(`${s.since.replace(' ', 'T')}Z`).toLocaleString()}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => api.revokeImpersonation(s.id).then(load)}>Log off</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
