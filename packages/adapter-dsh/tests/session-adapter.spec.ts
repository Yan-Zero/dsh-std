import { describe, expect, it } from 'vitest'
import type { CapabilityImplementation } from '@dsh-std/connection'
import { DshSessionProtocolAdapter, type DshSessionControllerFace } from '../src/session-adapter.js'

interface FixtureEvent {
  type: string
  seq: number
  time: number
  data: unknown
}

interface FixtureSession {
  meta: {
    id: string
    createdAt: number
    parentSession?: string
    seedLength?: number
    origin?: 'subagent'
  }
  events: FixtureEvent[]
}

class FixtureController implements DshSessionControllerFace {
  readonly sessions = new Map<string, FixtureSession>()
  readonly createCalls: string[] = []
  readonly renameCalls: Array<{ sessionId: string; title: string }> = []
  followFrames: Array<{ type: 'snapshot'; cursor: number } | { type: 'event'; event: FixtureEvent }> = []

  async list(): Promise<{ items: Array<{ sessionId: string; origin?: 'subagent' }> }> {
    return {
      items: [...this.sessions.values()].map(session => ({
        sessionId: session.meta.id,
        ...(session.meta.origin === undefined ? {} : { origin: session.meta.origin }),
      })),
    }
  }

  async inspect(sessionId: string): Promise<FixtureSession> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw Object.assign(new Error('not found'), { code: 'session/not-found' })
    }
    return session
  }

  async create(request: { sessionId?: string }): Promise<{ sessionId: string }> {
    const sessionId = request.sessionId ?? 'generated'
    this.createCalls.push(sessionId)
    this.sessions.set(sessionId, { meta: { id: sessionId, createdAt: 1_000 }, events: [] })
    return { sessionId }
  }

  async rename(request: { sessionId: string; title: string }): Promise<{ title: string; seq: number }> {
    this.renameCalls.push(request)
    const session = await this.inspect(request.sessionId)
    const seq = session.events.length
    session.events.push({
      type: 'session/title', seq, time: 2_000 + seq,
      data: { title: request.title, source: { kind: 'user' } },
    })
    return { title: request.title, seq }
  }

  async *follow(): AsyncIterable<{ type: 'snapshot'; cursor: number } | { type: 'event'; event: FixtureEvent }> {
    yield* this.followFrames
  }
}

function fixture(): {
  controller: FixtureController
  catalog: CapabilityImplementation
  history: CapabilityImplementation
} {
  const controller = new FixtureController()
  const adapter = new DshSessionProtocolAdapter(
    'dsh/runtime',
    controller,
    type => type.startsWith('example/') ? 'required' : 'ignorable',
  )
  return {
    controller,
    catalog: adapter.implementations.find(row => row.protocol.kind === 'SessionCatalog')!,
    history: adapter.implementations.find(row => row.protocol.kind === 'SessionHistory')!,
  }
}

function context(progress: unknown[] = [], signal = new AbortController().signal) {
  return {
    connectionId: 'connection-1', planRevision: 1, invocationId: 'invocation-1',
    binding: {}, signal, progress: (value: unknown) => { progress.push(value) },
  } as never
}

describe('DSH Session protocol adapter', () => {
  it('serves stable paginated catalog snapshots and excludes parent-qualified subagents', async () => {
    const { controller, catalog } = fixture()
    controller.sessions.set('session-a', {
      meta: { id: 'session-a', createdAt: 1_000 },
      events: [{ type: 'session/title', seq: 0, time: 1_100, data: { title: 'Alpha' } }],
    })
    controller.sessions.set('session-b', {
      meta: { id: 'session-b', createdAt: 2_000, parentSession: 'session-a', seedLength: 1 },
      events: [{ type: 'user/message', seq: 0, time: 2_100, data: { content: [] } }],
    })
    controller.sessions.set('child', {
      meta: { id: 'child', createdAt: 3_000, parentSession: 'session-a', origin: 'subagent' },
      events: [],
    })

    const first = await catalog.handle('list', { limit: 1 }, context()) as {
      sessions: Array<{ session: { id: string }; title?: string }>
      next: string
      catalogRevision: number
    }
    expect(first.sessions).toEqual([expect.objectContaining({
      session: { provider: 'dsh/runtime', id: 'session-a' }, title: 'Alpha',
    })])
    controller.sessions.delete('session-b')
    const second = await catalog.handle('list', { after: first.next, limit: 1 }, context()) as {
      sessions: Array<{ session: { id: string }; lineage?: unknown }>
      catalogRevision: number
    }
    expect(second.catalogRevision).toBe(first.catalogRevision)
    expect(second.sessions).toEqual([expect.objectContaining({
      session: { provider: 'dsh/runtime', id: 'session-b' },
      lineage: { parent: { provider: 'dsh/runtime', id: 'session-a' }, through: '0' },
    })])
  })

  it('maps create request ids idempotently and avoids duplicate title events', async () => {
    const { controller, catalog } = fixture()
    const input = { requestId: 'request-1', title: 'Portable title' }
    const first = await catalog.handle('create', input, context()) as { session: { session: { id: string } } }
    const second = await catalog.handle('create', input, context()) as { session: { session: { id: string } } }
    expect(second.session.session.id).toBe(first.session.session.id)
    expect(controller.createCalls).toEqual([first.session.session.id])
    expect(controller.renameCalls).toEqual([{ sessionId: first.session.session.id, title: 'Portable title' }])
  })

  it('translates durable event cursors, direction and replay classification', async () => {
    const { controller, history } = fixture()
    controller.sessions.set('session-a', {
      meta: { id: 'session-a', createdAt: 1_000 },
      events: [
        { type: 'user/message', seq: 0, time: 1_100, data: { text: 'a' } },
        { type: 'example/fact', seq: 1, time: 1_200, data: { value: 1 } },
        { type: 'assistant/message', seq: 2, time: 1_300, data: { text: 'b' } },
      ],
    })
    const session = { provider: 'dsh/runtime', id: 'session-a' }
    const page = await history.handle('read', {
      session, after: '0', direction: 'backward', limit: 1,
    }, context()) as { events: Array<{ cursor: string; replay: string }>; hasMore: boolean }
    expect(page).toMatchObject({ events: [{ cursor: '2', replay: 'ignorable' }], hasMore: true })
    await expect(history.handle('read', { session, after: '9' }, context()))
      .rejects.toThrow('cursor does not exist')
  })

  it('uses the product snapshot as the gap-free follow boundary', async () => {
    const { controller, history } = fixture()
    const events: FixtureEvent[] = [
      { type: 'user/message', seq: 0, time: 1_100, data: {} },
      { type: 'example/fact', seq: 1, time: 1_200, data: { value: 1 } },
      { type: 'assistant/message', seq: 2, time: 1_300, data: {} },
    ]
    controller.sessions.set('session-a', {
      meta: { id: 'session-a', createdAt: 1_000 }, events,
    })
    controller.followFrames = [
      { type: 'snapshot', cursor: 1 },
      { type: 'event', event: events[2]! },
    ]
    const progress: unknown[] = []
    await history.handle('follow', {
      session: { provider: 'dsh/runtime', id: 'session-a' }, after: '0',
    }, context(progress))
    expect(progress).toEqual([
      { type: 'ready', session: { provider: 'dsh/runtime', id: 'session-a' }, boundary: '1' },
      { type: 'event', event: expect.objectContaining({ cursor: '1', replay: 'required' }) },
      { type: 'event', event: expect.objectContaining({ cursor: '2', replay: 'ignorable' }) },
    ])
  })
})
