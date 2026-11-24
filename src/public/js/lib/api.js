// fetch() wrapper: sends the CSRF token, parses JSON and throws a readable Arabic error.
import { t } from './i18n.js';

const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content ?? '';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(url, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(t('networkError'), 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data?.error?.message ?? t('networkError'), response.status);
  return data;
}

export const post = (url, body = {}) => api(url, { method: 'POST', body });
