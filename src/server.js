/**
 * MANCO Admin Agent — a GitHub Copilot Extension (agent type) that logs
 * tickets into the Jira VFST2 project, tagged by Manco topic.
 *
 * Flow:
 *   1. GitHub Copilot sends a chat-completions style request to `POST /`
 *      with the user's messages and an `X-GitHub-Token` header.
 *   2. We let Copilot's own LLM decide whether to call our
 *      `create_jira_ticket` tool and pick the correct Manco topic from a
 *      fixed allow-list.
 *   3. When the tool is called, we hit the Jira REST API, creating an
 *      issue in VFST2 with a topic label (e.g. `manco-architecture`) and a
 *      summary prefix (e.g. `[Architecture] ...`).
 */

import "dotenv/config";
import express from "express";

import { createIssue } from "./jira.js";
import {
  copilotComplete,
  startSSE,
  writeAndEnd,
  writeStatus,
} from "./copilot.js";
import { verifySignature } from "./verifySignature.js";
import {
  TOPICS,
  TOPIC_VALUES,
  getTopic,
  topicGuideForPrompt,
  topicLabel,
} from "./topics.js";

const app = express();

// Capture the raw body so we can verify GitHub's signature.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */
app.get("/", (_req, res) => {
  res.json({
    name: "manco-admin-agent",
    status: "ok",
    project: process.env.JIRA_PROJECT_KEY || "VFST2",
    topics: TOPICS.map((t) => t.label),
  });
});

/* ------------------------------------------------------------------ */
/* Tool definition surfaced to the Copilot LLM                          */
/* ------------------------------------------------------------------ */
const tools = [
  {
    type: "function",
    function: {
      name: "create_jira_ticket",
      description:
        "Create a ticket in the Jira VFST2 project for the Manco programme. " +
        "Call this whenever the user asks to log, file, open, or create an " +
        "issue/ticket/bug/task discussed in a Manco meeting. You MUST pick " +
        "the topic from the allowed list.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            enum: TOPIC_VALUES,
            description:
              "Which Manco workstream / department this ticket belongs to. " +
              "Pick the single best match from the enum.",
          },
          summary: {
            type: "string",
            description:
              "Short one-line title (5-12 words). Do NOT include the topic " +
              "prefix; the server adds that automatically.",
          },
          description: {
            type: "string",
            description:
              "Detailed description of the problem, request, or action item. " +
              "Include context, owner if mentioned, and acceptance criteria " +
              "when present.",
          },
          issueType: {
            type: "string",
            enum: ["Task", "Bug", "Story", "Epic", "Improvement"],
            description: "Jira issue type. Defaults to Task.",
          },
          priority: {
            type: "string",
            enum: ["Highest", "High", "Medium", "Low", "Lowest"],
            description: "Priority if the user mentions urgency or severity.",
          },
          extraLabels: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional additional Jira labels (lowercase, no spaces). The " +
              "topic label is added automatically; do not repeat it here.",
          },
        },
        required: ["topic", "summary"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the Manco admin agent. Your job is to help \
VFS senior management (including the CIO) log action items from the Manco \
meeting into Jira project VFST2.

You MUST:
- Always call the \`create_jira_ticket\` tool when the user wants to log, \
file, open, raise, or create a ticket / issue / action item / bug / task.
- Pick a single \`topic\` from the allowed list below by matching the \
user's words to the topic label or aliases. If the topic is genuinely \
ambiguous between two, ask one short clarifying question instead of \
guessing.
- Keep the \`summary\` short (5-12 words) and free of the topic prefix.
- Default \`issueType\` to "Task" unless the user clearly describes a bug \
or a story.
- If the user doesn't give a clear summary, ask for one before calling the \
tool.

Manco topics (use the value on the right of the arrow):
${topicGuideForPrompt()}

Be concise. Do not restate the conversation.`;

/* ------------------------------------------------------------------ */
/* Main Copilot Extension endpoint                                     */
/* ------------------------------------------------------------------ */
app.post("/", async (req, res) => {
  const githubToken = req.get("X-GitHub-Token");
  const signature = req.get("Github-Public-Key-Signature");
  const keyId = req.get("Github-Public-Key-Identifier");

  // Optional signature verification — enable in production.
  if (process.env.VERIFY_SIGNATURE === "true") {
    const ok = await verifySignature(req.rawBody, signature, keyId).catch(
      () => false
    );
    if (!ok) {
      res.status(401).json({ error: "Invalid GitHub signature" });
      return;
    }
  }

  if (!githubToken) {
    res.status(401).json({ error: "Missing X-GitHub-Token header" });
    return;
  }

  const userMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...userMessages,
  ];

  startSSE(res);

  let completion;
  try {
    completion = await copilotComplete({
      githubToken,
      messages,
      tools,
    });
  } catch (err) {
    writeAndEnd(res, `Sorry, I couldn't reach Copilot's LLM: ${err.message}`);
    return;
  }

  const choice = completion.choices?.[0];
  const message = choice?.message;
  const toolCalls = message?.tool_calls || [];

  // The model didn't decide to file a ticket — relay its reply.
  if (toolCalls.length === 0) {
    writeAndEnd(
      res,
      message?.content ||
        "I can log Manco action items into Jira (project VFST2). " +
          "Tell me which workstream and what to file."
    );
    return;
  }

  // Process tool calls (we expose one tool; loop defensively).
  for (const call of toolCalls) {
    if (call.function?.name !== "create_jira_ticket") continue;

    let args;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch (err) {
      writeAndEnd(
        res,
        `I tried to file a ticket but couldn't parse the fields: ${err.message}`
      );
      return;
    }

    const topic = getTopic(args.topic);
    if (!topic) {
      writeAndEnd(
        res,
        `I couldn't pick a valid Manco topic (got "${args.topic}"). ` +
          `Allowed: ${TOPIC_VALUES.join(", ")}`
      );
      return;
    }

    const projectKey = process.env.JIRA_PROJECT_KEY || "VFST2";
    const prefixedSummary = `[${topic.label}] ${args.summary}`;
    const labels = [
      topicLabel(topic.value),
      ...(Array.isArray(args.extraLabels) ? args.extraLabels : []),
    ];

    writeStatus(
      res,
      `Filing **${topic.label}** ticket in ${projectKey}...\n\n`
    );

    try {
      const issue = await createIssue(
        {
          host: process.env.JIRA_HOST,
          email: process.env.JIRA_EMAIL,
          apiToken: process.env.JIRA_API_TOKEN,
          projectKey,
        },
        {
          summary: prefixedSummary,
          description: args.description,
          issueType:
            args.issueType || process.env.JIRA_DEFAULT_ISSUE_TYPE || "Task",
          priority: args.priority,
          labels,
        }
      );

      const md =
        `Done — created **[${issue.key}](${issue.url})** in ${projectKey}.\n\n` +
        `- **Topic:** ${topic.label}\n` +
        `- **Summary:** ${args.summary}\n` +
        (args.issueType ? `- **Type:** ${args.issueType}\n` : "") +
        (args.priority ? `- **Priority:** ${args.priority}\n` : "") +
        `- **Labels:** ${labels.join(", ")}\n`;
      writeAndEnd(res, md);
      return;
    } catch (err) {
      writeAndEnd(res, `I couldn't create the ticket: ${err.message}`);
      return;
    }
  }

  writeAndEnd(res, message?.content || "No action taken.");
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`MANCO admin agent listening on :${PORT}`);
});
