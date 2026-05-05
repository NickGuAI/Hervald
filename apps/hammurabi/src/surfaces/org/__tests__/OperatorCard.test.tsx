// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OperatorCard } from '@modules/org/components/OperatorCard'
import type { Operator } from '@modules/operators/types'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let previousActEnvironment: boolean | undefined
let root: Root | null = null
let container: HTMLDivElement | null = null

function createFounder(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 'google-oauth2|abc',
    kind: 'founder',
    displayName: 'TheNick',
    email: null,
    avatarUrl: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

async function renderOperatorCard(operator: Operator) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<OperatorCard operator={operator} />)
    await Promise.resolve()
  })
}

describe('OperatorCard', () => {
  beforeEach(() => {
    previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }
    root = null
    container?.remove()
    container = null
    document.body.innerHTML = ''
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('does not render an email line when operator.email is null', async () => {
    await renderOperatorCard(createFounder({ email: null }))

    const emailLines = Array.from(document.body.querySelectorAll('p'))
      .filter((paragraph) => paragraph.textContent?.includes('@'))

    expect(emailLines).toEqual([])
    expect(document.body.textContent).toContain('TheNick')
    expect(document.body.textContent).toContain('Founder')
  })

  it('does not render an email line when operator.email is a synthetic *@auth0.local string', async () => {
    await renderOperatorCard(createFounder({ email: 'google-oauth2|abc@auth0.local' }))

    expect(document.body.textContent).not.toContain('@auth0.local')
  })
})
