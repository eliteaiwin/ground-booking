import elizophLogo from '@/assets/elizoph.png';
import { APP_VERSION } from '@/changelog';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onMouseDown={onClose}>
      <div data-testid="about-dialog" className="relative bg-white text-gray-900 rounded-xl shadow-xl w-full max-w-xs px-6 pt-8 pb-5 flex flex-col items-center text-center" onMouseDown={e => e.stopPropagation()}>
        <button type="button" aria-label="Close" className="absolute top-2 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none" onClick={onClose}>&times;</button>
        <img src={elizophLogo} alt="Elizoph Technologies" className="w-48 h-auto" />
        <p className="mt-4 text-sm font-semibold"><span className="text-red-600">Elite</span> Turf Booking</p>
        <p className="text-xs text-gray-500">Ver {APP_VERSION}</p>
        <div className="mt-4 text-sm space-y-1">
          <p>Email: <a href="mailto:admin@elizoph.com" data-testid="about-email" className="text-blue-600 hover:underline">admin@elizoph.com</a></p>
          <p>Mobile: <a href="tel:+918951575798" data-testid="about-phone" className="text-blue-600 hover:underline">+91-8951575798</a></p>
        </div>
        <a href="https://www.elizoph.com" target="_blank" rel="noopener noreferrer"
          className="mt-4 text-sm text-blue-600 hover:underline" data-testid="about-link">www.elizoph.com</a>
      </div>
    </div>
  );
}
