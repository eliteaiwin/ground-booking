import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ExternalLink, LocateFixed, MapPin, Plus, X } from 'lucide-react';
import { ALL_SPORTS, sportLabel } from '@/lib/sports';
import {
  AMENITIES, AMENITY_STATUS_LABELS, EMPTY_SPORT_DETAIL, PRICED_STATUSES, getCurrentPosition, mapEmbedUrl, sportConfig,
  type AmenityMeta, type AmenityStatus, type AmenityValue, type GroundDetailsInput, type SportDetail,
} from '@/lib/grounds';

interface Props {
  initial: GroundDetailsInput;
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: GroundDetailsInput) => void;
}

const SELECTABLE_STATUSES: AmenityStatus[] = ['free', 'paid', 'rent', 'buy', 'rent_buy', 'no'];

function AmenityRows({ items, values, onChange }: {
  items: AmenityMeta[];
  values: Record<string, AmenityValue>;
  onChange: (next: Record<string, AmenityValue>) => void;
}) {
  const setStatus = (key: string, status: string) => {
    const next = { ...values };
    if (!status) delete next[key];
    else next[key] = { status: status as AmenityStatus, price: next[key]?.price || '' };
    onChange(next);
  };
  return (
    <div className="space-y-1">
      {items.map(a => {
        const value = values[a.key];
        return (
          <div key={a.key} className="flex items-center gap-2">
            <span className="w-6 text-center">{a.emoji}</span>
            <span className="flex-1 text-sm text-gray-700 truncate">{a.label}</span>
            {value && PRICED_STATUSES.includes(value.status) && (
              <Input className="h-8 w-20 text-xs" placeholder="Price" value={value.price}
                onChange={e => onChange({ ...values, [a.key]: { ...value, price: e.target.value } })} />
            )}
            <select
              aria-label={a.label}
              className="h-8 rounded-md border border-input bg-white px-1 text-xs w-28"
              value={value?.status || ''}
              onChange={e => setStatus(a.key, e.target.value)}
            >
              <option value="">—</option>
              {SELECTABLE_STATUSES.map(st => <option key={st} value={st}>{AMENITY_STATUS_LABELS[st]}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function SportDetailEditor({ sport, detail, onChange }: { sport: string; detail: SportDetail; onChange: (d: SportDetail) => void }) {
  const cfg = sportConfig(sport);
  const set = <K extends keyof SportDetail>(key: K, value: SportDetail[K]) => onChange({ ...detail, [key]: value });
  const setPitch = (i: number, patch: Partial<SportDetail['pitches'][number]>) =>
    set('pitches', detail.pitches.map((p, idx) => idx === i ? { ...p, ...patch } : p));
  return (
    <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Timing</Label>
          <Input placeholder="e.g. 6 AM - 11 PM" value={detail.timing} onChange={e => set('timing', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cost</Label>
          <Input placeholder="e.g. Rs 1500/hr" value={detail.price} onChange={e => set('price', e.target.value)} />
        </div>
        {cfg.surfaces.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">{cfg.surfaceLabel}</Label>
            <select aria-label={cfg.surfaceLabel} className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
              value={detail.surface} onChange={e => set('surface', e.target.value)}>
              <option value="">—</option>
              {cfg.surfaces.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">{cfg.sizeLabel}</Label>
          <Input placeholder={cfg.sizePlaceholder} value={detail.size} onChange={e => set('size', e.target.value)} />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">Equipment & services</p>
        <AmenityRows items={cfg.items} values={detail.items} onChange={items => set('items', items)} />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-500">{cfg.pitchLabel} <span className="font-normal">(moderators pick one when creating a game)</span></p>
        {detail.pitches.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="h-8 text-sm flex-1" placeholder="Format, e.g. 5-a-side" value={p.format} onChange={e => setPitch(i, { format: e.target.value })} />
            <span className="text-xs text-gray-500">×</span>
            <Input className="h-8 w-16 text-sm" type="number" min={1} max={20} value={p.count}
              onChange={e => setPitch(i, { count: Math.max(1, parseInt(e.target.value) || 1) })} />
            <button type="button" aria-label="Remove" className="p-1 text-gray-400 hover:text-red-600"
              onClick={() => set('pitches', detail.pitches.filter((_, idx) => idx !== i))}><X size={14} /></button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => set('pitches', [...detail.pitches, { format: '', count: 1 }])}><Plus size={12} className="mr-1" /> Add</Button>
          {detail.pitches.length === 0 && cfg.defaultPitches.length > 0 && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => set('pitches', cfg.defaultPitches)}>
              Use {cfg.defaultPitches.map(p => `${p.format} ×${p.count}`).join(', ')}
            </Button>
          )}
        </div>
        {detail.pitches.length > 1 && (
          <p className="text-[11px] text-gray-500">All formats share the same space: e.g. while one 5-a-side pitch is booked, 9-a-side (whole ground) can't be booked.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-500">Contact for {sportLabel(sport)} (optional)</p>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Name" value={detail.contact_name} onChange={e => set('contact_name', e.target.value)} />
          <Input placeholder="Phone" inputMode="tel" value={detail.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
        </div>
      </div>
      <Textarea rows={2} placeholder="Notes, e.g. rules, booking advance, age groups" value={detail.notes} onChange={e => set('notes', e.target.value)} />
    </div>
  );
}

export default function GroundDetailsForm({ initial, submitLabel, saving, onSubmit }: Props) {
  const [values, setValues] = useState<GroundDetailsInput>(initial);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [activeSport, setActiveSport] = useState(initial.sports[0] || '');

  const set = <K extends keyof GroundDetailsInput>(key: K, value: GroundDetailsInput[K]) =>
    setValues(prev => ({ ...prev, [key]: value }));

  const useMyLocation = async () => {
    setLocating(true);
    setLocationError('');
    try {
      const pos = await getCurrentPosition();
      setValues(prev => ({ ...prev, latitude: Number(pos.lat.toFixed(6)), longitude: Number(pos.lng.toFixed(6)) }));
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Could not get location');
    } finally {
      setLocating(false);
    }
  };

  const toggleSport = (key: string) => {
    const removing = values.sports.includes(key);
    set('sports', removing ? values.sports.filter(x => x !== key) : [...values.sports, key]);
    if (!removing) setActiveSport(key);
    else if (activeSport === key) setActiveSport(values.sports.find(x => x !== key) || '');
  };

  const sportDetail = (sport: string): SportDetail => ({ ...EMPTY_SPORT_DETAIL, ...values.sport_details[sport] });
  const setSportDetail = (sport: string, detail: SportDetail) =>
    set('sport_details', { ...values.sport_details, [sport]: detail });

  const submit = () => {
    const sport_details: Record<string, SportDetail> = {};
    for (const sport of values.sports) {
      const d = sportDetail(sport);
      sport_details[sport] = { ...d, pitches: d.pitches.filter(p => p.format.trim()).map(p => ({ format: p.format.trim(), count: p.count })) };
    }
    onSubmit({ ...values, sport_details });
  };

  const handleMapsUrl = (url: string) => {
    setValues(prev => ({ ...prev, maps_url: url, latitude: url !== prev.maps_url ? null : prev.latitude, longitude: url !== prev.maps_url ? null : prev.longitude }));
  };

  const hasPin = values.latitude != null && values.longitude != null;

  return (
    <form
      className="space-y-5"
      onSubmit={e => { e.preventDefault(); submit(); }}
    >
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1"><MapPin size={14} /> Location</h3>
        <Button type="button" variant="outline" className="w-full" onClick={useMyLocation} disabled={locating}>
          <LocateFixed size={16} className="mr-2 text-blue-600" />
          {locating ? 'Getting location...' : hasPin ? 'Move pin to my current location' : 'Save my current location as pin'}
        </Button>
        {locationError && <p className="text-xs text-red-600">{locationError}</p>}
        {hasPin && (
          <div className="rounded-lg overflow-hidden border">
            <iframe title="Ground location" src={mapEmbedUrl(values.latitude!, values.longitude!)} className="w-full h-40 border-0" loading="lazy" />
            <div className="flex items-center justify-between px-2 py-1 text-xs text-gray-500 bg-gray-50">
              <span>{values.latitude}, {values.longitude}</span>
              <a className="text-blue-600 flex items-center gap-1" target="_blank" rel="noreferrer"
                href={`https://www.google.com/maps/search/?api=1&query=${values.latitude},${values.longitude}`}>
                Open in Google Maps <ExternalLink size={10} />
              </a>
            </div>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Or paste a Google Maps link</Label>
          <Input placeholder="https://maps.app.goo.gl/..." value={values.maps_url} onChange={e => handleMapsUrl(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Address</Label>
          <Textarea rows={2} placeholder="Street, area, city" value={values.address} onChange={e => set('address', e.target.value)} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Owner contact</h3>
        <Input placeholder="Owner name" value={values.owner_name} onChange={e => set('owner_name', e.target.value)} />
        <Input placeholder="Owner phone" inputMode="tel" value={values.owner_phone} onChange={e => set('owner_phone', e.target.value)} />
        <Input placeholder="Owner email" type="email" value={values.owner_email} onChange={e => set('owner_email', e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={values.contact_public} onChange={e => set('contact_public', e.target.checked)} />
          Show owner contact to all players
        </label>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Venue</h3>
        <Input placeholder="Opening hours, e.g. 6 AM - 11 PM" value={values.opening_hours} onChange={e => set('opening_hours', e.target.value)} />
        <Textarea rows={2} placeholder="About the venue" value={values.description} onChange={e => set('description', e.target.value)} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Sports played here</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_SPORTS.map(sp => (
            <button type="button" key={sp.key} onClick={() => toggleSport(sp.key)}
              className={`px-3 py-1 rounded-full border text-sm ${values.sports.includes(sp.key) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700'}`}>
              {sp.emoji} {sp.label}
            </button>
          ))}
        </div>
        {values.sports.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-gray-500">Details for each sport — timing, cost, equipment and contact:</p>
            <div className="flex gap-1 overflow-x-auto border-b">
              {values.sports.map(sport => (
                <button type="button" key={sport} onClick={() => setActiveSport(sport)}
                  className={`shrink-0 px-3 py-1.5 text-sm border-b-2 -mb-px ${activeSport === sport ? 'border-green-600 text-green-700 font-medium' : 'border-transparent text-gray-500'}`}>
                  {ALL_SPORTS.find(x => x.key === sport)?.emoji} {sportLabel(sport)}
                </button>
              ))}
            </div>
            {activeSport && values.sports.includes(activeSport) && (
              <SportDetailEditor key={activeSport} sport={activeSport} detail={sportDetail(activeSport)}
                onChange={d => setSportDetail(activeSport, d)} />
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Facilities</h3>
        <AmenityRows items={AMENITIES} values={values.amenities} onChange={a => set('amenities', a)} />
        <div className="space-y-1">
          <Label className="text-xs">Anything else?</Label>
          <Input placeholder="e.g. Kids play area, umbrella rental" value={values.amenities_other} onChange={e => set('amenities_other', e.target.value)} />
        </div>
      </section>

      <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={saving}>
        {saving ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}
