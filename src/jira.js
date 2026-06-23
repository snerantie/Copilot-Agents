/**
 * Minimal Jira Cloud REST API v3 client.
 *
 * Auth: HTTP Basic with `email:api_token`. API tokens are generated at
 * https://id.atlassian.com/manage-profile/security/api-tokens
 */

function authHeader({ email, apiToken }) {
  const token = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Convert plain text into Atlassian Document Format (ADF), which Jira v3
 * requires for rich text fields like `description`.
 */
function toADF(text) {
  if (!text) return undefined;
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: String(text) }],
      },
    ],
  };
}

/**
 * Create a Jira issue.
 *
 * @param {object} config
 * @param {string} config.host           e.g. "acme.atlassian.net"
 * @param {string} config.email
 * @param {string} config.apiToken
 * @param {string} config.projectKey     e.g. "MANCO"
 * @param {object} ticket
 * @param {string} ticket.summary
 * @param {string} [ticket.description]
 * @param {string} [ticket.issueType="Task"]
 * @param {string} [ticket.priority]     e.g. "High"
 * @param {string[]} [ticket.labels]
 * @param {string} [ticket.assigneeAccountId]
 * @returns {Promise<{key: string, id: string, self: string, url: string}>}
 */
export async function createIssue(config, ticket) {
  const {
    host,
    email,
    apiToken,
    projectKey,
  } = config;

  if (!host || !email || !apiToken || !projectKey) {
    throw new Error(
      "Jira is not configured. Set JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY."
    );
  }
  if (!ticket?.summary) {
    throw new Error("Ticket `summary` is required.");
  }

  const fields = {
    project: { key: projectKey },
    summary: ticket.summary,
    issuetype: { name: ticket.issueType || "Task" },
  };
  if (ticket.description) fields.description = toADF(ticket.description);
  if (ticket.priority) fields.priority = { name: ticket.priority };
  if (Array.isArray(ticket.labels) && ticket.labels.length > 0) {
    fields.labels = ticket.labels;
  }
  if (ticket.assigneeAccountId) {
    fields.assignee = { accountId: ticket.assigneeAccountId };
  }

  const url = `https://${host}/rest/api/3/issue`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader({ email, apiToken }),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(
      `Jira create issue failed (${res.status} ${res.statusText}): ${bodyText}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error(`Jira returned non-JSON body: ${bodyText}`);
  }

  return {
    key: parsed.key,
    id: parsed.id,
    self: parsed.self,
    url: `https://${host}/browse/${parsed.key}`,
  };
}
