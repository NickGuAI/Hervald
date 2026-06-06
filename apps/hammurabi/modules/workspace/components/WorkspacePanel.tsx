import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, GitBranch, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkspaceTreeNode } from '../types'
import {
  downloadWorkspaceFile,
  fetchWorkspaceExpandedTree,
  fetchWorkspacePathResolution,
  fetchWorkspaceTree,
  getWorkspaceSourceKey,
  isWorkspaceTargetNotFoundError,
  useWorkspaceActions,
  useWorkspaceFilePreview,
  useWorkspaceGitLog,
  useWorkspaceGitStatus,
  type WorkspaceSource,
  type WorkspaceSourceRecovery,
  type WorkspacePendingFileAnnotation,
} from '../use-workspace'
import { WorkspaceFilePreview } from './WorkspaceFilePreview'
import { WorkspaceFilePreviewModal } from './WorkspaceFilePreviewModal'
import { WorkspaceGitPanel } from './WorkspaceGitPanel'
import { WorkspaceToolbar } from './WorkspaceToolbar'
import { WorkspaceTree } from './WorkspaceTree'

function joinWorkspacePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name
}

function findNode(
  nodesByParent: Record<string, WorkspaceTreeNode[]>,
  relativePath: string | null,
): WorkspaceTreeNode | null {
  if (!relativePath) {
    return null
  }

  for (const nodes of Object.values(nodesByParent)) {
    const match = nodes.find((node) => node.path === relativePath)
    if (match) {
      return match
    }
  }

  return null
}

function isHiddenWorkspaceNode(node: WorkspaceTreeNode): boolean {
  return node.name.startsWith('.')
}

