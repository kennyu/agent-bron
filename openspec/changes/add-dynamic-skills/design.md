# Design: Add Dynamic Skills System

## Context
The Claude Agent SDK supports:
- **Subagents** via `agents` option - specialized agents invoked via Task tool
- **MCP servers** via `mcpServers` option - external tool integrations
- **Tool allowlisting** via `allowedTools` option

A "skill" bundles these together into a reusable configuration.

## Decisions

### Decision 1: Skill Definition Schema
A skill can include tools, MCP servers, and nested subagents:

```typescript
interface Skill {
  name: string;
  description: string;
  prompt: string;                              // System prompt addition
  tools?: string[];                            // Allowed tools
  model?: 'sonnet' | 'opus' | 'haiku';         // Model preference
  mcpServers?: Record<string, MCPServerConfig>; // MCP integrations
  subagents?: Record<string, AgentDefinition>;  // Nested specialized agents
}

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface AgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku';
}
```

### Decision 2: Predefined Skills
Ship with these built-in skills:

```typescript
const SKILLS: Record<string, Skill> = {
  'code-reviewer': {
    name: 'code-reviewer',
    description: 'Reviews code for bugs, security, and best practices',
    prompt: 'You are a code review expert. Analyze code thoroughly.',
    tools: ['Read', 'Grep', 'Glob'],
    subagents: {
      'security-scanner': {
        description: 'Scans for security vulnerabilities',
        prompt: 'Focus on security issues: injection, auth, crypto.',
        tools: ['Read', 'Grep', 'Glob'],
        model: 'opus'
      }
    }
  },

  'file-editor': {
    name: 'file-editor',
    description: 'Creates and modifies files',
    prompt: 'You help create and edit files efficiently.',
    tools: ['Read', 'Write', 'Edit', 'Glob']
  },

  'code-runner': {
    name: 'code-runner',
    description: 'Executes scripts, tests, and build commands',
    prompt: 'You run scripts and commands. Report results clearly.',
    tools: ['Bash', 'Read', 'Grep'],
    subagents: {
      'test-runner': {
        description: 'Runs test suites and analyzes results',
        prompt: 'Run tests and provide clear pass/fail analysis.',
        tools: ['Bash', 'Read'],
        model: 'haiku'
      }
    }
  },

  'researcher': {
    name: 'researcher',
    description: 'Searches the web and fetches documentation',
    prompt: 'You research topics and summarize findings.',
    tools: ['WebSearch', 'WebFetch', 'Read']
  },

  'email-assistant': {
    name: 'email-assistant',
    description: 'Manages email via Gmail integration',
    prompt: 'You help manage email. Read, search, and compose messages.',
    tools: ['Read'],
    mcpServers: {
      gmail: { command: 'npx', args: ['@anthropic/gmail-mcp'] }
    }
  }
};
```

### Decision 3: Skill Merging
When multiple skills are activated, merge their configurations:

```typescript
function mergeSkills(skills: Skill[]): MergedConfig {
  return {
    tools: [...new Set(skills.flatMap(s => s.tools || []))],
    mcpServers: Object.assign({}, ...skills.map(s => s.mcpServers || {})),
    subagents: Object.assign({}, ...skills.map(s => s.subagents || {})),
    systemPromptAdditions: skills.map(s => s.prompt).join('\n\n')
  };
}
```

### Decision 4: Integration with ClaudeQueryOptions
Extend the options interface:

```typescript
interface ClaudeQueryOptions {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  mcpConfig?: UserMCPConfig;
  timeout?: number;
  allowedTools?: string[];
  // NEW
  skills?: string[];  // Skill names to activate
}
```

### Decision 5: Build Query with Skills
In `buildQueryOptions`, resolve skills and merge:

```typescript
private buildQueryOptions(options: ClaudeQueryOptions) {
  // Load and merge requested skills
  const activeSkills = (options.skills || [])
    .map(name => SKILLS[name])
    .filter(Boolean);

  const merged = mergeSkills(activeSkills);

  // Merge skill tools with explicit allowedTools
  const allTools = [
    ...(options.allowedTools || this.config.defaultAllowedTools),
    ...merged.tools
  ];

  // Merge skill MCP servers with user's MCP config
  const allMcpServers = {
    ...this.buildMcpServers(options.mcpConfig),
    ...merged.mcpServers
  };

  return {
    prompt: options.prompt,
    options: {
      cwd: process.cwd(),
      systemPrompt: this.buildSystemPrompt(options, merged.systemPromptAdditions),
      resume: options.sessionId,
      allowedTools: [...new Set(allTools)],
      permissionMode: 'bypassPermissions',
      maxTurns: 50,
      agents: merged.subagents,
      mcpServers: Object.keys(allMcpServers).length > 0 ? allMcpServers : undefined,
    },
  };
}
```

### Decision 6: API Endpoints

```
GET /skills                    -> List all available skills
GET /skills/:name              -> Get skill details
```

Response format:
```typescript
interface SkillResponse {
  name: string;
  description: string;
  tools: string[];
  hasMcpServers: boolean;
  hasSubagents: boolean;
}
```

## Example Usage

```typescript
// Activate multiple skills for a query
const result = await claudeClient.stream({
  prompt: "Review auth.ts for security issues, then run the tests",
  skills: ['code-reviewer', 'code-runner'],
  allowedTools: ['Task']  // Task tool invokes subagents
});
```

This loads:
- Tools: Read, Grep, Glob, Bash
- Subagents: security-scanner, test-runner
- System prompt additions from both skills

## Future Enhancements (Out of Scope)
- Database storage for custom user-defined skills
- Auto-detection of skills based on message content
- Skill versioning and updates
