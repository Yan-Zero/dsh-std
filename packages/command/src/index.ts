import type {
  ProtocolCatalog,
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolSupport,
} from '@dsh-std/core'
import type { ManifestDefinitionCatalog, ManifestExtension } from '@dsh-std/manifest'
import type {
  CapabilityCall,
  CapabilityClient,
  CapabilityHandlerContext,
  CapabilityImplementation,
} from '@dsh-std/connection'
import { defineCapabilityProtocol } from '@dsh-std/connection'
import type { Operation as PresentationOperation } from '@dsh-std/presentation'

export const API_VERSION = 'commands.dsh/v1alpha1'
export const KIND = 'Command'
export const RUNTIME_KIND = 'CommandRuntime'

/** Stable reference to one declared command path. */
export interface CommandReference {
  readonly name: string
  readonly path?: readonly string[]
}

export interface CommandValueSpec {
  readonly value: string
  readonly title?: string
  readonly titles?: Readonly<Record<string, string>>
}

export interface CommandArgumentSpec {
  readonly name: string
  readonly title?: string
  readonly titles?: Readonly<Record<string, string>>
  readonly required?: boolean
  readonly variadic?: boolean
  readonly values?: readonly CommandValueSpec[]
}

export interface CommandOptionSpec {
  /** Literal spellings such as `--verbose` and `-v`. */
  readonly names: readonly string[]
  readonly title: string
  readonly titles?: Readonly<Record<string, string>>
  readonly value?: CommandArgumentSpec
}

export interface CommandNodeSpec {
  readonly title: string
  readonly titles?: Readonly<Record<string, string>>
  readonly description?: string
  readonly aliases?: readonly string[]
  readonly arguments?: readonly CommandArgumentSpec[]
  readonly options?: readonly CommandOptionSpec[]
  readonly children?: readonly CommandNode[]
}

export interface CommandNode {
  readonly name: string
  readonly spec: CommandNodeSpec
}

export type CommandSpec = CommandNodeSpec

export type CommandResource = ManifestExtension<CommandSpec>

export interface CommandPresentationDescriptor {
  readonly clientId: string
  readonly contracts: readonly ProtocolSupport[]
}

export interface CommandOwnerReference {
  readonly component: string
  readonly facet: string
  readonly participantId?: string
}

export interface CommandDescriptor {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  readonly owner: CommandOwnerReference
  readonly resource: CommandResource
  readonly available: boolean
  readonly missingPresentation: readonly ProtocolSupport[]
  readonly issues: readonly { readonly code: string; readonly message: string }[]
}

export interface CommandCatalog {
  readonly apiVersion: typeof API_VERSION
  readonly commands: readonly CommandDescriptor[]
}

export interface CommandCatalogInput {
  /** Opaque execution context selected by the consuming product. */
  readonly contextId: string
  readonly presentation?: CommandPresentationDescriptor
}

export interface CommandExecutionInput extends CommandCatalogInput {
  readonly line: string
}

export interface CommandExecution {
  readonly apiVersion: typeof API_VERSION
  readonly commandId: string
  readonly result: {
    readonly kind: 'success' | 'error'
    readonly text?: string
    readonly sourceEventSeq?: number
  }
  readonly operations: readonly PresentationOperation[]
}

export type CommandRuntimeCall =
  | { readonly operation: 'catalog'; readonly input: CommandCatalogInput; readonly output: CommandCatalog }
  | { readonly operation: 'execute'; readonly input: CommandExecutionInput; readonly output: CommandExecution | undefined }

export interface CommandRuntimeClient {
  catalog(input: CommandCatalogInput, options?: { readonly signal?: AbortSignal }): CapabilityCall<CommandCatalog>
  execute(input: CommandExecutionInput, options?: { readonly signal?: AbortSignal }): CapabilityCall<CommandExecution | undefined>
}

export interface CommandRuntimeHandler {
  catalog(input: CommandCatalogInput, context: CapabilityHandlerContext): CommandCatalog | Promise<CommandCatalog>
  execute(
    input: CommandExecutionInput,
    context: CapabilityHandlerContext,
  ): CommandExecution | undefined | Promise<CommandExecution | undefined>
}

export interface CommandHandlerInput {
  readonly rawInput: string
}

export interface CommandHandlerContext {
  readonly signal: AbortSignal
  readonly presentation?: CommandPresentationDescriptor
  present(operation: PresentationOperation): boolean
}

export interface CommandHandler {
  execute(
    input: CommandHandlerInput,
    context: CommandHandlerContext,
  ): CommandExecution['result'] | Promise<CommandExecution['result']>
}

export function assertCommandHandler(value: unknown): asserts value is CommandHandler {
  if (!record(value) || typeof value.execute !== 'function') {
    throw new TypeError('Command handler must provide execute(input, context)')
  }
}

