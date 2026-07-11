import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Users, DollarSign } from 'lucide-react';
import { Player, formatPlayerDisplay } from '@/lib/player';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (playedUserIds: number[]) => void;
  selectedPlayers: Player[];
  waitingList: Player[];
  maxPlayers: number;
  groundCost: number;
  currency: string;
  isSoccer: boolean;
  continueLabel?: string;
}

export default function CompleteGameDialog({
  open,
  onOpenChange,
  onComplete,
  selectedPlayers,
  waitingList,
  maxPlayers,
  groundCost,
  currency,
  isSoccer,
  continueLabel = 'Complete Game',
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      // Default: confirmed players checked, waiting list unchecked
      setSelectedIds(new Set(selectedPlayers.map((p) => p.user_id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleId = (userId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const allPlayers = [...selectedPlayers, ...waitingList];
  const allIds = new Set(allPlayers.map((p) => p.user_id));

  const isAllSelected = allIds.size > 0 && selectedIds.size === allIds.size;
  const toggleAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const perPerson = selectedIds.size > 0 ? groundCost / selectedIds.size : 0;

  const handleConfirm = () => {
    if (selectedIds.size === 0) return;
    onComplete(Array.from(selectedIds));
    onOpenChange(false);
  };

  const renderPlayerRow = (player: Player) => (
    <div key={player.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
      <Checkbox
        id={`player-${player.user_id}`}
        checked={selectedIds.has(player.user_id)}
        onCheckedChange={() => toggleId(player.user_id)}
      />
      <Label htmlFor={`player-${player.user_id}`} className="flex-1 text-sm font-normal cursor-pointer">
        {formatPlayerDisplay(player.name, player.phone)}
        {player.position && player.position !== 'Anywhere' ? ` (${player.position})` : ''}
      </Label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={18} /> Who Played?
          </DialogTitle>
          <DialogDescription>
            Select the players who actually played. Confirmed players are checked by default.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-2">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium text-gray-700">All players</Label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-green-600 hover:underline"
            >
              {isAllSelected ? 'Uncheck all' : 'Check all'}
            </button>
          </div>

          <ScrollArea className="h-[280px] border rounded-lg p-2">
            {selectedPlayers.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-green-700 mb-1">Confirmed</p>
                <div className="space-y-1">{selectedPlayers.map(renderPlayerRow)}</div>
              </div>
            )}
            {waitingList.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-orange-700 mb-1">Waiting List</p>
                <div className="space-y-1">{waitingList.map(renderPlayerRow)}</div>
              </div>
            )}
            {selectedPlayers.length === 0 && waitingList.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No players in this game</p>
            )}
          </ScrollArea>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Ground booking cost</span>
            <span>{groundCost.toFixed(2)} {currency}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Booked for max players</span>
            <span>{maxPlayers}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Players who played</span>
            <span>{selectedIds.size}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-gray-200">
            <span className="font-semibold text-gray-800 flex items-center gap-1">
              <DollarSign size={14} /> Per person
            </span>
            <span className="font-bold text-green-700">
              {perPerson.toFixed(2)} {currency}
            </span>
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-purple-600 hover:bg-purple-700"
            disabled={selectedIds.size === 0}
            onClick={handleConfirm}
          >
            {isSoccer ? 'Continue to Score' : continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
