import { api } from '../services/api';

// The real user's token is kept aside while acting as someone else; impersonated users stay signed in.
export type ImpUser = { id: number; name: string; phone: string; role: string };
type ImpAccount = ImpUser & { token: string };
const OWNER_KEY = 'imp_owner';
const ACCOUNTS_KEY = 'imp_accounts';

const read = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};

export const impersonationOwner = () => read<ImpAccount | null>(OWNER_KEY, null);
export const impersonatedAccounts = () => read<ImpAccount[]>(ACCOUNTS_KEY, []);

const activate = (token: string) => {
  localStorage.setItem('token', token);
  window.location.reload();
};

export async function impersonate(target: ImpUser) {
  const res: { token: string; user: ImpUser } = await api.startImpersonation(target.id);
  if (!impersonationOwner()) {
    const me: { user: ImpUser } = await api.impersonationWhoami();
    localStorage.setItem(OWNER_KEY, JSON.stringify({ ...me.user, token: localStorage.getItem('token') || '' }));
  }
  const others = impersonatedAccounts().filter(a => a.id !== res.user.id);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...others, { ...res.user, token: res.token }]));
  activate(res.token);
}

export function switchToImpersonated(userId: number) {
  const a = impersonatedAccounts().find(x => x.id === userId);
  if (a) activate(a.token);
}

export function backToOwner() {
  const owner = impersonationOwner();
  if (owner) activate(owner.token);
}

export function forgetImpersonated(userId: number) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(impersonatedAccounts().filter(a => a.id !== userId)));
}

export function clearImpersonation() {
  localStorage.removeItem(OWNER_KEY);
  localStorage.removeItem(ACCOUNTS_KEY);
}
