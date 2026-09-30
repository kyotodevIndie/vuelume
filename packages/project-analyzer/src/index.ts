/**
 * @vuelume/project-analyzer
 *
 * File-system layer: discovers the files of a Vue project, runs the code engine on each
 * `.vue` file and resolves cross-file references into a {@link ProjectModel}.
 */
export { analyzeProject, type AnalyzeProjectOptions } from './analyze-project.js'
export { discoverSourceFiles, DEFAULT_IGNORED_DIRECTORIES } from './discover.js'
export { resolveImport, isProjectSpecifier } from './resolve.js'
export type { ProjectModel } from '@vuelume/project-model'
