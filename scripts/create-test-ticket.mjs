#!/usr/bin/env node
/**
 * create-test-ticket — exercise the agent's Jira plumbing end-to-end
 * WITHOUT going through Copilot or GitHub.
 *
 * Reads JIRA_* env vars, picks a topic, and creates one issue in VFST2
 * exactly the way the agent would (label, summary prefix, optional parent
 * Epic).
 *
 * Usage:
 *   npm run test:ticket -- --topic risk --summary "Test from agent" \
 *       --description "Created by create-test-ticket"
 *
 * Defaults: topic=architecture, summary="[smoke test] please ignore"
 *
 * Exit codes: 0 on success, 1 on any failure. Prints the new issue URL on
 * success so you can verify in Jira.
 */

import "dotenv/config";
import { createIssue } from "../src/jira.js";
import { TOPICS, getTopic, topicLabel } from "../src/topics.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const topicSlug = args.topic || "architecture";
const summary = args.summary || "[smoke test] please ignore";
const description =
  args.description ||
  "Created by scripts/create-test-ticket.mjs to verify Jira plumbing. Safe to delete.";
const issueType = args.issueType || "Task";

if (args.help || args.h) {
  console.log(
    `Usage: npm run test:ticket -- --topic <slug> --summary "..." [--description "..."] [--issueType Task]`
  );
  console.log(`Valid topic slugs: ${TOPICS.map((t) => t.value).join(", ")}`);
  process.exit(0);
}

const topic = getTopic(topicSlug);
if (!topic) {
  console.error(
    `✗ Unknown topic "${topicSlug}". Valid: ${TOPICS.map((t) => t.value).join(", ")}`
  );
  process.exit(1);
}

const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
const projectKey = process.env.JIRA_PROJECT_KEY || "VFST2";

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error(
    "✗ Missing JIRA_HOST, JIRA_EMAIL, or JIRA_API_TOKEN.\n" +
      "  Copy .env.example to .env and fill them in first."
  );
  process.exit(1);
}

console.log(`→ Creating test ticket in ${projectKey}`);
console.log(`  Topic:        ${topic.label} (${topic.value})`);
console.log(`  Summary:      [${topic.label}] ${summary}`);
console.log(`  Issue type:   ${issueType}`);
console.log(`  Label:        ${topicLabel(topic.value)}`);
console.log(
  `  Parent Epic:  ${topic.parentEpicKey || "(not configured — label-only)"}`
);
console.log("");

try {
  const issue = await createIssue(
    {
      host: JIRA_HOST,
      email: JIRA_EMAIL,
      apiToken: JIRA_API_TOKEN,
      projectKey,
    },
    {
      summary: `[${topic.label}] ${summary}`,
      description,
      issueType,
      labels: [topicLabel(topic.value)],
      parentKey: topic.parentEpicKey || undefined,
    }
  );

  console.log(`✓ Created ${issue.key}`);
  console.log(`  ${issue.url}`);
  console.log("");
  console.log("Verify in Jira:");
  console.log(
    `  1. Open ${issue.url} — issue should exist with the [${topic.label}] prefix`
  );
  console.log(`  2. Confirm the label '${topicLabel(topic.value)}' is set`);
  if (topic.parentEpicKey) {
    console.log(
      `  3. Confirm the parent is Epic ${topic.parentEpicKey}`
    );
  }
  console.log("\nDelete the ticket when done to keep your project tidy.");
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  console.error("");
  if (/401|Unauthorized/i.test(err.message)) {
    console.error(
      "  Likely cause: JIRA_EMAIL or JIRA_API_TOKEN is wrong, or the token expired."
    );
  } else if (/403|Forbidden/i.test(err.message)) {
    console.error(
      `  Likely cause: the account ${JIRA_EMAIL} can't create issues in ${projectKey}.`
    );
  } else if (/No project|404/i.test(err.message)) {
    console.error(
      `  Likely cause: JIRA_PROJECT_KEY '${projectKey}' is wrong or the account can't see it.`
    );
  } else if (/parent|epic/i.test(err.message)) {
    console.error(
      `  Likely cause: parentEpicKey ${topic.parentEpicKey} is invalid — fix in src/topics.js or unset it.`
    );
  }
  process.exit(1);
}
