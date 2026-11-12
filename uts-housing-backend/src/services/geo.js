/**
 * Google Maps link → coordinates → distance to campus.
 *
 * Landlords paste the link from Google Maps ("Share → Copy link") or raw
 * coordinates. We extract latitude/longitude and compute the straight-line
 * (Haversine) distance to the campus, so distance is no longer typed by hand.
 */

/** Great-circle distance in km (approximate, NOT driving distance). */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const valid = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

/**
 * Extract coordinates from a full Google Maps URL or plain "lat, lng" text.
 * Returns { latitude, longitude } or null.
 */
export function parseCoordinates(input) {
  if (!input) return null;
  const text = decodeURIComponent(String(input).trim()).replace(/\+/g, ' ');
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`), // exact pin of a place: ...!3d2.3123!4d111.84...
    new RegExp(`[?&](?:q|query|ll|destination|center|daddr)=(?:loc:)?\\s*${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`/search/${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`/place/${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`@${NUM},${NUM}`), // map viewport centre: /@2.3123,111.84,17z
    new RegExp(`^${NUM}\\s*,\\s*${NUM}$`), // plain "2.3123, 111.8456"
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (valid(lat, lng)) return { latitude: lat, longitude: lng };
    }
  }
  return null;
}

// Short links redirect to a full maps URL. Only Google hosts may be fetched (prevents SSRF).
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
const isGoogleHost = (h) => h === 'google.com' || h.endsWith('.google.com') || /^(www\.|maps\.)?google\.[a-z.]{2,6}$/.test(h);

export function isGoogleMapsUrl(input) {
  try {
    const u = new URL(String(input).trim());
    return u.protocol === 'https:' && (SHORT_HOSTS.has(u.hostname) || isGoogleHost(u.hostname));
  } catch {
    return false;
  }
}

/** Follow up to 5 redirects of a maps.app.goo.gl short link, staying on Google hosts. */
async function expandShortLink(url, fetchImpl) {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const location = res.headers.get('location');
    if (!location) return current;
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || !(SHORT_HOSTS.has(next.hostname) || isGoogleHost(next.hostname))) return current;
    current = next.toString();
    if (parseCoordinates(current)) return current;
  }
  return current;
}

/**
 * Resolve user input (Google Maps link or "lat, lng") to coordinates.
 * @returns {Promise<{latitude:number, longitude:number, mapUrl:string|null}>}
 * @throws Error with a user-friendly message
 */
export async function resolveLocation(input, { fetchImpl = fetch } = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a Google Maps link or coordinates.');
  const direct = parseCoordinates(raw);
  if (direct) return { ...direct, mapUrl: isGoogleMapsUrl(raw) ? raw : null };

  if (!isGoogleMapsUrl(raw)) {
    throw new Error('That does not look like a Google Maps link. In Google Maps tap Share → Copy link, or paste coordinates like "2.3123, 111.8456".');
  }
  const host = new URL(raw).hostname;
  if (SHORT_HOSTS.has(host)) {
    try {
      const expanded = await expandShortLink(raw, fetchImpl);
      const coords = parseCoordinates(expanded);
      if (coords) return { ...coords, mapUrl: raw };
    } catch {
      /* fall through to the friendly error */
    }
  }
  throw new Error('Could not read a location from this link. Open the place in Google Maps, drop a pin on the house, then copy the link again — or paste the coordinates shown at the bottom of the screen.');
}

/** Public links for a coordinate pair. */
export const mapsLinks = (lat, lng, campus) => ({
  view: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  embed: `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`,
  directions: campus
    ? `https://www.google.com/maps/dir/?api=1&origin=${lat},${lng}&destination=${Number(campus.latitude)},${Number(campus.longitude)}`
    : null,
});

/** Round to ~110 m so the public map shows the neighbourhood, not the exact door. */
export const approximate = (v) => Math.round(Number(v) * 1000) / 1000;
