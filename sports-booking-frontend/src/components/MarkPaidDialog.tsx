import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { ImagePlus } from 'lucide-react';

/** Settle Offline: the player marks their share as paid with a screenshot, a comment, or both. */
export default function MarkPaidDialog({ gameId, amount, payee, onClose, onDone }: {
  gameId: number | null; amount?: string; payee?: string; onClose: () => void; onDone: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(''); setComment(''); setError(''); onClose();
  };
  const pick = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Please choose a screenshot image'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setError(''); setFile(f); setPreview(URL.createObjectURL(f));
  };
  const submit = async () => {
    if ((!file && !comment.trim()) || gameId == null) return;
    setBusy(true); setError('');
    try {
      const r = await api.markPaidWithProof(gameId, file, comment.trim());
      close();
      onDone(r.message || 'Marked as paid');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={gameId != null} onOpenChange={o => { if (!o) close(); }}>
      <DialogContent className="max-w-sm" data-testid="mark-paid-dialog">
        <DialogHeader><DialogTitle>Mark as paid</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-600">
          Add a screenshot of your payment{amount ? ` of ${amount}` : ''}{payee ? ` to ${payee}` : ''}, a comment, or both. The moderator is told and can check it.
        </p>
        <label className="flex flex-col items-center justify-center gap-1 border-2 border-dashed rounded-lg p-3 text-sm text-gray-500 cursor-pointer min-h-[8rem]" data-testid="proof-picker">
          {preview
            ? <img src={preview} alt="Payment screenshot" className="max-h-48 rounded" />
            : <><ImagePlus size={28} /><span>Tap to choose a screenshot</span></>}
          <input type="file" accept="image/*" className="hidden" data-testid="proof-input" onChange={e => pick(e.target.files?.[0])} />
        </label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={300} rows={2}
          placeholder="Comment, e.g. Paid to Sri" data-testid="proof-comment"
          className="w-full border rounded-md px-2 py-1.5 text-sm" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={close}>Cancel</Button>
          <Button className="flex-1 bg-green-600 hover:bg-green-700" disabled={(!file && !comment.trim()) || busy} onClick={submit} data-testid="proof-submit">
            {busy ? 'Uploading...' : 'Submit'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProofViewer({ url, note = '', open, onClose }: { url: string; note?: string; open?: boolean; onClose: () => void }) {
  return (
    <Dialog open={open ?? (!!url || !!note)} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Payment details</DialogTitle></DialogHeader>
        {note && <p className="text-sm bg-gray-50 border rounded-md p-2 whitespace-pre-wrap" data-testid="proof-note">Comment: {note}</p>}
        {url && <img src={url} alt="Payment screenshot" className="w-full max-h-[70vh] object-contain rounded" data-testid="proof-image" />}
      </DialogContent>
    </Dialog>
  );
}
