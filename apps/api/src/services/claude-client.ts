/**
 * Claude Agent SDK Client
 *
 * Wraps the @anthropic-ai/claude-agent-sdk to provide:
 * - run(): Aggregated responses for background worker
 * - stream(): Async iterator for SSE streaming
 *
 * NOTE: The Agent SDK spawns Claude Code CLI as a subprocess.
 * You need to have Claude Code CLI installed: npm install -g @anthropic-ai/claude-code
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { UserMCPConfig } from '../../../../packages/shared-types/src';
import { getSkill, mergeSkills } from '../config/skills';

/**
 * Configuration for the Claude Agent Client
 */
export interface ClaudeAgentClientConfig {
  /** Default timeout in milliseconds */
  defaultTimeoutMs?: number;
  /** Default tools to allow */
  defaultAllowedTools?: string[];
}

/**
 * Options for running a query
 */
export interface ClaudeQueryOptions {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  mcpConfig?: UserMCPConfig;
  timeout?: number;
  allowedTools?: string[];
  /** Skill names to activate for this query */
  skills?: string[];
}

/**
 * Result from an aggregated run
 */
export interface ClaudeRunResult {
  response: string;
  sessionId: string;
}

/**
 * Message types from the SDK stream
 */
export interface ClaudeStreamMessage {
  type: 'init' | 'assistant' | 'tool_use' | 'tool_result' | 'error' | 'done';
  content?: string;
  sessionId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  error?: string;
}

/**
 * Claude Agent SDK Client
 *
 * Provides both aggregated and streaming interfaces to the Claude Agent SDK.
 */
export class ClaudeAgentClient {
  private config: Required<ClaudeAgentClientConfig>;

