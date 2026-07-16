// =============================================================================
// Chrome Storage Helpers
// =============================================================================

export interface NotableSettings {
  apiUrl: string;
  sessionToken: string | null;
  userEmail: string | null;
  saveMode: 'manual' | 'confirm' | 'auto';
  onboardingComplete: boolean;
}

const DEFAULTS: NotableSettings = {
  apiUrl: 'http://localhost:5000',
  sessionToken: null,
  userEmail: null,
  saveMode: 'manual',
  onboardingComplete: false,
};

/**
 * Get all settings from chrome.storage.local.
 */
export async function getSettings(): Promise<NotableSettings> {
  const data = await chrome.storage.local.get(DEFAULTS);
  return data as NotableSettings;
}

/**
 * Update one or more settings.
 */
export async function updateSettings(
  partial: Partial<NotableSettings>,
): Promise<void> {
  await chrome.storage.local.set(partial);
}

/**
 * Get the session token.
 */
export async function getToken(): Promise<string | null> {
  const { sessionToken } = await getSettings();
  return sessionToken;
}

/**
 * Store the session token and user email after login.
 */
export async function setAuth(token: string, email: string): Promise<void> {
  await updateSettings({ sessionToken: token, userEmail: email });
}

/**
 * Clear auth data (logout).
 */
export async function clearAuth(): Promise<void> {
  await updateSettings({ sessionToken: null, userEmail: null });
}

// =============================================================================
// Retry Queue
// =============================================================================

export interface RetryItem {
  url: string;
  title: string;
  description: string;
  content: string;
  contentType: string;
  metadata: Record<string, string>;
  timestamp: number;
}

/**
 * Get the current retry queue.
 */
export async function getRetryQueue(): Promise<RetryItem[]> {
  const { retryQueue = [] } = await chrome.storage.local.get('retryQueue');
  return retryQueue as RetryItem[];
}

/**
 * Add a failed save to the retry queue.
 */
export async function addToRetryQueue(item: RetryItem): Promise<void> {
  const queue = await getRetryQueue();
  queue.push(item);
  await chrome.storage.local.set({ retryQueue: queue });
}

/**
 * Clear the retry queue (after successful processing).
 */
export async function clearRetryQueue(): Promise<void> {
  await chrome.storage.local.set({ retryQueue: [] });
}

/**
 * Remove a specific item from the retry queue by index.
 */
export async function removeFromRetryQueue(index: number): Promise<void> {
  const queue = await getRetryQueue();
  queue.splice(index, 1);
  await chrome.storage.local.set({ retryQueue: queue });
}
