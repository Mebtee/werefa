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

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = (await res.json().catch(() => null)) as T | ApiEnvelope | null;
  if (!res.ok) {
    const env = (body as ApiEnvelope | null)?.error;
    if (env) throw new ApiError(res.status, env);
    throw new ApiError(res.status, {
      code: 'INTERNAL_ERROR',
      title: 'Request failed',
      detail: null,
      fields: null,
    });
  }
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<T>(path: string, data: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
    body: JSON.stringify(data),
  });
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return apiRequest<T>(path, {
    method: 'POST',
    headers: { 'x-requested-with': 'fetch' },
    body: form,
  });
}
