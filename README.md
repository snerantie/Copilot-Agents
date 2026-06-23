# MANCO Admin Agent

A **GitHub Copilot Extension** (agent type) that lets users log tickets into the Jira **MANCO** project directly from Copilot Chat.

```
@manco file a bug: login page hangs on Safari after the 25.7 release
```

The agent uses Copilot's own LLM to extract a clean summary, description, type, and priority from natural language, then creates the issue via the Jira Cloud REST API and replies with a clickable link to the new ticket.

---

## Architecture

```
Copilot Chat  ──►  GitHub  ──►  this server  ──►  Copilot LLM (function calling)
                                       │
                                       ▼
                                  Jira Cloud REST API v3
```

- **Runtime:** Node.js 20+, Express
- **Auth to Jira:** Basic auth (email + API token), via env vars
- **Auth to Copilot LLM:** the `X-GitHub-Token` GitHub forwards on every request
- **Response format:** Server-Sent Events in the OpenAI chat-completions chunk shape (what Copilot expects)

Source layout:

```
src/
  server.js            Express app + Copilot endpoint
  copilot.js           Copilot LLM client + SSE helpers
  jira.js              Jira REST v3 client
  verifySignature.js   GitHub request-signature verification
```

---

## 1. Set up Jira

1. Sign in to Atlassian with the user the agent should post as.
2. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
3. Confirm that user has **Create Issues** permission in the **MANCO** project.

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
# {"name":"manco-admin-agent","status":"ok","project":"MANCO"}
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
   - **Inference description:** "Logs tickets into the Jira MANCO project."
3. Install the GitHub App on your user or organization.
4. In VS Code → Copilot Chat, type `@` and pick your new agent. Try:

   > `@manco-admin-agent log a task: investigate slow dashboard load times`

   You should see a status line, then a confirmation with a `MANCO-###` link.

## 5. Production hardening

- Set `VERIFY_SIGNATURE=true` to enforce GitHub's request signature.
- Put the server behind a load balancer with HTTPS.
- Rotate the Jira API token periodically and store it in a secret manager.
- Restrict the Jira account's permissions to only the MANCO project.

---

## Customising

| Want to change... | Where |
| --- | --- |
| Default issue type | `JIRA_DEFAULT_ISSUE_TYPE` env var |
| Project key | `JIRA_PROJECT_KEY` env var |
| Tool schema (extra fields like components, fix versions) | `tools` in `src/server.js` |
| System prompt / agent behaviour | `SYSTEM_PROMPT` in `src/server.js` |
| Jira field mapping (custom fields, ADF rich text) | `src/jira.js` |

---

## Troubleshooting

- **`401 Missing X-GitHub-Token`** — the request didn't come through Copilot. Make sure you're invoking the agent from Copilot Chat, not hitting the endpoint directly.
- **`Jira create issue failed (403 ...)`** — the configured Jira user lacks Create Issues permission on MANCO.
- **`Jira create issue failed (400 ... "issuetype" ...)`** — the issue type name doesn't exist in the project; update `JIRA_DEFAULT_ISSUE_TYPE` or the tool's `enum`.
- **LLM keeps replying without filing** — tighten the `SYSTEM_PROMPT` or the tool `description`.
