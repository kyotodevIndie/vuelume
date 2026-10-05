# @vuelume/project-analyzer

Discovers the components of a Vue project (props, emits, slots, imports, component usage) and
builds a JSON-serializable project model. Part of [vuelume](https://github.com/kyotodevIndie/vuelume).

```ts
import { analyzeProject } from '@vuelume/project-analyzer'

const project = await analyzeProject('./my-app', { aliases: { '@': 'src' } })
```

MIT · https://github.com/kyotodevIndie/vuelume