export function WorkspacePanel({
  source,
  position = 'embedded',
  variant = 'light',
  onClose,
  onInsertPath,
  onAddAnnotationContext,
  refreshToken = 0,
  requestedPath,
  requestedPathToken = 0,
  onRequestedPathConsumed,
  onRecoverStaleTarget,
}: {
  source: WorkspaceSource
  position?: 'side' | 'compact' | 'embedded'
  variant?: 'light' | 'dark'
  onClose?: () => void
  onInsertPath?: (path: string, type: WorkspaceTreeNode['type']) => void
  onAddAnnotationContext?: (annotation: WorkspacePendingFileAnnotation) => void
  refreshToken?: number
  requestedPath?: string | null
  requestedPathToken?: number
  onRequestedPathConsumed?: (token: number) => void
  onRecoverStaleTarget?: WorkspaceSourceRecovery
}) {
  const sourceKey = getWorkspaceSourceKey(source)
  const actions = useWorkspaceActions(source)
  const [isOpen, setIsOpen] = useState(position !== 'compact')
  const [activeTab, setActiveTab] = useState<'files' | 'changes'>('files')
  const [nodesByParent, setNodesByParent] = useState<Record<string, WorkspaceTreeNode[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [previewModalPath, setPreviewModalPath] = useState<string | null>(null)
  const [showHiddenEntries, setShowHiddenEntries] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<{ path: string; message: string } | null>(null)
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [isInitializingGit, setIsInitializingGit] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addFeedbackTimersRef = useRef<number[]>([])
  const requestedSelectionRef = useRef<{ path: string } | null>(null)
  const handledRequestedPathRef = useRef<{ path: string; token: number } | null>(null)

  const gitStatusQuery = useWorkspaceGitStatus(
    source,
    isOpen && activeTab === 'changes',
    onRecoverStaleTarget,
  )
  const gitLogQuery = useWorkspaceGitLog(
    source,
    isOpen && activeTab === 'changes',
    15,
    onRecoverStaleTarget,
  )

  const modalOpen = position === 'side' && Boolean(previewModalPath)
  const visibleNodesByParent = useMemo(() => {
    if (showHiddenEntries) {
      return nodesByParent
    }

    return Object.fromEntries(
      Object.entries(nodesByParent).map(([parentPath, nodes]) => [
        parentPath,
        nodes.filter((node) => !isHiddenWorkspaceNode(node)),
      ]),
    )
  }, [nodesByParent, showHiddenEntries])
  const selectedNode = useMemo(() => findNode(nodesByParent, selectedPath), [nodesByParent, selectedPath])
  const previewPath = modalOpen ? previewModalPath : selectedPath
  const previewNode = useMemo(() => findNode(nodesByParent, previewPath), [nodesByParent, previewPath])
  const selectedPreviewPath = previewPath && previewNode?.type === 'file'
    ? previewPath
    : null
  const previewQuery = useWorkspaceFilePreview(
    source,
    selectedPreviewPath,
    isOpen && activeTab === 'files',
    onRecoverStaleTarget,
  )
  const refetchPreview = previewQuery.refetch
  const currentDirectoryPath = useMemo(() => {
    if (!selectedNode) {
      return ''
    }
    return selectedNode.type === 'directory'
      ? selectedNode.path
      : selectedNode.parentPath
  }, [selectedNode])

  const clearAddFeedbackTimers = useCallback(() => {
    for (const timerId of addFeedbackTimersRef.current) {
      window.clearTimeout(timerId)
    }
    addFeedbackTimersRef.current = []
  }, [])

  useEffect(() => {
    setNodesByParent({})
    setExpandedPaths(new Set())
    setLoadingPaths(new Set())
    setAddedPaths(new Set())
    setSelectedPath(null)
    setPreviewModalPath(null)
    setShowHiddenEntries(false)
    requestedSelectionRef.current = null
    setDraftContent('')
    setPanelError(null)
    setDownloadError(null)
    setDownloadingPath(null)
    setActiveTab('files')
    clearAddFeedbackTimers()
  }, [clearAddFeedbackTimers, sourceKey])

  useEffect(() => () => clearAddFeedbackTimers(), [clearAddFeedbackTimers])

  useEffect(() => {
    const nextContent = previewQuery.data?.kind === 'text'
      ? previewQuery.data.content ?? ''
      : ''
    setDraftContent(nextContent)
  }, [previewQuery.data?.content, previewQuery.data?.kind])

  async function readWorkspaceWithRecovery<T>(
    read: (readSource: WorkspaceSource) => Promise<T>,
  ): Promise<{ result: T; source: WorkspaceSource }> {
    try {
      return { result: await read(source), source }
    } catch (error) {
      if (!onRecoverStaleTarget || !isWorkspaceTargetNotFoundError(error)) {
        throw error
      }
      const recoveredSource = await onRecoverStaleTarget(source)
      if (!recoveredSource) {
        throw error
      }
      return { result: await read(recoveredSource), source: recoveredSource }
    }
  }

  async function loadDirectory(
    parentPath = '',
    expand = false,
    sourceOverride?: WorkspaceSource,
  ): Promise<void> {
    setLoadingPaths((prev) => new Set(prev).add(parentPath))
    setPanelError(null)
    try {
      const response = sourceOverride
        ? (
            expand
              ? await fetchWorkspaceExpandedTree(sourceOverride, parentPath)
              : await fetchWorkspaceTree(sourceOverride, parentPath)
          )
        : (
            await readWorkspaceWithRecovery((readSource) => (
              expand
                ? fetchWorkspaceExpandedTree(readSource, parentPath)
                : fetchWorkspaceTree(readSource, parentPath)
            ))
          ).result
      setNodesByParent((prev) => ({
        ...prev,
        [response.parentPath]: response.nodes,
      }))
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Failed to load workspace')
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(parentPath)
        return next
      })
    }
  }

  async function refreshWorkspace(): Promise<void> {
    const pathsToRefresh = new Set(['', ...expandedPaths])
    await Promise.all([...pathsToRefresh].map((path) => loadDirectory(path, path !== '')))
    const refreshTasks: Array<Promise<unknown>> = []
    if (selectedPath && selectedNode?.type === 'file') {
      refreshTasks.push(refetchPreview())
    }
    if (activeTab === 'changes') {
      refreshTasks.push(gitStatusQuery.refetch(), gitLogQuery.refetch())
    }
    if (refreshTasks.length > 0) {
      await Promise.all(refreshTasks)
    }
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }
    if (!nodesByParent['']) {
      void loadDirectory('')
    }
  }, [isOpen, nodesByParent, sourceKey])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    void refreshWorkspace()
  }, [refreshToken])

  useEffect(() => {
    const rawRequestedPath = requestedPath?.trim()
    if (!rawRequestedPath) {
      return
    }
    const handledRequestedPath = handledRequestedPathRef.current
    if (
      handledRequestedPath?.path === rawRequestedPath
      && handledRequestedPath.token === requestedPathToken
    ) {
      return
    }
    let cancelled = false
    const markRequestedPathConsumed = () => {
      handledRequestedPathRef.current = {
        path: rawRequestedPath,
        token: requestedPathToken,
      }
      onRequestedPathConsumed?.(requestedPathToken)
    }

    setActiveTab('files')
    setIsOpen(true)
    setPanelError(null)
    setPreviewModalPath(null)

    void (async () => {
      try {
        const { result: resolvedPath, source: resolvedSource } = await readWorkspaceWithRecovery(
          (readSource) => fetchWorkspacePathResolution(readSource, rawRequestedPath),
        )
        if (cancelled) {
          return
        }
        setSelectedPath(resolvedPath.path)
        requestedSelectionRef.current = {
          path: resolvedPath.path,
        }
        if (resolvedPath.treePath) {
          void loadDirectory(resolvedPath.treePath, true, resolvedSource)
        }
        markRequestedPathConsumed()
      } catch (error) {
        if (!cancelled) {
          setPanelError(error instanceof Error ? error.message : 'Failed to open workspace path')
          markRequestedPathConsumed()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [onRequestedPathConsumed, requestedPath, requestedPathToken, sourceKey])

  useEffect(() => {
    const requestedSelection = requestedSelectionRef.current
    if (
      !requestedSelection
      || requestedSelection.path !== selectedPath
    ) {
      return
    }

    if (!selectedNode) {
      return
    }

    if (selectedNode.type === 'directory') {
      setPreviewModalPath(null)
      setExpandedPaths((prev) => new Set(prev).add(selectedNode.path))
      if (!nodesByParent[selectedNode.path]) {
        void loadDirectory(selectedNode.path, true)
      }
      requestedSelectionRef.current = null
      return
    }

    if (position === 'side') {
      setPreviewModalPath(selectedNode.path)
    }
    requestedSelectionRef.current = null
  }, [nodesByParent, position, selectedNode, selectedPath])

  async function runBusyTask(label: string, task: () => Promise<void>): Promise<void> {
    setBusyLabel(label)
    setPanelError(null)
    try {
      await task()
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Workspace action failed')
    } finally {
      setBusyLabel(null)
    }
  }

  async function handleToggleDirectory(relativePath: string): Promise<void> {
    const isExpanded = expandedPaths.has(relativePath)
    if (isExpanded) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.delete(relativePath)
        return next
      })
      return
    }

    setExpandedPaths((prev) => new Set(prev).add(relativePath))
    if (!nodesByParent[relativePath]) {
      await loadDirectory(relativePath, true)
    }
  }

  const handleSelectPath = useCallback((path: string) => {
    setSelectedPath(path)
    setDownloadError(null)
    const node = findNode(nodesByParent, path)
    if (position === 'side') {
      if (node?.type === 'directory') {
        setPreviewModalPath(null)
      } else if (node?.type === 'file') {
        setPreviewModalPath(path)
      }
    }
  }, [nodesByParent, position])

  const handleDownloadPath = useCallback(async (
    path: string,
    knownType?: WorkspaceTreeNode['type'],
  ): Promise<void> => {
    const nodeType = knownType ?? findNode(nodesByParent, path)?.type
    if (nodeType !== 'file') {
      const message = 'Directories cannot be downloaded as single files'
      setPanelError(message)
      setDownloadError({ path, message })
      return
    }

    setBusyLabel('Downloading file…')
    setPanelError(null)
    setDownloadError(null)
    setDownloadingPath(path)
    try {
      await downloadWorkspaceFile(source, path, onRecoverStaleTarget)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download workspace file'
      setPanelError(message)
      setDownloadError({ path, message })
    } finally {
      setBusyLabel(null)
      setDownloadingPath(null)
    }
  }, [nodesByParent, onRecoverStaleTarget, source])

  function promptForName(label: string): string | null {
    if (typeof window === 'undefined') {
      return null
    }
    const value = window.prompt(label)
    return value?.trim() || null
  }

  async function handleCreateFile(): Promise<void> {
    const name = promptForName('New file name')
    if (!name) {
      return
    }
    await runBusyTask('Creating file…', async () => {
      const nextPath = joinWorkspacePath(currentDirectoryPath, name)
      await actions.createFile(nextPath)
      setSelectedPath(nextPath)
      await refreshWorkspace()
    })
  }

  async function handleCreateFolder(): Promise<void> {
    const name = promptForName('New folder name')
    if (!name) {
      return
    }
    await runBusyTask('Creating folder…', async () => {
      const nextPath = joinWorkspacePath(currentDirectoryPath, name)
      await actions.createFolder(nextPath)
      setExpandedPaths((prev) => new Set(prev).add(nextPath))
      await refreshWorkspace()
    })
  }

  async function handleSave(): Promise<void> {
    if (!selectedPath) {
      return
    }
    await runBusyTask('Saving file…', async () => {
      await actions.saveFile(selectedPath, draftContent)
      await previewQuery.refetch()
    })
  }

  async function handleRename(): Promise<void> {
    if (!selectedNode) {
      return
    }
    const nextName = promptForName(`Rename ${selectedNode.name} to`)
    if (!nextName || nextName === selectedNode.name) {
      return
    }
    await runBusyTask('Renaming…', async () => {
      const nextPath = joinWorkspacePath(selectedNode.parentPath, nextName)
      await actions.renamePath(selectedNode.path, nextPath)
      setSelectedPath(nextPath)
      await refreshWorkspace()
    })
  }

  async function handleDelete(): Promise<void> {
    if (!selectedNode || typeof window === 'undefined') {
      return
    }
    const confirmed = window.confirm(`Delete "${selectedNode.path}"?`)
    if (!confirmed) {
      return
    }
    await runBusyTask('Deleting…', async () => {
      await actions.deletePath(selectedNode.path)
      setSelectedPath(null)
      await refreshWorkspace()
    })
  }

  async function handleUpload(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) {
      return
    }
    await runBusyTask('Uploading…', async () => {
      await actions.uploadFiles(currentDirectoryPath, files)
      await refreshWorkspace()
    })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleInitGit(): Promise<void> {
    setIsInitializingGit(true)
    try {
      await actions.initGit()
      await refreshWorkspace()
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Failed to initialize Git')
    } finally {
      setIsInitializingGit(false)
    }
  }

  const handleAddPath = useCallback((path: string, knownType?: WorkspaceTreeNode['type']) => {
    if (!onInsertPath) {
      return
    }

    const node = knownType ? { type: knownType } : findNode(nodesByParent, path)
    onInsertPath(path, node?.type ?? 'file')
    setAddedPaths((prev) => new Set(prev).add(path))

    const timerId = window.setTimeout(() => {
      setAddedPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }, 1200)
    addFeedbackTimersRef.current.push(timerId)
  }, [nodesByParent, onInsertPath])

  const compactHeader = (
    <button
      type="button"
      data-testid="workspace-compact-header"
      data-test-id="workspace-compact-header"
      onClick={() => setIsOpen((prev) => !prev)}
      className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
    >
      <FolderOpen size={14} className="text-[color:var(--hv-fg-subtle)]" />
      <span className="flex-1 truncate font-mono text-xs text-[color:var(--hv-fg-muted)]">
        Workspace
      </span>
      <span className="text-whisper text-[color:var(--hv-fg-faint)]">
        {isOpen ? 'Hide' : 'Show'}
      </span>
    </button>
  )

  const previewError = previewQuery.error instanceof Error ? previewQuery.error.message : null

  useEffect(() => {
    if (!previewModalPath) {
      return
    }
    void refetchPreview()
  }, [previewModalPath, refetchPreview])

  const previewModal = (
    <WorkspaceFilePreviewModal
      open={modalOpen}
      selectedPath={previewModalPath}
      preview={previewQuery.data ?? null}
      draftContent={draftContent}
      loading={previewQuery.isLoading || previewQuery.isFetching}
      refreshing={previewQuery.isFetching}
      error={previewError}
      readOnly={Boolean(source.readOnly)}
      saving={busyLabel === 'Saving file…'}
      downloading={Boolean(previewModalPath && downloadingPath === previewModalPath)}
      downloadError={previewModalPath && downloadError?.path === previewModalPath ? downloadError.message : null}
      onClose={() => setPreviewModalPath(null)}
      onRefresh={() => void refetchPreview()}
      onDownload={previewModalPath ? () => void handleDownloadPath(previewModalPath, 'file') : undefined}
      onInsertPath={onInsertPath ? handleAddPath : undefined}
      onAddAnnotationContext={onAddAnnotationContext}
      onDraftChange={setDraftContent}
      onSave={() => void handleSave()}
    />
  )

  const panelBody = (
    <div
      data-testid="workspace-panel-body"
      data-test-id="workspace-panel-body"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div
        data-testid="workspace-panel-header"
        data-test-id="workspace-panel-header"
        className="flex items-center justify-between gap-3 border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)] px-3 py-2.5"
      >
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-wide text-[color:var(--hv-fg-subtle)]">
            Workspace
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="workspace-files-tab"
            data-test-id="workspace-files-tab"
            className={cn('rounded-md px-2 py-1 text-xs transition-colors', activeTab === 'files' ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]' : 'hover:bg-[var(--hv-surface-hover)] text-[color:var(--hv-fg-subtle)]')}
            onClick={() => setActiveTab('files')}
          >
            Files
          </button>
          <button
            type="button"
            data-testid="workspace-changes-tab"
            data-test-id="workspace-changes-tab"
            className={cn('rounded-md px-2 py-1 text-xs transition-colors', activeTab === 'changes' ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]' : 'hover:bg-[var(--hv-surface-hover)] text-[color:var(--hv-fg-subtle)]')}
            onClick={() => setActiveTab('changes')}
          >
            <span className="inline-flex items-center gap-1">
              <GitBranch size={12} />
              Changes
            </span>
          </button>
          <button
            type="button"
            data-testid="workspace-hidden-toggle"
            data-test-id="workspace-hidden-toggle"
            aria-pressed={showHiddenEntries}
            className={cn(
              'rounded-md px-2 py-1 text-xs transition-colors',
              showHiddenEntries
                ? 'bg-[var(--hv-button-primary-bg)] text-[color:var(--hv-fg-inverse)]'
                : 'hover:bg-[var(--hv-surface-hover)] text-[color:var(--hv-fg-subtle)]',
            )}
            onClick={() => setShowHiddenEntries((current) => !current)}
          >
            {showHiddenEntries ? 'Hide hidden' : 'Show hidden'}
          </button>
          {onClose && (
            <button
              type="button"
              data-testid="workspace-close-button"
              data-test-id="workspace-close-button"
              className="rounded-md p-1.5 hover:bg-[var(--hv-surface-hover)]"
              onClick={onClose}
              aria-label="Close workspace"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {panelError && (
        <div className="border-b border-[color:var(--hv-accent-danger)] bg-[var(--hv-accent-danger-wash)] px-3 py-2 text-sm text-[color:var(--hv-accent-danger)]">
          {panelError}
        </div>
      )}

      {activeTab === 'files' ? (
        <>
          <WorkspaceToolbar
            readOnly={Boolean(source.readOnly)}
            currentDirectoryPath={currentDirectoryPath}
            selectedPath={selectedPath}
            selectedType={selectedNode?.type ?? null}
            busyLabel={busyLabel}
            downloading={Boolean(selectedPath && downloadingPath === selectedPath)}
            variant={variant}
            onRefresh={() => void refreshWorkspace()}
            onUpload={() => fileInputRef.current?.click()}
            onNewFile={() => void handleCreateFile()}
            onNewFolder={() => void handleCreateFolder()}
            onDownloadSelected={selectedPath ? () => void handleDownloadPath(selectedPath, selectedNode?.type) : undefined}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => void handleUpload(event.target.files)}
          />
          <div
            className={cn(
              'flex-1 min-h-0 p-3',
              position === 'embedded' && 'grid gap-3 xl:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]',
            )}
          >
            <div
              className={cn(
                'min-h-0 overflow-auto rounded-lg border border-[color:var(--hv-border-hair)] bg-[var(--hv-surface-card)]',
                'h-full',
              )}
            >
              {visibleNodesByParent[''] ? (
                <div className="p-2">
                  <WorkspaceTree
                    nodesByParent={visibleNodesByParent}
                    expandedPaths={expandedPaths}
                    loadingPaths={loadingPaths}
                    addedPaths={addedPaths}
                    selectedPath={selectedPath}
                    onSelectPath={handleSelectPath}
                    onToggleDirectory={(path) => void handleToggleDirectory(path)}
                    onAddPath={onInsertPath ? handleAddPath : undefined}
                    onDownloadPath={(path, knownType) => void handleDownloadPath(path, knownType)}
                    downloadingPath={downloadingPath}
                    variant={variant}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[color:var(--hv-fg-subtle)]">
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Loading workspace…
                </div>
              )}
            </div>
            {position !== 'side' && (
              <div className="min-h-0">
                <WorkspaceFilePreview
                  selectedPath={selectedPath}
                  preview={previewQuery.data ?? null}
                  draftContent={draftContent}
                  loading={previewQuery.isLoading || previewQuery.isFetching}
                  error={previewError}
                  readOnly={Boolean(source.readOnly)}
                  saving={busyLabel === 'Saving file…'}
                  downloading={Boolean(selectedPreviewPath && downloadingPath === selectedPreviewPath)}
                  onDraftChange={setDraftContent}
                  onSave={() => void handleSave()}
                  onDownload={selectedPreviewPath ? () => void handleDownloadPath(selectedPreviewPath, 'file') : undefined}
                  onRename={() => void handleRename()}
                  onDelete={() => void handleDelete()}
                  onInsertPath={onInsertPath ? handleAddPath : undefined}
                  variant={variant}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 p-3">
          <WorkspaceGitPanel
            status={gitStatusQuery.data ?? null}
            log={gitLogQuery.data ?? null}
            loading={gitStatusQuery.isLoading || gitStatusQuery.isFetching || gitLogQuery.isLoading || gitLogQuery.isFetching}
            error={
              (gitStatusQuery.error instanceof Error ? gitStatusQuery.error.message : null) ??
              (gitLogQuery.error instanceof Error ? gitLogQuery.error.message : null)
            }
            readOnly={Boolean(source.readOnly)}
            onInit={source.readOnly ? undefined : () => void handleInitGit()}
            initializing={isInitializingGit}
            variant={variant}
          />
        </div>
      )}
    </div>
  )

  if (position === 'compact') {
    return (
      <>
        <div className="border-b border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)]">
          {compactHeader}
          {isOpen && (
            <div
              data-testid="workspace-compact-panel"
              data-test-id="workspace-compact-panel"
              className="h-[32rem] max-h-[70vh]"
            >
              {panelBody}
            </div>
          )}
        </div>
        {previewModal}
      </>
    )
  }

  return (
    <>
      <div
        data-testid="workspace-panel"
        data-test-id="workspace-panel"
        className={cn(
          position === 'side'
            ? 'flex h-full min-h-0 w-full flex-col'
            : 'h-full min-h-[28rem] rounded-xl border',
          'border-[color:var(--hv-border-hair)] bg-[var(--hv-bg-raised)]',
        )}
      >
        {panelBody}
      </div>
      {previewModal}
    </>
  )
}
