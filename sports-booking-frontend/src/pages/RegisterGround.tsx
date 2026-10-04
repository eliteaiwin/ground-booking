import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../services/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Building } from 'lucide-react';
import GroundDetailsForm from '@/components/grounds/GroundDetailsForm';
import { EMPTY_GROUND_DETAILS, type GroundDetailsInput } from '@/lib/grounds';

interface Props {
  onBack: () => void;
}

interface Registration {
  id: number;
  display_name: string;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string;
}

const STATUS_STYLE: Record<Registration['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};

export default function RegisterGround({ onBack }: Props) {
  const { user } = useAuth();
  const { activeTheme } = useTheme();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formKey, setFormKey] = useState(0);

  const loadRegistrations = () => api.myGroundRegistrations().then(setRegistrations).catch(console.error);

  useEffect(() => {
    api.listLocations().then(setLocations).catch(console.error);
    loadRegistrations();
  }, []);

  const initial: GroundDetailsInput = {
    ...EMPTY_GROUND_DETAILS,
    owner_name: user?.name || '',
    owner_phone: user?.phone || '',
    owner_email: user?.email || '',
  };

  const submit = async (values: GroundDetailsInput) => {
    setError('');
    setSuccess('');
    if (!name.trim() || !location.trim()) { setError('Ground name and area are required'); return; }
    if (!values.owner_phone.trim()) { setError('Owner phone is required'); return; }
    setSaving(true);
    try {
      const res = await api.registerGround({ ...values, name: name.trim(), location: location.trim() });
      setSuccess(res.message);
      setName('');
      setFormKey(k => k + 1);
      loadRegistrations();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register ground');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="text-white" style={{ backgroundColor: activeTheme.header_bg }}>
        <div className="max-w-2xl mx-auto px-4 py-3">
          <button onClick={onBack} className="flex items-center gap-1 text-sm mb-2 hover:underline"><ArrowLeft size={16} /> Back</button>
          <h1 className="text-xl font-bold flex items-center gap-2"><Building size={20} /> Register your ground</h1>
          <p className="text-sm opacity-80 mt-1">Own a ground? List it so players nearby can find it. After admin approval you become its Ground Manager.</p>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {success && <div className="bg-green-50 text-green-700 p-3 rounded-md text-sm">{success}</div>}
        {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
        {registrations.length > 0 && (
          <Card><CardContent className="p-3 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700">Your grounds</h3>
            {registrations.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="truncate">{r.display_name}</span>
                <Badge className={STATUS_STYLE[r.status]}>{r.status === 'pending' ? 'Awaiting approval' : r.status === 'approved' ? 'Approved' : 'Not approved'}</Badge>
              </div>
            ))}
            {registrations.filter(r => r.rejection_reason).map(r => (
              <p key={r.id} className="text-xs text-red-600">{r.display_name}: {r.rejection_reason}</p>
            ))}
          </CardContent></Card>
        )}
        <Card><CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Ground name</Label>
              <Input placeholder="e.g. Kickoff Turf" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Area / city</Label>
              <Input list="ground-areas" placeholder="e.g. Whitefield" value={location} onChange={e => setLocation(e.target.value)} />
              <datalist id="ground-areas">{locations.map(l => <option key={l.id} value={l.name} />)}</datalist>
            </div>
          </div>
          <GroundDetailsForm key={formKey} initial={initial} submitLabel="Submit for approval" saving={saving} onSubmit={submit} />
        </CardContent></Card>
      </div>
    </div>
  );
}
