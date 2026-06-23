# SPEC: Team Management Chatbot

## Problem Statement

Project teams lose alignment over time. Discussions drift, features creep in, and sprint plans diverge from the original Statement of Work. This system gives the team a persistent, AI-driven advisor that was "present at the SoW" and can flag drift in real time.

---

## Core Flows

### 1. Project Initialization

```
User uploads SoW (PDF or text)
  → LLM extracts entities, relationships, goals, constraints
  → Knowledge Graph is built and persisted
  → LLM generates DRL rules from scope boundaries and constraints
  → DRL rules are stored and rendered in the UI
```

### 2. Team Chat Session

```
User sends a message (feature idea, sprint plan, discussion note)
  → Chat handler embeds the message
  → KG is queried for relevant nodes
  → DRL rules are evaluated against the message content
  → LLM produces:
      - Alignment score (0–100)
      - List of in-scope / out-of-scope components detected
      - Deviation flags (which rules are violated or at risk)
      - Coverage delta (which SoW goals this addresses)
      - Architecture recommendations
  → Response is streamed to the chat UI
```

### 3. Viewers

- **KG Viewer**: Interactive graph of all entities and relationships extracted from the SoW. Nodes colored by type (goal, feature, component, constraint, actor). Clickable to show details.
- **DRL Viewer**: Rendered list of business rules. Each rule shows: condition, action, source excerpt from SoW, and current violation status.

---

## Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| LLM | Claude (Anthropic SDK) | Best reasoning quality for structured extraction and alignment tasks |
| Backend | FastAPI (Python) | Simple, async, auto-docs |
| KG Store | NetworkX in-memory + JSON persistence | No infra, sufficient for project-scale graphs |
| KG Visualization | Cytoscape.js | Standalone JS, rich graph layout, no build step needed |
| DRL (rules) | Custom JSON-based rule objects, rendered as pseudo-DRL | True Drools requires JVM; JSON rules evaluated in Python are equivalent for this scale |
| Embeddings | `sentence-transformers` (local) or Claude embeddings | For KG node similarity queries |
| Frontend | Single HTML + vanilla JS (no build step) | Standalone, simple, no toolchain friction |
| Persistence | JSON files under `data/projects/{project_id}/` | No DB needed at this scale |

### Note on DRL

True Drools Rule Language (DRL) targets a JVM rules engine (Drools/Kogito). For this project:
- Rules are authored in a structured JSON format that mirrors DRL semantics (when/then, salience, agenda-group)
- The UI renders them in DRL-like syntax for readability
- Evaluation is done in Python using the same when/then logic
- If the project requires actual Drools integration, a thin Java sidecar can be added later

---

## Data Models

### Project

```json
{
  "project_id": "uuid",
  "name": "string",
  "sow_text": "string",
  "created_at": "iso8601",
  "kg": { "nodes": [], "edges": [] },
  "rules": []
}
```

### KG Node

```json
{
  "id": "string",
  "label": "string",
  "type": "goal | feature | component | constraint | actor | milestone",
  "description": "string",
  "sow_excerpt": "string",
  "coverage_status": "unaddressed | partial | covered"
}
```

### KG Edge

```json
{
  "source": "node_id",
  "target": "node_id",
  "relation": "depends_on | implements | constrains | owned_by | delivers"
}
```

### Rule (pseudo-DRL)

```json
{
  "rule_id": "string",
  "name": "string",
  "salience": 10,
  "when": "string (natural language condition)",
  "then": "string (natural language action / flag)",
  "sow_excerpt": "string",
  "violation_status": "ok | at_risk | violated"
}
```

### Chat Message

```json
{
  "role": "user | assistant",
  "content": "string",
  "metadata": {
    "alignment_score": 0,
    "in_scope": [],
    "out_of_scope": [],
    "deviations": [],
    "coverage_delta": [],
    "recommendations": []
  }
}
```

---

## API Endpoints

```
POST /projects                    # Create project (upload SoW text)
GET  /projects/{id}               # Get project metadata
GET  /projects/{id}/kg            # Get full KG (nodes + edges)
GET  /projects/{id}/rules         # Get all DRL rules
POST /projects/{id}/chat          # Send chat message, get alignment response
GET  /projects/{id}/chat/history  # Get full chat history
GET  /projects/{id}/coverage      # Get goal coverage summary
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Project Name]                          [New Project]       │
├──────────────┬──────────────────────────┬───────────────────┤
│  KNOWLEDGE   │      CHAT                │  RULES            │
│  GRAPH       │                          │  (DRL Viewer)     │
│              │  [message history]       │                   │
│  [cytoscape] │                          │  rule 1 ✓         │
│              │                          │  rule 2 ⚠         │
│              │                          │  rule 3 ✗         │
│              │  [input box] [Send]      │                   │
│              │                          │  Coverage: 42%    │
└──────────────┴──────────────────────────┴───────────────────┘
```

- Left panel: KG Viewer (Cytoscape.js, collapsible)
- Center panel: Chat (streaming responses, alignment score badge on each assistant message)
- Right panel: DRL rules list with live violation status, coverage percentage at bottom

---

## LLM Prompt Strategy

### SoW Extraction Prompt

Extract from the SoW:
1. Goals (what success looks like)
2. Features / deliverables
3. Components / subsystems
4. Constraints (budget, timeline, tech, regulatory)
5. Actors / stakeholders
6. Milestones

Return structured JSON matching the KG node/edge schema.

### DRL Rule Generation Prompt

From the SoW and extracted KG, generate rules of the form:
- "When a feature is proposed that is not linked to any goal node, flag as out-of-scope"
- "When a timeline is mentioned that exceeds milestone X, raise a deviation"

### Alignment Scoring Prompt

Given the KG, rules, and the user's message:
- Identify which KG nodes are referenced (directly or semantically)
- Check each rule's `when` condition against the message
- Produce alignment score, in/out-of-scope lists, deviation flags, coverage delta, and recommendations

---

## Open Questions

1. Should the chatbot maintain a conversation history that influences future alignment scores (session memory)?
2. Should KG nodes be updated dynamically as the project progresses (e.g., mark a goal as "covered" when chat confirms it)?
3. Multi-project support in v1, or single active project?
4. Authentication needed, or single-user local tool?
5. Should recommendations be prescriptive (specific architecture patterns) or descriptive (observations only)?
