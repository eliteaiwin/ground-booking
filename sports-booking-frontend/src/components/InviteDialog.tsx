import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Share2, Check, MessageCircle, MessageSquare, QrCode } from 'lucide-react';

export interface ShareTab {
  key: string;
  label: string;
  text: string;
  qrUrl?: string;
  extra?: ReactNode;
}

/** One share sheet: message preview + WhatsApp / SMS / Copy, optional QR and tabs. */
export function ShareDialog({ title, tabs, onClose }: { title: string; tabs: ShareTab[]; onClose: () => void }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const tab = tabs.find(t => t.key === active) || tabs[0];

  useEffect(() => {
    setQr('');
    if (!tab?.qrUrl) return;
    QRCode.toDataURL(tab.qrUrl, { width: 480, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [tab?.qrUrl]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(tab.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="share-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Share2 size={16} /> {title}</DialogTitle></DialogHeader>
        {tabs.length > 1 && (
          <div className="grid grid-flow-col auto-cols-fr gap-1 bg-gray-100 rounded-lg p-1" role="tablist">
            {tabs.map(t => (
              <button key={t.key} type="button" role="tab" aria-selected={t.key === tab.key} data-testid={`share-tab-${t.key}`}
                onClick={() => { setActive(t.key); setShowQr(false); }}
                className={`text-sm rounded-md py-1.5 ${t.key === tab.key ? 'bg-white shadow font-semibold text-green-700' : 'text-gray-600'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="bg-white rounded-lg p-3 text-sm font-mono whitespace-pre-wrap [overflow-wrap:anywhere] border max-h-[40vh] overflow-y-auto" data-testid="share-text">
          {tab.text}
        </div>
        {showQr && qr && (
          <div className="flex flex-col items-center gap-1">
            <img src={qr} alt="QR code" className="w-48 h-48" data-testid="invite-qr" />
            <p className="text-xs text-gray-500">Scan with the phone camera</p>
          </div>
        )}
        <div className={`grid gap-2 ${tab.qrUrl ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <Button className="bg-green-600 hover:bg-green-700 px-1" data-testid="share-whatsapp"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(tab.text)}`, '_blank')}>
            <MessageCircle size={14} className="mr-1" /> WhatsApp
          </Button>
          <Button variant="outline" className="px-1" data-testid="share-sms"
            onClick={() => { window.location.href = `sms:?&body=${encodeURIComponent(tab.text)}`; }}>
            <MessageSquare size={14} className="mr-1" /> SMS
          </Button>
          <Button variant="outline" className="px-1" onClick={copy} data-testid="share-copy">
            {copied ? <><Check size={14} className="mr-1" /> Copied</> : <><Copy size={14} className="mr-1" /> Copy</>}
          </Button>
          {tab.qrUrl && (
            <Button variant="outline" className="px-1" data-testid="share-qr" onClick={() => setShowQr(s => !s)}>
              <QrCode size={14} className="mr-1" /> QR
            </Button>
          )}
        </div>
        {tab.extra}
      </DialogContent>
    </Dialog>
  );
}