export const extensionDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateMetadata(metadata: { readonly name: string }): void {
    if (!/^[a-z][a-z0-9_-]*$/u.test(metadata.name)) throw new TypeError('Command metadata.name is invalid')
  },
  validateSpec(value: unknown): void {
    validateNodeSpec(value, 'Command spec')
  },
})

/** Host support for accepting and owning Command resource publications. */
export const resourceProtocol: ProtocolDefinition = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
  validateRequirement: emptyProtocolSpec,
  validateSupport: emptyProtocolSpec,
  negotiate(input) {
    const issues: ProtocolIssue[] = []
    for (const row of input.requirements) {
      if (input.supports.some(candidate => candidate.participant !== row.participant)) continue
      issues.push(Object.freeze({
        code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
        severity: row.requirement.optional === true ? 'warning' : 'error',
        participant: row.participant,
        message: `no participant accepts ${row.requirement.apiVersion} ${row.requirement.kind} resources`,
      }))
    }
    return {
      agreement: Object.freeze({ kind: 'ResourcePublication' as const }),
      issues: Object.freeze(issues),
    }
  },
} satisfies ProtocolDefinition)

export const resourceSupport: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: KIND,
})

/** Callable, resource-keyed command dispatcher implemented once by a Runtime adapter. */
export const runtimeProtocol = defineCapabilityProtocol({
  apiVersion: API_VERSION,
  kind: RUNTIME_KIND,
})

export const runtimeSupport: ProtocolSupport = Object.freeze({
  apiVersion: API_VERSION,
  kind: RUNTIME_KIND,
})

/** Bind the typed CommandRuntime operations to a consumer-scoped connection client. */
export function commandRuntime(client: CapabilityClient): CommandRuntimeClient {
  return Object.freeze({
    catalog(input: CommandCatalogInput, options?: { readonly signal?: AbortSignal }) {
      return client.invoke<CommandCatalogInput, CommandCatalog>(runtimeSupport, 'catalog', validateCatalogInput(input), options)
    },
    execute(input: CommandExecutionInput, options?: { readonly signal?: AbortSignal }) {
      return client.invoke<CommandExecutionInput, CommandExecution | undefined>(runtimeSupport, 'execute', validateExecutionInput(input), options)
    },
  })
}

/** Create the sole Runtime-side dispatcher implementation for every Command resource. */
export function commandRuntimeImplementation(
  participantId: string,
  handler: CommandRuntimeHandler,
): CapabilityImplementation {
  return Object.freeze({
    participantId,
    protocol: runtimeSupport,
    handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (operation === 'catalog') return handler.catalog(validateCatalogInput(input), context)
      if (operation === 'execute') return handler.execute(validateExecutionInput(input), context)
      throw new TypeError(`unsupported CommandRuntime operation ${JSON.stringify(operation)}`)
    },
  })
}

export function register(protocols: ProtocolCatalog, manifest?: ManifestDefinitionCatalog): () => void {
  const disposeResource = manifest?.registerExtension(extensionDefinition) ?? (() => undefined)
  const disposeResourceProtocol = protocols.register(resourceProtocol)
  const disposeRuntime = protocols.register(runtimeProtocol)
  return () => {
    disposeRuntime()
    disposeResourceProtocol()
    disposeResource()
  }
}

