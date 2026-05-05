import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CreateCommanderForm } from '../components/CreateCommanderForm'

describe('CreateCommanderForm', () => {
  it('renders the create commander modal form with key controls', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    queryClient.setQueryData(['providers'], [])
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(CreateCommanderForm, {
          onAdd: vi.fn(async () => {}),
          isPending: false,
        }),
      ),
    )

    expect(html).toContain('New commander')
    expect(html).toContain('host (e.g. my-agent-1)')
    expect(html).toContain('Agent type')
    expect(html).toContain('Claude effort')
  })
})
