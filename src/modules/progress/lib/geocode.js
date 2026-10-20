/**
 * Reverse geocoding — turns GPS coordinates into a human-readable address for the
 * camera overlay. Uses OpenStreetMap's free Nominatim API (no key required, but
 * rate-limited to ~1 req/sec — we only call this once per capture session, not
 * per photo). Swap this out for Google/Mapbox later if volume or accuracy needs it
 * (PROJECT_PLAN.md action item #6).
 */
export async function reverseGeocode(lat, lng, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Reverse geocode failed: ${res.status}`);
    const data = await res.json();
    return data?.display_name ? shortenAddress(data.display_name) : null;
  } catch (e) {
    console.warn('[geocode] reverse geocode failed:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Nominatim addresses are long ("371, Beach Road, ..., Singapore, 199597, Singapore") — keep the first couple of segments. */
function shortenAddress(displayName) {
  const parts = displayName.split(',').map((p) => p.trim());
  return parts.slice(0, 2).join(' ');
}
