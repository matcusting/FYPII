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

export const homeFor = (role) => ({ STUDENT: '/student', LANDLORD: '/landlord', ADMIN: '/admin' }[role] || '/');

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
