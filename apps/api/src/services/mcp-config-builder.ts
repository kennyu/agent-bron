/**
 * MCP Configuration Builder
 *
 * Builds per-user MCP server configurations with credential decryption.
 * Ensures User A's credentials are never mixed with User B's.
 */

import type { UserIntegration, MCPServerConfig, UserMCPConfig } from '../../../../packages/shared-types/src';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Encryption settings (should be in environment variables in production)
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// MCP server paths by provider
const MCP_SERVER_PATHS: Record<string, string> = {
  gmail: '@anthropic/mcp-server-gmail',
  google_photos: '@anthropic/mcp-server-google-photos',
  google_drive: '@anthropic/mcp-server-google-drive',
  slack: '@anthropic/mcp-server-slack',
  filesystem: '@anthropic/mcp-server-filesystem',
};

/**
 * Encrypt a string using AES-256-GCM
 */
export function encryptCredential(
  plaintext: string,
  encryptionKey: Buffer
): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Return: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a string using AES-256-GCM
 */
export function decryptCredential(
  encryptedData: string,
  encryptionKey: Buffer
): string {
  const [ivBase64, authTagBase64, encrypted] = encryptedData.split(':');

  if (!ivBase64 || !authTagBase64 || !encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');

  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Decrypted credentials for an integration
 */
export interface DecryptedCredentials {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Decrypt OAuth credentials for an integration
 */
export function decryptIntegrationCredentials(
  integration: {
    encryptedAccessToken?: string | null;
    encryptedRefreshToken?: string | null;
  },
  encryptionKey: Buffer
): DecryptedCredentials {
  if (!integration.encryptedAccessToken) {
    throw new Error('No access token found for integration');
  }

  return {
    accessToken: decryptCredential(integration.encryptedAccessToken, encryptionKey),
    refreshToken: integration.encryptedRefreshToken
      ? decryptCredential(integration.encryptedRefreshToken, encryptionKey)
      : undefined,
  };
}

/**
 * Build MCP server configuration for a specific provider
 */
function buildMCPServerForProvider(
  provider: string,
  credentials: DecryptedCredentials,
  metadata: Record<string, unknown>
): MCPServerConfig | null {
  const serverPath = MCP_SERVER_PATHS[provider];
  if (!serverPath) {
    console.warn(`Unknown MCP provider: ${provider}`);
    return null;
  }

  // Common environment variables
  const env: Record<string, string> = {
    OAUTH_ACCESS_TOKEN: credentials.accessToken,
  };

  if (credentials.refreshToken) {
    env.OAUTH_REFRESH_TOKEN = credentials.refreshToken;
  }

  // Provider-specific configuration
  switch (provider) {
    case 'gmail':
      return {
        provider,
        serverPath,
        env: {
          ...env,
          GMAIL_USER_EMAIL: (metadata.email as string) || '',
        },
      };

    case 'google_photos':
      return {
        provider,
        serverPath,
        env,
      };

    case 'google_drive':
      return {
        provider,
        serverPath,
        env,
      };

    case 'slack':
      return {
        provider,
        serverPath,
        env: {
          ...env,
          SLACK_TEAM_ID: (metadata.teamId as string) || '',
        },
      };

    case 'filesystem':
      return {
        provider,
        serverPath,
        args: [
          '--root',
          (metadata.rootPath as string) || '/tmp',
        ],
      };

    default:
      return {
        provider,
        serverPath,
        env,
      };
  }
}

/**
 * Build complete MCP configuration for a user
 *
 * Takes the user's integrations and builds the full MCP config
 * with decrypted credentials. This is called at execution time only.
 */
export function buildUserMCPConfig(
  integrations: Array<{
    provider: string;
    encryptedAccessToken?: string | null;
    encryptedRefreshToken?: string | null;
    metadata: Record<string, unknown>;
    isActive: boolean;
  }>,
  encryptionKey: Buffer
): UserMCPConfig {
  const servers: MCPServerConfig[] = [];

  for (const integration of integrations) {
    // Skip inactive integrations
    if (!integration.isActive) {
      continue;
    }

    try {
      const credentials = decryptIntegrationCredentials(integration, encryptionKey);
      const server = buildMCPServerForProvider(
        integration.provider,
        credentials,
        integration.metadata || {}
      );

      if (server) {
        servers.push(server);
      }
    } catch (error) {
      console.error(
        `Failed to build MCP config for provider ${integration.provider}:`,
        error
      );
      // Continue with other integrations
    }
  }

  return { servers };
}

/**
 * Get list of available (not connected) integrations for a user
 */
export function getAvailableIntegrations(
  connectedProviders: string[]
): Array<{ provider: string; name: string; description: string }> {
  const allIntegrations = [
    {
      provider: 'gmail',
      name: 'Gmail',
      description: 'Read, search, and send emails',
    },
    {
      provider: 'google_photos',
      name: 'Google Photos',
      description: 'Search and manage photos',
    },
    {
      provider: 'google_drive',
      name: 'Google Drive',
      description: 'Access and manage files',
    },
    {
      provider: 'slack',
      name: 'Slack',
      description: 'Send and read messages',
    },
    {
      provider: 'filesystem',
      name: 'File System',
      description: 'Access local files',
    },
  ];

  return allIntegrations.filter(
    (integration) => !connectedProviders.includes(integration.provider)
  );
}

/**
 * Check if a required integration is available for a user
 */
export function hasRequiredIntegration(
  requiredProvider: string,
  connectedProviders: string[]
): boolean {
  return connectedProviders.includes(requiredProvider);
}

/**
 * Format connected integrations for system prompt
 */
export function formatIntegrationsForPrompt(
  integrations: Array<{
    provider: string;
    metadata: Record<string, unknown>;
  }>
): string {
  if (integrations.length === 0) {
    return 'No integrations connected.';
  }

  const lines = integrations.map((integration) => {
    const providerName = integration.provider.replace('_', ' ');
    const details = formatIntegrationDetails(integration);
    return `- ${providerName}${details ? ` (${details})` : ''}`;
  });

  return lines.join('\n');
}

/**
 * Format integration-specific details
 */
function formatIntegrationDetails(integration: {
  provider: string;
  metadata: Record<string, unknown>;
}): string {
  switch (integration.provider) {
    case 'gmail':
      return integration.metadata.email as string || '';
    case 'slack':
      return integration.metadata.teamName as string || '';
    default:
      return '';
  }
}
