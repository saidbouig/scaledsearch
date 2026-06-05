// Built-in template/pipeline/index name patterns we exclude from `import`.
//
// Elasticsearch ships with 100+ system-owned templates and pipelines
// (APM, Fleet, ML, monitoring, ILM history, etc.). Importing them would
// produce a baseline that fights the cluster on replay — and they're not
// the user's schema anyway. Same for OpenSearch's auto-generated indices.
//
// We use exclude patterns rather than an allow-list because user templates
// can have any name; the built-ins follow predictable suffixes/prefixes.

// Leading-dot system indices/templates are universally system-owned in ES
// and OS. We always exclude these.
const SYSTEM_DOT_PREFIX = /^\./;

// Built-in template/pipeline name patterns. These cover:
// - APM, Fleet, ML, monitoring, ILM/SLM history, deprecation, watcher
// - Built-in suffix convention: @template, @pipeline, @default-pipeline
// - Search, agentless, behavioral analytics, connectors
const BUILTIN_TEMPLATE_PATTERNS = [
  /@template$/,
  /@pipeline$/,
  /@default-pipeline$/,
  /@json-pipeline$/,
  /@json-message$/,
  /^(logs|metrics|traces|synthetics)$/,
  /^(logs|metrics|traces)-apm/,
  /^(logs|metrics|traces)-otel/,
  /^apm@/,
  /^(ilm|slm|watch)-history/,
  /^behavioral_analytics-/,
  /^elastic-connectors/,
  /^reindex-data-stream-/,
  /^search-default-/,
  /^search-acl-filter$/,
  /^logs-default-pipeline$/,
  /^agentless$/,
];

// OpenSearch plugins auto-create indices with these prefixes/patterns.
// They're not user data, just plugin state.
const OS_PLUGIN_INDEX_PATTERNS = [
  /^top_queries-/,
  /^\.opensearch-/,
  /^\.opendistro-/,
  /^\.plugins-/,
  /^\.tasks$/,
];

export function isBuiltinTemplate(name: string): boolean {
  if (SYSTEM_DOT_PREFIX.test(name)) return true;
  return BUILTIN_TEMPLATE_PATTERNS.some(p => p.test(name));
}

// Pipelines follow the same naming convention as templates — same filter.
export function isBuiltinPipeline(name: string): boolean {
  return isBuiltinTemplate(name);
}

// Indices: leading-dot system + OS plugin patterns. User indices with
// other names are kept.
export function isBuiltinIndex(name: string): boolean {
  if (SYSTEM_DOT_PREFIX.test(name)) return true;
  return OS_PLUGIN_INDEX_PATTERNS.some(p => p.test(name));
}
