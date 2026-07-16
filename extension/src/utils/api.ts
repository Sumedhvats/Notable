// =============================================================================
// API Client for Notable Backend
// =============================================================================

import { getSettings, clearAuth } from './storage.js';

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Make an authenticated API call to the Notable backend.
 * Handles auth errors (401) by clearing the stored token.
 */
export async function apiCall<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const { apiUrl, sessionToken } = await getSettings();

  if (!sessionToken) {
    return { ok: false, status: 401, error: 'Not authenticated' };
  }

  const url = `${apiUrl}/api${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Cookie: `better-auth.session_token=${sessionToken}`,
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });

    if (response.status === 401) {
      await clearAuth();
      return { ok: false, status: 401, error: 'Session expired — please log in again' };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        ok: false,
        status: response.status,
        error: (errorData as any).error || `Request failed (${response.status})`,
      };
    }

    // Handle text responses (e.g., markdown export)
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/')) {
      const text = await response.text();
      return { ok: true, status: response.status, data: text as unknown as T };
    }

    const data = await response.json();
    return { ok: true, status: response.status, data: data as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: `Network error: ${(err as Error).message}`,
    };
  }
}

/**
 * Check if a URL has already been saved.
 */
export async function checkUrlExists(
  url: string,
): Promise<{ exists: boolean; memoryId?: string }> {
  const res = await apiCall<{ exists: boolean; memoryId?: string }>(
    'GET',
    `/memories/check?url=${encodeURIComponent(url)}`,
  );
  if (res.ok && res.data) {
    return res.data;
  }
  return { exists: false };
}

/**
 * Save a memory via the extension endpoint.
 */
export async function saveMemory(payload: {
  url: string;
  title: string;
  description: string;
  content: string;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<ApiResponse> {
  return apiCall('POST', '/memories/extension', payload);
}

/**
 * Check if authenticated by verifying the stored token is still valid.
 */
export async function isAuthenticated(): Promise<boolean> {
  const { sessionToken } = await getSettings();
  if (!sessionToken) return false;

  // Quick validation: try to list memories (limit=1)
  const res = await apiCall('GET', '/memories?limit=1');
  return res.ok;
}
