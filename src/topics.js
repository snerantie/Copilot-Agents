/**
 * The 16 Manco topics. Edit this list to add, remove, or rename topics.
 *
 * - `value`    is the canonical slug used in the LLM tool's enum and as the
 *              suffix of the Jira label (e.g. "manco-architecture").
 * - `label`    is the human-readable name shown to the LLM and used in the
 *              ticket summary prefix (e.g. "[Architecture] ...").
 * - `aliases`  are extra phrases the LLM can match in natural language so
 *              that, e.g. "AI" or "architecture review" still route to
 *              "architecture". Add as many as you need.
 */
export const TOPICS = [
  { value: "architecture",       label: "Architecture",       aliases: ["arch", "architecture review"] },
  { value: "service-management", label: "Service Management", aliases: ["service mgmt", "ITSM"] },
  { value: "audit",              label: "Audit",              aliases: [] },
  { value: "tech-assurance",     label: "Tech Assurance",     aliases: ["technical assurance"] },
  { value: "cyber",              label: "Cyber",              aliases: ["cybersecurity", "security"] },
  { value: "risk",               label: "Risk",               aliases: [] },
  { value: "pi-planning",        label: "PI Planning",        aliases: ["program increment planning"] },
  { value: "pi-delivery",        label: "PI Delivery",        aliases: ["program increment delivery"] },
  { value: "international",      label: "International",      aliases: [] },
  { value: "innovations",        label: "Innovations",        aliases: ["innovation"] },
  { value: "ways-of-working",    label: "Ways of Working",    aliases: ["wow", "process"] },
  { value: "resourcing",         label: "Resourcing",         aliases: ["staffing", "headcount"] },
  { value: "hr",                 label: "HR",                 aliases: ["human resources", "people"] },
  { value: "budget",             label: "Budget",             aliases: ["finance", "spend"] },
  { value: "manco",              label: "Manco",              aliases: ["management committee"] },
  { value: "vfs-exco",           label: "VFS Exco",           aliases: ["exco", "executive committee"] },
];

const BY_VALUE = new Map(TOPICS.map((t) => [t.value, t]));

export function getTopic(value) {
  return BY_VALUE.get(value);
}

export const TOPIC_VALUES = TOPICS.map((t) => t.value);

/**
 * Human-readable lines used in the LLM system prompt so it knows how to
 * route. Aliases are included to improve matching from natural language.
 */
export function topicGuideForPrompt() {
  return TOPICS.map((t) => {
    const aliases = t.aliases.length ? ` (aliases: ${t.aliases.join(", ")})` : "";
    return `- ${t.label}${aliases} -> "${t.value}"`;
  }).join("\n");
}

/**
 * Jira label format. Labels can't contain spaces; we use lowercase slugs
 * prefixed with `manco-` so they're easy to JQL on.
 */
export function topicLabel(value) {
  return `manco-${value}`;
}
