import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Google Maps link input for landlords. Checks the link with the server,
 * shows the pin on an embedded map and the calculated distance to campus.
 *
 * props: value, onChange(text), onResolved(result | null), initial (existing listing.location), compact
 */
const MapLinkField = ({ value, onChange, onResolved, initial = null, compact = false }) => {
    const [result, setResult] = useState(initial ? { links: initial.links, latitude: initial.latitude, longitude: initial.longitude } : null);
    const [error, setError] = useState(null);
    const [checking, setChecking] = useState(false);
    const [checkedValue, setCheckedValue] = useState(initial ? value : null);

    const check = async () => {
        const text = value.trim();
        if (!text || text === checkedValue) return;
        setChecking(true);
        setError(null);
        try {
            const r = await api('/listings/resolve-location', { method: 'POST', body: { mapLink: text } });
            setResult(r);
            setCheckedValue(text);
            onResolved(r);
        } catch (err) {
            setResult(null);
            setCheckedValue(null);
            setError(err.message);
            onResolved(null);
        } finally {
            setChecking(false);
        }
    };

    const handleChange = (e) => {
        onChange(e.target.value);
        if (result && e.target.value.trim() !== checkedValue) {
            setResult(null);
            onResolved(null);
        }
    };

    const pad = compact ? 'p-2.5' : 'p-3';

    return (
        <div>
            <label htmlFor="mapLink" className={`block text-[13px] font-bold text-[#374151] ${compact ? 'mb-1' : 'mb-2'}`}>📍 Google Maps Link</label>
            <div className="flex flex-col sm:flex-row gap-2">
                <input
                    id="mapLink"
                    type="text"
                    inputMode="url"
                    value={value}
                    onChange={handleChange}
                    onBlur={check}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } }}
                    placeholder="https://maps.app.goo.gl/...  or  2.3123, 111.8456"
                    className={`flex-1 min-w-0 ${pad} border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800`}
                />
                <button
                    type="button"
                    onClick={check}
                    disabled={checking || !value.trim()}
                    className="border border-[#203569] text-[#203569] text-[13px] font-bold px-4 py-2 rounded-md bg-white hover:bg-blue-50 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                    {checking ? 'Checking...' : 'Check Location'}
                </button>
            </div>
            {!compact && (
                <p className="text-[12px] text-gray-500 mt-1.5">
                    In Google Maps, find the house (long-press to drop a pin), tap <strong>Share → Copy link</strong> and paste it here. The distance to UTS is calculated automatically. Students only see the approximate area (about 100 m), not your exact door.
                </p>
            )}
            {error && <p className="text-[12px] text-[#b91c1c] font-bold mt-1.5" role="alert">{error}</p>}
            {result && (
                <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
                    <iframe
                        title="Property location preview"
                        src={result.links.embed}
                        className={`w-full ${compact ? 'h-[150px]' : 'h-[200px]'} border-0`}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                    ></iframe>
                    <div className="px-4 py-2.5 bg-[#f0fdf4] flex flex-wrap gap-x-4 gap-y-1 justify-between items-center text-[13px]">
                        <span className="font-bold text-[#15803d]">
                            ✓ Location found{result.distanceKm != null && <> • ≈ {result.distanceKm} km to {result.campus?.name || 'UTS'} (straight line)</>}
                        </span>
                        <a href={result.links.view} target="_blank" rel="noopener noreferrer" className="font-bold text-[#1d4ed8] hover:underline">Open in Google Maps ↗</a>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MapLinkField;
