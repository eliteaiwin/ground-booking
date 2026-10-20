import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sportLabel } from '@/lib/sports';

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
}

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

export default function AllotmentSheet({ groundId, groups }: { groundId: number; groups: ModeratorGroupRef[] }) {
  const [sports, setSports] = useState<string[]>([]);
  const [sport, setSport] = useState('');
  const [date, setDate] = useState(todayIso());
  const [format, setFormat] = useState('');
  const [occ, setOcc] = useState<Occupancy | null>(null);
  const [moderators, setModerators] = useState<{ user_id: number; user_name: string }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<OccupancyItem | null>(null);
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getGroundDetails(groundId)
      .then((d: { sports: string[] }) => { setSports(d.sports); setSport(d.sports[0] || ''); })
      .catch(() => setSports([]));
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
    setDraft({ number, label, start: minutesToTime(startMinute), duration: '60', target: '', rent: '', repeat: '1', notes: '' });
  };

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
        repeat_weeks: parseInt(draft.repeat) || 1,
      });
      const skipped = (res.skipped as { date: string; reason: string }[]).map((s) => `${s.date}: ${s.reason}`).join('\n');
      setInfo(`Allotted ${res.pitch_label} on ${res.created.length} date(s).${skipped ? `\nSkipped:\n${skipped}` : ''}`);
      setDraft(null);
      reload();
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft size={16} />
          </Button>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-40" aria-label="Date" />
          <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight size={16} />
          </Button>
        </div>
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
                    {isAllotment && it.rent ? ` · ₹${it.rent}${it.rent_paid ? ' paid' : ''}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {draft && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white border-t shadow-2xl p-4 max-w-lg mx-auto rounded-t-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Allot {draft.label} on {date}</h3>
            <button type="button" aria-label="Close" onClick={() => setDraft(null)}><X size={18} /></button>
          </div>
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
            <Select value={draft.target} onValueChange={(v) => setDraft({ ...draft, target: v })}>
              <SelectTrigger aria-label="Allot to"><SelectValue placeholder="Moderator or moderator group" /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={`g${g.id}`} value={`g:${g.id}`}>Group: {g.name} ({g.members.length})</SelectItem>
                ))}
                {moderators.map((m) => (
                  <SelectItem key={`u${m.user_id}`} value={`u:${m.user_id}`}>{m.user_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="allot-rent">Rent (₹)</Label>
              <Input id="allot-rent" type="number" min="0" value={draft.rent} onChange={(e) => setDraft({ ...draft, rent: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Repeat weekly</Label>
              <Select value={draft.repeat} onValueChange={(v) => setDraft({ ...draft, repeat: v })}>
                <SelectTrigger aria-label="Repeat weekly"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 8, 12].map((w) => (
                    <SelectItem key={w} value={String(w)}>{w === 1 ? 'Just this date' : `${w} weeks`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Input placeholder="Note (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <Button className="w-full bg-green-600 hover:bg-green-700" disabled={saving} onClick={confirm}>
            {saving ? 'Allotting...' : 'Confirm allotment'}
          </Button>
        </div>
      )}

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white border-t shadow-2xl p-4 max-w-lg mx-auto rounded-t-xl space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{selected.pitch_label} · {selected.start.slice(11)}–{selected.end.slice(11)}</h3>
            <button type="button" aria-label="Close" onClick={() => setSelected(null)}><X size={18} /></button>
          </div>
          {selected.kind === 'allotment' ? (
            <>
              <p>Allotted to <b>{selected.holder}</b></p>
              <p>Rent: ₹{selected.rent || 0} · {selected.rent_paid ? 'Paid' : 'Not paid'}</p>
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
