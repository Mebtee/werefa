import { api, type BusinessDetail } from './api';

export interface BusinessProfileInput {
  name?: string;
  publicSlug?: string;
  category?: string;
  description?: string;
  phone?: string;
  contactEmail?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googleMapsLink?: string;
  openStreetMapLink?: string;
}

export const businessApi = {
  create: (input: BusinessProfileInput) =>
    api.post<{ business: BusinessDetail }>('/api/v1/businesses', input).then((r) => r.business),
  listMine: () =>
    api.get<{ businesses: BusinessDetail[] }>('/api/v1/businesses').then((r) => r.businesses),
  get: (id: string) =>
    api.get<{ business: BusinessDetail }>(`/api/v1/businesses/${id}`).then((r) => r.business),
  update: (id: string, input: BusinessProfileInput) =>
    api
      .patch<{ business: BusinessDetail }>(`/api/v1/businesses/${id}`, input)
      .then((r) => r.business),
  pause: (id: string, body: { until?: string; message?: string }) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/businesses/${id}/pause`, body)
      .then((r) => r.business),
  resume: (id: string) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/businesses/${id}/resume`)
      .then((r) => r.business),
  deactivate: (id: string) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/businesses/${id}/deactivate`)
      .then((r) => r.business),
  reactivate: (id: string) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/businesses/${id}/reactivate`)
      .then((r) => r.business),
  select: (id: string) => api.post<{ activeBusinessId: string }>(`/api/v1/businesses/${id}/select`),
  uploadLogo: (id: string, file: File) =>
    api
      .upload<{ business: BusinessDetail }>(`/api/v1/businesses/${id}/logo`, file)
      .then((r) => r.business),
  uploadCover: (id: string, file: File) =>
    api
      .upload<{ business: BusinessDetail }>(`/api/v1/businesses/${id}/cover`, file)
      .then((r) => r.business),
};

export const adminBusinessApi = {
  list: (search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return api
      .get<{ businesses: BusinessDetail[] }>(`/api/v1/admin/businesses${q}`)
      .then((r) => r.businesses);
  },
  get: (id: string) =>
    api.get<{ business: BusinessDetail }>(`/api/v1/admin/businesses/${id}`).then((r) => r.business),
  update: (id: string, input: BusinessProfileInput) =>
    api
      .patch<{ business: BusinessDetail }>(`/api/v1/admin/businesses/${id}`, input)
      .then((r) => r.business),
  pause: (id: string, body: { until?: string; message?: string }) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/admin/businesses/${id}/pause`, body)
      .then((r) => r.business),
  resume: (id: string) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/admin/businesses/${id}/resume`)
      .then((r) => r.business),
  deactivate: (id: string) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/admin/businesses/${id}/deactivate`)
      .then((r) => r.business),
  reactivate: (id: string) =>
    api
      .post<{ business: BusinessDetail }>(`/api/v1/admin/businesses/${id}/reactivate`)
      .then((r) => r.business),
};
