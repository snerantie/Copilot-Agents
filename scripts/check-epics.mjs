#!/usr/bin/env node
/**
 * check-epics — verify that every `parentEpicKey` configured in
 * `src/topics.js` actually exists in Jira, is an Epic, and (when a
 * `featureKey` is also configured) is a child of that Feature.
 *
 * Usage:
 *   npm run check:epics
 *
 * Reads JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN from .env.
 * Exits 0 if every configured entry is healthy, 1 otherwise.
 * Topics whose `parentEpicKey` is null are reported as "skipped".
 */

import "dotenv/config";
import { TOPICS } from "../src/topics.js";

const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function skip(msg) {
  console.log(`• ${msg}`);
}

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error(
    "Missing one of JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN. " +
      "Did you copy .env.example to .env and fill it in?"
  );
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64")}`;

async function getIssue(key) {
  const url = `https://${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(
    key
  )}?fields=issuetype,summary,parent`;
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

let configured = 0;
let healthy = 0;

for (const topic of TOPICS) {
  if (!topic.parentEpicKey) {
    skip(`${topic.label.padEnd(20)} — no parentEpicKey configured (label-only)`);
    continue;
  }
  configured++;

  try {
    const issue = await getIssue(topic.parentEpicKey);
    const issueType = issue.fields?.issuetype?.name;
    const parentKey = issue.fields?.parent?.key;
    const summary = issue.fields?.summary || "";

    if (issueType !== "Epic") {
      fail(
        `${topic.label.padEnd(20)} — ${topic.parentEpicKey} exists but is a ` +
          `${issueType}, expected Epic. Fix in src/topics.js.`
      );
      continue;
    }

    if (topic.featureKey && parentKey !== topic.featureKey) {
      fail(
        `${topic.label.padEnd(20)} — Epic ${topic.parentEpicKey} is not a ` +
          `child of Feature ${topic.featureKey} (parent: ${parentKey || "none"}). ` +
          `Either fix the Jira hierarchy or update src/topics.js.`
      );
      continue;
    }

    ok(
      `${topic.label.padEnd(20)} → ${topic.parentEpicKey} (${summary.slice(0, 60)})`
    );
    healthy++;
  } catch (err) {
    fail(`${topic.label.padEnd(20)} — ${topic.parentEpicKey} : ${err.message}`);
  }
}

console.log("");
console.log(
  `Summary: ${healthy}/${configured} configured Epics healthy, ` +
    `${TOPICS.length - configured} topic(s) on label-only fallback.`
);

if (configured === 0) {
  console.log(
    "\nTip: fill in `parentEpicKey` values in src/topics.js to enable " +
      "Epic-parented tickets. Until then, tickets are filed in the project " +
      "with the topic label only."
  );
}
