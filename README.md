# MANCO Admin Agent

A **GitHub Copilot Extension** (agent type) that lets VFS senior management log Manco-meeting action items into the Jira `VFST2` project directly from Copilot Chat.

```
@manco-admin-agent file a risk action: revisit BCP testing cadence next quarter
```

The agent uses Copilot's own LLM to:

1. Pick the right **Manco topic** (Architecture, Risk, Cyber, HR, Budget, etc.) from a fixed allow-list.
2. Extract a clean summary, description, type, and priority from natural language.
3. Create the issue via the Jira Cloud REST API in project **`VFST2`**, tagged with a topic label (e.g. `manco-risk`) and a summary prefix (e.g. `[Risk] ...`).
4. Reply with a clickable `VFST2-###` link.

---

## How tickets are tagged

Because all 16 Manco workstreams live in a single Jira project (`VFST2`), the agent disambiguates them two ways on every ticket:

- **Label** — `manco-architecture`, `manco-risk`, `manco-cyber`, etc. Filter in Jira with JQL:
  ```
  project = VFST2 AND labels = "manco-risk"
  ```
- **Summary prefix** — `[Architecture]`, `[Risk]`, etc. Visible at a glance on any board.

To add, rename, or remove topics, edit [`src/topics.js`](src/topics.js). The list is the single source of truth — the system prompt and the tool's enum are generated from it.

### Default topic list

Architecture · Service Management · Audit · Tech Assurance · Cyber · Risk · PI Planning · PI Delivery · International · Innovations · Ways of Working · Resourcing · HR · Budget · Manco · VFS Exco

---

## Architecture

```
Copilot Chat  ──►  GitHub  ──►  this server  ──►  Copilot LLM (function calling)
                                       │
                                       ▼
                                  Jira Cloud REST API v3 (project VFST2)
```

- **Runtime:** Node.js 20+, Express
- **Auth to Jira:** Basic auth (email + API token), via env vars
- **Auth to Copilot LLM:** the `X-GitHub-Token` GitHub forwards on every request
- **Response format:** Server-Sent Events in the OpenAI chat-completions chunk shape (what Copilot expects)

Source layout:

```
src/
  server.js            Express app + Copilot endpoint, tool wiring, system prompt
  copilot.js           Copilot LLM client + SSE helpers
  jira.js              Jira REST v3 client
  topics.js            The 16 Manco topics — edit here to change routing
  verifySignature.js   GitHub request-signature verification
```

---

## 1. Set up Jira

1. Sign in to Atlassian as the user the agent should post as. This user must have **Create Issues** permission on project `VFST2`.
2. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.

## 2. Configure the server

```bash
cp .env.example .env
# then fill in JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN
```

Install and run:

```bash
npm install
npm start
```

Quick smoke check (no Copilot required):

```bash
curl -s localhost:3000/
# {"name":"manco-admin-agent","status":"ok","project":"VFST2","topics":[...]}
```

## 3. Expose the server publicly

GitHub needs to reach your server over HTTPS. For local development use a tunnel:

```bash
# example with ngrok
ngrok http 3000
```

Note the public URL (e.g. `https://abcd-1234.ngrok-free.app`). For production, deploy to any HTTPS host (Fly, Render, AWS, Azure, etc.).

## 4. Register the GitHub App + Copilot Extension

1. <https://github.com/settings/apps> → **New GitHub App**.
   - Homepage URL: your public URL
   - Webhook: not required for a Copilot extension; you can disable it
   - Permissions: no repository permissions are needed for ticket logging
2. After creating the app, open its **Copilot** tab:
   - **App Type:** Agent
   - **URL:** `https://<your-public-url>/`
   - **Inference description:** "Logs Manco action items into Jira VFST2."
3. Install the GitHub App on your user or organization.
4. In VS Code → Copilot Chat, type `@` and pick your new agent. Try:

   > `@manco-admin-agent log a risk ticket: revisit BCP testing cadence`

   You should see a status line, then a confirmation with a `VFST2-###` link and the topic label.

## 5. Production hardening

- Set `VERIFY_SIGNATURE=true` to enforce GitHub's request signature.
- Put the server behind HTTPS with a real domain.
- Rotate the Jira API token periodically; store it in a secret manager.
- Restrict the Jira account's permissions to only project `VFST2`.

---

## Customising

| Want to change... | Where |
| --- | --- |
| Topic list / aliases / parent Epics | `src/topics.js` |
| Default issue type | `JIRA_DEFAULT_ISSUE_TYPE` env var |
| Project key | `JIRA_PROJECT_KEY` env var (defaults to `VFST2`) |
| Tool schema (extra fields like components, fix versions, epic link) | `tools` array in `src/server.js` |
| System prompt / agent behaviour | `SYSTEM_PROMPT` in `src/server.js` |
| Jira field mapping (custom fields, ADF rich text, parent/epic) | `src/jira.js` |
| Verify configured Epics exist in Jira | `npm run check:epics` |

### Filling in landing Epics

The Jira hierarchy in VFST2 is:

```
Feature  ──►  Epic  ──►  Task
(topic)       (landing)  (what the agent creates)
```

Each topic in [`src/topics.js`](src/topics.js) has two slots:

- `featureKey` — the issue key of the topic's Feature (e.g. `VFST2-970` for Architecture). Used only by the `check:epics` helper for sanity-checking.
- `parentEpicKey` — the issue key of the Epic the agent should parent new Tasks under. **This is the one that matters at run time.**

When `parentEpicKey` is `null`, the agent falls back to label-only routing for that topic: the ticket lands in `VFST2` with the right label, just not parented under an Epic.

To configure properly:

1. In Jira, under each Feature you care about, create (or pick an existing) Epic that will be the catch-all landing zone — e.g. `Manco Actions — Architecture`.
2. Copy the Epic's issue key (e.g. `VFST2-1042`).
3. Open `src/topics.js`, paste it into the matching topic's `parentEpicKey`. Also fill in `featureKey` if you have it.
4. Run `npm run check:epics` to verify every configured Epic actually exists, is an Epic, and is a child of the right Feature.

You can do this incrementally — fill in 3-5 topics first, ship, then backfill the rest.

### Upgrading further (Components, custom fields, etc.)

- **Components:** create each topic as a Component in `VFST2`, then in `src/jira.js` add `fields.components = [{ name: topic.label }]`.
- **Custom Epic-link field:** if your Jira is a company-managed (classic) project, `fields.parent` may not work; you'll need the `customfield_XXXXX` for Epic Link instead. The error message from `check:epics` will tell you.

---

## Troubleshooting

- **`401 Missing X-GitHub-Token`** — the request didn't come through Copilot. Make sure you're invoking the agent from Copilot Chat, not hitting the endpoint directly.
- **`Jira create issue failed (403 ...)`** — the configured Jira user lacks Create Issues permission on `VFST2`.
- **`Jira create issue failed (400 ... "issuetype" ...)`** — the issue type name doesn't exist in the project; update `JIRA_DEFAULT_ISSUE_TYPE` or the tool's `enum`.
- **`I couldn't pick a valid Manco topic`** — the LLM emitted a topic value not in `src/topics.js`. Add it to the list or strengthen the system prompt.
- **LLM keeps replying without filing** — tighten the `SYSTEM_PROMPT` or the tool `description`.
