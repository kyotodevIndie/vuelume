# @vuelume/vue-code-engine

Pure (no file system) engine behind [vuelume](https://github.com/kyotodevIndie/vuelume):
analyzes Vue SFCs into a JSON-serializable model and applies **minimal, verified** edits —
props, text, insert / remove / move / wrap / duplicate — preserving formatting, comments and
everything it does not understand. Unsafe operations are refused with an explicit error.

```ts
import { analyzeComponent, insertNode, setProp } from '@vuelume/vue-code-engine'

const model = analyzeComponent(source, { filename: 'src/App.vue' })
const result = setProp(source, { nodeId: '1.2', name: 'size', value: 'small' })
if (result.ok) save(result.code)
else console.warn(result.error.code, result.error.message)
```

MIT · https://github.com/kyotodevIndie/vuelume
