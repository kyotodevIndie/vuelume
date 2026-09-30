# Relatório — Fases 0 e 1 (+ prova de conceito das Fases 2/3)

Data: 2026-09-29 · Nome provisório: **vuelume**

## Resposta à pergunta principal

> É tecnicamente viável construir um editor visual bidirecional para projetos Vue reais sem
> destruir ou substituir o código original?

**Sim, no nível de props, com evidência.** Não é uma conclusão teórica:

- `@vue/compiler-sfc` expõe o AST **bruto** do template com offsets absolutos no arquivo para
  elementos, nomes/valores de atributos e expressões de diretivas. Isso permite editar só os
  bytes necessários.
- `setProp`/`removeProp` foram implementados com **verificação por re-parse** (qualquer divergência
  rejeita a edição). Há 85 testes, incluindo os exemplos exatos do briefing, fuzz de escaping,
  CRLF + BOM e arquivos propositalmente bagunçados.
- `vuelume verify <dir>` executa _toda_ edição suportada em _todo_ elemento, em memória, e confere a
  restauração byte a byte. No projeto de exemplo e nas fixtures: **107 round-trips, 0 falhas**.
- O **HMR foi verificado** no navegador: depois de `set-prop --write`, o Vite fez `hmr update` sem
  recarregar a página, e o estado do componente (texto digitado num input) foi preservado.

O que **ainda não está provado** (e é o maior risco restante) é o caminho **Canvas → código**:
o Vue não guarda localização de fonte por elemento em runtime. Isso exige um spike próprio
(ADR-0008, proposta).

## Premissas do briefing que precisaram de correção

1. **"AST → transformations → código `.vue`" como geração de código.** Não existe printer oficial
   de template Vue a partir do AST (o compilador gera render functions). Regenerar o template
   perderia formatação, comentários, aspas e o que a ferramenta não entende. **Solução:** o AST é um
   _índice somente leitura_; as mudanças são edições de texto mínimas + re-parse de verificação
   (ADR-0002, ADR-0003).
2. **"Selecionar no Canvas localiza o node".** Não há mapeamento runtime → fonte no Vue. Além disso,
   um node gera N instâncias (`v-for`), o node a editar é o **local de uso** no componente pai (não
   o arquivo do componente) e o conteúdo de slot pertence ao pai. **Solução proposta:**
   instrumentação em tempo de compilação, só em dev, via plugin do Vite (ADR-0008).
3. **`featured [ true ]` no Inspector.** Escrever o shorthand `featured` só equivale a `true` se a
   prop for declarada `Boolean` no componente filho. Por isso o engine escreve `:featured="true"`
   até ter o tipo do filho disponível.
4. **`apps/playground` na Fase 0.** O playground é a UI da IDE (Fase 4). O que as Fases 0–1
   precisavam era um _projeto alvo_, criado como `examples/basic-shop`. O playground foi adiado
   (ADR-0001).

## Arquitetura criada

```
project-model  ←  vue-code-engine  ←  project-analyzer  ←  cli
 (tipos, JSON)     (puro, sem fs)       (fs, só leitura)     (escreve arquivos)
```

- **project-model**: modelo serializável (`ComponentModel`, `TemplateElementNode`, atributos
  `static | bind | on | directive`, `editable` + `readonlyReason`, `flags`, ranges com
  offset/linha/coluna), mais os helpers `findElementById`/`findElementAtOffset` (source ↔ node).
- **vue-code-engine**: `analyzeComponent`, `setProp`, `removeProp`, `checkRoundTrip`.
- **project-analyzer**: `analyzeProject` (descoberta, resolução de imports → arquivos, aliases
  explícitos, diagnósticos de projeto).
- **cli**: `inspect`, `tree`, `set-prop`, `remove-prop`, `verify`.

