import { useAuth } from '../context/AuthContext';

export interface SportMeta {
  key: string;
  label: string;
  icon: string;
  defaultPlayers: number;
  emoji: string;
}

export const ALL_SPORTS: SportMeta[] = [
  { key: 'soccer', label: 'Soccer', icon: '⚽', emoji: '⚽', defaultPlayers: 16 },
  { key: 'cricket', label: 'Cricket', icon: '🏏', emoji: '🏏', defaultPlayers: 14 },
  { key: 'badminton', label: 'Badminton', icon: '🏸', emoji: '🏸', defaultPlayers: 4 },
  { key: 'basketball', label: 'Basketball', icon: '🏀', emoji: '🏀', defaultPlayers: 10 },
  { key: 'hockey', label: 'Hockey', icon: '🏒', emoji: '🏒', defaultPlayers: 14 },
];

export const SPORTS_BY_KEY: Record<string, SportMeta> = ALL_SPORTS.reduce((acc, s) => {
  acc[s.key] = s;
  return acc;
}, {} as Record<string, SportMeta>);

export function useSports() {
  const { appSettings } = useAuth();
  const enabled = appSettings?.enabled_sports && appSettings.enabled_sports.length > 0
    ? appSettings.enabled_sports
    : ['soccer'];
  return ALL_SPORTS.filter(s => enabled.includes(s.key));
}

export function sportIcon(key: string) {
  return SPORTS_BY_KEY[key]?.icon || '🏆';
}

export function sportLabel(key: string) {
  return SPORTS_BY_KEY[key]?.label || key;
}
