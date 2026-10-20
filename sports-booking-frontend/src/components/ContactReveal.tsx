import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { formatPhone } from '@/lib/phone';
import { maskedPhoneText } from '@/lib/player';

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  return domain ? `${user.slice(0, 1)}***@${domain}` : '***';
};

// Phone/email shown masked with an eye icon; tapping the eye reveals the full value.
export function ContactReveal({ value, kind }: { value: string; kind: 'phone' | 'email' }) {
  const [shown, setShown] = useState(false);
  if (!value) return null;
  const full = kind === 'phone' ? formatPhone(value) : value;
  const masked = kind === 'phone' ? maskedPhoneText(value) : maskEmail(value);
  return (
    <span className="inline-flex items-center gap-1">
      {shown
        ? <a href={kind === 'phone' ? `tel:${value}` : `mailto:${value}`} className="text-blue-600" onClick={e => e.stopPropagation()}>{full}</a>
        : <span>{masked}</span>}
      <button
        type="button"
        data-testid={`reveal-${kind}`}
        aria-label={shown ? `Hide ${kind}` : `Show ${kind}`}
        className="text-gray-400 hover:text-blue-600"
        onClick={e => { e.stopPropagation(); setShown(s => !s); }}
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}
