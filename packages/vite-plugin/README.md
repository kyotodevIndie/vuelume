# @vuelume/vite-plugin

**A visual editor for your existing Vue + Vite app.** Select, edit, insert, drag and drop components
in the browser — every change is a small, verified edit of your `.vue` files. No proprietary
format, no runtime: remove the plugin and your project is untouched.

> Preview release (0.x). Works with Vue 3 + Vite projects that use `<script setup>`.

## Install

```bash
npm i -D @vuelume/vite-plugin
# or: pnpm add -D @vuelume/vite-plugin
```

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue'
import vuelume from '@vuelume/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vuelume(), vue()],
})
```

Run your dev server as usual and open the URL printed as **`vuelume editor`**
(e.g. `http://localhost:5173/__vuelume/`).

The plugin only runs on the dev server (`apply: 'serve'`): production builds are not affected.

## What you can do

- Select any element in the live preview (Alt+click drills into a component) or in **Layers**
- Edit props, text, classes, inline styles and attributes in the **Inspector**
- Insert project components or HTML elements from **Insert** — click or drag onto the preview
- Move elements by dragging them (before / after / inside), duplicate, wrap, delete
- Undo / redo everything (Ctrl+Z / Ctrl+Shift+Z), even across files
- Edits made in your code editor show up live; history never replays over them

Anything the editor cannot change safely (dynamic bindings, `v-if`/`v-else` chains, content from
`v-html`, …) is shown read-only with an **Open in code** link instead of being guessed.

## Options

```ts
vuelume({
  // Extra import aliases for analysis (string entries of Vite's `resolve.alias` are read automatically)
  aliases: { '~': 'src' },
})
```

## Links

- Source, docs and issues: https://github.com/kyotodevIndie/vuelume
- License: MIT
