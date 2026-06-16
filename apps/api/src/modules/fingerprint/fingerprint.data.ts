// Realistic device + locale catalogs used to generate believable, randomized
// fingerprints. Kept as plain data so the generator stays deterministic-ish and
// easy to extend.

export type DeviceModel = {
  manufacturer: string;
  brand: string;
  model: string;
  resolution: string;
  dpi: number;
  osVersions: string[];
};

export const DEVICE_MODELS: DeviceModel[] = [
  { manufacturer: 'Samsung', brand: 'samsung', model: 'SM-S918B', resolution: '1440x3088', dpi: 500, osVersions: ['13', '14'] },
  { manufacturer: 'Samsung', brand: 'samsung', model: 'SM-A546B', resolution: '1080x2340', dpi: 450, osVersions: ['13', '14'] },
  { manufacturer: 'Samsung', brand: 'samsung', model: 'SM-G991B', resolution: '1080x2400', dpi: 421, osVersions: ['12', '13'] },
  { manufacturer: 'Google', brand: 'google', model: 'Pixel 8 Pro', resolution: '1344x2992', dpi: 489, osVersions: ['14', '15'] },
  { manufacturer: 'Google', brand: 'google', model: 'Pixel 7', resolution: '1080x2400', dpi: 416, osVersions: ['13', '14'] },
  { manufacturer: 'Xiaomi', brand: 'Redmi', model: 'Redmi Note 12', resolution: '1080x2400', dpi: 395, osVersions: ['12', '13'] },
  { manufacturer: 'Xiaomi', brand: 'xiaomi', model: '2210132G', resolution: '1440x3200', dpi: 522, osVersions: ['13', '14'] },
  { manufacturer: 'OnePlus', brand: 'OnePlus', model: 'CPH2449', resolution: '1440x3216', dpi: 525, osVersions: ['13', '14'] },
  { manufacturer: 'OPPO', brand: 'OPPO', model: 'CPH2451', resolution: '1240x2772', dpi: 450, osVersions: ['13'] },
  { manufacturer: 'vivo', brand: 'vivo', model: 'V2230', resolution: '1080x2400', dpi: 388, osVersions: ['13'] },
  { manufacturer: 'motorola', brand: 'motorola', model: 'moto g84 5G', resolution: '1080x2400', dpi: 393, osVersions: ['13', '14'] }
];

export type Locale = {
  country: string;
  countryCode: string;
  timezone: string;
  language: string;
  mcc: string;
  mnc: string;
  carrier: string;
  dialCode: string;
  // Approximate center coordinates for GPS simulation.
  lat: number;
  lng: number;
};

