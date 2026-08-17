import { validateEndpointOffer } from './model.js'
import type { ConnectionEndpoint, StandardConnection } from './connection.js'

export interface ConnectionTarget {
  /** Implementation-neutral target. Its URI scheme is interpreted by registered connectors. */
  readonly uri: string
  readonly metadata?: Readonly<Record<string, string>>
}

export interface ConnectRequest {
  readonly target: ConnectionTarget
  /** Live endpoint, including the dispatcher used for peer-to-local calls. */
  readonly local: ConnectionEndpoint
  readonly signal?: AbortSignal
}

/** Client half of one concrete connection implementation. */
export interface ConnectionConnector {
  /** Namespaced implementation identity, not a transport or product name exposed to domain consumers. */
  readonly id: string
  supports(target: ConnectionTarget): boolean
  connect(request: ConnectRequest): Promise<StandardConnection>
}

export class ConnectionSelectionError extends Error {
  constructor(
    readonly code: 'implementation-unavailable' | 'implementation-ambiguous',
    message: string,
    readonly implementations: readonly string[],
  ) {
    super(message)
    this.name = 'ConnectionSelectionError'
  }
}

/**
 * Implementation registry used by an adapter or application composition root.
 * Domain consumers request a connection; they never import the selected implementation.
 */
export class ConnectionBroker {
  private readonly connectors = new Map<string, ConnectionConnector>()

  register(connector: ConnectionConnector): () => void {
    namespaced(connector.id, 'connection connector id')
    if (this.connectors.has(connector.id)) throw new Error(`connection connector ${JSON.stringify(connector.id)} is already registered`)
    this.connectors.set(connector.id, connector)
    return () => { if (this.connectors.get(connector.id) === connector) this.connectors.delete(connector.id) }
  }

  implementations(target?: ConnectionTarget): readonly string[] {
    if (target !== undefined) validateTarget(target)
    return Object.freeze([...this.connectors.values()]
      .filter(connector => target === undefined || safelySupports(connector, target))
      .map(connector => connector.id)
      .sort())
  }

  async connect(request: ConnectRequest): Promise<StandardConnection> {
    validateTarget(request.target)
    validateEndpointOffer(request.local.offer)
    request.signal?.throwIfAborted()
    const matches = [...this.connectors.values()]
      .filter(connector => safelySupports(connector, request.target))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (matches.length === 0) {
      throw new ConnectionSelectionError(
        'implementation-unavailable',
        `no connection implementation supports ${JSON.stringify(request.target.uri)}`,
        [],
      )
    }
    if (matches.length > 1) {
      const ids = Object.freeze(matches.map(connector => connector.id))
      throw new ConnectionSelectionError(
        'implementation-ambiguous',
        `multiple connection implementations support ${JSON.stringify(request.target.uri)}: ${ids.join(', ')}`,
        ids,
      )
    }
    return matches[0]!.connect(request)
  }
}

function safelySupports(connector: ConnectionConnector, target: ConnectionTarget): boolean {
  try { return connector.supports(target) } catch { return false }
}

function validateTarget(target: ConnectionTarget): void {
  if (typeof target.uri !== 'string' || target.uri.trim() === '') throw new TypeError('connection target uri must be non-empty')
  if (target.metadata !== undefined) {
    for (const [key, value] of Object.entries(target.metadata)) {
      if (key.trim() === '' || typeof value !== 'string') throw new TypeError('connection target metadata must contain string pairs')
    }
  }
}

function namespaced(value: string, label: string): void {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9][a-z0-9-]*)+$/u.test(value)) throw new TypeError(`${label} must be namespaced`)
}
