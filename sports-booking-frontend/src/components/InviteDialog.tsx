import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Share2, Check } from 'lucide-react';

export function InviteDialog({ title, url, message, onClose }: {
  title: string;
  url: string;
  message: string;
  onClose: () => void;
}) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [url]);

  const text = `${message}\n${url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="invite-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Share2 size={16} /> {title}</DialogTitle></DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {qr && <img src={qr} alt="QR code" className="w-56 h-56" data-testid="invite-qr" />}
          <p className="text-xs text-gray-500 text-center">Scan with the phone camera, or share the link</p>
          <p className="w-full text-xs bg-gray-50 border rounded px-2 py-1.5 break-all" data-testid="invite-link">{url}</p>
          <div className="grid grid-cols-2 gap-2 w-full">
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')}>
              <Share2 size={14} className="mr-1" /> WhatsApp
            </Button>
            <Button variant="outline" onClick={copy}>
              {copied ? <><Check size={14} className="mr-1" /> Copied</> : <><Copy size={14} className="mr-1" /> Copy</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
