export interface Actor {
  userId: string;
  role: 'Owner' | 'Admin' | 'SuperAdmin';
  businessId?: string;
  ownedBusinessIds: string[];
}

export interface BusinessDetail {
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
  pausedUntil: string | null;
  pauseMessage: string | null;
  deactivatedAt: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  publicUrl: string;
  qrUrl: string;
  logoKey: string | null;
  coverKey: string | null;
  owner?: { userId: string; email: string | null } | null;
}

export interface ApiEnvelope<E = unknown> {
  error: {
    code: string;
    title: string;
    detail: string | null;
    fields: { field: string; message: string }[] | null;
  } & E;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: ApiEnvelope['error']['fields'];

  constructor(status: number, envelope: ApiEnvelope['error']) {
    super(envelope.title);
    this.name = 'ApiError';
    this.code = envelope.code;
    this.status = status;
    this.fields = envelope.fields;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      // CSRF defense (doc 18): state-changing requests must carry the custom
      // header when a session cookie is present.
      'x-requested-with': 'fetch',
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiEnvelope | null;
  if (!res.ok) {
    const env = body as ApiEnvelope | null;
    throw new ApiError(
      res.status,
      env?.error ?? { code: 'INTERNAL_ERROR', title: 'Request failed', detail: null, fields: null },
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, file: File): Promise<T> => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(path, {
      credentials: 'include',
      method: 'POST',
      headers: { 'x-requested-with': 'fetch' },
      body: fd,
    }).then(async (res) => {
      const body = (await res.json().catch(() => null)) as T | ApiEnvelope | null;
      if (!res.ok) {
        const env = body as ApiEnvelope | null;
        throw new ApiError(
          res.status,
          env?.error ?? {
            code: 'INTERNAL_ERROR',
            title: 'Request failed',
            detail: null,
            fields: null,
          },
        );
      }
      return body as T;
    });
  },
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
};

const ACTOR_KEY = 'werefa:actor';

export const sessionStore = {
  getActor(): Actor | null {
    const raw = localStorage.getItem(ACTOR_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Actor;
    } catch {
      return null;
    }
  },
  setActor(actor: Actor | null): void {
    if (actor === null) localStorage.removeItem(ACTOR_KEY);
    else localStorage.setItem(ACTOR_KEY, JSON.stringify(actor));
  },
};
