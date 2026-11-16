import { useState } from 'react';
import { MAX_DOCUMENT_MB, PROPERTY_DOCUMENT_KINDS, tooLarge } from '../lib/api';

/**
 * Pick ownership / right-to-rent documents for a property before upload.
 * `value` is a list of { kind, file }.
 */
export default function PropertyDocumentPicker({ value, onChange, disabled = false }) {
    const [kind, setKind] = useState('PROPERTY_TITLE');
    const [error, setError] = useState(null);
    const labelFor = (k) => PROPERTY_DOCUMENT_KINDS.find((x) => x.value === k)?.label || k;

    const add = (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        const big = tooLarge(files);
        if (big) { setError(`"${big.name}" is larger than ${MAX_DOCUMENT_MB} MB.`); return; }
        setError(null);
        onChange([...value, ...files.map((file) => ({ kind, file }))].slice(0, 10));
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
                <select aria-label="Document type" value={kind} onChange={(e) => setKind(e.target.value)} disabled={disabled} className="flex-1 p-2.5 border border-gray-300 rounded-md outline-none focus:border-[#203569] text-gray-800 bg-white text-sm">
                    {PROPERTY_DOCUMENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <label className={`border border-[#203569] text-[#203569] text-sm font-bold px-4 py-2.5 rounded-md text-center transition ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-blue-50'}`}>
                    + Add file
                    <input type="file" accept="application/pdf,image/jpeg,image/png" multiple disabled={disabled} onChange={add} className="hidden" />
                </label>
            </div>
            {error && <p className="text-[12px] text-[#b91c1c] font-bold">{error}</p>}
            {value.length > 0 && (
                <ul className="space-y-1.5">
                    {value.map((d, i) => (
                        <li key={`${d.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-[13px] bg-[#f8f9fa] border border-gray-200 rounded-md px-3 py-2">
                            <span>{d.file.type === 'application/pdf' ? '📄' : '🖼'}</span>
                            <strong className="text-gray-800">{labelFor(d.kind)}</strong>
                            <span className="text-gray-500 break-all">{d.file.name}</span>
                            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="ml-auto text-[12px] font-bold text-red-600 hover:underline cursor-pointer">Remove</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
