import { describe, expect, it } from 'vitest'
import {
  getChannelProviderDescriptor,
  listChannelProviderDescriptors,
  projectChannelBindingState,
} from '../descriptors'
import type { CommanderChannelBinding } from '../types'

describe('channel provider descriptors', () => {
  it('describes the current email form defaults, credentials, policy, and commander binding affordance', () => {
    const descriptor = getChannelProviderDescriptor('email')

    expect(descriptor).toMatchObject({
      provider: 'email',
      label: 'Email',
      credentialFields: ['appPassword'],
      policyFields: ['allowlist', 'globalAllowlist'],
      pairing: { mode: 'none' },
      commanderBinding: {
        mode: 'account-commander',
        fieldKey: 'defaultCommanderId',
        label: 'Default Commander',
        source: 'bindingState.defaultCommanderId',
        emptyLabel: 'None',
      },
      formDefaults: {
        imapHost: 'imap.gmail.com',
        imapPort: '993',
        imapSecure: true,
        imapMailbox: 'INBOX',
        smtpHost: 'smtp.gmail.com',
        smtpPort: '465',
        smtpSecure: true,
        pollIntervalSeconds: '15',
      },
      configDefaults: {
        provider: 'email',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        pollIntervalMs: 15_000,
        dmPolicy: 'allowlist',
        groupPolicy: 'disabled',
      },
    })
    expect(descriptor?.fields.map((field) => [field.key, field.label])).toContainEqual(['appPassword', 'App Password'])
    expect(descriptor?.fields.map((field) => [field.key, field.label])).toContainEqual(['allowlist', 'Allowed Senders'])
  })

  it('describes the current WhatsApp Baileys defaults, policy schema, and QR pairing mode', () => {
    const descriptor = getChannelProviderDescriptor('whatsapp')

    expect(descriptor).toMatchObject({
      provider: 'whatsapp',
      label: 'WhatsApp',
      policyFields: ['dmPolicy', 'groupPolicy', 'dmAllowlist', 'groupAllowlist', 'globalAllowlist', 'requireMention'],
      pairing: { mode: 'qr', transport: 'baileys', statusPollIntervalMs: 2_000 },
      formDefaults: {
        transport: 'baileys',
        browserName: 'Hervald',
        connectTimeoutSeconds: '30',
        printQrInTerminal: true,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        reconnect: true,
        sendTextWithVoiceNote: false,
        dmPolicy: 'allowlist',
        groupPolicy: 'disabled',
        requireMention: false,
        ttsEnabled: false,
        ttsVoice: 'alloy',
        sttEnabled: true,
      },
    })
    const dmPolicy = descriptor?.fields.find((field) => field.key === 'dmPolicy')
    expect(dmPolicy?.options).toEqual([
      { value: 'allowlist', label: 'Allowlist' },
      { value: 'open', label: 'Open' },
      { value: 'disabled', label: 'Disabled' },
    ])
  })

  it('describes the Google Chat service-account webhook defaults and policy schema', () => {
    const descriptor = getChannelProviderDescriptor('googlechat')

    expect(descriptor).toMatchObject({
      provider: 'googlechat',
      label: 'Google Chat',
      credentialFields: ['serviceAccountJson'],
      policyFields: ['dmPolicy', 'groupPolicy', 'dmAllowlist', 'groupAllowlist', 'globalAllowlist', 'requireMention'],
      pairing: { mode: 'none' },
      formDefaults: {
        webhookAudienceType: 'url',
        dmPolicy: 'allowlist',
        groupPolicy: 'disabled',
        requireMention: true,
        maxMessageBytes: '30000',
      },
      configDefaults: {
        provider: 'googlechat',
        webhookAudienceType: 'url',
        dmPolicy: 'allowlist',
        groupPolicy: 'disabled',
        requireMention: true,
        maxMessageBytes: 30_000,
      },
    })
    expect(descriptor?.fields.map((field) => [field.key, field.label])).toContainEqual(['serviceAccountJson', 'Service Account JSON'])
    expect(descriptor?.fields.map((field) => [field.key, field.label])).toContainEqual(['webhookAudience', 'Webhook Audience'])
    expect(descriptor?.fields.find((field) => field.key === 'webhookAudienceType')?.options).toEqual([
      { value: 'url', label: 'Endpoint URL' },
      { value: 'project-number', label: 'Project Number' },
    ])
  })

  it('projects commander binding state without changing stored binding config shape', () => {
    const binding: CommanderChannelBinding = {
      id: 'binding-1',
      commanderId: 'cmd-owner',
      provider: 'email',
      accountId: 'assistant@example.com',
      displayName: 'Assistant Email',
      enabled: true,
      config: {
        provider: 'email',
        defaultCommanderId: 'cmd-owner',
      },
      createdAt: '2026-05-19T00:00:00.000Z',
      updatedAt: '2026-05-19T00:00:00.000Z',
    }

    expect(projectChannelBindingState(binding)).toEqual({
      defaultCommanderId: 'cmd-owner',
      effectiveCommanderId: 'cmd-owner',
      source: 'legacy-provider-config',
    })
    expect(listChannelProviderDescriptors({
      commanderId: 'cmd-owner',
      bindings: [binding],
    }).find((descriptor) => descriptor.provider === 'email')?.bindingState).toEqual({
      defaultCommanderId: 'cmd-owner',
      effectiveCommanderId: 'cmd-owner',
      source: 'legacy-provider-config',
    })
    expect(binding.config).toEqual({
      provider: 'email',
      defaultCommanderId: 'cmd-owner',
    })
  })
})
