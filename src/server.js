/**
 * MANCO Admin Agent — a GitHub Copilot Extension (agent type) that logs
 * tickets into the Jira MANCO project.
 *
 * Flow:
 *   1. GitHub Copilot sends a chat-completions style request to `POST /`
 *      with the user's messages and an `X-GitHub-Token` header.
 *   2. We let Copilot's own LLM decide whether to call our `create_jira_ticket`
 *      tool, and to extract the structured fields from natural language.
 *   3. When the tool is called, we hit the Jira REST API and stream a
 *      confirmation (with the new ticket URL) back to the chat.
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
    project: process.env.JIRA_PROJECT_KEY || "MANCO",
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
        "Create a ticket in the Jira MANCO project. Use this whenever " +
        "the user asks to log, file, open, or create an issue/ticket/bug/task.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Short one-line title of the ticket.",
          },
          description: {
            type: "string",
            description:
              "Detailed description of the problem, request, or task. " +
              "Include steps, context, or acceptance criteria when present.",
          },
          issueType: {
            type: "string",
            enum: ["Task", "Bug", "Story", "Epic", "Improvement"],
            description: "Jira issue type. Defaults to Task.",
          },
          priority: {
            type: "string",
            enum: ["Highest", "High", "Medium", "Low", "Lowest"],
            description: "Priority if the user specifies one.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Optional Jira labels.",
          },
        },
        required: ["summary"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the MANCO admin agent. Your job is to help \
users log tickets into the Jira "MANCO" project.

Rules:
- If the user wants to file/log/open a ticket, ALWAYS call the \
\`create_jira_ticket\` tool with the best fields you can infer.
- If the user's request is missing a summary, ask them for one before \
calling the tool.
- Default issueType to "Task" unless the user clearly describes a bug.
- Be concise. Don't restate the whole conversation.`;

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

  // The model didn't decide to file a ticket — just relay its reply.
  if (toolCalls.length === 0) {
    writeAndEnd(
      res,
      message?.content ||
        "I can log tickets into the MANCO Jira project. Tell me what to file."
    );
    return;
  }

  // Process tool calls (we only expose one tool, but loop defensively).
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

    writeStatus(res, `Filing ticket in ${process.env.JIRA_PROJECT_KEY || "MANCO"}...\n\n`);

    try {
      const issue = await createIssue(
        {
          host: process.env.JIRA_HOST,
          email: process.env.JIRA_EMAIL,
          apiToken: process.env.JIRA_API_TOKEN,
          projectKey: process.env.JIRA_PROJECT_KEY || "MANCO",
        },
        {
          summary: args.summary,
          description: args.description,
          issueType: args.issueType || process.env.JIRA_DEFAULT_ISSUE_TYPE || "Task",
          priority: args.priority,
          labels: args.labels,
        }
      );

      const md =
        `Done — created **[${issue.key}](${issue.url})** in ${process.env.JIRA_PROJECT_KEY || "MANCO"}.\n\n` +
        `- **Summary:** ${args.summary}\n` +
        (args.issueType ? `- **Type:** ${args.issueType}\n` : "") +
        (args.priority ? `- **Priority:** ${args.priority}\n` : "") +
        (args.labels?.length ? `- **Labels:** ${args.labels.join(", ")}\n` : "");
      writeAndEnd(res, md);
      return;
    } catch (err) {
      writeAndEnd(
        res,
        `I couldn't create the ticket: ${err.message}`
      );
      return;
    }
  }

  // Defensive fallback if no recognised tool calls were processed.
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
