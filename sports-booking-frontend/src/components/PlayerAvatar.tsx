import { User } from 'lucide-react';
import { api } from '../services/api';

const SIZES = { sm: 'w-6 h-6', md: 'w-10 h-10', lg: 'w-20 h-20' } as const;

/** Profile photo, or a grey male/female/neutral placeholder when the player has none. */
export function PlayerAvatar({ photo, gender, size = 'sm', alt = '' }: {
  photo?: string | null; gender?: string | null; size?: keyof typeof SIZES; alt?: string;
}) {
  const box = SIZES[size];
  if (photo) return <img src={api.getProfilePicUrl(photo)} alt={alt} className={`${box} rounded-full object-cover shrink-0`} />;
  const g = (gender || '').toLowerCase();
  return (
    <span className={`${box} rounded-full bg-gray-100 text-gray-400 flex items-center justify-center overflow-hidden shrink-0`}
      data-testid="avatar-placeholder" title={g ? `No photo (${g})` : 'No photo'}>
      {g === 'male' || g === 'female' ? (
        <svg viewBox="0 0 24 24" className="w-[85%] h-[85%]" fill="currentColor" aria-hidden>
          {g === 'female' && (
            <path d="M12 2.8c-3.2 0-5.3 2.4-5.3 5.5 0 2.6-.7 4.4-1.8 5.8 1.5.7 3.2 1 5 1h4.2c1.8 0 3.5-.3 5-1-1.1-1.4-1.8-3.2-1.8-5.8 0-3.1-2.1-5.5-5.3-5.5z" opacity=".55" />
          )}
          <circle cx="12" cy="8.4" r={g === 'female' ? 3.4 : 3.9} />
          <path d={g === 'female' ? 'M5.5 21.5c0-3.8 2.9-6.4 6.5-6.4s6.5 2.6 6.5 6.4z' : 'M4 21.5c0-4.2 3.6-7 8-7s8 2.8 8 7z'} />
        </svg>
      ) : (
        <User className="w-[65%] h-[65%]" />
      )}
    </span>
  );
}
