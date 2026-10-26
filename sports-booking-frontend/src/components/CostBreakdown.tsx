import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '@/services/api';
import { computeFeeBreakdown, type FeeBreakdown, type FeeSettings } from '@/lib/fees';
import { formatMoney } from '@/lib/currency';

export function FeeBreakdownTable({ breakdown, fees, currency }: { breakdown: FeeBreakdown; fees: FeeSettings; currency: string }) {
  const row = (label: string, amount: number, total = false) => (
    <div className={`flex justify-between gap-2 ${total ? 'font-semibold border-t pt-1 mt-1' : ''}`}>
      <span>{label}</span>
      <span className="whitespace-nowrap">{formatMoney(amount.toFixed(2), currency)}</span>
    </div>
  );
  return (
    <div className="text-xs text-gray-700 bg-white border rounded p-2 mt-1 space-y-0.5" data-testid="fee-breakdown">
      {row('Ground fee share', breakdown.base)}
      {row(`App management fee (${fees.commission_percent}%)`, breakdown.app_fee)}
      {breakdown.app_fee_gst > 0 && row(`GST on app fee (${fees.app_fee_gst_percent}%)`, breakdown.app_fee_gst)}
      {row(`Payment gateway ${fees.fee_percent}%${fees.gst_percent > 0 ? ` + ${fees.gst_percent}% GST` : ''}`, breakdown.gateway_fee)}
      {row('Per player total', breakdown.total, true)}
    </div>
  );
}

export default function CostBreakdown({ groundCost, players, collection, currency }: {
  groundCost: number;
  players: number;
  collection: string;
  currency: string;
}) {
  const [fees, setFees] = useState<FeeSettings | null>(null);
  const [open, setOpen] = useState(false);
  const viaApp = collection === 'app';

  useEffect(() => {
    if (!viaApp || fees) return;
    api.getGatewayInfo().then((f: FeeSettings) => setFees(f)).catch(() => setFees(null));
  }, [viaApp, fees]);

  if (groundCost <= 0 || players <= 0) return null;
  const share = groundCost / players;
  const breakdown = viaApp && fees ? computeFeeBreakdown(share, fees) : null;

  return (
    <div className="p-2 bg-green-50 rounded text-sm text-green-800" data-testid="cost-breakdown">
      <div className="flex items-center gap-1">
        <span>
          Per player: <span className="font-semibold">{formatMoney(breakdown ? breakdown.total : Math.ceil(share - 0.001), currency)}</span>
          <span className="text-xs text-green-700"> (read-only, {players} players)</span>
        </span>
        {breakdown && (
          <button type="button" aria-label="Show cost breakdown" onClick={() => setOpen((o) => !o)} className="text-green-700">
            <Info size={14} />
          </button>
        )}
      </div>
      {breakdown && fees && open && <FeeBreakdownTable breakdown={breakdown} fees={fees} currency={currency} />}
    </div>
  );
}
