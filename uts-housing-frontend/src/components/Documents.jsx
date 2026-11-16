import { documentUrl } from '../lib/api';

const sizeText = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** List of private documents; each opens in a new tab (access is checked by the server). */
export function DocumentLinks({ documents, onRemove, empty = 'No documents uploaded.' }) {
    if (!documents?.length) return <p className="text-[12px] text-gray-400">{empty}</p>;
    return (
        <ul className="space-y-1.5">
            {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span>{d.mimeType === 'application/pdf' ? '📄' : '🖼'}</span>
                    <a href={documentUrl(d.url)} target="_blank" rel="noopener noreferrer" className="font-bold text-[#1d4ed8] hover:underline break-all">
                        {d.kindLabel}
                    </a>
                    <span className="text-gray-400 text-[12px] break-all">{d.originalName} · {sizeText(d.sizeBytes)}</span>
                    {onRemove && (
                        <button type="button" onClick={() => onRemove(d)} className="text-[12px] font-bold text-red-600 hover:underline cursor-pointer">Remove</button>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** File input with a label, accepted types and the chosen file names. */
export function FileField({ id, label, hint, accept, multiple = false, files, onChange, required = false, error }) {
    return (
        <div>
            <label htmlFor={id} className="block text-[13px] font-bold text-gray-700 mb-1.5">
                {label} {required && <span className="text-[#e11d48]">*</span>}
            </label>
            <input
                id={id}
                type="file"
                accept={accept}
                multiple={multiple}
                onChange={(e) => onChange(Array.from(e.target.files || []))}
                className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-[#eef2ff] file:text-[#203569] hover:file:bg-[#e0e7ff] cursor-pointer"
            />
            {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
            {files?.length > 0 && <p className="text-[12px] text-gray-600 mt-1">Selected: {files.map((f) => f.name).join(', ')}</p>}
            {error && <p className="text-[12px] text-[#b91c1c] font-bold mt-1">{error}</p>}
        </div>
    );
}
