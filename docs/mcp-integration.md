# MCP Integration Setup

This document describes how to set up and configure MCP (Model Context Protocol) integrations for the Agentic Tasks platform.

## Overview

MCP allows Claude to interact with external services like Gmail, Google Drive, Slack, and more. Each user can connect their own accounts, and the platform ensures complete credential isolation between users.

## Supported Integrations

| Provider | Name | Description | Required Metadata |
|----------|------|-------------|-------------------|
| `gmail` | Gmail | Read, search, and send emails | `email` |
| `google_photos` | Google Photos | Search and manage photos | - |
| `google_drive` | Google Drive | Access and manage files | - |
| `slack` | Slack | Send and read messages | `teamId`, `teamName` |
| `filesystem` | File System | Access local files | `rootPath` |

## Security Model

### Credential Isolation

- Each user's OAuth tokens are encrypted separately using AES-256-GCM
- Encryption keys are stored securely (should be in environment variables)
- User A's Gmail credentials are never accessible when processing User B's conversations
- Credentials are decrypted only at execution time

### Encryption Format

Encrypted credentials are stored as:
```
{iv}:{authTag}:{ciphertext}
```

All components are Base64-encoded.

### Database Schema

```sql
CREATE TABLE user_integrations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  provider VARCHAR(50) NOT NULL,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, provider)
);

CREATE INDEX idx_user_integrations_user ON user_integrations(user_id);
CREATE INDEX idx_user_integrations_user_provider ON user_integrations(user_id, provider);
```

## Setting Up Integrations

### Environment Variables

```bash
# 32-byte encryption key (64 hex characters)
ENCRYPTION_KEY=your_64_char_hex_key_here

# OAuth client credentials (per provider)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
```

### OAuth Flow

1. User initiates connection in Settings UI
2. Redirect to provider's OAuth consent screen
3. Provider redirects back with authorization code
4. Exchange code for access/refresh tokens
5. Encrypt tokens and store in database

### Example: Adding Gmail Integration

```typescript
import { encryptCredential } from './services/mcp-config-builder';

async function saveGmailIntegration(
  userId: string,
  tokens: { access_token: string; refresh_token: string },
  email: string,
  encryptionKey: Buffer
) {
  await db.insert(userIntegrations).values({
    userId,
    provider: 'gmail',
    encryptedAccessToken: encryptCredential(tokens.access_token, encryptionKey),
    encryptedRefreshToken: encryptCredential(tokens.refresh_token, encryptionKey),
    metadata: { email },
    isActive: true,
  });
}
```

## Using Integrations in Chat

When a user sends a message, the system:

1. Loads the user's active integrations from the database
2. Decrypts credentials at execution time
3. Builds MCP server configuration
4. Passes configuration to Claude Code SDK
5. Claude can now use the connected services

### System Prompt Integration

The system prompt includes integration information:

```
USER'S CONNECTED INTEGRATIONS:
- gmail (user@example.com)
- slack (Acme Corp)

AVAILABLE INTEGRATIONS (not connected):
- Google Photos: Search and manage photos
- Google Drive: Access and manage files
- File System: Access local files
```

This helps Claude understand what tools are available.

## MCP Server Configuration

### Server Paths

Each provider maps to an MCP server package:

```typescript
const MCP_SERVER_PATHS = {
  gmail: '@anthropic/mcp-server-gmail',
  google_photos: '@anthropic/mcp-server-google-photos',
  google_drive: '@anthropic/mcp-server-google-drive',
  slack: '@anthropic/mcp-server-slack',
  filesystem: '@anthropic/mcp-server-filesystem',
};
```

### Generated Configuration

For each integration, a configuration object is generated:

```typescript
interface MCPServerConfig {
  provider: string;
  serverPath: string;
  args?: string[];
  env?: Record<string, string>;
}

// Gmail example
{
  provider: 'gmail',
  serverPath: '@anthropic/mcp-server-gmail',
  env: {
    OAUTH_ACCESS_TOKEN: '...',
    OAUTH_REFRESH_TOKEN: '...',
    GMAIL_USER_EMAIL: 'user@example.com'
  }
}

// Filesystem example
{
  provider: 'filesystem',
  serverPath: '@anthropic/mcp-server-filesystem',
  args: ['--root', '/home/user/documents']
}
```

## Token Refresh Handling

### During Execution

If a token expires during execution:

1. MCP server returns auth error
2. Worker detects auth-related error patterns
3. Conversation status changes to `waiting_input`
4. User receives notification to reconnect
5. User reconnects in Settings
6. Work resumes with fresh tokens

### Error Detection

Auth errors are detected by checking for these patterns in error messages:
- `auth`
- `token`
- `expired`
- `unauthorized`

## Adding New Integrations

### 1. Add Server Path

```typescript
const MCP_SERVER_PATHS = {
  // ... existing
  new_provider: '@anthropic/mcp-server-new-provider',
};
```

### 2. Add Provider Configuration

In `buildMCPServerForProvider`:

```typescript
case 'new_provider':
  return {
    provider,
    serverPath,
    env: {
      ...env,
      PROVIDER_SPECIFIC_VAR: metadata.specificValue as string || '',
    },
  };
```

### 3. Add to Available Integrations

In `getAvailableIntegrations`:

```typescript
{
  provider: 'new_provider',
  name: 'New Provider',
  description: 'What it does',
}
```

### 4. Implement OAuth Flow

Add OAuth endpoints for the new provider.

## Best Practices

### Security

1. **Never log credentials** - Even encrypted ones
2. **Use short-lived tokens** - Prefer refresh tokens over long-lived access
3. **Validate metadata** - Sanitize user-provided metadata values
4. **Rate limit OAuth** - Prevent abuse of token exchange endpoints

### User Experience

1. **Clear connection status** - Show which integrations are connected
2. **Graceful degradation** - Handle missing integrations in prompts
3. **Reconnect prompts** - Guide users to reconnect expired tokens
4. **Permission explanations** - Explain what access each integration needs

### Error Handling

1. **Catch decryption errors** - Handle corrupted encrypted data
2. **Continue on single failure** - Don't fail all integrations if one fails
3. **Log errors appropriately** - Error logs without sensitive data
4. **Notify on persistent failures** - Alert users when integrations repeatedly fail

## Troubleshooting

### Common Issues

**Integration not appearing:**
- Check `isActive` is true in database
- Verify tokens are properly encrypted
- Check for decryption errors in logs

**Auth errors during execution:**
- Token may have expired
- User may have revoked access
- OAuth scopes may be insufficient

**MCP server not starting:**
- Verify server package is installed
- Check environment variables are set
- Verify server path is correct

### Debug Logging

Enable debug logging for MCP config building:

```typescript
// In mcp-config-builder.ts
console.debug('Building MCP config for:', integration.provider);
console.debug('Metadata:', JSON.stringify(integration.metadata));
// Never log: credentials, tokens, or encryption keys
```

## API Reference

### Functions

#### `encryptCredential(plaintext: string, key: Buffer): string`

Encrypts a string using AES-256-GCM.

#### `decryptCredential(encrypted: string, key: Buffer): string`

Decrypts an AES-256-GCM encrypted string.

#### `buildUserMCPConfig(integrations, key): UserMCPConfig`

Builds complete MCP configuration for a user.

#### `getAvailableIntegrations(connectedProviders): IntegrationInfo[]`

Returns list of integrations user hasn't connected yet.

#### `formatIntegrationsForPrompt(integrations): string`

Formats connected integrations for system prompt display.
