// ISO 3166-1 alpha-2 → emoji flag, plus a short country-name lookup for chips.
// Flag emoji is built from regional-indicator symbols: U+1F1E6 + (charCode - 'A').

export const COUNTRY_NAMES: Record<string, string> = {
  ZW: 'Zimbabwe',
  ZA: 'South Africa',
  BW: 'Botswana',
  NA: 'Namibia',
  ZM: 'Zambia',
  MW: 'Malawi',
  MZ: 'Mozambique',
  KE: 'Kenya',
  TZ: 'Tanzania',
  UG: 'Uganda',
  RW: 'Rwanda',
  NG: 'Nigeria',
  GH: 'Ghana',
  ET: 'Ethiopia',
  EG: 'Egypt',
  MA: 'Morocco',
  US: 'United States',
  GB: 'United Kingdom',
  IE: 'Ireland',
  AU: 'Australia',
  CA: 'Canada',
  IN: 'India',
  CN: 'China',
  FR: 'France',
  DE: 'Germany',
  ES: 'Spain',
  IT: 'Italy',
  NL: 'Netherlands',
  PT: 'Portugal',
  BR: 'Brazil',
  MX: 'Mexico',
  AE: 'United Arab Emirates',
};

/** Returns the flag emoji for an ISO alpha-2 code, or '' for unknown/empty. */
export function flagFor(code: string | null | undefined): string {
  if (!code) return '';
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + c.charCodeAt(0) - 65, base + c.charCodeAt(1) - 65);
}

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/** Ordered list for select/filter UIs — common African + global picks first. */
export const COUNTRY_OPTIONS: { code: string; name: string }[] = [
  'ZW',
  'ZA',
  'BW',
  'NA',
  'ZM',
  'MW',
  'MZ',
  'KE',
  'TZ',
  'UG',
  'RW',
  'NG',
  'GH',
  'ET',
  'EG',
  'MA',
  'US',
  'GB',
  'IE',
  'AU',
  'CA',
  'IN',
  'CN',
  'FR',
  'DE',
  'ES',
  'IT',
  'NL',
  'PT',
  'BR',
  'MX',
  'AE',
].map((code) => ({ code, name: COUNTRY_NAMES[code] }));
