// One custom React Flow node type per entity kind. All share NodeShell; each stays a separate,
// memoized component so React Flow can re-render only the nodes whose data changed.
import { memo } from 'react'
import type { NodeProps, NodeTypes } from '@xyflow/react'
import type { FlowNode } from '../graph/types.ts'
import { NodeShell } from './NodeShell.tsx'
import { ProjectNode } from './ProjectNode.tsx'

type Props = NodeProps<FlowNode>

export const LeadNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const TeamNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const AgentNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const SubagentNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const TaskNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const ReviewNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const TestNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const WorktreeNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)
export const BlockerNode = memo((props: Props) => <NodeShell id={props.id} data={props.data} />)

export const nodeTypes: NodeTypes = {
  lead: LeadNode,
  team: TeamNode,
  agent: AgentNode,
  subagent: SubagentNode,
  task: TaskNode,
  review: ReviewNode,
  test: TestNode,
  worktree: WorktreeNode,
  blocker: BlockerNode,
  project: ProjectNode
}
