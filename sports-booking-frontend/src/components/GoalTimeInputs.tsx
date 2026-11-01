/** Goal time pickers limited to game start − 15 min … game end + 15 min. */
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (mins: number) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function goalWindow(gameTime: string, durationMinutes: number) {
  const start = toMin(gameTime || '00:00');
  return { min: toHHMM(start - 15), max: toHHMM(start + (durationMinutes || 90) + 15) };
}

export function inGoalWindow(hhmm: string, win: { min: string; max: string }) {
  if (!hhmm) return true;
  const t = toMin(hhmm), lo = toMin(win.min), hi = toMin(win.max);
  return lo <= hi ? t >= lo && t <= hi : t >= lo || t <= hi;
}

export function formatGoalTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export default function GoalTimeInputs({ count, values, onChange, win, label = 'Goal', tone = 'purple' }: {
  count: number;
  values: string[];
  onChange: (values: string[]) => void;
  win: { min: string; max: string };
  label?: string;
  tone?: 'purple' | 'red';
}) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-1" data-testid="goal-times">
      {Array.from({ length: count }, (_, i) => {
        const v = values[i] || '';
        const bad = !inGoalWindow(v, win);
        return (
          <label key={i} className={`flex items-center gap-1 text-[11px] ${tone === 'red' ? 'text-red-600' : 'text-purple-700'}`}>
            {label} {i + 1}
            <input type="time" step={60} min={win.min} max={win.max} value={v}
              onChange={e => { const next = [...values]; next[i] = e.target.value; onChange(next.slice(0, count)); }}
              className={`border rounded px-1 py-0.5 text-xs ${bad ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
          </label>
        );
      })}
      <span className="w-full text-[10px] text-gray-500">
        Time scored, between {formatGoalTime(win.min)} and {formatGoalTime(win.max)}
      </span>
    </div>
  );
}
