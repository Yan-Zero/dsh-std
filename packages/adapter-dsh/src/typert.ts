/** Strict Host-side Typert definition for the adapter's browser command bridge. */

import { z } from 'zod'

const stringSchema = z.string()
const commandResultSchema = z.union([
  z.undefined(),
  z.object({
    apiVersion: z.literal('commands.dsh/v1alpha1'),
    commandId: z.string(),
    result: z.union([
      z.object({
        kind: z.literal('success'),
        text: z.string().optional(),
        sourceEventSeq: z.number().int().nonnegative().optional(),
      }),
      z.object({ kind: z.literal('error'), text: z.string() }),
    ]),
  }),
])

const commandInvocation = Object.freeze({
  id: '@dsh-std/adapter-dsh#dshStd/command',
  service: 'dshStd',
  namespace: 'dshStd',
  method: 'command',
  invocation: Object.freeze({ kind: 'direct' as const }),
  parameters: Object.freeze([
    Object.freeze({
      name: 'sessionId', wire: 'sessionId', source: 'json' as const,
      codec: Object.freeze({
        mode: 'strict' as const,
        typeSymbol: '@dsh-std/adapter-dsh#dshStd/command:sessionId',
        schema: stringSchema,
      }),
    }),
    Object.freeze({
      name: 'line', wire: 'line', source: 'json' as const,
      codec: Object.freeze({
        mode: 'strict' as const,
        typeSymbol: '@dsh-std/adapter-dsh#dshStd/command:line',
        schema: stringSchema,
      }),
    }),
  ]),
  result: Object.freeze({
    mode: 'strict' as const,
    typeSymbol: '@dsh-std/adapter-dsh#dshStd/command:result',
    schema: commandResultSchema,
  }),
})

/** Typert Loader artifact discovered from package.json exports["./typert"]. */
export const TYPERT = Object.freeze({
  package: '@dsh-std/adapter-dsh',
  face: 'host' as const,
  schemas: Object.freeze([]),
  invocations: Object.freeze([commandInvocation]),
  model: Object.freeze({
    services: Object.freeze([Object.freeze({
      description: 'DSH adapter bridge used by browser-realm standard facets.',
      summary: 'DSH standard browser bridge.',
      tags: Object.freeze([]),
      jsDoc: '/** DSH adapter bridge used by browser-realm standard facets. */',
      key: 'dshStd',
      exportName: 'DshStandardAdapter',
      members: Object.freeze([Object.freeze({
        kind: 'method',
        name: 'command',
        signature: 'command(sessionId: string, line: string): Promise<DshCommandExecution | undefined>',
        summary: 'Execute one standard command for a browser-realm contribution.',
      })]),
      types: Object.freeze([]),
    })]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})

export default TYPERT