  constructor(config: ClaudeAgentClientConfig = {}) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? 300000, // 5 minutes
      defaultAllowedTools: config.defaultAllowedTools ?? [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Glob',
        'Grep',
      ],
    };
  }

  /**
   * Run a query and return aggregated response (for background worker)
   */
  async run(options: ClaudeQueryOptions): Promise<ClaudeRunResult> {
    let responseText = '';
    let sessionId = '';

    const queryOptions = this.buildQueryOptions(options);
    console.log('[ClaudeAgentClient] run() called with prompt:', options.prompt.slice(0, 100) + '...');

    for await (const message of query(queryOptions)) {
      console.log('[ClaudeAgentClient] run() received:', message.type);

      // Extract session ID from init message
      if (message.type === 'system' && (message as any).subtype === 'init') {
        sessionId = (message as any).session_id || '';
      }

      // Aggregate assistant text
      // SDK wraps content in message.message.content OR message.content
      if (message.type === 'assistant') {
        const messageContent = (message as any).message?.content || (message as any).content;

        if (typeof messageContent === 'string') {
          responseText += messageContent;
        } else if (Array.isArray(messageContent)) {
          // Handle content blocks
          for (const block of messageContent) {
            if (block.type === 'text') {
              responseText += block.text;
            }
          }
        }
      }
    }

    console.log('[ClaudeAgentClient] run() completed, response length:', responseText.length);
    return {
      response: responseText,
      sessionId,
    };
  }

  /**
   * Stream query responses (for SSE endpoint)
   */
  async *stream(options: ClaudeQueryOptions): AsyncGenerator<ClaudeStreamMessage> {
    const queryOptions = this.buildQueryOptions(options);

    console.log('[ClaudeAgentClient] stream() called');
    console.log('[ClaudeAgentClient] cwd:', process.cwd());
    console.log('[ClaudeAgentClient] ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
    console.log('[ClaudeAgentClient] Query options:', JSON.stringify(queryOptions, null, 2));

    let queryIterator: AsyncIterable<any>;
    try {
      console.log('[ClaudeAgentClient] Calling query()...');
      queryIterator = query(queryOptions);
      console.log('[ClaudeAgentClient] query() returned, starting iteration...');
    } catch (error: any) {
      console.error('[ClaudeAgentClient] Failed to create query:', error);
      console.error('[ClaudeAgentClient] Error name:', error?.name);
      console.error('[ClaudeAgentClient] Error message:', error?.message);
      console.error('[ClaudeAgentClient] Error code:', error?.code);
      console.error('[ClaudeAgentClient] Error stack:', error?.stack);
      yield {
        type: 'error',
        error: `Failed to start Claude: ${error?.message || String(error)}`,
      };
      return;
    }

    try {
      let sentDone = false;
      for await (const message of queryIterator) {
        console.log('[ClaudeAgentClient] Received SDK message:', message.type, JSON.stringify(message).slice(0, 200));
        const streamMessage = this.mapToStreamMessage(message);
        if (streamMessage) {
          console.log('[ClaudeAgentClient] Yielding:', streamMessage.type);
          yield streamMessage;
          if (streamMessage.type === 'done') {
            sentDone = true;
          }
        } else {
          console.log('[ClaudeAgentClient] No stream message for:', message.type);
        }
      }

      // Signal completion if not already sent
      if (!sentDone) {
        yield { type: 'done' };
      }
    } catch (error: any) {
      console.error('[ClaudeAgentClient] Stream iteration error:', error);
      console.error('[ClaudeAgentClient] Error name:', error?.name);
      console.error('[ClaudeAgentClient] Error message:', error?.message);
      console.error('[ClaudeAgentClient] Error code:', error?.code);
      console.error('[ClaudeAgentClient] Error stack:', error?.stack);
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build query options for the SDK
   */
  private buildQueryOptions(options: ClaudeQueryOptions): Parameters<typeof query>[0] {
    const mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

    // Convert MCP config to SDK format
    if (options.mcpConfig?.servers && Array.isArray(options.mcpConfig.servers)) {
      for (const server of options.mcpConfig.servers) {
        if (server.serverPath) {
          mcpServers[server.provider] = {
            command: server.serverPath,
            args: server.args || [],
          };
        }
      }
    }

    // Load and merge requested skills
    const activeSkills = (options.skills || [])
      .map((name) => getSkill(name))
      .filter((skill): skill is NonNullable<typeof skill> => skill !== undefined);

    const merged = mergeSkills(activeSkills);

    // Merge skill tools with explicit allowedTools
    const allTools = [
      ...(options.allowedTools || this.config.defaultAllowedTools),
      ...merged.tools,
    ];

    // Merge skill MCP servers with user's MCP config
    for (const [name, config] of Object.entries(merged.mcpServers)) {
      mcpServers[name] = {
        command: config.command,
        args: config.args || [],
        ...(config.env && { env: config.env }),
      };
    }

    // Build system prompt with skill additions
    const systemPrompt = this.buildSystemPrompt(options.systemPrompt, merged.systemPromptAdditions);

    return {
      prompt: options.prompt,
      options: {
        cwd: process.cwd(),
        systemPrompt,
        resume: options.sessionId,
        allowedTools: [...new Set(allTools)],
        permissionMode: 'bypassPermissions' as const,
        maxTurns: 50,
        ...(Object.keys(merged.subagents).length > 0 && { agents: merged.subagents }),
        ...(Object.keys(mcpServers).length > 0 && { mcpServers }),
      },
    };
  }

  /**
   * Build system prompt with skill additions
   */
  private buildSystemPrompt(basePrompt?: string, skillAdditions?: string): string | undefined {
    if (!basePrompt && !skillAdditions) {
      return undefined;
    }
    if (!skillAdditions) {
      return basePrompt;
    }
    if (!basePrompt) {
      return skillAdditions;
    }
    return `${basePrompt}\n\n${skillAdditions}`;
  }

  /**
   * Map SDK message to stream message format
   */
  private mapToStreamMessage(message: any): ClaudeStreamMessage | null {
    // Init message
    if (message.type === 'system' && message.subtype === 'init') {
      return {
        type: 'init',
        sessionId: message.session_id,
      };
    }

    // Assistant text - SDK wraps it in message.message.content
    if (message.type === 'assistant') {
      let content = '';

      // Check for message.message.content structure (SDK format)
      const messageContent = message.message?.content || message.content;

      if (typeof messageContent === 'string') {
        content = messageContent;
      } else if (Array.isArray(messageContent)) {
        for (const block of messageContent) {
          if (block.type === 'text') {
            content += block.text;
          }
        }
      }

      if (content) {
        return {
          type: 'assistant',
          content,
        };
      }
    }

    // Result message - signals completion, don't duplicate content
    // The result content is already streamed via assistant messages
    if (message.type === 'result') {
      return {
        type: 'done',
      };
    }

    // Tool use
    if (message.type === 'tool_use') {
      return {
        type: 'tool_use',
        toolName: message.name,
        toolInput: message.input,
      };
    }

    // Tool result
    if (message.type === 'tool_result') {
      return {
        type: 'tool_result',
        toolResult: message.content,
      };
    }

    return null;
  }
}

/**
 * Mock Claude client for development without API key
 */
export class MockClaudeClient {
  async run(options: ClaudeQueryOptions): Promise<ClaudeRunResult> {
    console.log('[MockClaudeClient] run() called');
    console.log('[MockClaudeClient] Prompt:', options.prompt.slice(0, 100) + '...');

    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      response: JSON.stringify({
        message: 'This is a mock response. Set ANTHROPIC_API_KEY to use the real Claude Agent SDK.',
      }),
      sessionId: 'mock-session-' + Date.now(),
    };
  }

  async *stream(options: ClaudeQueryOptions): AsyncGenerator<ClaudeStreamMessage> {
    console.log('[MockClaudeClient] stream() called');
    console.log('[MockClaudeClient] Prompt:', options.prompt.slice(0, 100) + '...');

    yield {
      type: 'init',
      sessionId: 'mock-session-' + Date.now(),
    };

    const mockResponse = 'This is a mock streaming response. Set ANTHROPIC_API_KEY to use the real Claude Agent SDK.';
    const words = mockResponse.split(' ');

    for (const word of words) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      yield {
        type: 'assistant',
        content: word + ' ',
      };
    }

    yield { type: 'done' };
  }
}

/**
 * Create a Claude client based on environment
 */
export function createClaudeClient(
  config?: ClaudeAgentClientConfig
): ClaudeAgentClient | MockClaudeClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn(
      '[ClaudeClient] ANTHROPIC_API_KEY not set, using mock client.'
    );
    return new MockClaudeClient();
  }

  console.log('[ClaudeClient] Using Claude Agent SDK');
  return new ClaudeAgentClient(config);
}
