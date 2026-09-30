# vuelume _(provisional name)_

**A code-first visual IDE for existing Vue projects** — think IDE + Figma + Unity Inspector, where
your `.vue` files remain the single source of truth. No proprietary JSON, no runtime: remove the
tool and you still have a normal Vue app.

> **Status: early research / Phase 1.** There is no visual editor yet. This repository currently
> proves the hard part: analyzing real Vue projects and modifying them safely, with minimal diffs.

## What works today

```bash
pnpm install
pnpm build

# Discover components, props, emits, slots and usage
pnpm vuelume inspect examples/basic-shop

# See the template model: node ids, source locations, what is editable
pnpm vuelume tree examples/basic-shop/src/App.vue

# Change a prop (dry run prints a diff; add --write to apply)
pnpm vuelume set-prop examples/basic-shop/src/App.vue 1.2 size small
pnpm vuelume remove-prop examples/basic-shop/src/App.vue 1.1 badge

# Read-only self-check on ANY Vue project: tries every supported edit in memory
# and verifies the source round-trips byte-for-byte
pnpm vuelume verify path/to/your/vue-project
```

Example output of `inspect`:

```
Button  (src/components/Button.vue)
  props
    variant: string
    size?: "small" | "medium" | "large"
    disabled?: boolean
  emits
    click(event: MouseEvent)
  slots
    default
```

and of `set-prop … 1.2 size small`:

```
  34       <Button
  35         variant="primary"
  36 -       size="large"
  36 +       size="small"
  37       >
```

Anything outside the safe subset is refused instead of guessed:

```
✖ readonly (advanced-binding): "cart-count" on <AppHeader> cannot be edited visually (advanced-binding).
```

## Repository layout

| Path                        | What                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `packages/project-model`    | JSON-serializable model: components, props, template nodes, ranges |
| `packages/vue-code-engine`  | Pure analysis + safe transformations (`setProp`, `removeProp`)     |
| `packages/project-analyzer` | File discovery and cross-file resolution                           |
| `packages/cli`              | The `vuelume` command                                              |
| `examples/basic-shop`       | A real Vue 3 + Vite app used as the target in tests and demos      |

Read next: [ARCHITECTURE.md](ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md) ·
[DECISIONS.md](DECISIONS.md) · [CONTRIBUTING.md](CONTRIBUTING.md)

## Using the engine as a library

```ts
import { analyzeComponent, setProp } from '@vuelume/vue-code-engine'

const model = analyzeComponent(source, { filename: 'src/App.vue' })
const result = setProp(source, { nodeId: '1.2', name: 'size', value: 'small' })
if (result.ok) writeFile(file, result.code)
else console.warn(result.error.code, result.error.reason) // e.g. 'readonly', 'advanced-binding'
```

## Requirements

Node.js ≥ 22.13 and pnpm 11.

## License

[MIT](LICENSE)
