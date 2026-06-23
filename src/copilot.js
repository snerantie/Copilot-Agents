/**
 * Helpers for talking to the GitHub Copilot Chat completions API as an
 * extension. When the extension is invoked, GitHub forwards an
 * `X-GitHub-Token` header that the extension can use to call Copilot's LLM
 * on behalf of the user.
 *
 * Docs: https://docs.github.com/en/copilot/building-copilot-extensions
 */

const COPILOT_API = "https://api.githubcopilot.com/chat/completions";

/**
 * Call the Copilot LLM (non-streaming) with tool/function-calling enabled.
 *
 * @param {object} args
 * @param {string} args.githubToken      Token from the X-GitHub-Token header
 * @param {Array<object>} args.messages  OpenAI-style chat messages
 * @param {Array<object>} [args.tools]   OpenAI-style tools/functions
 * @param {string} [args.model]          Defaults to "gpt-4o"
 * @returns {Promise<object>} The full completion response
 */
export async function copilotComplete({
  githubToken,
  messages,
  tools,
  model = "gpt-4o",
}) {
  const res = await fetch(COPILOT_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: tools && tools.length > 0 ? "auto" : undefined,
      stream: false,
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(
      `Copilot LLM call failed (${res.status} ${res.statusText}): ${bodyText}`
    );
  }
  return JSON.parse(bodyText);
}

/* ------------------------------------------------------------------ */
/* Server-Sent Events response helpers                                 */
/* ------------------------------------------------------------------ */
/**
 * Copilot Extensions return responses as an SSE stream in OpenAI
 * chat-completions chunk format. Each chunk is `data: { ... }\n\n`
 * and the stream ends with `data: [DONE]\n\n`.
 */

function sseChunk(delta) {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        index: 0,
        delta,
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone() {
  return "data: [DONE]\n\n";
}

/**
 * Begin an SSE response. Call before writing any chunks.
 */
export function startSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

/**
 * Stream a plain-text message to the Copilot chat window, then close.
 */
export function writeAndEnd(res, text) {
  res.write(sseChunk({ role: "assistant", content: text }));
  res.write(sseDone());
  res.end();
}

/**
 * Stream a "thinking" / status line, but keep the stream open.
 */
export function writeStatus(res, text) {
  res.write(sseChunk({ role: "assistant", content: text }));
}
