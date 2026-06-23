/**
 * The 16 Manco topics. Edit this list to add, remove, or rename topics.
 *
 * - `value`           canonical slug used in the LLM tool's enum and as the
 *                     suffix of the Jira label (e.g. "manco-architecture").
 * - `label`           human-readable name shown to the LLM and used in the
 *                     ticket summary prefix (e.g. "[Architecture] ...").
 * - `aliases`         extra phrases the LLM can match from natural language.
 * - `featureKey`      the Jira issue key of the Feature for this topic
 *                     (e.g. "VFST2-970" for Architecture). Used for the
 *                     `check:epics` helper to verify your `parentEpicKey`
 *                     is actually a child of the right Feature.
 * - `parentEpicKey`   the Jira issue key of the Epic new Tasks should be
 *                     parented under. Leave as null to fall back to
 *                     label-only routing for this topic.
 *
 * To fill in `parentEpicKey` values, see README → "Filling in landing Epics".
 */
export const TOPICS = [
  { value: "architecture",       label: "Architecture",       aliases: ["arch", "architecture review"],         featureKey: "VFST2-970", parentEpicKey: null },
  { value: "service-management", label: "Service Management", aliases: ["service mgmt", "ITSM"],                 featureKey: null,        parentEpicKey: null },
  { value: "audit",              label: "Audit",              aliases: [],                                       featureKey: null,        parentEpicKey: null },
  { value: "tech-assurance",     label: "Tech Assurance",     aliases: ["technical assurance"],                  featureKey: null,        parentEpicKey: null },
  { value: "cyber",              label: "Cyber",              aliases: ["cybersecurity", "security"],            featureKey: null,        parentEpicKey: null },
  { value: "risk",               label: "Risk",               aliases: [],                                       featureKey: null,        parentEpicKey: null },
  { value: "pi-planning",        label: "PI Planning",        aliases: ["program increment planning"],           featureKey: null,        parentEpicKey: null },
  { value: "pi-delivery",        label: "PI Delivery",        aliases: ["program increment delivery"],           featureKey: null,        parentEpicKey: null },
  { value: "international",      label: "International",      aliases: [],                                       featureKey: null,        parentEpicKey: null },
  { value: "innovations",        label: "Innovations",        aliases: ["innovation"],                           featureKey: null,        parentEpicKey: null },
  { value: "ways-of-working",    label: "Ways of Working",    aliases: ["wow", "process"],                       featureKey: null,        parentEpicKey: null },
  { value: "resourcing",         label: "Resourcing",         aliases: ["staffing", "headcount"],                featureKey: null,        parentEpicKey: null },
  { value: "hr",                 label: "HR",                 aliases: ["human resources", "people"],            featureKey: null,        parentEpicKey: null },
  { value: "budget",             label: "Budget",             aliases: ["finance", "spend"],                     featureKey: null,        parentEpicKey: null },
  { value: "manco",              label: "Manco",              aliases: ["management committee"],                 featureKey: null,        parentEpicKey: null },
  { value: "vfs-exco",           label: "VFS Exco",           aliases: ["exco", "executive committee"],          featureKey: null,        parentEpicKey: null },
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
