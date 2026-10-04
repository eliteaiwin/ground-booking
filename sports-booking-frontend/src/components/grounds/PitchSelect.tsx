import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PitchLayout } from '@/lib/grounds';

interface Props {
  layouts: PitchLayout[];
  value: string;
  onChange: (value: string) => void;
  allowNumber?: boolean;
}

export default function PitchSelect({ layouts, value, onChange, allowNumber = true }: Props) {
  if (layouts.length === 0) return null;
  return (
    <div className="space-y-2">
      <Label>Pitch / Court</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select pitch" /></SelectTrigger>
        <SelectContent>
          {layouts.map(l => [
            <SelectItem key={`${l.format}|0`} value={`${l.format}|0`}>
              {l.count === 1 ? `${l.format} (whole ground)` : `${l.format} · any free (${l.count} pitches)`}
            </SelectItem>,
            ...(allowNumber && l.count > 1
              ? Array.from({ length: l.count }, (_, i) => (
                <SelectItem key={`${l.format}|${i + 1}`} value={`${l.format}|${i + 1}`}>{l.format} · Pitch {i + 1}</SelectItem>
              ))
              : []),
          ])}
        </SelectContent>
      </Select>
      <p className="text-xs text-gray-500">Formats share the ground: a bigger format can't be booked while a smaller pitch is booked at the same time.</p>
    </div>
  );
}
