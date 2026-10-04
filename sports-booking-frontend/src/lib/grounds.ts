export type AmenityStatus = 'free' | 'paid' | 'rent' | 'buy' | 'rent_buy' | 'no';

export interface AmenityValue {
  status: AmenityStatus;
  price: string;
}

export interface AmenityMeta {
  key: string;
  label: string;
  emoji: string;
}

export const AMENITIES: AmenityMeta[] = [
  { key: 'toilet', label: 'Toilet', emoji: '🚻' },
  { key: 'shower', label: 'Shower', emoji: '🚿' },
  { key: 'changing_room', label: 'Changing room', emoji: '🚪' },
  { key: 'lockers', label: 'Lockers', emoji: '🔐' },
  { key: 'car_parking', label: 'Car parking', emoji: '🅿️' },
  { key: 'bike_parking', label: 'Bike parking', emoji: '🏍️' },
  { key: 'drinking_water', label: 'Drinking water', emoji: '🚰' },
  { key: 'shed', label: 'Shed / seating', emoji: '⛱️' },
  { key: 'floodlights', label: 'Night lights', emoji: '💡' },
  { key: 'first_aid', label: 'First aid', emoji: '⛑️' },
  { key: 'cctv', label: 'CCTV', emoji: '📹' },
  { key: 'power_backup', label: 'Power backup', emoji: '🔋' },
  { key: 'cafe', label: 'Café / snacks', emoji: '☕' },
  { key: 'wifi', label: 'Wi-Fi', emoji: '📶' },
  { key: 'wheelchair', label: 'Wheelchair access', emoji: '♿' },
];

export interface PitchLayout {
  format: string;
  count: number;
}

export interface SportDetail {
  timing: string;
  price: string;
  surface: string;
  size: string;
  contact_name: string;
  contact_phone: string;
  notes: string;
  items: Record<string, AmenityValue>;
  pitches: PitchLayout[];
}

export interface SportConfig {
  surfaceLabel: string;
  surfaces: string[];
  sizeLabel: string;
  sizePlaceholder: string;
  items: AmenityMeta[];
  pitchLabel: string;
  defaultPitches: PitchLayout[];
}

const COACHING: AmenityMeta = { key: 'coaching', label: 'Coaching', emoji: '🧑‍🏫' };

export const SPORT_CONFIG: Record<string, SportConfig> = {
  soccer: {
    surfaceLabel: 'Ground type', surfaces: ['Artificial turf', 'Natural grass', 'Mud'],
    sizeLabel: 'Ground size', sizePlaceholder: 'e.g. 60m x 40m',
    items: [
      { key: 'football', label: 'Football', emoji: '⚽' }, COACHING,
      { key: 'ball_boy', label: 'Ball boy', emoji: '🧒' },
      { key: 'cleats', label: 'Cleats / studs', emoji: '👟' },
      { key: 'socks', label: 'Socks', emoji: '🧦' },
      { key: 'bibs', label: 'Bibs', emoji: '🦺' },
      { key: 'tshirts', label: 'T-shirts', emoji: '👕' },
    ],
    pitchLabel: 'Pitch splits',
    defaultPitches: [{ format: '5-a-side', count: 3 }, { format: '7-a-side', count: 2 }, { format: '9-a-side', count: 1 }],
  },
  badminton: {
    surfaceLabel: 'Court type', surfaces: ['Wooden', 'Synthetic mat', 'Cement'],
    sizeLabel: 'Courts', sizePlaceholder: 'e.g. 4 indoor courts',
    items: [
      { key: 'shuttles', label: 'Shuttles', emoji: '🏸' },
      { key: 'racket', label: 'Racket', emoji: '🏸' }, COACHING,
      { key: 'non_marking_shoes', label: 'Non-marking shoes', emoji: '👟' },
    ],
    pitchLabel: 'Courts', defaultPitches: [{ format: 'Court', count: 2 }],
  },
  swimming: {
    surfaceLabel: 'Pool type', surfaces: ['Indoor', 'Outdoor'],
    sizeLabel: 'Pool size', sizePlaceholder: 'e.g. 25m x 12m, 4 lanes, 1.2-2m deep',
    items: [
      { key: 'swimsuit', label: 'Swim suit', emoji: '🩱' },
      { key: 'cap', label: 'Cap', emoji: '🧢' },
      { key: 'ear_plug', label: 'Ear plugs', emoji: '👂' },
      { key: 'goggles', label: 'Goggles', emoji: '🥽' },
      { key: 'towel', label: 'Towel', emoji: '🧺' }, COACHING,
    ],
    pitchLabel: 'Lanes', defaultPitches: [{ format: 'Lane', count: 4 }],
  },
  pickleball: {
    surfaceLabel: 'Court type', surfaces: ['Hard court', 'Synthetic', 'Wooden'],
    sizeLabel: 'Courts', sizePlaceholder: 'e.g. 3 courts',
    items: [
      { key: 'paddle', label: 'Paddle', emoji: '🏓' },
      { key: 'balls', label: 'Balls', emoji: '🟡' }, COACHING,
    ],
    pitchLabel: 'Courts', defaultPitches: [{ format: 'Court', count: 2 }],
  },
  tennis: {
    surfaceLabel: 'Court type', surfaces: ['Hard court', 'Clay', 'Grass', 'Synthetic'],
    sizeLabel: 'Courts', sizePlaceholder: 'e.g. 2 floodlit courts',
    items: [
      { key: 'racket', label: 'Racket', emoji: '🎾' },
      { key: 'balls', label: 'Balls', emoji: '🟡' },
      { key: 'ball_boy', label: 'Ball boy', emoji: '🧒' }, COACHING,
    ],
    pitchLabel: 'Courts', defaultPitches: [{ format: 'Court', count: 2 }],
  },
  cricket: {
    surfaceLabel: 'Pitch type', surfaces: ['Turf', 'Matting', 'Cement', 'Natural grass'],
    sizeLabel: 'Ground size', sizePlaceholder: 'e.g. 60m boundary',
    items: [
      { key: 'bat', label: 'Bat', emoji: '🏏' },
      { key: 'balls', label: 'Balls', emoji: '🔴' },
      { key: 'stumps', label: 'Stumps', emoji: '🏏' },
      { key: 'nets', label: 'Practice nets', emoji: '🥅' },
      { key: 'umpire', label: 'Umpire', emoji: '🧑‍⚖️' }, COACHING,
    ],
    pitchLabel: 'Pitches / nets', defaultPitches: [],
  },
  basketball: {
    surfaceLabel: 'Court type', surfaces: ['Wooden', 'Hard court', 'Synthetic'],
    sizeLabel: 'Courts', sizePlaceholder: 'e.g. 1 full court',
    items: [{ key: 'basketball', label: 'Basketball', emoji: '🏀' }, COACHING],
    pitchLabel: 'Courts', defaultPitches: [{ format: 'Half court', count: 2 }, { format: 'Full court', count: 1 }],
  },
  hockey: {
    surfaceLabel: 'Ground type', surfaces: ['Artificial turf', 'Natural grass'],
    sizeLabel: 'Ground size', sizePlaceholder: 'e.g. 91m x 55m',
    items: [
      { key: 'sticks', label: 'Hockey sticks', emoji: '🏒' },
      { key: 'balls', label: 'Balls', emoji: '⚪' }, COACHING,
    ],
    pitchLabel: 'Pitch splits', defaultPitches: [],
  },
};

