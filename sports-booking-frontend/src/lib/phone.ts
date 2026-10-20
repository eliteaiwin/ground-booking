// Shows phone numbers as +<country code>-<number>, e.g. +91-9999230168. Bare 10-digit numbers are Indian.
export const formatPhone = (phone?: string | null): string => {
  const raw = (phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/^\+/, '').replace(/[\s-]/g, '');
  if (digits.length === 10) return `+91-${digits}`;
  if (digits.length > 10) return `+${digits.slice(0, digits.length - 10)}-${digits.slice(-10)}`;
  return raw;
};
