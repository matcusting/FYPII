// Small fetch wrapper for the UTS Housing REST API (/api/v1).
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const BASE = `${API_ORIGIN}/api/v1`;

export class ApiError extends Error {
    constructor(status, code, message, fields) {
        super(message);
        this.status = status;
        this.code = code;
        this.fields = fields || {};
    }
}

export async function api(path, { method = 'GET', body, form, query } = {}) {
    let url = `${BASE}${path}`;
    if (query) {
        const params = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => {
            if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return;
            params.set(k, Array.isArray(v) ? v.join(',') : String(v));
        });
        const qs = params.toString();
        if (qs) url += `?${qs}`;
    }
    const init = { method, credentials: 'include', headers: {} };
    if (form) {
        init.body = form; // multipart: browser sets the boundary header
    } else if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    let res;
    try {
        res = await fetch(url, init);
    } catch {
        throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const err = json?.error || {};
        throw new ApiError(res.status, err.code || 'ERROR', err.message || 'Something went wrong.', err.fields);
    }
    return json?.meta ? { data: json.data, meta: json.meta } : json?.data;
}

/** Turn an API photo path (/uploads/...) into a URL the browser can load. */
export const assetUrl = (url) => (url && url.startsWith('/uploads') ? `${API_ORIGIN}${url}` : url);

/** Google Maps link for an address typed by the landlord (opens a search for it). */
export const mapsSearchUrl = (address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;

export const homeFor = (role) => ({ STUDENT: '/student', LANDLORD: '/landlord', ADMIN: '/admin', LEGAL_REVIEWER: '/reviewer' }[role] || '/');

export const timeAgo = (iso) => {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
    if (s < 172800) return 'Yesterday';
    if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
    return new Date(iso).toLocaleDateString();
};

export const chatTime = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long' });
};

export const statusLabel = (s) =>
    ({
        DRAFT: 'Draft',
        PENDING_REVIEW: 'Pending Review',
        PUBLISHED: 'Active',
        REJECTED: 'Rejected',
        PAUSED: 'Paused',
        RENTED: 'Rented',
        ARCHIVED: 'Archived',
    }[s] || s);

export const GENDER_LABELS = { MALE: 'Male', FEMALE: 'Female' };

export const GENDER_RESTRICTION_OPTIONS = [
    { value: 'ANY', label: 'All genders welcome' },
    { value: 'MALE_ONLY', label: 'Male tenants only' },
    { value: 'FEMALE_ONLY', label: 'Female tenants only' },
];

/** Short badge text for a gender-restricted listing (null when anyone can rent). */
export const genderBadge = (restriction) => ({ MALE_ONLY: '♂ Male only', FEMALE_ONLY: '♀ Female only' }[restriction] || null);

/** True when a student of `gender` may rent a listing with this restriction. */
export const genderAllowed = (restriction, gender) =>
    !restriction || restriction === 'ANY' || (restriction === 'MALE_ONLY' && gender === 'MALE') || (restriction === 'FEMALE_ONLY' && gender === 'FEMALE');

/** Link that opens a private verification document (session cookie is sent automatically). */
export const documentUrl = (url) => `${API_ORIGIN}${url}`;

export const PROPERTY_DOCUMENT_KINDS = [
    { value: 'PROPERTY_TITLE', label: 'Title deed / proof of ownership' },
    { value: 'TENANCY_AGREEMENT', label: 'Tenancy agreement (if you are subletting)' },
    { value: 'OWNER_AUTHORISATION', label: "Owner's authorisation letter" },
    { value: 'OTHER_PROPERTY', label: 'Other supporting document' },
];

export const LEGAL_STATUS = {
    NOT_SUBMITTED: { label: 'Documents not submitted', className: 'bg-gray-100 text-gray-600' },
    PENDING: { label: 'Legal check in progress', className: 'bg-[#fefce8] text-[#a16207]' },
    APPROVED: { label: '✓ Ownership documents verified', className: 'bg-[#dcfce7] text-[#15803d]' },
    REJECTED: { label: 'Documents not accepted', className: 'bg-[#fee2e2] text-[#b91c1c]' },
};

export const MAX_DOCUMENT_MB = 10;

/** Client-side size check (the server checks type and size again). */
export const tooLarge = (files) => files.find((f) => f.size > MAX_DOCUMENT_MB * 1024 * 1024);

/** Upload picked property documents ([{ kind, file }]) for a listing, one request per document type. */
export async function uploadPropertyDocuments(listingId, picked) {
    const byKind = picked.reduce((m, d) => ({ ...m, [d.kind]: [...(m[d.kind] || []), d.file] }), {});
    let last = null;
    for (const [kind, files] of Object.entries(byKind)) {
        const form = new FormData();
        form.append('kind', kind);
        files.forEach((f) => form.append('documents', f));
        last = await api(`/listings/${listingId}/documents`, { method: 'POST', form });
    }
    return last;
}
