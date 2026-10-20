import { formatPhone } from '@/lib/phone';
export interface Player {
  display_name?: string;
  must_prepay?: boolean;
  always_prepay?: boolean;
  id: number;
  user_id: number;
  name: string;
  phone: string;
  status: string;
  position: string;
  team_id: number | null;
  payment_confirmed: number;
  played: boolean;
  nominated_by: number | null;
  nominated_by_info: string | null;
  joined_at: string;
  photo: string;
}

function getDisplayMode(): string {
  if (typeof window === 'undefined') return 'first_phone_masked';
  return localStorage.getItem('player_name_display') || 'first_phone_masked';
}

function getFirstName(name: string): string {
  return (name || '').split(' ')[0];
}

function getLastInitial(name: string): string {
  const parts = (name || '').split(' ').filter(Boolean);
  if (parts.length > 1 && parts[1]) return parts[1][0];
  return '';
}

function maskPhone(phone?: string): string {
  if (!phone || phone.length < 4) return phone || '';
  return phone[0] + 'x'.repeat(phone.length - 4) + phone.slice(-2);
}

function phoneText(phone: string, masked: boolean): string {
  const f = formatPhone(phone);
  const i = f.indexOf('-');
  if (!f.startsWith('+') || i < 0) return masked ? maskPhone(f) : f;
  const local = f.slice(i + 1);
  return `${f.slice(0, i)}-${masked ? maskPhone(local) : local}`;
}

export const maskedPhoneText = (phone?: string) => (phone ? phoneText(phone, true) : '');

export const formatPlayerDisplay = (name: string, phone: string, mode?: string, displayName?: string | null) => {
  const displayMode = mode || getDisplayMode();
  const custom = (displayName || '').trim();
  const first = custom || getFirstName(name);
  const lastInitial = custom ? '' : getLastInitial(name);
  switch (displayMode) {
    case 'first':
      return first;
    case 'first_last_initial':
      return lastInitial ? `${first} ${lastInitial}.` : first;
    case 'first_phone_masked':
      return phone ? `${first} - ${phoneText(phone, true)}` : first;
    case 'first_phone_visible':
      return phone ? `${first} - ${phoneText(phone, false)}` : first;
    case 'first_last':
      return custom || (name || '').trim() || first;
    case 'first_last_initial_phone_visible': {
      const base = lastInitial ? `${first} ${lastInitial}.` : first;
      return phone ? `${base} - ${phoneText(phone, false)}` : base;
    }
    default:
      return phone ? `${first} - ${phoneText(phone, true)}` : first;
  }
};
