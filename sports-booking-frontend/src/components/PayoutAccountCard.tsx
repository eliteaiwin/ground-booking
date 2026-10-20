import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PayoutAccount {
  gateway_configured: boolean;
  upi_id: string;
  account_holder: string;
  status: string | null;
  ready: boolean;
}

const statusBadge = (a: PayoutAccount) =>
  a.ready
    ? { text: 'Active', className: 'bg-green-100 text-green-700' }
    : a.status
      ? { text: 'Being verified', className: 'bg-amber-100 text-amber-700' }
      : { text: 'Not set up', className: 'bg-gray-100 text-gray-600' };

export default function PayoutAccountCard() {
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [upiId, setUpiId] = useState('');
  const [holder, setHolder] = useState('');
  const [pan, setPan] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPayoutAccount()
      .then((a: PayoutAccount) => { setAccount(a); setUpiId(a.upi_id); setHolder(a.account_holder); })
      .catch(() => setAccount(null));
  }, []);

  if (!account || !account.gateway_configured) return null;

  const save = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      const a: PayoutAccount = await api.savePayoutAccount({ upi_id: upiId, account_holder: holder, pan });
      setAccount(a);
      setPan('');
      setMessage(a.ready ? 'Payout account is active.' : 'Saved. Cashfree is verifying it; this can take a little while.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save payout account');
    } finally {
      setSaving(false);
    }
  };

  const badge = statusBadge(account);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wallet size={18} className="text-green-600" /> Receive Payments
          <Badge className={`ml-auto text-xs ${badge.className}`}>{badge.text}</Badge>
        </CardTitle>
        <p className="text-xs text-gray-500">
          When players pay through the app for games where you are the payment receiver, your share is sent to this UPI ID automatically.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && <div className="bg-green-50 text-green-700 p-2 rounded-md text-sm">{message}</div>}
        {error && <div className="bg-red-50 text-red-600 p-2 rounded-md text-sm">{error}</div>}
        <div className="space-y-1">
          <Label htmlFor="payout-upi">UPI ID</Label>
          <Input id="payout-upi" value={upiId} placeholder="e.g. 98xxxxxx45@okhdfcbank" onChange={(e) => setUpiId(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payout-name">Name on bank account</Label>
          <Input id="payout-name" value={holder} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="payout-pan">PAN</Label>
          <Input
            id="payout-pan"
            value={pan}
            maxLength={10}
            placeholder={account.status ? 'Re-enter to update' : 'ABCDE1234F'}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
          />
          <p className="text-xs text-gray-400">Required by Cashfree for KYC. Not stored in the app.</p>
        </div>
        <Button className="w-full bg-green-600 hover:bg-green-700" onClick={save} disabled={saving || !upiId || !holder || !pan}>
          {saving ? 'Saving...' : 'Save payout account'}
        </Button>
      </CardContent>
    </Card>
  );
}
