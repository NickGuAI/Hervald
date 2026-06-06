import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceTreeNode } from '../../../workspace/types'
import {
  fetchWorkspaceExpandedTree,
  fetchWorkspacePathResolution,
  fetchWorkspaceTree,
  getWorkspaceSourceKey,
  isWorkspaceTargetNotFoundError,
  useWorkspaceFilePreview,
  type WorkspaceSource,
  type WorkspaceSourceRecovery,
} from '../../../workspace/use-workspace'

function findNodeByPath(
  nodesByParent: Record<string, WorkspaceTreeNode[]>,
  path: string | null,
): WorkspaceTreeNode | null {
  if (!path) {
    return null
  }

  for (const nodes of Object.values(nodesByParent)) {
    const match = nodes.find((node) => node.path === path)
    if (match) {
      return match
    }
  }

  return null
}

interface UseWorkspaceOverlayTreeOptions {
  open: boolean
  source: WorkspaceSource
  query: string
  filesTabActive: boolean
  onSelectFile: (filePath: string, type: WorkspaceTreeNode['type']) => void
  requestedPath?: string | null
  requestedPathToken?: number
  onRequestedPathConsumed?: (token: number) => void
  onRecoverStaleTarget?: WorkspaceSourceRecovery
}

export function useWorkspaceOverlayTree({
  open,
  source,
  query,
  filesTabActive,
  onSelectFile,
  requestedPath,
  requestedPathToken = 0,
  onRequestedPathConsumed,
  onRecoverStaleTarget,
}: UseWorkspaceOverlayTreeOptions) {
  const sourceKey = getWorkspaceSourceKey(source)
  const [nodesByParent, setNodesByParent] = useState<Record<string, WorkspaceTreeNode[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const addFeedbackTimersRef = useRef<number[]>([])
  const handledRequestedPathRef = useRef<{ path: string; token: number } | null>(null)

  const selectedNode = useMemo(
    () => findNodeByPath(nodesByParent, selectedPath),
    [nodesByParent, selectedPath],
  )

  const previewQuery = useWorkspaceFilePreview(
    source,
    selectedNode?.type === 'file' ? selectedNode.path : null,
    open && filesTabActive,
    onRecoverStaleTarget,
  )

  const clearAddFeedbackTimers = useCallback(() => {
    for (const timerId of addFeedbackTimersRef.current) {
      window.clearTimeout(timerId)
    }
    addFeedbackTimersRef.current = []
  }, [])

  useEffect(() => {
    if (open) {
      return
    }
    setSelectedPath(null)
    setAddedPaths(new Set())
    clearAddFeedbackTimers()
  }, [clearAddFeedbackTimers, open])

  useEffect(() => {
    setNodesByParent({})
    setExpandedPaths(new Set())
    setLoadingPaths(new Set())
    setAddedPaths(new Set())
    setSelectedPath(null)
    clearAddFeedbackTimers()
  }, [clearAddFeedbackTimers, sourceKey])

  useEffect(() => () => clearAddFeedbackTimers(), [clearAddFeedbackTimers])

  const readWorkspaceWithRecovery = useCallback(async <T,>(
    read: (readSource: WorkspaceSource) => Promise<T>,
  ): Promise<{ result: T; source: WorkspaceSource }> => {
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
  }, [onRecoverStaleTarget, source])

  const loadDirectory = useCallback(async (
    parentPath = '',
    expand = false,
    sourceOverride?: WorkspaceSource,
  ): Promise<void> => {
    setLoadingPaths((prev) => new Set(prev).add(parentPath))
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
    } catch {
      // Silently fail — user can retry by collapsing/expanding.
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(parentPath)
        return next
      })
    }
  }, [readWorkspaceWithRecovery])

  useEffect(() => {
    if (!open || nodesByParent['']) {
      return
    }
    void loadDirectory('')
  }, [loadDirectory, nodesByParent, open, sourceKey])

  useEffect(() => {
    const rawRequestedPath = requestedPath?.trim()
    if (!open || !rawRequestedPath) {
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
    void (async () => {
      try {
        const { result: resolvedPath, source: resolvedSource } = await readWorkspaceWithRecovery(
          (readSource) => fetchWorkspacePathResolution(readSource, rawRequestedPath),
        )
        if (cancelled) {
          return
        }
        setSelectedPath(resolvedPath.path)
        if (resolvedPath.treePath) {
          void loadDirectory(resolvedPath.treePath, true, resolvedSource)
        }
        markRequestedPathConsumed()
      } catch {
        // Silently fail — user can open the workspace tree manually.
        if (!cancelled) {
          markRequestedPathConsumed()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    loadDirectory,
    onRequestedPathConsumed,
    open,
    readWorkspaceWithRecovery,
    requestedPath,
    requestedPathToken,
    sourceKey,
  ])

  const handleToggleDirectory = useCallback(async (relativePath: string): Promise<void> => {
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
  }, [expandedPaths, loadDirectory, nodesByParent])

  const handlePreviewPath = useCallback((path: string) => {
    setSelectedPath(path)
  }, [])

  const handleAddPath = useCallback((path: string, knownType?: WorkspaceTreeNode['type']) => {
    const nodeType = knownType ?? findNodeByPath(nodesByParent, path)?.type ?? 'file'
    onSelectFile(path, nodeType)
    setAddedPaths((prev) => new Set(prev).add(path))

    const timerId = window.setTimeout(() => {
      setAddedPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }, 1200)
    addFeedbackTimersRef.current.push(timerId)
  }, [nodesByParent, onSelectFile])

  const filteredNodesByParent = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return nodesByParent
    }

    const matchingPaths = new Set<string>()
    for (const [parent, nodes] of Object.entries(nodesByParent)) {
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(normalizedQuery)) {
          matchingPaths.add(parent)
        }
      }
    }

    const result: Record<string, WorkspaceTreeNode[]> = {}
    for (const [parent, nodes] of Object.entries(nodesByParent)) {
      if (matchingPaths.has(parent) || parent === '') {
        result[parent] = nodes.filter(
          (node) =>
            node.type === 'directory' ||
            node.name.toLowerCase().includes(normalizedQuery),
        )
      }
    }
    return result
  }, [nodesByParent, query])

  const selectedPreviewPath =
    filesTabActive && selectedNode?.type === 'file' ? selectedPath : null

  const closePreview = useCallback(() => {
    setSelectedPath(null)
  }, [])

  return {
    filteredNodesByParent,
    expandedPaths,
    loadingPaths,
    addedPaths,
    selectedPath,
    selectedPreviewPath,
    previewQuery,
    handlePreviewPath,
    handleToggleDirectory,
    handleAddPath,
    closePreview,
  }
}
