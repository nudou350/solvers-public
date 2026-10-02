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
  ZIP_TOO_LARGE: { level: "E", doc: "ZIP acima do teto" },
  ZIP_EXPANDS_TOO_MUCH: { level: "E", doc: "Bytes reais extraídos acima do teto" },
  ZIP_TOO_MANY_FILES: { level: "E", doc: "Mais arquivos que o teto" },
  ZIP_BAD_ROOT: { level: "E", doc: "Não há uma única pasta raiz com `manifest.json`" },
  ZIP_DUPLICATE_ENTRY: { level: "E", doc: "Nomes repetidos (NFC, sem distinguir caixa)" },
  ZIP_BAD_PATH: { level: "E", doc: "`..`, `\\`, absoluto, controle, nome com ponto inicial" },
  ZIP_SYMLINK: { level: "E", doc: "Entrada é link simbólico" },
  ZIP_IGNORED_FILE: { level: "A", doc: "`__MACOSX/`, `.DS_Store`, `Thumbs.db` removidos da extração" },
  FILE_TYPE_NOT_ALLOWED: { level: "E", doc: "Extensão ou pasta fora da fase" },
  FILE_NOT_UTF8: { level: "E", doc: "Arquivo de texto que não é UTF-8 válido" },
  FILE_TOO_LARGE: { level: "E", doc: "Arquivo acima do teto" },
  MANIFEST_MISSING: { level: "E", doc: "Sem `manifest.json`" },
  MANIFEST_INVALID_JSON: { level: "E", doc: "JSON inválido" },
  MANIFEST_SCHEMA: { level: "E", doc: "Campo de tipo ou tamanho errado (`path` aponta o campo)" },
  MANIFEST_UNKNOWN_FIELD: { level: "E", doc: "Campo desconhecido (terceiros)" },
  MANIFEST_SPEC_VERSION: { level: "E", doc: "Terceiro sem `specVersion: 1`" },
  MANIFEST_PLATFORM_FORBIDDEN: { level: "E", doc: "Terceiro com `platform` ou pasta `verifier/`" },
  MANIFEST_ID_OWNER: { level: "E", doc: "`id` ou `slug` já pertence a outro criador" },
  MANIFEST_SLUG_RESERVED: { level: "E", doc: "Slug reservado" },
  MANIFEST_SLUG_LOOKS_LIKE_ID: { level: "E", doc: "Slug no formato de `id` (32 hex)" },
  MANIFEST_GUARANTEE_FORBIDDEN: { level: "E", doc: "Terceiro com `guarantee.available: true` (Núcleo)" },
  MANIFEST_CATEGORY_FORBIDDEN: { level: "E", doc: "Categoria não permitida a terceiros no Núcleo (D13)" },
  MANIFEST_VERSION_NOT_GREATER: { level: "E", doc: "Versão não é maior que a publicada" },
  MANIFEST_NAME_TOO_LONG: { level: "E", doc: "Nome com mais de 32 bytes" },
  MANIFEST_VERSION_TOO_LONG: { level: "E", doc: "Versão com mais de 16 bytes" },
  MANIFEST_PRICE_BELOW_MIN: { level: "E", doc: "Preço abaixo do `min_price` da config" },
  MANIFEST_PATH_ESCAPE: { level: "E", doc: "Caminho do manifesto sai da pasta (§3.3)" },
  MANIFEST_VERSIONS_MISSING: { level: "E", doc: "Sem entrada em `versions[]` para a versão atual" },
  MANIFEST_DIFFERENTIATOR_UNPROVEN: { level: "A", doc: "Diferencial declarado que o validador não consegue comprovar (§4.2)" },
  MANIFEST_DIFFERENTIATORS_FEW: { level: "A", doc: "Menos de 2 diferenciais comprovados (critério \"2 de 5\")" },
  SUPPLY_WITH_TRIAL: { level: "A", doc: "`supply` (teto de licenças) com teste grátis ligado: o teste não consome vaga" },
  CATALOG_ONLY_IGNORED: { level: "A", doc: "Campo `catalogOnly`" },
  CONTENTS_MISMATCH: { level: "A", doc: "`packageContents` promete o que não existe" },
  TERMS_MISSING: { level: "E", doc: "Sem `terms` aceitos" },
  STEP_FILE_MISSING: { level: "E", doc: "Etapa declarada sem arquivo" },
  STEP_SECTION_MISSING: { level: "A/E", doc: "Falta seção obrigatória (E em v1 para as três principais)" },
  STEP_TOO_SHORT_LONG: { level: "A/E", doc: "Fora de 400–12.000 caracteres" },
  STEP_REFERENCE_UNKNOWN: { level: "A", doc: "Cita ferramenta ou template inexistente" },
  STEP_SENSITIVE_ASK: { level: "A", doc: "Pede dado sensível" },
  STEP_EXTERNAL_URL: { level: "A", doc: "URL de envio externa" },
  STEP_INJECTION_PATTERN: { level: "A", doc: "Padrão de injeção" },
  TEXT_HIDDEN_CHARS: { level: "A", doc: "Unicode invisível ou de direção" },
  GATE_TOO_MANY: { level: "A/E", doc: "Mais de 6 itens" },
  GATE_EVIDENCE_UNKNOWN_TOOL: { level: "E", doc: "`evidence.tool` inexistente (Abertura)" },
  KNOWLEDGE_TOO_BIG: { level: "E", doc: "Chunks acima do teto" },
  KNOWLEDGE_SOURCE_MISSING: { level: "E", doc: "Falta `source` (v1)" },
  KNOWLEDGE_DATE_INVALID: { level: "E", doc: "Data fora de `AAAA-MM-DD`" },
  KNOWLEDGE_EXPIRED: { level: "A", doc: "`valid_until` já passou" },
  KNOWLEDGE_FRONTMATTER_INVALID: { level: "E", doc: "YAML inválido" },
  PDF_NO_TEXT: { level: "E", doc: "PDF sem camada de texto (Abertura)", reserved: "P7" },
  TEMPLATE_UNDECLARED: { level: "A", doc: "Arquivo em `templates/` sem declaração" },
  TEMPLATE_MISSING: { level: "E", doc: "Declarado e ausente" },
  TEMPLATE_TYPE_FORBIDDEN: { level: "E", doc: "Tipo não permitido na fase" },
  TOOL_FORBIDDEN_RUNNER: { level: "E", doc: "Runner não permitido para terceiros" },
  TOOL_SCHEMA_MISSING: { level: "A/E", doc: "Sem `inputSchema`" },
  TOOL_SCHEMA_UNSAFE: { level: "E", doc: "`$ref` remoto, `pattern` ou profundidade" },
  TOOL_HTTP_HOST: { level: "E", doc: "Host fora da `allowedHosts` ou domínio compartilhado (Abertura)" },
  TOOL_EGRESS_MISSING: { level: "E", doc: "`http` sem `egress: true`" },
  TRIAL_STEPS_EXCEED: { level: "E", doc: "`trial.steps` maior que as etapas" },
  TRIAL_TOOL_UNKNOWN: { level: "E", doc: "`trial.tools` com ferramenta inexistente" },
  TRIAL_TEMPLATE_UNKNOWN: { level: "E", doc: "`trial.templates` inexistente" },
  ONBOARDING_SENSITIVE: { level: "A", doc: "Pergunta de dado sensível" },
  ONBOARDING_NEEDS_MEMORY: { level: "E", doc: "`onboarding` sem `usesMemory`" },
  EVAL_TOO_FEW_CASES: { level: "A/E", doc: "Menos de 10 casos (E em v1)" },
  EVAL_CASE_INVALID: { level: "E", doc: "Caso com JSON ou checagem inválida" },
  DIFF_UNREVIEWED_FILE: { level: "E", doc: "(interno) arquivo alterado sem passar pelo diff", reserved: "P4" },
  DIFF_ENDPOINT_CHANGED_MINOR: { level: "E", doc: "Mudança de `tools` (inclui `http`), `onboarding`, `requirements` ou estrutura de `steps` sem subir MAJOR" },
  SCAN_DUPLICATE_CONTENT: { level: "A", doc: "Conteúdo parecido com pacote publicado", reserved: "P4" },
} as const satisfies Record<string, CodeInfo>;

export type Code = keyof typeof CODES;

export const CODE_LIST = Object.keys(CODES) as Code[];
