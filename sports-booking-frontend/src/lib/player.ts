export interface Player {
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

export const formatPlayerDisplay = (name: string, phone: string, mode?: string) => {
  const displayMode = mode || getDisplayMode();
  const first = getFirstName(name);
  const lastInitial = getLastInitial(name);
  switch (displayMode) {
    case 'first':
      return first;
    case 'first_last_initial':
      return lastInitial ? `${first} ${lastInitial}.` : first;
    case 'first_phone_masked':
      return phone ? `${first} - ${maskPhone(phone)}` : first;
    case 'first_phone_visible':
      return phone ? `${first} - ${phone}` : first;
    case 'first_last':
      return (name || '').trim() || first;
    case 'first_last_initial_phone_visible':
      const base = lastInitial ? `${first} ${lastInitial}.` : first;
      return phone ? `${base} - ${phone}` : base;
    default:
      return phone ? `${first} - ${maskPhone(phone)}` : first;
  }
};
