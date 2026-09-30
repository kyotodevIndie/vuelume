# Corpus validation — real-world Vue projects

Date: 2026-09-29. Engine as of the commit that adds this report.

## Method

Shallow clones (read-only, outside the repository) of 7 open-source Vue projects with different
styles. For each project:

- `vuelume verify <dir>` — every supported edit on every element, in memory, checking that the
  source round-trips byte-for-byte (see ADR-0003);
- `vuelume inspect <dir> --json` — analysis coverage.

To reproduce, clone the repositories at the listed commits and run the two commands.

## Transformation safety (`verify`)

| Project                                                                   | Commit  | Files checked |   Elements | Round-trips passed |   Refused | Failed |
| ------------------------------------------------------------------------- | ------- | ------------: | ---------: | -----------------: | --------: | -----: |
| [antfu/vitesse](https://github.com/antfu/vitesse)                         | 8a01bc9 |         10/10 |         57 |                 78 |         1 |      0 |
| [vuejs/docs](https://github.com/vuejs/docs)                               | 40aa88a |         60/60 |        497 |                914 |         0 |      0 |
| [nuxt/ui](https://github.com/nuxt/ui)                                     | 77c92de |       798/798 |      7,024 |             12,163 |       704 |      0 |
| [directus/directus](https://github.com/directus/directus)                 | 2878b4e |       586/586 |      8,233 |             11,976 |       115 |      0 |
| [vbenjs/vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)         | 50f4ede |       692/695 |      5,671 |             12,528 |       236 |      0 |
| [element-plus/element-plus](https://github.com/element-plus/element-plus) | 80af5a1 |   1,006/1,008 |      9,502 |             22,543 |        59 |      0 |
| [primefaces/primevue](https://github.com/primefaces/primevue)             | 36965f1 |   2,486/2,615 |     28,942 |             43,390 |     2,859 |      0 |
| **Total**                                                                 |         |     **5,638** | **59,926** |        **103,592** | **3,974** |  **0** |

Files not checked have no `<template>` (render functions / script-only); none were skipped for
parse errors.

### What the first run found (and was fixed)

The first run reported **24 failures in 3 projects, all of the same kind and none corrupting**:
the model marked namespaced attributes as editable while `setProp` refused their names —

- inline SVG: `xmlns:xlink`, `xml:space`, `xlink:href` (element-plus, vue-vben-admin);
- PrimeVue pass-through props: `pt:root:class`, `pt:pcPaginator:root` (primevue).

Fix: one shared attribute-name rule used by both the model and the transformations
(`isWritableAttributeName`), plus a new `unsupported-name` read-only reason so the two layers can
never disagree again. Regression fixture: `packages/vue-code-engine/test/fixtures/svg-namespaces.vue`.

The run also showed that skipping every hidden directory missed real components (`.vitepress/`
themes); discovery now skips an explicit list instead.

### Performance

A single `setProp` on the largest template found (vue-vben-admin `slogan.vue`, 165 KB inline SVG,
1,056 elements) takes ~11–43 ms including verification. `verify` itself is intentionally quadratic
(several parses per element), which is why it took minutes on that project; it is a batch testing
tool, not an interactive path. `inspect` takes 0.4–8.4 s per project.

## Analysis coverage (`inspect`)

| Project        | Components | `<script setup>` | Options API | Props found | Setup comps. with incomplete props | Imports → project file | `props/imported-type` |
| -------------- | ---------: | ---------------: | ----------: | ----------: | ---------------------------------: | ---------------------: | --------------------: |
| vitesse        |         10 |                8 |           0 |           1 |                                  0 |                    0/0 |                     0 |
| docs           |         60 |               51 |           2 |          37 |                                  0 |                  27/68 |                     0 |
| nuxt/ui        |        798 |              748 |           0 |       1,045 |                                103 |                384/764 |                     9 |
| directus       |        586 |              535 |          35 |       2,433 |                                 15 |              460/4,580 |                    10 |
| vue-vben-admin |        695 |              674 |           1 |         782 |                                177 |              403/2,138 |                   178 |
| element-plus   |      1,008 |              748 |          23 |          59 |                                129 |                150/591 |                    99 |
| primevue       |      2,615 |              611 |       1,732 |          23 |                                 68 |               90/1,629 |                    68 |

"Imports → project file" counts component usages bound to an `import` that resolved to a file in
the project; the rest are packages (legitimately external) **or aliases we do not read yet**.

## Conclusions

1. **Editing is safe on real code**: 0 failures in ~104k in-memory edits across very different
   codebases (apps, component libraries, docs sites, Windows/Unix line endings, huge inline SVG).
2. The analysis gaps are concentrated and known, in priority order:
   - **Aliases** (`@/…`, workspace packages): directus resolves only 460/4,580 usages without
     them → read `tsconfig` `paths` / Vite `resolve.alias`.
   - **Options API props**: PrimeVue is 66% Options API; the runtime-object props parser already
     exists, so this is a cheap win.
   - **Imported prop types** (`defineProps<ImportedProps>()`, runtime props imported from `.ts`,
     e.g. element-plus `defineProps(buttonProps)`).
