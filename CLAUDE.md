# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is
KnowledgeMind — a privacy-aware personal AI agent. A **FastAPI** backend (`api/main.py`) serves a **React** front-end (`frontend/`) and wraps the engine: a SQLite + NetworkX personal knowledge graph, a LangGraph background monitor, a privacy router (LOCAL vs CLOUD), an L1/L2/L3 ReAct agent, and a set of connectors. Runs CPU-only and degrades to mock data when no API keys are set.

## Commands
```bash
# Python deps (use the project venv)
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy download en_core_web_sm

# Build the React front-end (FastAPI serves frontend/dist)
cd frontend && npm install && npm run build && cd ..

# Run the app  → http://127.0.0.1:8000  (login with ACCESS_KEY if it is set)
.venv/bin/python launcher.py

# Dev with hot reload (two terminals)
.venv/bin/uvicorn api.main:app --reload      # backend on :8000
cd frontend && npm run dev                    # Vite on :5173 (proxies /api → :8000)

# Tests
.venv/bin/python benchmark.py --mode static   # offline routing/privacy contract (target 100%)
.venv/bin/python demo_conflicts.py            # end-to-end conflict demo (offline)
.venv/bin/python -m kg.graph                  # per-module smoke test (each module has one)
```

## Architecture
```
launcher.py            → entry point; runs uvicorn api.main:app on :8000, opens the browser
api/main.py            → FastAPI: access-key auth + CORS + endpoints + serves frontend/dist
frontend/              → React (Vite) SPA: App.jsx, views.jsx, Login.jsx, api.js
routing/router.py      → privacy + complexity classifier → LOCAL (Ollama) or CLOUD (Groq)
agent/orchestrator.py  → HybridMindAgent, 3 agency levels (L1/L2/L3)
agent/tools.py         → tool registry (dispatch_tool); every tool returns {success, formatted}
monitor/fsm.py         → LangGraph FSM: POLL → EXTRACT → UPDATE → CHECK → ALERT
kg/                    → SQLite + NetworkX KG; person-agnostic conflict detection
extraction/            → spaCy NER + few-shot commitment extractor + timeparse.py resolver
connectors/            → Slack/Calendar/Gmail (BaseConnector) + Hermes signal sources (below)
tools/rag.py           → ChromaDB RAG over local documents
memory/memory_manager.py → per-session history (turns table)
projmgmt/              → mounted sub-app at /projmgmt ("Project Advisor": SOW → KG + rules → chat)
```

### API endpoints (every `/api/*` is gated by `ACCESS_KEY` when set)
`GET /api/status` · `POST /api/scan` · `GET /api/commitments` · `GET /api/conflicts` ·
`POST /api/chat` · `GET|POST /api/documents` · `POST /api/rag/query` · `GET|POST /api/config` ·
`GET /api/connectors`. The static SPA is served at `/` (not gated, so the login screen can load); the **projmgmt** sub-app is mounted at `/projmgmt` (gated too — see below).

### Access-key auth (api/main.py)
Set `ACCESS_KEY` to lock the app: every `/api/*` **and `/projmgmt`** request must carry the key — as an `X-Access-Key` header (KM's fetch calls) or a `km_access` cookie (the projmgmt iframe, which can't set headers; mirrored from localStorage at login). Unset → open (local dev). The static SPA at `/` stays open so the login screen can load.

### Privacy routing (routing/router.py) — the most critical invariant
- `ALWAYS_LOCAL_TOOLS` is never routed to cloud. Do NOT add a force_cloud flag or remove a tool without approval.
- Privacy ≥ 0.65 → LOCAL. Low privacy + high complexity → CLOUD. Privacy always wins.
- `TOOL_PRIVACY_FLOORS` pins per-tool minimum privacy (KG/calendar/gmail ≥ 0.90; Hermes signal tools 0.90–0.98).

### Agency levels (agent/orchestrator.py)
**L1** one call + one optional tool + synthesis · **L2** Groq plan → local dispatch → Groq critique (default) · **L3** ReAct loop with replan.

### Tool contract (agent/tools.py)
Every tool: `dict -> {"success": bool, "formatted": str, ...}`, never raises (`dispatch_tool` is the catch-all). `gmail action="send"` is blocked — sending requires an explicit confirmed UI action.

### Hermes connectors (signal sources)
`connectors/{strava,spotify,todoist,apple_health}.py` derive **signals** (fitness/sleep/tasks/mood) — not messages or commitments — so they are wired as **agent tools** (`strava`, `apple_health`, `todoist`, `spotify` in `agent/tools.py`, via `hermes_tools/`), NOT into the monitor. Each derives locally, records a snapshot to `kg/connector_store.py` (a separate `connectors.db`), and falls back to mock data without keys. `GET /api/connectors` surfaces them; the React **Connectors** view renders them. `mcp_serve.py` optionally exposes the tools over MCP as a separate process (`python mcp_serve.py`). `hermes_skills/*.md` + `hermes_jobs/*.json` are design specs for a proactive cron runtime that is **not yet implemented** (no loader/runner).

### Project Advisor (projmgmt sub-app)
`projmgmt/` is a self-contained FastAPI app (own `backend/`, vanilla-JS frontend, `pm_config`, tests) **mounted at `/projmgmt`** by `api/main.py` (ASGI sub-app; the import is wrapped in try/except so a missing key just disables it without breaking KM). It ingests a Statement of Work → builds a project KG + rules → a chat advisor that rates alignment and flags deviations. It uses the **shared `GROQ_API_KEY`** (resolved in `projmgmt/backend/pm_config.py`), is surfaced in the React UI as the **Project Advisor** iframe view, and sits behind the same access-key lock (via the cookie). Its `data/` persistence is separate from KM's KG.

### Knowledge graph
Tables: `persons`, `commitments`, `conflicts`, `turns`, `rag_documents`. Commitment types HARD/SOFT/TENTATIVE. Conflict detection is **person-agnostic** (the user's whole timeline) and skips TENTATIVE. Open the DB via `get_db_connection(cfg.db_path)` (idempotent `init_db`).

## Deployment
`infra/` holds the Dockerfile (HF Spaces, port 7860) + a deploy guide; `.github/workflows/` has CI + the HF Spaces deploy. Set `ACCESS_KEY` + `GROQ_API_KEY` as Space secrets.

## Environment variables
| Variable | Purpose |
|---|---|
| `ACCESS_KEY` | Locks the app (X-Access-Key); unset = open |
| `GROQ_API_KEY` | Cloud LLM (L2/L3 + cloud-routed tasks) |
| `TAVILY_API_KEY` | Web search (falls back to DuckDuckGo) |
| `SLACK_BOT_TOKEN`, `GOOGLE_CREDENTIALS_PATH` | Live Slack / Calendar / Gmail (else mock) |
| `STRAVA_*`, `TODOIST_API_TOKEN`, `SPOTIFY_*` | Hermes connectors (else mock) |
| `ALLOWED_ORIGINS` | CORS origins (only if the front-end is served from a different origin) |
| `KM_DB_PATH`, `KM_LOCAL_MODEL`, `KM_OLLAMA_URL` | Overrides |
