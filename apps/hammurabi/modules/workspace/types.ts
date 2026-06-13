export type WorkspaceSourceKind = 'target'

export interface WorkspaceSourceDescriptor {
  kind: WorkspaceSourceKind
  id: string
  targetId?: string
  label: string
  host?: string | null
  readOnly?: boolean
  repo?: {
    owner: string
    repo: string
  }
  branch?: string
}

export interface WorkspaceSummary {
  source: WorkspaceSourceDescriptor
  rootPath: string
  rootName: string
  gitRoot: string | null
  readOnly: boolean
  isRemote: boolean
}

export interface WorkspaceMachineDescriptor {
  id: string
  label: string
  host: string
  user?: string
  port?: number
}

export interface ResolvedWorkspace extends WorkspaceSummary {
  machine?: WorkspaceMachineDescriptor
}

export interface WorkspaceTargetDescriptor {
  targetId: string
  conversationId?: string
  sessionName?: string
  commanderId?: string
  label: string
  host: string
  rootPath: string
  readOnly: boolean
  machine?: WorkspaceMachineDescriptor
}

export interface ResolvedWorkspaceTarget {
  target: WorkspaceTargetDescriptor
  workspace: ResolvedWorkspace
  commandRunner?: import('./git.js').WorkspaceCommandRunner
  host: string
  rootPath: string
  machine?: WorkspaceMachineDescriptor
  readOnly: boolean
}

export type WorkspacePanelDefault = 'open' | 'closed' | 'last-used'

export interface WorkspacePreferences {
  panelDefault: WorkspacePanelDefault
}

export interface WorkspaceTreeNode {
  name: string
  path: string
  parentPath: string
  type: 'file' | 'directory'
  extension?: string
  size?: number
}

export interface WorkspaceTreeResponse {
  workspace: WorkspaceSummary
  parentPath: string
  nodes: WorkspaceTreeNode[]
}

export interface WorkspacePathResolution {
  workspace: WorkspaceSummary
  requestedPath: string
  path: string
  type: WorkspaceTreeNode['type']
  treePath: string
  targetId?: string
  targetLabel?: string
  targetReadOnly?: boolean
  preferredFrom?: string
  preferredReason?: 'graphviz-source'
}

export type WorkspaceFilePreviewKind = 'text' | 'image' | 'binary' | 'pdf'

export interface WorkspaceFilePreview {
  workspace: WorkspaceSummary
  path: string
  name: string
  kind: WorkspaceFilePreviewKind
  size: number
  mimeType?: string
  content?: string
  truncated?: boolean
  writable: boolean
}

export interface WorkspaceMutationResult {
  workspace: WorkspaceSummary
  path: string
}

export interface WorkspaceFileAnnotation {
  path: string
  body: string
  quote?: string | null
  range?: {
    startLine?: number | null
    endLine?: number | null
  } | null
}

export interface WorkspacePendingFileAnnotation extends WorkspaceFileAnnotation {
  id: string
}

export interface WorkspaceContextPayload {
  targetId?: string | null
  conversationId?: string | null
  filePaths?: string[]
  directoryPaths?: string[]
  fileAnnotations?: WorkspaceFileAnnotation[]
}

export interface WorkspaceContextRequest extends WorkspaceContextPayload {
  targetId: string
}

export interface WorkspaceContextSkippedFile {
  path: string
  reason: 'not_found'
  error: string
}

export interface WorkspaceContextMaterialization {
  text: string
  filePaths: string[]
  directoryPaths: string[]
  fileAnnotations: WorkspaceFileAnnotation[]
  skippedFilePaths?: WorkspaceContextSkippedFile[]
  skippedDirectoryPaths?: WorkspaceContextSkippedFile[]
}

export interface WorkspaceGitStatusEntry {
  path: string
  code: string
}

export interface WorkspaceGitStatus {
  workspace: WorkspaceSummary
  enabled: boolean
  branch: string | null
  ahead: number
  behind: number
  entries: WorkspaceGitStatusEntry[]
}

export interface WorkspaceGitCommit {
  hash: string
  shortHash: string
  author: string
  authoredAt: string
  subject: string
}

export interface WorkspaceGitLog {
  workspace: WorkspaceSummary
  enabled: boolean
  commits: WorkspaceGitCommit[]
}
