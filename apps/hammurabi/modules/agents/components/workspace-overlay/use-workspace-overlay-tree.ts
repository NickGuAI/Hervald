import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceTreeNode } from '../../../workspace/types'
import {
  fetchWorkspaceExpandedTree,
  fetchWorkspaceTree,
  getWorkspaceSourceKey,
  useWorkspaceFilePreview,
  type WorkspaceSource,
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
  onSelectFile: (filePath: string) => void
}

export function useWorkspaceOverlayTree({
  open,
  source,
  query,
  filesTabActive,
  onSelectFile,
}: UseWorkspaceOverlayTreeOptions) {
  const sourceKey = getWorkspaceSourceKey(source)
  const [nodesByParent, setNodesByParent] = useState<Record<string, WorkspaceTreeNode[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [addedPaths, setAddedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const addFeedbackTimersRef = useRef<number[]>([])

  const selectedNode = useMemo(
    () => findNodeByPath(nodesByParent, selectedPath),
    [nodesByParent, selectedPath],
  )

  const previewQuery = useWorkspaceFilePreview(
    source,
    selectedNode?.type === 'file' ? selectedNode.path : null,
    open && filesTabActive,
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

  const loadDirectory = useCallback(async (parentPath = '', expand = false): Promise<void> => {
    setLoadingPaths((prev) => new Set(prev).add(parentPath))
    try {
      const response = expand
        ? await fetchWorkspaceExpandedTree(source, parentPath)
        : await fetchWorkspaceTree(source, parentPath)
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
  }, [source])

  useEffect(() => {
    if (!open || nodesByParent['']) {
      return
    }
    void loadDirectory('')
  }, [loadDirectory, nodesByParent, open, sourceKey])

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
    const nodeType = knownType ?? findNodeByPath(nodesByParent, path)?.type
    const isDirectory = nodeType === 'directory'
    onSelectFile(isDirectory ? `${path}/` : path)
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
