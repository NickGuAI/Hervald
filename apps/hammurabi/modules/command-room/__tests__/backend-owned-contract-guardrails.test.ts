import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function readAppFile(relativePath: string): Promise<string> {
  return readFile(path.join(appRoot, relativePath), 'utf8')
}

function expectAbsent(source: string, patterns: ReadonlyArray<string | RegExp>) {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      expect(source).not.toContain(pattern)
    } else {
      expect(source).not.toMatch(pattern)
    }
  }
}

describe('backend-owned UI contract guardrails', () => {
  it('keeps desktop and mobile conversation controls on backend action DTOs', async () => {
    const commandRoom = await readAppFile('modules/command-room/components/CommandRoom.tsx')
    const mobileChatView = await readAppFile('modules/command-room/components/mobile/MobileChatView.tsx')
    const mobileShell = await readAppFile('modules/agents/page-shell/MobileSessionShell.tsx')
    const sessionsColumn = await readAppFile('modules/command-room/components/desktop/SessionsColumn.tsx')
    const combined = [commandRoom, mobileChatView, mobileShell, sessionsColumn].join('\n')

    expect(commandRoom).toContain('conversation?.allowedActions?.[action] === true')
    expect(commandRoom).toContain('conversation.sendTarget.sessionName')
    expect(commandRoom).toContain("resolveModuleGraphWebSocketPath(")
    expect(commandRoom).not.toContain('/api/conversations/${encodeURIComponent(selectedConversation.id)}/ws')
    expect(commandRoom).not.toMatch(/\/api\/conversations.*\/ws/u)
    expect(mobileChatView).toContain('conversation.sendTarget?.sessionName?.trim()')
    expect(mobileShell).toContain("hasConversationAction(conversation, 'start')")
    expect(sessionsColumn).toContain("hasConversationAction(conversation, 'start')")

    expectAbsent(combined, [
      'supportsQueuedDrafts',
      'queue-capability',
      'isConversationScopedSession',
      'buildConversationSessionName',
      'conversation-empty-',
      /commander-\$\{[\s\S]{0,120}conversation/u,
    ])
  })

  it('keeps workspace context materialization on backend send paths', async () => {
    const commandRoom = await readAppFile('modules/command-room/components/CommandRoom.tsx')
    const mobileSessionView = await readAppFile('modules/agents/page-shell/MobileSessionView.tsx')
    const sendDispatcher = await readAppFile('src/hooks/send-dispatcher.ts')
    const agentStream = await readAppFile('src/hooks/use-agent-session-stream.ts')
    const conversationHook = await readAppFile('modules/conversation/hooks/use-conversations.ts')
    const frontendSendSurface = [
      commandRoom,
      mobileSessionView,
      sendDispatcher,
      agentStream,
      conversationHook,
    ].join('\n')

    expect(frontendSendSurface).toContain('workspaceContext')
    expect(sendDispatcher).toContain('workspaceContext: input.workspaceContext')
    expect(agentStream).toContain('workspaceContext: body.workspaceContext')
    expect(conversationHook).toContain('workspaceContext: input.workspaceContext')

    expectAbsent(frontendSendSurface, [
      'materializeWorkspaceContext',
      'materializeWorkspaceContextPayload',
      'formatWorkspaceContextText',
      '<workspace-files>',
      '<workspace-file-annotations>',
    ])
  })

  it('keeps provider, channel, route, settings, and machine policy in backend descriptors', async () => {
    const commandRoom = await readAppFile('modules/command-room/components/CommandRoom.tsx')
    const routeMetadata = await readAppFile('modules/command-room/route-metadata.ts')
    const sessionsColumn = await readAppFile('modules/command-room/components/desktop/SessionsColumn.tsx')
    const mobileShell = await readAppFile('modules/agents/page-shell/MobileSessionShell.tsx')
    const createConversationPanel = await readAppFile('modules/conversation/components/CreateConversationPanel.tsx')
    const channelsHook = await readAppFile('modules/channels/hooks/useChannels.ts')
    const channelsPage = await readAppFile('modules/channels/page.tsx')
    const agentWebSocket = await readAppFile('modules/agents/websocket.ts')
    const conversationReadModel = await readAppFile('modules/commanders/routes/conversation-read-model.ts')
    const mobileSettings = await readAppFile('modules/settings/MobileSettings.tsx')
    const mobileSettingsSections = await readAppFile('modules/settings/mobile-settings-sections.ts')

    expect(commandRoom).toContain("findModuleGraphUiRouteMetadata(moduleGraph, 'command-room.ui')")
    expect(routeMetadata).toContain('normalizeCommandRoomRouteMetadata')
    expect(sessionsColumn).toContain('useProviderRegistry()')
    expect(mobileShell).toContain('useProviderRegistry()')
    expect(createConversationPanel).toContain('providerOptions.map')
    expect(channelsHook).toContain('/providers')
    expect(channelsPage).toContain('useChannelProviderDescriptors')
    expect(channelsPage).toContain('descriptor.formDefaults')
    expect(channelsPage).toContain('buildConfigFromDescriptor')
    expect(agentWebSocket).toContain('sendImmediateTextToStreamSession(')
    expect(conversationReadModel).toContain('capabilities.supportsMessageImages')
    expect(mobileSettings).toContain('useMobileSettingsSections()')
    expect(mobileSettings).toContain('buildMachineDaemonPendingDisplayDto')
    expect(mobileSettingsSections).toContain('/api/settings/mobile')

    expectAbsent(
      [
        sessionsColumn,
        mobileShell,
        createConversationPanel,
        channelsPage,
        channelsHook,
        mobileSettings,
      ].join('\n'),
      [
        'PROVIDERS',
        'MOBILE_SETTINGS_SECTIONS',
        '@modules/agents/providers/registry',
        'DEFAULT_PROVIDER_REGISTRY',
        'DEFAULT_EMAIL_FORM',
        'DEFAULT_WHATSAPP_FORM',
        'buildEmailConfig',
        'buildWhatsAppConfig',
        "provider === 'email'",
        "provider === 'whatsapp'",
        'listChannelProviderDescriptors',
      ],
    )

    expectAbsent(agentWebSocket, [
      "liveSession.agentType === 'gemini'",
      "liveSession.agentType === 'opencode'",
      "liveSession.agentType === 'codex'",
      'Image-only messages are not supported in Codex sessions',
      'Image attachments are not supported in',
    ])
    expectAbsent(conversationReadModel, [
      'media: hasActiveStream',
    ])
  })
})
