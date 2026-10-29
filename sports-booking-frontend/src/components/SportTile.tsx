import { sportIcon } from '@/lib/sports';

const TILES = new Set(['soccer', 'cricket', 'badminton', 'basketball', 'hockey', 'pickleball', 'tennis', 'swimming']);
const ALIAS: Record<string, string> = { football: 'soccer', lawn_tennis: 'tennis' };

/** The app's green turf with the sport's equipment on top (football, bat & ball, shuttle…). */
export function SportTile({ sport, className = 'w-10 h-10' }: { sport?: string | null; className?: string }) {
  const key = ALIAS[sport || ''] || sport || '';
  if (!TILES.has(key)) return <span className="text-2xl">{sportIcon(key)}</span>;
  return <img src={`/sports/${key}.jpg`} alt={key} title={key} data-testid="sport-tile" className={`${className} rounded-lg object-cover shrink-0 shadow-sm`} />;
}
