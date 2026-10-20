import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

const VIEW = 240;
const OUT = 512;

/** Lets the user drag/zoom a photo inside a circle and returns the square crop as the profile thumbnail. */
export function ImageCropDialog({ file, onCancel, onDone }: {
  file: File | null; onCancel: () => void; onDone: (cropped: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const drag = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { setImg(i); setZoom(1); setCenter({ x: 0.5, y: 0.5 }); };
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const scale = img ? (VIEW / Math.min(img.width, img.height)) * zoom : 1;
  const w = img ? img.width * scale : VIEW;
  const h = img ? img.height * scale : VIEW;
  const clamp = (c: { x: number; y: number }) => ({
    x: Math.min(1 - VIEW / 2 / w, Math.max(VIEW / 2 / w, c.x)),
    y: Math.min(1 - VIEW / 2 / h, Math.max(VIEW / 2 / h, c.y)),
  });
  const c = clamp(center);

  const save = () => {
    if (!img || !file) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT; canvas.height = OUT;
    const side = VIEW / scale;
    canvas.getContext('2d')!.drawImage(img, c.x * img.width - side / 2, c.y * img.height - side / 2, side, side, 0, 0, OUT, OUT);
    canvas.toBlob(b => b && onDone(new File([b], 'profile.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  };

  return (
    <Dialog open={!!file} onOpenChange={o => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Crop profile photo</DialogTitle></DialogHeader>
        <p className="text-xs text-gray-500">Drag to move, use the slider to zoom. The circle is your thumbnail.</p>
        <div
          className="relative mx-auto overflow-hidden bg-gray-100 touch-none cursor-move select-none"
          style={{ width: VIEW, height: VIEW }}
          data-testid="crop-area"
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, cx: c.x, cy: c.y }; }}
          onPointerMove={e => {
            const d = drag.current;
            if (d) setCenter(clamp({ x: d.cx - (e.clientX - d.px) / w, y: d.cy - (e.clientY - d.py) / h }));
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          {img && (
            <img src={img.src} alt="" draggable={false} className="absolute max-w-none pointer-events-none"
              style={{ width: w, height: h, left: VIEW / 2 - c.x * w, top: VIEW / 2 - c.y * h }} />
          )}
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 999px rgba(0,0,0,0.45)' }} />
        </div>
        <input type="range" min={1} max={4} step={0.01} value={zoom} aria-label="Zoom" data-testid="crop-zoom"
          onChange={e => setZoom(parseFloat(e.target.value))} className="w-full accent-green-600" />
        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => file && onDone(file)}>Use whole photo</Button>
          <Button className="bg-green-600 hover:bg-green-700" onClick={save} data-testid="crop-save">Save thumbnail</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
