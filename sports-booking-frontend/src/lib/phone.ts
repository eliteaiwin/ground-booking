// Phone numbers show without a country code when they belong to the "home" country (the ground's country,
// India by default); numbers from other countries show as +<code>-<number> with a non-breaking hyphen.
// Bare 10-digit numbers are Indian.
let homeCode = '91';

export const setPhoneHomeCountry = (code?: string | null) => {
  homeCode = (code || '').replace(/\D/g, '') || '91';
};

export const COUNTRY_CODES: { code: string; name: string }[] = [
  { code: '91', name: 'India' },
  { code: '44', name: 'United Kingdom' },
  { code: '1', name: 'USA / Canada' },
  { code: '971', name: 'UAE' },
  { code: '966', name: 'Saudi Arabia' },
  { code: '974', name: 'Qatar' },
  { code: '65', name: 'Singapore' },
  { code: '61', name: 'Australia' },
  { code: '64', name: 'New Zealand' },
  { code: '49', name: 'Germany' },
  { code: '977', name: 'Nepal' },
  { code: '94', name: 'Sri Lanka' },
];

export const formatPhone = (phone?: string | null): string => {
  const raw = (phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/^\+/, '').replace(/[\s-]/g, '');
  let code = '';
  let local = digits;
  if (digits.length === 10) code = '91';
  else if (digits.length > 10) { code = digits.slice(0, digits.length - 10); local = digits.slice(-10); }
  else return raw;
  return code === homeCode ? local : `+${code}\u2011${local}`;
};
