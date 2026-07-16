// =============================================================================
// Content Script — injected into web pages on demand
// =============================================================================
// This script runs in the page's DOM context via chrome.scripting.executeScript.
// It extracts page content and sends it back to the background service worker.

import { extractPage } from './utils/extractor.js';

/**
 * Extract content from the current page and return it.
 * This is called by the background script via chrome.scripting.executeScript.
 */
function run() {
  const url = window.location.href;
  const result = extractPage(url);
  return result;
}

// Execute immediately when injected
run();
