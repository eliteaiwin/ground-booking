export type AmenityStatus = 'free' | 'paid' | 'rent' | 'buy' | 'rent_buy' | 'no';

export interface AmenityValue {
  status: AmenityStatus;
  price: string;
}

export interface AmenityMeta {
  key: string;
  label: string;
  emoji: string;
  group: 'general' | 'staff' | 'gear' | 'surface' | 'sport';
  sport?: string;
}

export const AMENITY_GROUPS: { key: AmenityMeta['group']; label: string }[] = [
  { key: 'general', label: 'Facilities' },
  { key: 'surface', label: 'Surface & Venue' },
  { key: 'staff', label: 'Staff' },
  { key: 'gear', label: 'Gear' },
  { key: 'sport', label: 'Sport Equipment' },
];

export const AMENITIES: AmenityMeta[] = [
  { key: 'toilet', label: 'Toilet', emoji: '🚻', group: 'general' },
  { key: 'shower', label: 'Shower', emoji: '🚿', group: 'general' },
  { key: 'changing_room', label: 'Changing room', emoji: '🚪', group: 'general' },
  { key: 'lockers', label: 'Lockers', emoji: '🔐', group: 'general' },
  { key: 'car_parking', label: 'Car parking', emoji: '🅿️', group: 'general' },
  { key: 'bike_parking', label: 'Bike parking', emoji: '🏍️', group: 'general' },
  { key: 'drinking_water', label: 'Drinking water', emoji: '🚰', group: 'general' },
  { key: 'shed', label: 'Shed / seating', emoji: '⛱️', group: 'general' },
  { key: 'floodlights', label: 'Night lights', emoji: '💡', group: 'general' },
  { key: 'first_aid', label: 'First aid', emoji: '⛑️', group: 'general' },
  { key: 'cctv', label: 'CCTV', emoji: '📹', group: 'general' },
  { key: 'power_backup', label: 'Power backup', emoji: '🔋', group: 'general' },
  { key: 'cafe', label: 'Café / snacks', emoji: '☕', group: 'general' },
  { key: 'wifi', label: 'Wi-Fi', emoji: '📶', group: 'general' },
  { key: 'wheelchair', label: 'Wheelchair access', emoji: '♿', group: 'general' },
  { key: 'turf_artificial', label: 'Artificial turf', emoji: '🟩', group: 'surface' },
  { key: 'natural_grass', label: 'Natural grass', emoji: '🌱', group: 'surface' },
  { key: 'mud', label: 'Mud ground', emoji: '🟫', group: 'surface' },
  { key: 'hard_court', label: 'Hard court', emoji: '🧱', group: 'surface' },
  { key: 'wooden_court', label: 'Wooden court', emoji: '🪵', group: 'surface' },
  { key: 'synthetic_court', label: 'Synthetic court', emoji: '🟦', group: 'surface' },
  { key: 'indoor', label: 'Indoor', emoji: '🏟️', group: 'surface' },
  { key: 'outdoor', label: 'Outdoor', emoji: '☀️', group: 'surface' },
  { key: 'ball_boy', label: 'Ball boy', emoji: '🧒', group: 'staff' },
  { key: 'coach', label: 'Coach', emoji: '🧑‍🏫', group: 'staff' },
  { key: 'referee', label: 'Referee / umpire', emoji: '🧑‍⚖️', group: 'staff' },
  { key: 'shoes', label: 'Shoes', emoji: '👟', group: 'gear' },
  { key: 'shorts', label: 'Shorts', emoji: '🩳', group: 'gear' },
  { key: 'socks', label: 'Socks', emoji: '🧦', group: 'gear' },
  { key: 'tshirts', label: 'T-shirts', emoji: '👕', group: 'gear' },
  { key: 'bibs', label: 'Bibs / vests', emoji: '🦺', group: 'gear' },
  { key: 'ball', label: 'Ball', emoji: '⚽', group: 'gear' },
  { key: 'goalposts', label: 'Goalposts', emoji: '🥅', group: 'sport', sport: 'soccer' },
  { key: 'shuttles', label: 'Shuttles', emoji: '🏸', group: 'sport', sport: 'badminton' },
  { key: 'badminton_rackets', label: 'Badminton rackets', emoji: '🏸', group: 'sport', sport: 'badminton' },
  { key: 'cricket_bats', label: 'Cricket bats', emoji: '🏏', group: 'sport', sport: 'cricket' },
  { key: 'cricket_balls', label: 'Cricket balls', emoji: '🔴', group: 'sport', sport: 'cricket' },
  { key: 'stumps', label: 'Stumps', emoji: '🏏', group: 'sport', sport: 'cricket' },
  { key: 'cricket_nets', label: 'Practice nets', emoji: '🥅', group: 'sport', sport: 'cricket' },
  { key: 'basketballs', label: 'Basketballs', emoji: '🏀', group: 'sport', sport: 'basketball' },
  { key: 'hockey_sticks', label: 'Hockey sticks', emoji: '🏒', group: 'sport', sport: 'hockey' },
];

export const AMENITY_STATUS_LABELS: Record<AmenityStatus, string> = {
  free: 'Free',
  paid: 'Paid',
  rent: 'On rent',
  buy: 'To buy',
  rent_buy: 'Rent or buy',
  no: 'Not available',
};

export const PRICED_STATUSES: AmenityStatus[] = ['paid', 'rent', 'buy', 'rent_buy'];

export function amenitiesForSports(sports: string[]): AmenityMeta[] {
  return AMENITIES.filter(a => !a.sport || sports.includes(a.sport));
}

export function amenityStatusText(value: AmenityValue, group: AmenityMeta['group']): string {
  if (group === 'surface') return '';
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
  contact_public: boolean;
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  photos: { id: number; filename: string; caption: string; is_main: boolean }[];
  moderators: { user_id: number; name: string; phone: string; sport_type: string }[];
  upcoming_games: {
    game_id: number; title: string; sport_type: string; status: string; game_date: string; game_time: string;
    duration_minutes: number; max_players: number; player_count: number; cost_per_person: number;
    organiser_name: string; organiser_phone: string;
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
}

export const EMPTY_GROUND_DETAILS: GroundDetailsInput = {
  address: '', latitude: null, longitude: null, maps_url: '', owner_name: '', owner_phone: '', owner_email: '',
  contact_public: true, opening_hours: '', price_info: '', description: '', sports: [], amenities: {}, amenities_other: '',
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
