import type { Assignment } from './group-projects.ts'
import type { Graph } from './types.ts'

/** Keeps one project's nodes (and the edges between them); 'all' keeps everything. */
export function filterByProject(graph: Graph, assignment: Assignment, projectKey: string): Graph {
  if (projectKey === 'all') return graph
  const nodes = graph.nodes.filter((n) => assignment.get(n.id)?.key === projectKey)
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) }
}
