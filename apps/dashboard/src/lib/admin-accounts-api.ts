import { api } from './api';

export interface AdminAccountListItem {
  id: string;
  email: string;
  disabledAt: string | null;
  createdAt: string;
}

export interface CreateAdminInput {
  email: string;
  password: string;
}

export const adminAccountsApi = {
  list: () =>
    api.get<{ admins: AdminAccountListItem[] }>('/api/v1/super-admin/admins').then((r) => r.admins),
  create: (input: CreateAdminInput) =>
    api.post<{ id: string; email: string }>('/api/v1/super-admin/admins', input),
  deactivate: (id: string) => api.post<void>(`/api/v1/super-admin/admins/${id}/deactivate`),
  reactivate: (id: string) => api.post<void>(`/api/v1/super-admin/admins/${id}/reactivate`),
  changePassword: (id: string, newPassword: string) =>
    api.post<void>(`/api/v1/super-admin/admins/${id}/password`, { newPassword }),
  forceSignOut: (userId: string) => api.post<void>(`/api/v1/super-admin/logout/${userId}`),
};
