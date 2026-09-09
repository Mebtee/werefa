export interface PublicBusiness {
  id: string;
  publicSlug: string;
  name: string;
  category: string | null;
  description: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsLink: string | null;
  openStreetMapLink: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  isPaused: boolean;
  pauseMessage: string | null;
  isDeactivated: boolean;
  publicUrl: string;
  qrUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicCatalogEntry {
  id: string;
  name: string;
  basePriceMinor: number;
  baseDurationMinutes: number;
  variations: { id: string; name: string; priceDeltaMinor: number; durationDeltaMinutes: number }[];
  addOns: { id: string; name: string; priceDeltaMinor: number; durationDeltaMinutes: number }[];
}

export const PHONE_PATTERN = /^\+?[0-9\s()-]{7,20}$/;

export function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function minutes(m: number): string {
  return `${m} min`;
}