Detalhes em [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Arquivos importantes

| Arquivo                                                       | Papel                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/project-model/src/template.ts`                      | Modelo do template, `NodeId`, regras de somente leitura          |
| `packages/vue-code-engine/src/template.ts`                    | AST do Vue → modelo; regras do subset seguro                     |
| `packages/vue-code-engine/src/script/analyze-script.ts`       | `defineProps`/`withDefaults`/`defineEmits`/`defineModel`/imports |
| `packages/vue-code-engine/src/script/types.ts`                | Resolução de tipos locais → `PropType`                           |
| `packages/vue-code-engine/src/transform/props.ts`             | `setProp`/`removeProp` + `verify()`                              |
| `packages/vue-code-engine/src/verify/round-trip.ts`           | Autoteste em memória                                             |
| `packages/project-analyzer/src/analyze-project.ts`            | Projeto → `ProjectModel`                                         |
| `packages/cli/src/main.ts`                                    | Comandos                                                         |
| `examples/basic-shop/`                                        | App Vue real (build com Vite 8)                                  |
| `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`, `docs/adr/*` | Documentação                                                     |

## Decisões (ADRs)

0001 layout do monorepo e fronteiras · 0002 código como fonte da verdade · 0003 edições cirúrgicas
com verificação · 0004 parsers oficiais + análise estática própria de script · 0005 subset seguro
("recusar em vez de adivinhar") · 0006 identidade de nodes por caminho de índices · 0007 tooling
(TS 6.0 porque o typescript-eslint ainda não suporta TS 7) · 0008 _(proposta)_ mapeamento
Canvas ↔ fonte.

## Testes

85 testes (Vitest) em 6 arquivos:

- **analyze**: todas as formas de `defineProps`, tipos locais/`extends`/interseções, tipos importados
  (reportados), defaults, emits, `defineModel`, Options API detectada, erros de sintaxe, imports,
  resolução de tags, modelo do template, mapeamento offset ↔ node, serialização JSON.
- **transform-props**: exemplos do briefing (saída exata), aspas, escaping, bindings literais,
  static → binding, kebab/camel, no-op, layout (multilinha/inline/sem atributos), CRLF, recusas
  (cada `readonlyReason`), arquivo com erro de parse, remoção nos três layouts, fuzz de valores,
  set + remove = arquivo original.
- **round-trip**: `checkRoundTrip` em todas as fixtures e no exemplo; CRLF + BOM; aspas ausentes.
- **analyzer**: projeto de exemplo, projeto temporário (ignores, aliases, import não resolvido,
  nomes duplicados, arquivo quebrado), `resolveImport`.
- **cli**: `inspect` (texto/JSON), exit codes, `tree`, dry-run vs `--write`, recusa sem alterar arquivo.
- **model**: helpers de travessia.

## Comandos

```bash
pnpm install
pnpm check                                   # typecheck + lint + format + testes
pnpm build                                   # necessário para a CLI
pnpm vuelume inspect examples/basic-shop
pnpm vuelume tree examples/basic-shop/src/App.vue
pnpm vuelume set-prop examples/basic-shop/src/App.vue 1.2 size small          # dry-run
pnpm vuelume set-prop examples/basic-shop/src/App.vue 1.2 size small --write
pnpm vuelume verify caminho/para/um/projeto/vue                                # somente leitura
pnpm --filter basic-shop dev                                                   # ver o HMR
```

## Limitações atuais

- Só `<script setup>`. A Options API é detectada, mas não analisada.
- Tipos de props importados de outro arquivo, genéricos (`generic="T"`) e utility types são
  **reportados** e não resolvidos.
- Aliases (`@/`) só funcionam via `--alias`. Ainda não são lidos do tsconfig/vite.config.
- Componentes globais e auto-imports aparecem como `unresolved`.
- Só valores literais (`string | number | boolean`) são escritos.
- `insertNode`/`removeNode`/`moveNode` ainda não foram implementados.
- Templates não-HTML (pug) e `<template src>` não são suportados.
- A validação em projetos reais de terceiros ainda não foi feita. Só rodamos no exemplo e em
  fixtures hostis criadas por nós.

## Riscos (priorizados)

1. **Canvas → fonte** (alto): sem localização em runtime, `v-for` 1→N, slots, multi-root,
   `inheritAttrs: false`.
2. **Tipos entre arquivos** (médio): o Inspector precisa dos tipos do componente filho.
3. **Ids mudam em edições estruturais** (médio): a solução planejada é re-mapear após cada operação.
4. **Edição concorrente** (VS Code + editor visual) (médio): o engine é puro e o escritor checa se
   o arquivo mudou (a CLI já faz isso).
5. **Semântica que o texto não mostra** (médio): casting de Boolean, ordem de `v-bind` objeto,
   fallthrough attrs.
6. Versão do Vue do projeto ≠ versão do compilador da ferramenta (baixo/médio).

## Recomendação para a próxima fase

Antes de qualquer UI:

1. **Validação em corpus**: rodar `vuelume verify` e `inspect` em 5–10 projetos Vue open-source de
   estilos diferentes. Cada falha vira fixture. É barato e é a melhor evidência do "nunca corromper".
2. **Spike Canvas ↔ fonte** (ADR-0008) com um plugin Vite dev-only. É o maior risco restante.
3. **Tipos entre arquivos + aliases automáticos**, para o Inspector mostrar `size: small|medium|large`
   também quando o tipo é importado.
4. **Operações estruturais** (`insertNode`/`removeNode`/`moveNode`) com o mesmo padrão de verificação.
5. Só então a **Fase 4** (playground `Component Tree | Preview | Inspector`).
