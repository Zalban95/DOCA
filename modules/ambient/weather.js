'use strict';

/**
 * The weather where a screen is, for the ambient screen (asked 2026-10-06: "the usual info like weather, forecast…").
 * Open-Meteo: no key and no account, so a fresh hub shows it as soon as a place is named. The place is a name
 * (`ambient.place`, geocoded once) or "lat,lon". Kept 15 minutes per place, so ten screens ask once.
 */
const GEO = process.env.DOCA_GEOCODE_API || 'https://geocoding-api.open-meteo.com/v1/search';
const API = process.env.DOCA_WEATHER_API || 'https://api.open-meteo.com/v1/forecast';
const KEEP_MS = 15 * 60000;
const _cache = new Map();   // key → {at, value}

/** WMO weather codes, as a word and a sign. */
const CODES = [[0, 'clear', '☀'], [1, 'mostly clear', '🌤'], [2, 'partly cloudy', '⛅'], [3, 'overcast', '☁'], [45, 'fog', '🌫'], [48, 'fog', '🌫'],
  [51, 'drizzle', '🌦'], [53, 'drizzle', '🌦'], [55, 'drizzle', '🌦'], [56, 'freezing drizzle', '🌧'], [57, 'freezing drizzle', '🌧'],
  [61, 'light rain', '🌦'], [63, 'rain', '🌧'], [65, 'heavy rain', '🌧'], [66, 'freezing rain', '🌧'], [67, 'freezing rain', '🌧'],
  [71, 'light snow', '🌨'], [73, 'snow', '🌨'], [75, 'heavy snow', '❄'], [77, 'snow grains', '🌨'], [80, 'showers', '🌦'], [81, 'showers', '🌧'],
  [82, 'violent showers', '⛈'], [85, 'snow showers', '🌨'], [86, 'snow showers', '❄'], [95, 'thunderstorm', '⛈'], [96, 'thunderstorm, hail', '⛈'], [99, 'thunderstorm, hail', '⛈']];
const word = c => (CODES.find(([k]) => k === c) || [c, 'unknown', '·']).slice(1);

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'DOCA' } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

/** A place name or "lat,lon" → {name, lat, lon}. */
async function locate(place) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(place);
  if (m) return { name: place.trim(), lat: Number(m[1]), lon: Number(m[2]) };
  const j = await getJson(`${GEO}?name=${encodeURIComponent(place)}&count=1&format=json`);
  const p = j.results?.[0];
  if (!p) throw Object.assign(new Error(`No place called "${place}" was found.`), { status: 404 });
  return { name: [p.name, p.admin1, p.country_code].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude };
}

/** Now and the next days at `place`, in `units` (metric | imperial). */
async function forecast(place, units = 'metric') {
  place = String(place || '').trim();
  if (!place) return null;
  const key = `${place.toLowerCase()}|${units}`, hit = _cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const at = await locate(place);
  const imp = units === 'imperial';
  const q = new URLSearchParams({ latitude: at.lat, longitude: at.lon, timezone: 'auto', forecast_days: '6',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    ...(imp ? { temperature_unit: 'fahrenheit', wind_speed_unit: 'mph' } : {}) });
  const j = await getJson(`${API}?${q}`);
  const c = j.current || {}, d = j.daily || {};
  const value = {
    place: at.name, units: imp ? 'imperial' : 'metric', unit: imp ? '°F' : '°C', wind: imp ? 'mph' : 'km/h',
    now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, windSpeed: c.wind_speed_10m,
      code: c.weather_code, text: word(c.weather_code)[0], icon: c.is_day === 0 && c.weather_code <= 1 ? '☾' : word(c.weather_code)[1] },
    days: (d.time || []).map((date, i) => ({ date, max: d.temperature_2m_max?.[i], min: d.temperature_2m_min?.[i], rain: d.precipitation_probability_max?.[i],
      code: d.weather_code?.[i], text: word(d.weather_code?.[i])[0], icon: word(d.weather_code?.[i])[1] })),
    at: new Date().toISOString(),
  };
  _cache.set(key, { at: Date.now(), value });
  if (_cache.size > 50) _cache.delete(_cache.keys().next().value);
  return value;
}

module.exports = { forecast, locate, word };
