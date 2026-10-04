import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ExternalLink, LocateFixed, MapPin } from 'lucide-react';
import { ALL_SPORTS } from '@/lib/sports';
import {
  AMENITY_GROUPS, AMENITY_STATUS_LABELS, PRICED_STATUSES, amenitiesForSports, getCurrentPosition, mapEmbedUrl,
  type AmenityStatus, type GroundDetailsInput,
} from '@/lib/grounds';

interface Props {
  initial: GroundDetailsInput;
  submitLabel: string;
  saving: boolean;
  onSubmit: (values: GroundDetailsInput) => void;
}

const SELECTABLE_STATUSES: AmenityStatus[] = ['free', 'paid', 'rent', 'buy', 'rent_buy', 'no'];

export default function GroundDetailsForm({ initial, submitLabel, saving, onSubmit }: Props) {
  const [values, setValues] = useState<GroundDetailsInput>(initial);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

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

  const toggleSport = (key: string) =>
    set('sports', values.sports.includes(key) ? values.sports.filter(s => s !== key) : [...values.sports, key]);

  const setAmenityStatus = (key: string, status: string) => {
    const next = { ...values.amenities };
    if (!status) delete next[key];
    else next[key] = { status: status as AmenityStatus, price: next[key]?.price || '' };
    set('amenities', next);
  };

  const setAmenityPrice = (key: string, price: string) =>
    set('amenities', { ...values.amenities, [key]: { ...values.amenities[key], price } });

  const toggleSurface = (key: string) => setAmenityStatus(key, values.amenities[key] ? '' : 'free');

  const handleMapsUrl = (url: string) => {
    setValues(prev => ({ ...prev, maps_url: url, latitude: url !== prev.maps_url ? null : prev.latitude, longitude: url !== prev.maps_url ? null : prev.longitude }));
  };

  const amenities = amenitiesForSports(values.sports);
  const hasPin = values.latitude != null && values.longitude != null;

  return (
    <form
      className="space-y-5"
      onSubmit={e => { e.preventDefault(); onSubmit(values); }}
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
        <h3 className="text-sm font-semibold text-gray-700">Sports played here</h3>
        <div className="flex flex-wrap gap-2">
          {ALL_SPORTS.map(s => (
            <button type="button" key={s.key} onClick={() => toggleSport(s.key)}
              className={`px-3 py-1 rounded-full border text-sm ${values.sports.includes(s.key) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700'}`}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-700">Timings & price</h3>
        <Input placeholder="Opening hours, e.g. 6 AM - 11 PM" value={values.opening_hours} onChange={e => set('opening_hours', e.target.value)} />
        <Input placeholder="Price, e.g. Rs 1500/hr weekdays" value={values.price_info} onChange={e => set('price_info', e.target.value)} />
        <Textarea rows={2} placeholder="About the ground (size, format, rules...)" value={values.description} onChange={e => set('description', e.target.value)} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Amenities</h3>
        {AMENITY_GROUPS.map(group => {
          const items = amenities.filter(a => a.group === group.key);
          if (items.length === 0) return null;
          if (group.key === 'surface') {
            return (
              <div key={group.key}>
                <p className="text-xs font-medium text-gray-500 mb-1">{group.label}</p>
                <div className="flex flex-wrap gap-2">
                  {items.map(a => (
                    <button type="button" key={a.key} onClick={() => toggleSurface(a.key)}
                      className={`px-2 py-1 rounded-full border text-xs ${values.amenities[a.key] ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white text-gray-600'}`}>
                      {a.emoji} {a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div key={group.key}>
              <p className="text-xs font-medium text-gray-500 mb-1">{group.label}</p>
              <div className="space-y-1">
                {items.map(a => {
                  const value = values.amenities[a.key];
                  return (
                    <div key={a.key} className="flex items-center gap-2">
                      <span className="w-6 text-center">{a.emoji}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{a.label}</span>
                      {value && PRICED_STATUSES.includes(value.status) && (
                        <Input className="h-8 w-20 text-xs" placeholder="Price" value={value.price} onChange={e => setAmenityPrice(a.key, e.target.value)} />
                      )}
                      <select
                        aria-label={a.label}
                        className="h-8 rounded-md border border-input bg-white px-1 text-xs w-28"
                        value={value?.status || ''}
                        onChange={e => setAmenityStatus(a.key, e.target.value)}
                      >
                        <option value="">—</option>
                        {SELECTABLE_STATUSES.map(s => <option key={s} value={s}>{AMENITY_STATUS_LABELS[s]}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