export function sportConfig(sport: string): SportConfig {
  return SPORT_CONFIG[sport] || {
    surfaceLabel: 'Surface', surfaces: [], sizeLabel: 'Size', sizePlaceholder: '', items: [COACHING],
    pitchLabel: 'Courts / pitches', defaultPitches: [],
  };
}

export const EMPTY_SPORT_DETAIL: SportDetail = {
  timing: '', price: '', surface: '', size: '', contact_name: '', contact_phone: '', notes: '', items: {}, pitches: [],
};

export function parsePitchValue(value: string): { pitch_format?: string; pitch_number?: number } {
  if (!value) return {};
  const [format, number] = value.split('|');
  return { pitch_format: format, pitch_number: Number(number) || undefined };
}

export function defaultPitchValue(layouts: PitchLayout[]): string {
  return layouts.length > 0 ? `${layouts[0].format}|0` : '';
}

export function pitchLabel(format: string, number: number): string {
  if (!format) return '';
  return number ? `${format} · Pitch ${number}` : format;
}

export const AMENITY_STATUS_LABELS: Record<AmenityStatus, string> = {
  free: 'Free',
  paid: 'Paid',
  rent: 'On rent',
  buy: 'To buy',
  rent_buy: 'Rent or buy',
  no: 'Not available',
};

export const PRICED_STATUSES: AmenityStatus[] = ['paid', 'rent', 'buy', 'rent_buy'];

export function amenityStatusText(value: AmenityValue): string {
  const label = AMENITY_STATUS_LABELS[value.status];
  return value.price ? `${label} · ${value.price}` : label;
}

export interface GroundDetails {
  id: number;
  name: string;
  location: string;
  display_name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  maps_url: string;
  sport_types: string[];
  sports: string[];
  main_photo: string;
  is_approved: number;
  description: string;
  opening_hours: string;
  price_info: string;
  amenities: Record<string, AmenityValue>;
  amenities_other: string;
  sport_details: Record<string, SportDetail>;
  contact_public: boolean;
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  photos: { id: number; filename: string; caption: string; is_main: boolean }[];
  moderators: { user_id: number; name: string; phone: string; sport_type: string }[];
  upcoming_games: {
    game_id: number; title: string; sport_type: string; status: string; game_date: string; game_time: string;
    duration_minutes: number; max_players: number; player_count: number; cost_per_person: number;
    organiser_name: string; organiser_phone: string; pitch_format: string; pitch_number: number;
  }[];
  can_manage: boolean;
  is_member: boolean;
  join_request_status: string;
  rejection_reason: string;
}

export interface GroundDetailsInput {
  address: string;
  latitude: number | null;
  longitude: number | null;
  maps_url: string;
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  contact_public: boolean;
  opening_hours: string;
  price_info: string;
  description: string;
  sports: string[];
  amenities: Record<string, AmenityValue>;
  amenities_other: string;
  sport_details: Record<string, SportDetail>;
}

export const EMPTY_GROUND_DETAILS: GroundDetailsInput = {
  address: '', latitude: null, longitude: null, maps_url: '', owner_name: '', owner_phone: '', owner_email: '',
  contact_public: true, opening_hours: '', price_info: '', description: '', sports: [], amenities: {}, amenities_other: '',
  sport_details: {},
};

export function directionsUrl(g: { latitude: number | null; longitude: number | null; maps_url: string; address: string; display_name: string }): string {
  if (g.latitude != null && g.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${g.latitude},${g.longitude}`;
  }
  if (g.maps_url) return g.maps_url;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(g.address || g.display_name)}`;
}

export function mapEmbedUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
}

export function whatsappUrl(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits.length === 10 ? '91' + digits : digits}`;
}

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.code === err.PERMISSION_DENIED
        ? 'Location permission denied. Please allow location access and try again.'
        : 'Could not get your location. Please try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}