function emptyProtocolSpec(value: unknown): undefined {
  if (value !== undefined) throw new TypeError('Command resource protocol does not accept spec')
  return undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateCatalogInput(value: unknown): CommandCatalogInput {
  if (!record(value)) throw new TypeError('CommandRuntime.catalog input must be an object')
  exact(value, ['contextId', 'presentation'], 'CommandRuntime.catalog input')
  text(value.contextId, 'CommandRuntime.catalog input.contextId')
  if (value.presentation !== undefined) validatePresentation(value.presentation)
  return Object.freeze({
    contextId: value.contextId as string,
    ...(value.presentation === undefined ? {} : { presentation: value.presentation as CommandPresentationDescriptor }),
  })
}

function validateExecutionInput(value: unknown): CommandExecutionInput {
  if (!record(value)) throw new TypeError('CommandRuntime.execute input must be an object')
  exact(value, ['contextId', 'line', 'presentation'], 'CommandRuntime.execute input')
  const catalog = validateCatalogInput({
    contextId: value.contextId,
    ...(value.presentation === undefined ? {} : { presentation: value.presentation }),
  })
  text(value.line, 'CommandRuntime.execute input.line')
  return Object.freeze({ ...catalog, line: value.line as string })
}

function validatePresentation(value: unknown): void {
  if (!record(value)) throw new TypeError('CommandRuntime presentation must be an object')
  exact(value, ['clientId', 'contracts'], 'CommandRuntime presentation')
  text(value.clientId, 'CommandRuntime presentation.clientId')
  if (!Array.isArray(value.contracts)) throw new TypeError('CommandRuntime presentation.contracts must be an array')
  for (const contract of value.contracts) {
    if (!record(contract)) throw new TypeError('CommandRuntime presentation contract must be an object')
    exact(contract, ['apiVersion', 'kind', 'spec'], 'CommandRuntime presentation contract')
    text(contract.apiVersion, 'CommandRuntime presentation contract.apiVersion')
    text(contract.kind, 'CommandRuntime presentation contract.kind')
  }
}

function validateNodeSpec(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  exact(value, ['title', 'titles', 'description', 'aliases', 'arguments', 'options', 'children'], label)
  text(value.title, `${label}.title`)
  if (value.description !== undefined) text(value.description, `${label}.description`)
  if (value.titles !== undefined) localized(value.titles, `${label}.titles`)
  if (value.aliases !== undefined) tokens(value.aliases, `${label}.aliases`)
  if (value.arguments !== undefined) argumentsList(value.arguments, `${label}.arguments`)
  if (value.options !== undefined) optionsList(value.options, `${label}.options`)
  if (value.children !== undefined) children(value.children, `${label}.children`)
}

function argumentsList(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const names = new Set<string>()
  for (const [index, argument] of value.entries()) {
    const item = `${label}[${index}]`
    if (!record(argument)) throw new TypeError(`${item} must be an object`)
    exact(argument, ['name', 'title', 'titles', 'required', 'variadic', 'values'], item)
    token(argument.name, `${item}.name`)
    if (names.has(argument.name as string)) throw new TypeError(`${label} contains a duplicate argument`)
    names.add(argument.name as string)
    if (argument.title !== undefined) text(argument.title, `${item}.title`)
    if (argument.titles !== undefined) localized(argument.titles, `${item}.titles`)
    if (argument.required !== undefined && typeof argument.required !== 'boolean') throw new TypeError(`${item}.required must be boolean`)
    if (argument.variadic !== undefined && typeof argument.variadic !== 'boolean') throw new TypeError(`${item}.variadic must be boolean`)
    if (argument.variadic === true && index !== value.length - 1) throw new TypeError(`${item} must be the last argument when variadic`)
    if (argument.values !== undefined) values(argument.values, `${item}.values`)
  }
}

function optionsList(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const names = new Set<string>()
  for (const [index, option] of value.entries()) {
    const item = `${label}[${index}]`
    if (!record(option)) throw new TypeError(`${item} must be an object`)
    exact(option, ['names', 'title', 'titles', 'value'], item)
    text(option.title, `${item}.title`)
    if (option.titles !== undefined) localized(option.titles, `${item}.titles`)
    if (!Array.isArray(option.names) || option.names.length === 0) throw new TypeError(`${item}.names must be a non-empty array`)
    for (const name of option.names) {
      if (typeof name !== 'string' || !/^-{1,2}[^\s-][^\s]*$/u.test(name)) throw new TypeError(`${item}.names contains an invalid option`)
      if (names.has(name)) throw new TypeError(`${label} contains a duplicate option name`)
      names.add(name)
    }
    if (option.value !== undefined) argumentsList([option.value], `${item}.value`)
  }
}

function children(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const names = new Set<string>()
  for (const [index, child] of value.entries()) {
    const item = `${label}[${index}]`
    if (!record(child)) throw new TypeError(`${item} must be an object`)
    exact(child, ['name', 'spec'], item)
    token(child.name, `${item}.name`)
    for (const name of [child.name, ...(Array.isArray((child.spec as Record<string, unknown> | undefined)?.aliases) ? (child.spec as { aliases: unknown[] }).aliases : [])]) {
      if (typeof name !== 'string') continue
      if (names.has(name)) throw new TypeError(`${label} contains a duplicate name or alias`)
      names.add(name)
    }
    validateNodeSpec(child.spec, `${item}.spec`)
  }
}

function values(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const [index, choice] of value.entries()) {
    const item = `${label}[${index}]`
    if (!record(choice)) throw new TypeError(`${item} must be an object`)
    exact(choice, ['value', 'title', 'titles'], item)
    text(choice.value, `${item}.value`)
    if (seen.has(choice.value as string)) throw new TypeError(`${label} contains a duplicate value`)
    seen.add(choice.value as string)
    if (choice.title !== undefined) text(choice.title, `${item}.title`)
    if (choice.titles !== undefined) localized(choice.titles, `${item}.titles`)
  }
}

function localized(value: unknown, label: string): void {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  for (const [locale, translation] of Object.entries(value)) {
    if (locale.trim() === '') throw new TypeError(`${label} contains an empty locale`)
    text(translation, `${label}.${locale}`)
  }
}

function tokens(value: unknown, label: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const seen = new Set<string>()
  for (const valueItem of value) {
    token(valueItem, label)
    if (seen.has(valueItem as string)) throw new TypeError(`${label} contains a duplicate token`)
    seen.add(valueItem as string)
  }
}

function token(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^[^\s/]+$/u.test(value)) throw new TypeError(`${label} must be one token`)
}

function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key) && !key.startsWith('x-'))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
}
