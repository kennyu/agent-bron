## ADDED Requirements

### Requirement: Skill Definition
The system SHALL define skills as reusable configurations containing tools, MCP servers, subagents, and system prompt additions.

#### Scenario: Skill includes tools and subagents
- **GIVEN** a skill named "code-reviewer" is defined
- **WHEN** the skill configuration is loaded
- **THEN** it SHALL include allowed tools (Read, Grep, Glob)
- **AND** it SHALL include subagents (security-scanner)
- **AND** it SHALL include a system prompt addition

#### Scenario: Skill includes MCP servers
- **GIVEN** a skill named "email-assistant" is defined
- **WHEN** the skill configuration is loaded
- **THEN** it SHALL include MCP server configuration for Gmail

### Requirement: Skill Registry
The system SHALL provide a registry of predefined skills that can be queried and activated.

#### Scenario: List available skills
- **GIVEN** the skill registry contains predefined skills
- **WHEN** a request is made to GET /skills
- **THEN** the response SHALL include all available skill names and descriptions

#### Scenario: Get skill details
- **GIVEN** a skill named "code-runner" exists
- **WHEN** a request is made to GET /skills/code-runner
- **THEN** the response SHALL include the skill's tools, subagents, and MCP servers

### Requirement: Skill Activation
The system SHALL activate skills by name when processing Claude queries.

#### Scenario: Single skill activation
- **GIVEN** a query includes skills: ["code-reviewer"]
- **WHEN** the query is processed
- **THEN** the skill's tools SHALL be added to allowedTools
- **AND** the skill's subagents SHALL be passed to the SDK agents option
- **AND** the skill's prompt SHALL be appended to the system prompt

#### Scenario: Multiple skill activation
- **GIVEN** a query includes skills: ["code-reviewer", "code-runner"]
- **WHEN** the query is processed
- **THEN** tools from both skills SHALL be merged (union)
- **AND** subagents from both skills SHALL be merged
- **AND** MCP servers from both skills SHALL be merged

### Requirement: Skill Merging
The system SHALL merge multiple activated skills into a single configuration.

#### Scenario: Tool merging removes duplicates
- **GIVEN** skill A has tools ["Read", "Grep"]
- **AND** skill B has tools ["Read", "Bash"]
- **WHEN** both skills are merged
- **THEN** the merged tools SHALL be ["Read", "Grep", "Bash"]

#### Scenario: Subagent merging combines agents
- **GIVEN** skill A has subagent "security-scanner"
- **AND** skill B has subagent "test-runner"
- **WHEN** both skills are merged
- **THEN** the merged config SHALL include both subagents
