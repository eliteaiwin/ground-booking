import { useState } from 'react';
import { CHANGELOG, APP_VERSION } from '@/changelog';

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="app-version" onClick={() => setOpen(true)}
        className="text-[9px] leading-none opacity-80 hover:opacity-100 underline-offset-2 hover:underline">
        Ver {APP_VERSION}
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={() => setOpen(false)}>
          <div className="bg-white text-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold">What's new</h2>
              <button type="button" aria-label="Close" className="text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={() => setOpen(false)}>&times;</button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-4" data-testid="changelog">
              {CHANGELOG.map((r, i) => (
                <section key={r.version}>
                  <h3 className="text-sm font-semibold">
                    Ver {r.version} <span className="font-normal text-gray-400 text-xs">{new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    {i === 0 && <span className="ml-2 text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5">Current</span>}
                  </h3>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5 text-sm text-gray-700">
                    {r.changes.map(c => <li key={c}>{c}</li>)}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