// 150+ countries condensed to a representative, broad set with valid MCC/MNC,
// timezones and carriers. Coordinates are the capital/major-city center.
export const LOCALES: Locale[] = [
  { country: 'United States', countryCode: 'US', timezone: 'America/New_York', language: 'en', mcc: '310', mnc: '260', carrier: 'T-Mobile', dialCode: '+1', lat: 40.7128, lng: -74.006 },
  { country: 'United Kingdom', countryCode: 'GB', timezone: 'Europe/London', language: 'en', mcc: '234', mnc: '15', carrier: 'Vodafone', dialCode: '+44', lat: 51.5074, lng: -0.1278 },
  { country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin', language: 'de', mcc: '262', mnc: '01', carrier: 'Telekom', dialCode: '+49', lat: 52.52, lng: 13.405 },
  { country: 'France', countryCode: 'FR', timezone: 'Europe/Paris', language: 'fr', mcc: '208', mnc: '01', carrier: 'Orange', dialCode: '+33', lat: 48.8566, lng: 2.3522 },
  { country: 'Turkey', countryCode: 'TR', timezone: 'Europe/Istanbul', language: 'tr', mcc: '286', mnc: '01', carrier: 'Turkcell', dialCode: '+90', lat: 41.0082, lng: 28.9784 },
  { country: 'Spain', countryCode: 'ES', timezone: 'Europe/Madrid', language: 'es', mcc: '214', mnc: '07', carrier: 'Movistar', dialCode: '+34', lat: 40.4168, lng: -3.7038 },
  { country: 'Italy', countryCode: 'IT', timezone: 'Europe/Rome', language: 'it', mcc: '222', mnc: '10', carrier: 'TIM', dialCode: '+39', lat: 41.9028, lng: 12.4964 },
  { country: 'Netherlands', countryCode: 'NL', timezone: 'Europe/Amsterdam', language: 'nl', mcc: '204', mnc: '04', carrier: 'Vodafone', dialCode: '+31', lat: 52.3676, lng: 4.9041 },
  { country: 'Brazil', countryCode: 'BR', timezone: 'America/Sao_Paulo', language: 'pt', mcc: '724', mnc: '06', carrier: 'Vivo', dialCode: '+55', lat: -23.5505, lng: -46.6333 },
  { country: 'Canada', countryCode: 'CA', timezone: 'America/Toronto', language: 'en', mcc: '302', mnc: '610', carrier: 'Bell', dialCode: '+1', lat: 43.6532, lng: -79.3832 },
  { country: 'Australia', countryCode: 'AU', timezone: 'Australia/Sydney', language: 'en', mcc: '505', mnc: '01', carrier: 'Telstra', dialCode: '+61', lat: -33.8688, lng: 151.2093 },
  { country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo', language: 'ja', mcc: '440', mnc: '10', carrier: 'NTT Docomo', dialCode: '+81', lat: 35.6762, lng: 139.6503 },
  { country: 'South Korea', countryCode: 'KR', timezone: 'Asia/Seoul', language: 'ko', mcc: '450', mnc: '05', carrier: 'SKT', dialCode: '+82', lat: 37.5665, lng: 126.978 },
  { country: 'India', countryCode: 'IN', timezone: 'Asia/Kolkata', language: 'en', mcc: '404', mnc: '45', carrier: 'Airtel', dialCode: '+91', lat: 28.6139, lng: 77.209 },
  { country: 'Indonesia', countryCode: 'ID', timezone: 'Asia/Jakarta', language: 'id', mcc: '510', mnc: '10', carrier: 'Telkomsel', dialCode: '+62', lat: -6.2088, lng: 106.8456 },
  { country: 'Mexico', countryCode: 'MX', timezone: 'America/Mexico_City', language: 'es', mcc: '334', mnc: '020', carrier: 'Telcel', dialCode: '+52', lat: 19.4326, lng: -99.1332 },
  { country: 'Russia', countryCode: 'RU', timezone: 'Europe/Moscow', language: 'ru', mcc: '250', mnc: '01', carrier: 'MTS', dialCode: '+7', lat: 55.7558, lng: 37.6173 },
  { country: 'Poland', countryCode: 'PL', timezone: 'Europe/Warsaw', language: 'pl', mcc: '260', mnc: '01', carrier: 'Plus', dialCode: '+48', lat: 52.2297, lng: 21.0122 },
  { country: 'Sweden', countryCode: 'SE', timezone: 'Europe/Stockholm', language: 'sv', mcc: '240', mnc: '01', carrier: 'Telia', dialCode: '+46', lat: 59.3293, lng: 18.0686 },
  { country: 'United Arab Emirates', countryCode: 'AE', timezone: 'Asia/Dubai', language: 'ar', mcc: '424', mnc: '02', carrier: 'Etisalat', dialCode: '+971', lat: 25.2048, lng: 55.2708 },
  { country: 'Saudi Arabia', countryCode: 'SA', timezone: 'Asia/Riyadh', language: 'ar', mcc: '420', mnc: '01', carrier: 'STC', dialCode: '+966', lat: 24.7136, lng: 46.6753 },
  { country: 'Argentina', countryCode: 'AR', timezone: 'America/Argentina/Buenos_Aires', language: 'es', mcc: '722', mnc: '310', carrier: 'Claro', dialCode: '+54', lat: -34.6037, lng: -58.3816 },
  { country: 'Singapore', countryCode: 'SG', timezone: 'Asia/Singapore', language: 'en', mcc: '525', mnc: '01', carrier: 'Singtel', dialCode: '+65', lat: 1.3521, lng: 103.8198 },
  { country: 'Nigeria', countryCode: 'NG', timezone: 'Africa/Lagos', language: 'en', mcc: '621', mnc: '30', carrier: 'MTN', dialCode: '+234', lat: 6.5244, lng: 3.3792 },
  { country: 'South Africa', countryCode: 'ZA', timezone: 'Africa/Johannesburg', language: 'en', mcc: '655', mnc: '01', carrier: 'Vodacom', dialCode: '+27', lat: -26.2041, lng: 28.0473 }
];
