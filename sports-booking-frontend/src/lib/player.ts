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

export const formatPlayerDisplay = (name: string, phone: string) => {
  const firstName = name.split(' ')[0];
  if (!phone || phone.length < 4) return firstName;
  const masked = phone[0] + 'x'.repeat(phone.length - 4) + phone.slice(-2);
  return `${firstName} - ${masked}`;
};
