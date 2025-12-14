// API configuration
// In development, set BUN_PUBLIC_API_URL to point to your API server
// e.g., BUN_PUBLIC_API_URL=http://localhost:3001

export const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.BUN_PUBLIC_API_URL) ||
  (typeof window !== 'undefined' && (window as any).__API_URL__) ||
  'http://localhost:3001';

// Default user ID for development (must be valid UUID)
export const DEV_USER_ID = '00000000-0000-0000-0000-000000000001';
