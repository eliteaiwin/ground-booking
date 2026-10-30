import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sportLabel } from '@/lib/sports';
import { PersonSearch } from '@/components/PersonSearch';
import { formatMoney, currencySymbol } from '@/lib/currency';

const SLOT_MINUTES = 30;
const SLOT_PX = 22;
const SLOTS_PER_DAY = 1440 / SLOT_MINUTES;

export interface ModeratorGroupRef { id: number; name: string; members: unknown[] }

interface Pitch { number: number; letter: string; label: string; units: number[] }
interface Layout { format: string; count: number; pitches: Pitch[] }
interface OccupancyItem {
  kind: 'allotment' | 'game';
  id: number;
  units: number[];
  start_minute: number;
  end_minute: number;
  start: string;
  end: string;
  pitch_label: string;
  holder: string;
  title?: string;
  status?: string;
  rent?: number;
  rent_paid?: boolean;
  series_key?: string | null;
  allotment_id?: number | null;
}
interface Occupancy { units: number; layouts: Layout[]; items: OccupancyItem[]; can_manage: boolean }
interface Draft {
  number: number; label: string; start: string; duration: string;
  target: string; rent: string; repeat: string; notes: string;
  until: string; weekdays: number[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function minutesToTime(m: number) {
  const r = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
}

function overlaps(item: OccupancyItem, units: number[], start: number, end: number) {
  return item.start_minute < end && item.end_minute > start && item.units.some((u) => units.includes(u));
}

export default function AllotmentSheet({ groundId, groups, date: dateProp, onDateChange, newDraft = 0, onDraftOpened, onChanged }: {
  groundId: number; groups: ModeratorGroupRef[]; date?: string; onDateChange?: (d: string) => void;
  newDraft?: number; onDraftOpened?: () => void; onChanged?: () => void;
}) {
  const [sports, setSports] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sport, setSport] = useState('');
  const [ownDate, setOwnDate] = useState(todayIso());
  const date = dateProp ?? ownDate;
  const setDate = onDateChange ?? setOwnDate;
  const [format, setFormat] = useState('');
  const [occ, setOcc] = useState<Occupancy | null>(null);
  const [moderators, setModerators] = useState<{ user_id: number; user_name: string }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<OccupancyItem | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currency, setCurrency] = useState('₹');

  useEffect(() => {
    api.getGroundDetails(groundId)
      .then((d: { sports: string[]; sport_types?: string[]; currency?: string }) => {
        setCurrency(currencySymbol(d.currency));
        const list = d.sports.length ? d.sports : (d.sport_types || []);
        setSports(list); setSport(list[0] || '');
      })
      .catch(() => setSports([]))
      .finally(() => setLoaded(true));
    api.listGroundModerators(groundId)
      .then((mods: { user_id: number; user_name: string }[]) => {
        const seen = new Set<number>();
        setModerators(mods.filter((m) => !seen.has(m.user_id) && !!seen.add(m.user_id)));
      })
      .catch(() => setModerators([]));
  }, [groundId]);

  const reload = () => {
    if (!sport) return;
    api.getGroundOccupancy(groundId, date, sport)
      .then((o: Occupancy) => setOcc(o))
      .catch((e: Error) => setError(e.message));
  };
  useEffect(reload, [groundId, date, sport]);

