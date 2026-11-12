import { describe, expect, it } from 'vitest';
import { approximate, haversineKm, isGoogleMapsUrl, parseCoordinates, resolveLocation } from '../src/services/geo.js';

describe('Google Maps link parsing', () => {
  const cases = [
    ['place link with exact pin', 'https://www.google.com/maps/place/Taman+Universiti/@2.3200,111.8400,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d2.322241!4d111.844294', 2.322241, 111.844294],
    ['map viewport link', 'https://www.google.com/maps/@2.3121,111.8406,15z', 2.3121, 111.8406],
    ['search api link', 'https://www.google.com/maps/search/?api=1&query=2.31,111.84', 2.31, 111.84],
    ['q= link', 'https://maps.google.com/?q=2.3096,111.8473', 2.3096, 111.8473],
    ['dropped pin search path', 'https://www.google.com/maps/search/2.304410,+111.819456?entry=tts', 2.30441, 111.819456],
    ['plain coordinates', '2.3123, 111.8456', 2.3123, 111.8456],
    ['plain coordinates no space', '-6.2,106.8', -6.2, 106.8],
  ];
  for (const [name, input, lat, lng] of cases) {
    it(`reads ${name}`, () => {
      expect(parseCoordinates(input)).toEqual({ latitude: lat, longitude: lng });
    });
  }

  it('prefers the exact place pin over the viewport centre', () => {
    const r = parseCoordinates('https://www.google.com/maps/place/X/@1.0,100.0,15z/data=!3d2.5!4d111.5');
    expect(r).toEqual({ latitude: 2.5, longitude: 111.5 });
  });

  it('rejects text without coordinates and impossible values', () => {
    expect(parseCoordinates('Taman Universiti, Sibu')).toBeNull();
    expect(parseCoordinates('95.0, 200.0')).toBeNull();
  });

  it('only accepts Google hosts over https', () => {
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/AbC123')).toBe(true);
    expect(isGoogleMapsUrl('https://www.google.com.my/maps/@2,111,15z')).toBe(true);
    expect(isGoogleMapsUrl('https://evil.example/maps/@2,111,15z')).toBe(false);
    expect(isGoogleMapsUrl('http://maps.app.goo.gl/x')).toBe(false);
  });

  it('expands maps.app.goo.gl short links by following Google redirects only', async () => {
    const fakeFetch = async (url) => ({
      headers: new Map([['location', url.includes('goo.gl') ? 'https://www.google.com/maps/place/X/data=!3d2.3!4d111.8' : null]]),
    });
    const r = await resolveLocation('https://maps.app.goo.gl/AbC123', { fetchImpl: fakeFetch });
    expect(r).toMatchObject({ latitude: 2.3, longitude: 111.8, mapUrl: 'https://maps.app.goo.gl/AbC123' });

    const evilFetch = async () => ({ headers: new Map([['location', 'https://evil.example/@2.3,111.8,15z']]) });
    await expect(resolveLocation('https://maps.app.goo.gl/Bad', { fetchImpl: evilFetch })).rejects.toThrow(/Could not read a location/);
  });

  it('rejects non-Google links with a helpful message', async () => {
    await expect(resolveLocation('https://example.com/house')).rejects.toThrow(/Google Maps link/);
  });

  it('computes straight-line distance and rounds public coordinates', () => {
    expect(haversineKm(2.3121, 111.8406, 2.322241, 111.844294)).toBeCloseTo(1.2, 1);
    expect(approximate(2.322241)).toBe(2.322);
  });
});
