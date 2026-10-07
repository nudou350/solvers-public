// Catálogo de códigos do validador (PACKAGE_SPEC.md, Apêndice A). É a fonte única: o teste
// test/validate.test.ts confere que o Apêndice da spec e este arquivo têm exatamente os mesmos códigos e níveis.
//
// Nível: "E" bloqueia o envio; "A" vai como aviso ao revisor; "A/E" depende do pacote (aviso em v0, erro em v1).

export type CodeLevel = "E" | "A" | "A/E";

type CodeInfo = {
  level: CodeLevel;
  /** O que o código significa (vai no Apêndice da spec). */
  doc: string;
  /** Ainda não emitido: depende de parte de outra fase (extrator de ZIP, parser de PDF, diff da revisão). */
  reserved?: "P4" | "P7";
};

export const CODES = {
  ZIP_TOO_LARGE: { level: "E", doc: "ZIP above the cap" },
  ZIP_EXPANDS_TOO_MUCH: { level: "E", doc: "Actual extracted bytes above the cap" },
  ZIP_TOO_MANY_FILES: { level: "E", doc: "More files than the cap" },
  ZIP_BAD_ROOT: { level: "E", doc: "There is not a single root folder with `manifest.json`" },
  ZIP_DUPLICATE_ENTRY: { level: "E", doc: "Repeated names (NFC, case-insensitive)" },
  ZIP_BAD_PATH: { level: "E", doc: "`..`, `\\`, absolute, control characters, a leading-dot name" },
  ZIP_SYMLINK: { level: "E", doc: "Entry is a symbolic link" },
  ZIP_IGNORED_FILE: { level: "A", doc: "`__MACOSX/`, `.DS_Store`, `Thumbs.db` removed from extraction" },
  FILE_TYPE_NOT_ALLOWED: { level: "E", doc: "Extension or folder outside the phase" },
  FILE_NOT_UTF8: { level: "E", doc: "Arquivo de texto que não é UTF-8 válido" },
  FILE_TOO_LARGE: { level: "E", doc: "File above the cap" },
  MANIFEST_MISSING: { level: "E", doc: "No `manifest.json`" },
  MANIFEST_INVALID_JSON: { level: "E", doc: "Invalid JSON" },
  MANIFEST_SCHEMA: { level: "E", doc: "Field of the wrong type or size (`path` points to the field)" },
  MANIFEST_UNKNOWN_FIELD: { level: "E", doc: "Unknown field (third parties)" },
  MANIFEST_SPEC_VERSION: { level: "E", doc: "A third party without `specVersion: 1`" },
  MANIFEST_PLATFORM_FORBIDDEN: { level: "E", doc: "A third party with `platform` or a `verifier/` folder" },
  MANIFEST_ID_OWNER: { level: "E", doc: "`id` or `slug` already belongs to another creator" },
  MANIFEST_SLUG_RESERVED: { level: "E", doc: "Reserved slug" },
  MANIFEST_SLUG_LOOKS_LIKE_ID: { level: "E", doc: "Slug in the shape of an `id` (32 hex)" },
  MANIFEST_GUARANTEE_FORBIDDEN: { level: "E", doc: "A third party with `guarantee.available: true` (Core)" },
  MANIFEST_CATEGORY_FORBIDDEN: { level: "E", doc: "A category not allowed for third parties in the Core phase (D13)" },
  MANIFEST_VERSION_NOT_GREATER: { level: "E", doc: "The version is not greater than the published one" },
  MANIFEST_NAME_TOO_LONG: { level: "E", doc: "A name over 32 bytes" },
  MANIFEST_VERSION_TOO_LONG: { level: "E", doc: "A version over 16 bytes" },
  MANIFEST_PRICE_BELOW_MIN: { level: "E", doc: "Price below the config's `min_price`" },
  MANIFEST_PATH_ESCAPE: { level: "E", doc: "A manifest path leaves the folder (§3.3)" },
  MANIFEST_VERSIONS_MISSING: { level: "E", doc: "No entry in `versions[]` for the current version" },
  MANIFEST_DIFFERENTIATOR_UNPROVEN: { level: "A", doc: "A declared differentiator the validator cannot prove (§4.2)" },
  MANIFEST_DIFFERENTIATORS_FEW: { level: "A", doc: "Fewer than 2 proven differentiators (\"2 of 5\" criterion)" },
  SUPPLY_WITH_TRIAL: { level: "A", doc: "`supply` (license cap) with the free trial on: the trial does not consume a slot" },
  CATALOG_ONLY_IGNORED: { level: "A", doc: "The `catalogOnly` field" },
  CONTENTS_MISMATCH: { level: "A", doc: "`packageContents` promises what does not exist" },
  TERMS_MISSING: { level: "E", doc: "No accepted `terms`" },
  STEP_FILE_MISSING: { level: "E", doc: "A declared step with no file" },
  STEP_SECTION_MISSING: { level: "A/E", doc: "A required section is missing (E in v1 for the three main ones)" },
  STEP_TOO_SHORT_LONG: { level: "A/E", doc: "Outside 400-12,000 characters" },
  STEP_REFERENCE_UNKNOWN: { level: "A", doc: "Cites a tool or template that does not exist" },
  STEP_SENSITIVE_ASK: { level: "A", doc: "Asks for sensitive data" },
  STEP_EXTERNAL_URL: { level: "A", doc: "An external data-sending URL" },
  STEP_INJECTION_PATTERN: { level: "A", doc: "Injection pattern" },
  TEXT_HIDDEN_CHARS: { level: "A", doc: "Invisible or bidirectional Unicode" },
  GATE_TOO_MANY: { level: "A/E", doc: "More than 6 items" },
  GATE_EVIDENCE_UNKNOWN_TOOL: { level: "E", doc: "`evidence.tool` does not exist (Opening)" },
  KNOWLEDGE_TOO_BIG: { level: "E", doc: "Chunks above the cap" },
  KNOWLEDGE_SOURCE_MISSING: { level: "E", doc: "`source` missing (v1)" },
  KNOWLEDGE_DATE_INVALID: { level: "E", doc: "Date outside `YYYY-MM-DD`" },
  KNOWLEDGE_EXPIRED: { level: "A", doc: "`valid_until` has already passed" },
  KNOWLEDGE_FRONTMATTER_INVALID: { level: "E", doc: "Invalid YAML" },
  PDF_NO_TEXT: { level: "E", doc: "A PDF with no text layer (Opening)", reserved: "P7" },
  TEMPLATE_UNDECLARED: { level: "A", doc: "A file in `templates/` with no declaration" },
  TEMPLATE_MISSING: { level: "E", doc: "Declared and absent" },
  TEMPLATE_TYPE_FORBIDDEN: { level: "E", doc: "A type not allowed in the phase" },
  TOOL_FORBIDDEN_RUNNER: { level: "E", doc: "A runner not allowed for third parties" },
  TOOL_SCHEMA_MISSING: { level: "A/E", doc: "No `inputSchema`" },
  TOOL_SCHEMA_UNSAFE: { level: "E", doc: "Remote `$ref`, `pattern` or depth" },
  TOOL_HTTP_HOST: { level: "E", doc: "A host outside `allowedHosts` or a shared domain (Opening)" },
  TOOL_EGRESS_MISSING: { level: "E", doc: "`http` without `egress: true`" },
  TRIAL_STEPS_EXCEED: { level: "E", doc: "`trial.steps` greater than the steps" },
  TRIAL_TOOL_UNKNOWN: { level: "E", doc: "`trial.tools` with a nonexistent tool" },
  TRIAL_TEMPLATE_UNKNOWN: { level: "E", doc: "`trial.templates` nonexistent" },
  ONBOARDING_SENSITIVE: { level: "A", doc: "A sensitive-data question" },
  ONBOARDING_NEEDS_MEMORY: { level: "E", doc: "`onboarding` without `usesMemory`" },
  EVAL_TOO_FEW_CASES: { level: "A/E", doc: "Fewer than 10 cases (E in v1)" },
  EVAL_CASE_INVALID: { level: "E", doc: "A case with invalid JSON or an invalid check" },
  DIFF_UNREVIEWED_FILE: { level: "E", doc: "(internal) a file changed without going through the diff", reserved: "P4" },
  DIFF_ENDPOINT_CHANGED_MINOR: { level: "E", doc: "A change to `tools` (including `http`), `onboarding`, `requirements` or the structure of `steps` without bumping MAJOR" },
  SCAN_DUPLICATE_CONTENT: { level: "A", doc: "Content similar to a published package", reserved: "P4" },
} as const satisfies Record<string, CodeInfo>;

export type Code = keyof typeof CODES;

export const CODE_LIST = Object.keys(CODES) as Code[];