  useEffect(() => {
    if (!occ) return;
    setFormat((f) => (occ.layouts.some((l) => l.format === f) ? f : occ.layouts[0]?.format || ''));
  }, [occ]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 34 * SLOT_PX;
  }, [sport]);

  const totalUnits = occ?.units || 1;
  const pitches = useMemo<Pitch[]>(() => {
    const layout = occ?.layouts.find((l) => l.format === format);
    return layout
      ? layout.pitches
      : [{ number: 0, letter: '', label: 'Whole ground', units: Array.from({ length: totalUnits }, (_, i) => i) }];
  }, [occ, format, totalUnits]);
  const blocks = (occ?.items || []).filter((i) => i.kind === 'allotment' || !i.allotment_id);
  const canManage = occ?.can_manage ?? false;

  const openDraft = (number: number, label: string, startMinute: number) => {
    setSelected(null); setInfo(''); setError('');
    setDraft({ number, label, start: minutesToTime(startMinute), duration: '60', target: '', rent: '', repeat: '1', notes: '', until: addDays(date, 6), weekdays: [0, 1, 2, 3, 4, 5, 6] });
  };

  useEffect(() => {
    if (!newDraft || !occ || !pitches.length) return;
    openDraft(pitches[0].number, pitches[0].label, 18 * 60);
    onDraftOpened?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newDraft, occ, pitches]);

  useEffect(() => {
    if (draft && pitches.length && !pitches.some((p) => p.number === draft.number)) {
      setDraft({ ...draft, number: pitches[0].number, label: pitches[0].label });
    }
  }, [draft, pitches]);

  const confirm = async () => {
    if (!draft || !draft.target) { setError('Choose a moderator or a moderator group'); return; }
    setSaving(true); setError('');
    const [kind, id] = draft.target.split(':');
    try {
      const res = await api.createAllotment(groundId, {
        sport_type: sport,
        pitch_format: format,
        pitch_number: draft.number,
        allot_date: date,
        start_time: draft.start,
        duration_minutes: parseInt(draft.duration) || 60,
        ...(kind === 'g' ? { moderator_group_id: Number(id) } : { moderator_user_id: Number(id) }),
        rent: parseFloat(draft.rent) || 0,
        notes: draft.notes,
        ...(draft.repeat === 'range'
          ? { until_date: draft.until, weekdays: draft.weekdays }
          : { repeat_weeks: parseInt(draft.repeat) || 1 }),
      });
      const skipped = (res.skipped as { date: string; reason: string }[]).map((s) => `${s.date}: ${s.reason}`).join('\n');
      setInfo(`Allotted ${res.pitch_label} on ${res.created.length} date(s).${skipped ? `\nSkipped:\n${skipped}` : ''}`);
      setDraft(null);
      reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to allot');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (item: OccupancyItem, series: boolean) => {
    if (!window.confirm(series ? 'Cancel this and all later weeks of this allotment?' : 'Cancel this allotment?')) return;
    try {
      await api.cancelAllotment(item.id, series);
      setSelected(null);
      reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel');
    }
  };

  const toggleRentPaid = async (item: OccupancyItem) => {
    await api.updateAllotment(item.id, { rent_paid: !item.rent_paid });
    setSelected({ ...item, rent_paid: !item.rent_paid });
    reload();
  };

  if (!sports.length) {
    return <p className="text-sm text-gray-500 p-4">Add the sports this ground offers in the Details tab first.</p>;
  }

  if (loaded && sports.length === 0) {
    return (
      <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-md p-3" data-testid="allot-no-sports">
        No sports set up for this ground yet. Open <b>Details</b>, tick the sports played here (and their pitch formats), tap Save details, then come back to Allot.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {dateProp === undefined && <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft size={16} />
          </Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" aria-label="Date" />
          <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>}
        <Select value={sport} onValueChange={(v) => { setSport(v); setDraft(null); }}>
          <SelectTrigger className="w-36" aria-label="Sport"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sports.map((s) => <SelectItem key={s} value={s}>{sportLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        {(occ?.layouts.length || 0) > 0 && (
          <Select value={format} onValueChange={(v) => { setFormat(v); setDraft(null); }}>
            <SelectTrigger className="w-40" aria-label="Format"><SelectValue /></SelectTrigger>
            <SelectContent>
              {occ?.layouts.map((l) => (
                <SelectItem key={l.format} value={l.format}>
                  {l.format} ({l.count === 1 ? 'whole ground' : `${l.count} pitches`})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 border border-green-400" /> Free for rent</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200" /> Not free for {format || 'this pitch'}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> Allotted</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-300 border border-dashed border-red-600" /> Game without allotment</span>
      </div>

      {info && <pre className="whitespace-pre-wrap text-xs bg-green-50 text-green-800 p-2 rounded">{info}</pre>}
      {error && <p className="text-xs bg-red-50 text-red-700 p-2 rounded">{error}</p>}

      <div className="bg-white rounded-lg border shadow-sm">
        <div className="flex border-b text-xs font-semibold text-gray-700">
          <div className="w-12 shrink-0" />
          <div className="flex-1 flex">
            {pitches.map((p) => (
              <div key={p.number} className="text-center py-1 border-l" style={{ width: `${(p.units.length / totalUnits) * 100}%` }}>
                {p.letter ? p.letter : p.label}
              </div>
            ))}
          </div>
        </div>
        <div ref={scrollRef} className="max-h-[65vh] overflow-y-auto">
          <div className="flex">
            <div className="w-12 shrink-0">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-[10px] text-gray-500 text-right pr-1 border-b" style={{ height: SLOT_PX * 2 }}>
                  {`${String(h).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>
            <div className="flex-1 relative" style={{ height: SLOTS_PER_DAY * SLOT_PX }}>
              {pitches.map((p) => {
                const left = (Math.min(...p.units) / totalUnits) * 100;
                const width = (p.units.length / totalUnits) * 100;
                return Array.from({ length: SLOTS_PER_DAY }, (_, i) => {
                  const start = i * SLOT_MINUTES;
                  const busy = (occ?.items || []).some((it) => overlaps(it, p.units, start, start + SLOT_MINUTES));
                  const isDraft = draft && draft.number === p.number && draft.start === minutesToTime(start);
                  return (
                    <button
                      key={`${p.number}-${i}`}
                      type="button"
                      disabled={busy || !canManage}
                      onClick={() => openDraft(p.number, p.label, start)}
                      aria-label={`${p.label} ${minutesToTime(start)} ${busy ? 'not free' : 'free'}`}
                      className={`absolute border-l border-b ${i % 2 ? 'border-b-gray-300' : 'border-b-gray-100'} ${busy ? 'bg-gray-200' : 'bg-green-100 hover:bg-green-300'} ${isDraft ? 'ring-2 ring-green-700 z-10' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%`, top: i * SLOT_PX, height: SLOT_PX }}
                    />
                  );
                });
              })}
              {blocks.map((it) => {
                const lo = Math.min(...it.units);
                const hi = Math.max(...it.units) + 1;
                const isAllotment = it.kind === 'allotment';
                return (
                  <button
                    key={`${it.kind}-${it.id}`}
                    type="button"
                    onClick={() => { setDraft(null); setSelected(it); }}
                    className={`absolute z-20 rounded text-left px-1 overflow-hidden text-[10px] leading-tight shadow ${isAllotment ? 'bg-red-500 text-white' : 'bg-red-300 text-red-900 border border-dashed border-red-600'}`}
                    style={{
                      left: `calc(${(lo / totalUnits) * 100}% + 2px)`,
                      width: `calc(${((hi - lo) / totalUnits) * 100}% - 4px)`,
                      top: (it.start_minute / SLOT_MINUTES) * SLOT_PX + 1,
                      height: Math.max(((it.end_minute - it.start_minute) / SLOT_MINUTES) * SLOT_PX - 2, 14),
                    }}
                  >
                    <span className="font-semibold">{it.pitch_label}</span> · {it.holder}
                    <br />
                    {it.start.slice(11)}–{it.end.slice(11)}
                    {isAllotment && it.rent ? ` · ${formatMoney(it.rent, currency)}${it.rent_paid ? ' paid' : ''}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {draft && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white border-t shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-w-lg mx-auto rounded-t-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Allot {draft.label}{draft.repeat === 'range' ? '' : ` on ${date}`}</h3>
            <button type="button" aria-label="Close" onClick={() => setDraft(null)}><X size={18} /></button>
          </div>
          {pitches.length > 1 && (
            <div className="space-y-1">
              <Label>Pitch</Label>
              <Select value={String(draft.number)} onValueChange={(v) => {
                const p = pitches.find((x) => String(x.number) === v);
                if (p) setDraft({ ...draft, number: p.number, label: p.label });
              }}>
                <SelectTrigger aria-label="Pitch"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pitches.map((p) => <SelectItem key={p.number} value={String(p.number)}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="allot-start">Start</Label>
              <Input id="allot-start" type="time" step={1800} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Duration</Label>
              <Select value={draft.duration} onValueChange={(v) => setDraft({ ...draft, duration: v })}>
                <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[30, 60, 90, 120, 150, 180, 240].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m < 60 ? `${m} min` : `${m / 60} hr`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Allot to</Label>
            <PersonSearch value={draft.target} onChange={(v) => setDraft({ ...draft, target: v })} testId="allot-to"
              placeholder="Type moderator or group name..."
              options={[
                ...groups.map((g) => ({ id: `g:${g.id}`, label: `Group: ${g.name} (${g.members.length})` })),
                ...moderators.map((m) => ({ id: `u:${m.user_id}`, label: m.user_name })),
              ]} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="allot-rent">Rent ({currency})</Label>
              <Input id="allot-rent" type="number" min="0" value={draft.rent} onChange={(e) => setDraft({ ...draft, rent: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Repeat</Label>
              <Select value={draft.repeat} onValueChange={(v) => setDraft({ ...draft, repeat: v })}>
                <SelectTrigger aria-label="Repeat"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="range">Date range…</SelectItem>
                  {[1, 2, 3, 4, 5, 8, 12, 26, 52].map((w) => (
                    <SelectItem key={w} value={String(w)}>{w === 1 ? 'Just this date' : w === 52 ? 'Weekly, 52 weeks' : `Weekly, ${w} weeks`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {draft.repeat === 'range' && (
            <div className="space-y-2 bg-gray-50 rounded-md p-2" data-testid="allot-range">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="allot-from">From</Label>
                  <Input id="allot-from" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="allot-to">To</Label>
                  <Input id="allot-to" type="date" min={date} value={draft.until} onChange={(e) => setDraft({ ...draft, until: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-1">
                {WEEKDAYS.map((d, i) => {
                  const on = draft.weekdays.includes(i);
                  return (
                    <button key={d} type="button" aria-pressed={on}
                      onClick={() => setDraft({ ...draft, weekdays: on ? draft.weekdays.filter((x) => x !== i) : [...draft.weekdays, i] })}
                      className={`flex-1 rounded border text-xs py-1 ${on ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-500'}`}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <Input placeholder="Note (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          {error && <p className="text-xs bg-red-50 text-red-700 p-2 rounded" data-testid="allot-error">{error}</p>}
          <Button className="w-full bg-green-600 hover:bg-green-700" disabled={saving} onClick={confirm}>
            {saving ? 'Allotting...' : 'Confirm allotment'}
          </Button>
        </div>
      )}

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white border-t shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-w-lg mx-auto rounded-t-xl space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{selected.pitch_label} · {selected.start.slice(11)}–{selected.end.slice(11)}</h3>
            <button type="button" aria-label="Close" onClick={() => setSelected(null)}><X size={18} /></button>
          </div>
          {selected.kind === 'allotment' ? (
            <>
              <p>Allotted to <b>{selected.holder}</b></p>
              <p>Rent: {formatMoney(selected.rent || 0, currency)} · {selected.rent_paid ? 'Paid' : 'Not paid'}</p>
              {(occ?.items || [])
                .filter((it) => it.kind === 'game' && it.allotment_id === selected.id)
                .map((g) => <p key={g.id} className="text-xs text-gray-600">Game: {g.title} ({g.status})</p>)}
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => toggleRentPaid(selected)}>
                    {selected.rent_paid ? 'Mark unpaid' : 'Mark rent paid'}
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => cancel(selected, false)}>Cancel</Button>
                  {selected.series_key && (
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => cancel(selected, true)}>
                      Cancel this &amp; later weeks
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p>
              Game “{selected.title}” by <b>{selected.holder}</b> — no Ground Manager allotment yet. Tap a free slot to allot this pitch to them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
