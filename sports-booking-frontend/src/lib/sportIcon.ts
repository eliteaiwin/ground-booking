export const sportIconChar = (type: string) => {
  if (type === 'soccer' || type === 'football') return '\u26BD';
  if (type === 'cricket') return '\uD83C\uDFCF';
  if (type === 'badminton') return '\uD83C\uDFF8';
  if (type === 'basketball') return '\uD83C\uDFC0';
  if (type === 'hockey') return '\uD83C\uDFD2';
  if (type === 'pickleball' || type === 'lawn_tennis' || type === 'tennis') return '\uD83C\uDFBE';
  if (type === 'swimming') return '\uD83C\uDFCA';
  return '\uD83C\uDFC5';
};

export const sportLabel = (type: string) =>
  type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
