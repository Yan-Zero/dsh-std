import type {
  ProtocolCatalog,
  ProtocolDefinition,
  ProtocolIssue,
  ProtocolNegotiationInput,
  ProtocolRequirement,
  ProtocolSupport,
} from '@dsh-std/core'
import type {
  CapabilityClient,
  CapabilityHandlerContext,
  CapabilityImplementation,
  ConnectionNegotiationPolicy,
} from '@dsh-std/connection'
import { defineCapabilityProtocol } from '@dsh-std/connection'
import { EXTERNAL_REDIRECT_KIND, externalRedirectClient, externalRedirectProtocol } from './callback.js'
import type { ExternalRedirectClient } from './callback.js'

export * from './callback.js'

export const API_VERSION = 'presentation.dsh/v1alpha1'
export const OPEN_EXTERNAL_KIND = 'OpenExternal'
export const COPY_TEXT_KIND = 'CopyText'
export const NOTIFICATION_KIND = 'Notification'
export const USER_INTERACTION_KIND = 'UserInteraction'

export interface PresentationDescriptor {
  /** Endpoint identity selected and authenticated by the Host for this invocation. */
  readonly clientId: string
  /** Active Presentation agreements projected into this invocation. */
  readonly contracts: readonly ProtocolSupport[]
}

export interface PresentationRequestContext {
  readonly requestId: string
  readonly invocationId: string
  readonly origin: string
  readonly deadline?: string
}

/** Invocation authority supplied by the Host when it creates scoped clients. */
export interface PresentationInvocationScope {
  readonly invocationId: string
  readonly origin: string
  readonly deadline?: string
  nextRequestId(): string
}

export type PresentationResult<T> =
  | { readonly status: 'submitted'; readonly value: T }
  | { readonly status: 'cancelled' }
  | { readonly status: 'expired' }
  | { readonly status: 'unavailable'; readonly reason?: string }

export interface OpenExternalRequest extends PresentationRequestContext {
  readonly uri: string
}

export type OpenExternalInput = Omit<OpenExternalRequest, keyof PresentationRequestContext>

export interface OpenExternalReceipt { readonly accepted: true }

export interface CopyTextRequest extends PresentationRequestContext {
  readonly text: string
  readonly sensitivity?: 'public' | 'private'
}

export type CopyTextInput = Omit<CopyTextRequest, keyof PresentationRequestContext>

export interface CopyTextReceipt { readonly accepted: true }

export interface NotificationRequest extends PresentationRequestContext {
  readonly text: string
  readonly level?: 'info' | 'warning' | 'error'
  readonly deduplicationKey?: string
}

export type NotificationInput = Omit<NotificationRequest, keyof PresentationRequestContext>

export interface NotificationReceipt { readonly accepted: true }

export type UserInteractionOperation = 'question' | 'approval' | 'secret-input'

export interface UserInteractionRequirementSpec {
  readonly operations: readonly UserInteractionOperation[]
  readonly optionalOperations?: readonly UserInteractionOperation[]
}

export interface UserInteractionLimits {
  readonly maxConcurrentRequests?: number
  readonly maxFields?: number
  readonly maxOptionsPerField?: number
  readonly maxTextLength?: number
}

export interface UserInteractionSupportSpec {
  readonly operations: readonly UserInteractionOperation[]
  readonly limits?: UserInteractionLimits
}

export interface QuestionOption {
  readonly id: string
  readonly label: string
  readonly description?: string
}

interface QuestionFieldBase {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly required?: boolean
}

export interface TextQuestionField extends QuestionFieldBase {
  readonly kind: 'text'
  readonly multiline?: boolean
  readonly minLength?: number
  readonly maxLength?: number
}

export interface SelectQuestionField extends QuestionFieldBase {
  readonly kind: 'select'
  readonly multiple?: boolean
  readonly options: readonly QuestionOption[]
}

export interface ConfirmQuestionField extends QuestionFieldBase {
  readonly kind: 'confirm'
}

export type QuestionField = TextQuestionField | SelectQuestionField | ConfirmQuestionField

export interface QuestionRequest extends PresentationRequestContext {
  readonly kind: 'question'
  readonly title?: string
  readonly description?: string
  readonly fields: readonly QuestionField[]
}

export interface QuestionAnswers {
  readonly answers: Readonly<Record<string, string | boolean | readonly string[]>>
}

export interface ApprovalDetail {
  readonly label: string
  readonly value: string
  readonly sensitivity?: 'public' | 'private'
}

export interface ApprovalRequest extends PresentationRequestContext {
  readonly kind: 'approval'
  readonly action: string
  readonly summary: string
  readonly details?: readonly ApprovalDetail[]
  readonly risk?: 'low' | 'medium' | 'high'
}

export interface ApprovalValue { readonly decision: 'approved' | 'denied' }

export interface SecretInputRequest extends PresentationRequestContext {
  readonly kind: 'secret-input'
  readonly label: string
  readonly description?: string
  readonly minLength?: number
  readonly maxLength?: number
}

export interface SecretInputValue { readonly secret: string }

export type UserInteractionRequest = QuestionRequest | ApprovalRequest | SecretInputRequest
export type UserInteractionValue = QuestionAnswers | ApprovalValue | SecretInputValue
export type QuestionInput = Omit<QuestionRequest, keyof PresentationRequestContext>
export type ApprovalInput = Omit<ApprovalRequest, keyof PresentationRequestContext>
export type SecretInput = Omit<SecretInputRequest, keyof PresentationRequestContext>

export interface OpenExternalClient {
  openExternal(input: OpenExternalInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<OpenExternalReceipt>>
}

export interface CopyTextClient {
  copyText(input: CopyTextInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<CopyTextReceipt>>
}

export interface NotificationClient {
  notify(input: NotificationInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<NotificationReceipt>>
}

export interface UserInteractionClient {
  interact(input: QuestionInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<QuestionAnswers>>
  interact(input: ApprovalInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<ApprovalValue>>
  interact(input: SecretInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<SecretInputValue>>
}

/** Typed Presentation capabilities available to one domain invocation. */
export interface PresentationClients {
  readonly descriptor: PresentationDescriptor
  readonly openExternal?: OpenExternalClient
  readonly copyText?: CopyTextClient
  readonly notification?: NotificationClient
  readonly interaction?: UserInteractionClient
  readonly externalRedirect?: ExternalRedirectClient
}

export interface OpenExternalHandler {
  openExternal(request: OpenExternalRequest, context: CapabilityHandlerContext): PresentationResult<OpenExternalReceipt> | Promise<PresentationResult<OpenExternalReceipt>>
}

export interface CopyTextHandler {
  copyText(request: CopyTextRequest, context: CapabilityHandlerContext): PresentationResult<CopyTextReceipt> | Promise<PresentationResult<CopyTextReceipt>>
}

export interface NotificationHandler {
  notify(request: NotificationRequest, context: CapabilityHandlerContext): PresentationResult<NotificationReceipt> | Promise<PresentationResult<NotificationReceipt>>
}

export interface UserInteractionHandler {
  interact(request: QuestionRequest, context: CapabilityHandlerContext): PresentationResult<QuestionAnswers> | Promise<PresentationResult<QuestionAnswers>>
  interact(request: ApprovalRequest, context: CapabilityHandlerContext): PresentationResult<ApprovalValue> | Promise<PresentationResult<ApprovalValue>>
  interact(request: SecretInputRequest, context: CapabilityHandlerContext): PresentationResult<SecretInputValue> | Promise<PresentationResult<SecretInputValue>>
}

const emptySpec = (value: unknown): undefined => {
  if (value !== undefined) throw new TypeError('Presentation operation does not accept spec in v1alpha1')
  return undefined
}

export const openExternalProtocol = defineCapabilityProtocol({
  apiVersion: API_VERSION, kind: OPEN_EXTERNAL_KIND, validateRequirement: emptySpec, validateSupport: emptySpec,
})
export const copyTextProtocol = defineCapabilityProtocol({
  apiVersion: API_VERSION, kind: COPY_TEXT_KIND, validateRequirement: emptySpec, validateSupport: emptySpec,
})
export const notificationProtocol = defineCapabilityProtocol({
  apiVersion: API_VERSION, kind: NOTIFICATION_KIND, validateRequirement: emptySpec, validateSupport: emptySpec,
})

export const openExternalSupport: ProtocolSupport = Object.freeze({ apiVersion: API_VERSION, kind: OPEN_EXTERNAL_KIND })
export const copyTextSupport: ProtocolSupport = Object.freeze({ apiVersion: API_VERSION, kind: COPY_TEXT_KIND })
export const notificationSupport: ProtocolSupport = Object.freeze({ apiVersion: API_VERSION, kind: NOTIFICATION_KIND })
export const userInteractionSupport = (spec: UserInteractionSupportSpec): ProtocolSupport<UserInteractionSupportSpec> =>
  Object.freeze({ apiVersion: API_VERSION, kind: USER_INTERACTION_KIND, spec: validateUserInteractionSupport(spec) })

export const userInteractionProtocol: ProtocolDefinition<
  UserInteractionRequirementSpec,
  UserInteractionSupportSpec
> = Object.freeze({
  apiVersion: API_VERSION,
  kind: USER_INTERACTION_KIND,
  validateRequirement: validateUserInteractionRequirement,
  validateSupport: validateUserInteractionSupport,
  negotiate: negotiateUserInteraction,
})

export const protocols: readonly ProtocolDefinition[] = Object.freeze([
  openExternalProtocol,
  copyTextProtocol,
  notificationProtocol,
  userInteractionProtocol,
  externalRedirectProtocol,
])

export function register(catalog: ProtocolCatalog): () => void {
  const disposers = protocols.map(protocol => catalog.register(protocol))
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

export function openExternalClient(client: CapabilityClient, scope: PresentationInvocationScope): OpenExternalClient {
  const request = requestFactory(scope)
  return Object.freeze({
    async openExternal(input: OpenExternalInput, options?: { readonly signal?: AbortSignal }) {
      const value = request(input)
      validateOpenExternalRequest(value)
      const result = await client.invoke<OpenExternalRequest, PresentationResult<OpenExternalReceipt>>(
        openExternalSupport, 'openExternal', value, options,
      ).result
      return validatePresentationResult(result, validateAcceptedReceipt, 'OpenExternal result')
    },
  })
}

export function copyTextClient(client: CapabilityClient, scope: PresentationInvocationScope): CopyTextClient {
  const request = requestFactory(scope)
  return Object.freeze({
    async copyText(input: CopyTextInput, options?: { readonly signal?: AbortSignal }) {
      const value = request(input)
      validateCopyTextRequest(value)
      const result = await client.invoke<CopyTextRequest, PresentationResult<CopyTextReceipt>>(
        copyTextSupport, 'copyText', value, options,
      ).result
      return validatePresentationResult(result, validateAcceptedReceipt, 'CopyText result')
    },
  })
}

export function notificationClient(client: CapabilityClient, scope: PresentationInvocationScope): NotificationClient {
  const request = requestFactory(scope)
  return Object.freeze({
    async notify(input: NotificationInput, options?: { readonly signal?: AbortSignal }) {
      const value = request(input)
      validateNotificationRequest(value)
      const result = await client.invoke<NotificationRequest, PresentationResult<NotificationReceipt>>(
        notificationSupport, 'notify', value, options,
      ).result
      return validatePresentationResult(result, validateAcceptedReceipt, 'Notification result')
    },
  })
}

export function userInteractionClient(client: CapabilityClient, scope: PresentationInvocationScope): UserInteractionClient {
  const request = requestFactory(scope)
  return Object.freeze({
    async interact(input: QuestionInput | ApprovalInput | SecretInput, options?: { readonly signal?: AbortSignal }): Promise<PresentationResult<UserInteractionValue>> {
      const value = request(input) as UserInteractionRequest
      validateUserInteractionRequest(value)
      const result = await client.invoke<UserInteractionRequest, PresentationResult<UserInteractionValue>>(
        { apiVersion: API_VERSION, kind: USER_INTERACTION_KIND }, 'interact', value, options,
      ).result
      return validateInteractionResult(value, result)
    },
  }) as UserInteractionClient
}

export function presentationClients(
  descriptor: PresentationDescriptor,
  client: CapabilityClient,
  scope: PresentationInvocationScope,
): PresentationClients {
  validatePresentationDescriptor(descriptor)
  validateInvocationScope(scope)
  const has = (kind: string) => descriptor.contracts.some(contract =>
    contract.apiVersion === API_VERSION && contract.kind === kind && client.binding(contract) !== undefined)
  return Object.freeze({
    descriptor: freezeClone(descriptor),
    ...(has(OPEN_EXTERNAL_KIND) ? { openExternal: openExternalClient(client, scope) } : {}),
    ...(has(COPY_TEXT_KIND) ? { copyText: copyTextClient(client, scope) } : {}),
    ...(has(NOTIFICATION_KIND) ? { notification: notificationClient(client, scope) } : {}),
    ...(has(USER_INTERACTION_KIND) ? { interaction: userInteractionClient(client, scope) } : {}),
    ...(has(EXTERNAL_REDIRECT_KIND) ? { externalRedirect: externalRedirectClient(client, scope) } : {}),
  })
}

export function openExternalImplementation(participantId: string, handler: OpenExternalHandler): CapabilityImplementation {
  return implementation(participantId, openExternalSupport, 'openExternal', validateOpenExternalRequest, handler.openExternal.bind(handler),
    result => validatePresentationResult(result, validateAcceptedReceipt, 'OpenExternal result'))
}

export function copyTextImplementation(participantId: string, handler: CopyTextHandler): CapabilityImplementation {
  return implementation(participantId, copyTextSupport, 'copyText', validateCopyTextRequest, handler.copyText.bind(handler),
    result => validatePresentationResult(result, validateAcceptedReceipt, 'CopyText result'))
}

export function notificationImplementation(participantId: string, handler: NotificationHandler): CapabilityImplementation {
  return implementation(participantId, notificationSupport, 'notify', validateNotificationRequest, handler.notify.bind(handler),
    result => validatePresentationResult(result, validateAcceptedReceipt, 'Notification result'))
}

export function userInteractionImplementation(
  participantId: string,
  spec: UserInteractionSupportSpec,
  handler: UserInteractionHandler,
): CapabilityImplementation {
  const protocol = userInteractionSupport(spec)
  return Object.freeze({
    participantId,
    protocol,
    async handle(operationName: string, input: unknown, context: CapabilityHandlerContext) {
      if (operationName !== 'interact') throw new TypeError(`unsupported UserInteraction operation ${JSON.stringify(operationName)}`)
      validateUserInteractionRequest(input)
      if (!spec.operations.includes(input.kind)) throw new TypeError(`UserInteraction provider does not support ${JSON.stringify(input.kind)}`)
      const result = await handler.interact(input as never, context)
      return validateInteractionResult(input, result)
    },
  })
}

export function validatePresentationDescriptor(value: unknown): asserts value is PresentationDescriptor {
  const descriptor = exactRecord(value, ['clientId', 'contracts'], ['clientId', 'contracts'], 'Presentation descriptor')
  nonEmpty(descriptor.clientId, 'Presentation descriptor.clientId')
  if (!Array.isArray(descriptor.contracts)) throw new TypeError('Presentation descriptor.contracts must be an array')
  const seen = new Set<string>()
  for (const [index, contractValue] of descriptor.contracts.entries()) {
    const contract = exactRecord(contractValue, ['apiVersion', 'kind', 'spec'], ['apiVersion', 'kind'], `Presentation descriptor.contracts[${index}]`)
    nonEmpty(contract.apiVersion, `Presentation descriptor.contracts[${index}].apiVersion`)
    nonEmpty(contract.kind, `Presentation descriptor.contracts[${index}].kind`)
    const key = `${String(contract.apiVersion)}\0${String(contract.kind)}`
    if (seen.has(key)) throw new TypeError(`Presentation descriptor contains duplicate contract ${JSON.stringify(key)}`)
    seen.add(key)
  }
}

export function validateOpenExternalRequest(value: unknown): asserts value is OpenExternalRequest {
  const request = requestRecord(value, ['uri'], 'OpenExternal request')
  nonEmpty(request.uri, 'OpenExternal request.uri')
  const uri = new URL(request.uri as string)
  if (uri.protocol !== 'https:' && uri.protocol !== 'http:') throw new TypeError('OpenExternal only accepts HTTP(S) URIs')
}

export function validateCopyTextRequest(value: unknown): asserts value is CopyTextRequest {
  const request = requestRecord(value, ['text', 'sensitivity'], 'CopyText request')
  nonEmpty(request.text, 'CopyText request.text')
  if (request.sensitivity !== undefined && request.sensitivity !== 'public' && request.sensitivity !== 'private') {
    throw new TypeError('CopyText request.sensitivity is invalid')
  }
}

export function validateNotificationRequest(value: unknown): asserts value is NotificationRequest {
  const request = requestRecord(value, ['text', 'level', 'deduplicationKey'], 'Notification request')
  nonEmpty(request.text, 'Notification request.text')
  if (request.level !== undefined && request.level !== 'info' && request.level !== 'warning' && request.level !== 'error') {
    throw new TypeError('Notification request.level is invalid')
  }
  if (request.deduplicationKey !== undefined) nonEmpty(request.deduplicationKey, 'Notification request.deduplicationKey')
}

export function validateUserInteractionRequest(value: unknown): asserts value is UserInteractionRequest {
  if (!record(value)) throw new TypeError('UserInteraction request must be an object')
  if (value.kind === 'question') return validateQuestionRequest(value)
  if (value.kind === 'approval') return validateApprovalRequest(value)
  if (value.kind === 'secret-input') return validateSecretInputRequest(value)
  throw new TypeError('UserInteraction request.kind is invalid')
}

export function validateUserInteractionRequirement(value: unknown): UserInteractionRequirementSpec {
  const spec = exactRecord(value, ['operations', 'optionalOperations'], ['operations'], 'UserInteraction requirement spec')
  const operations = operationList(spec.operations, 'UserInteraction requirement spec.operations')
  const optionalOperations = spec.optionalOperations === undefined
    ? undefined
    : operationList(spec.optionalOperations, 'UserInteraction requirement spec.optionalOperations')
  if (optionalOperations?.some(operation => operations.includes(operation)) === true) {
    throw new TypeError('UserInteraction optionalOperations must not duplicate required operations')
  }
  return deepFreeze({ operations, ...(optionalOperations === undefined ? {} : { optionalOperations }) })
}

export function validateUserInteractionSupport(value: unknown): UserInteractionSupportSpec {
  const spec = exactRecord(value, ['operations', 'limits'], ['operations'], 'UserInteraction support spec')
  const operations = operationList(spec.operations, 'UserInteraction support spec.operations')
  const limits = spec.limits === undefined ? undefined : validateLimits(spec.limits)
  return deepFreeze({ operations, ...(limits === undefined ? {} : { limits }) })
}

function negotiateUserInteraction(
  input: ProtocolNegotiationInput<UserInteractionRequirementSpec, UserInteractionSupportSpec>,
) {
  const issues: ProtocolIssue[] = []
  const bindings: Array<{
    readonly consumer: string
    readonly provider: string
    readonly requirement: ProtocolRequirement<UserInteractionRequirementSpec>
    readonly support: ProtocolSupport<UserInteractionSupportSpec>
  }> = []
  const connectionPolicy = connectionNegotiationPolicy(input.policy)
  for (const row of input.requirements) {
    const consumerEndpoint = connectionPolicy?.endpointByParticipant[row.participant]
    const candidates = input.supports.filter(candidate => {
      if (candidate.participant === row.participant) return false
      if (consumerEndpoint !== undefined && connectionPolicy?.endpointByParticipant[candidate.participant] === consumerEndpoint) return false
      return row.requirement.spec!.operations.every(operation => candidate.support.spec!.operations.includes(operation))
    })
    if (candidates.length === 0) {
      issues.push(Object.freeze({
        code: row.requirement.optional === true ? 'optional-support-missing' : 'required-support-missing',
        severity: row.requirement.optional === true ? 'warning' : 'error',
        participant: row.participant,
        message: `no participant supports the required ${USER_INTERACTION_KIND} operations`,
      }))
      continue
    }
    if (candidates.length > 1) {
      issues.push(Object.freeze({
        code: 'support-ambiguous', severity: 'error', participant: row.participant,
        message: `multiple participants support ${API_VERSION} ${USER_INTERACTION_KIND}`,
      }))
      continue
    }
    const provider = candidates[0]!
    bindings.push(Object.freeze({
      consumer: row.participant,
      provider: provider.participant,
      requirement: row.requirement,
      support: provider.support,
    }))
    for (const operation of row.requirement.spec!.optionalOperations ?? []) {
      if (provider.support.spec!.operations.includes(operation)) continue
      issues.push(Object.freeze({
        code: 'optional-operation-missing', severity: 'warning', participant: row.participant,
        message: `${USER_INTERACTION_KIND} provider does not support optional operation ${JSON.stringify(operation)}`,
      }))
    }
  }
  return {
    agreement: Object.freeze({ kind: 'CapabilityBindings' as const, bindings: Object.freeze(bindings) }),
    issues: Object.freeze(issues),
  }
}

function connectionNegotiationPolicy(value: unknown): ConnectionNegotiationPolicy | undefined {
  return record(value) && record(value.endpointByParticipant)
    ? value as unknown as ConnectionNegotiationPolicy
    : undefined
}

function implementation<TInput, TOutput>(
  participantId: string,
  protocol: ProtocolSupport,
  operationName: string,
  validateInput: (value: unknown) => asserts value is TInput,
  handler: (input: TInput, context: CapabilityHandlerContext) => TOutput | Promise<TOutput>,
  validateOutput: (value: unknown) => TOutput,
): CapabilityImplementation {
  return Object.freeze({
    participantId,
    protocol,
    async handle(operation: string, input: unknown, context: CapabilityHandlerContext) {
      if (operation !== operationName) throw new TypeError(`unsupported ${protocol.kind} operation ${JSON.stringify(operation)}`)
      validateInput(input)
      return validateOutput(await handler(input, context))
    },
  })
}

function validateQuestionRequest(value: unknown): asserts value is QuestionRequest {
  const request = requestRecord(value, ['kind', 'title', 'description', 'fields'], 'Question request')
  if (request.kind !== 'question') throw new TypeError('Question request.kind must be "question"')
  optionalText(request.title, 'Question request.title')
  optionalText(request.description, 'Question request.description')
  if (!Array.isArray(request.fields) || request.fields.length === 0) throw new TypeError('Question request.fields must be a non-empty array')
  const ids = new Set<string>()
  for (const [index, fieldValue] of request.fields.entries()) {
    const label = `Question request.fields[${index}]`
    if (!record(fieldValue)) throw new TypeError(`${label} must be an object`)
    const common = ['id', 'kind', 'label', 'description', 'required']
    const allowed = fieldValue.kind === 'text' ? [...common, 'multiline', 'minLength', 'maxLength']
      : fieldValue.kind === 'select' ? [...common, 'multiple', 'options'] : common
    const field = exactRecord(fieldValue, allowed, ['id', 'kind', 'label'], label)
    localId(field.id, `${label}.id`)
    if (ids.has(field.id as string)) throw new TypeError('Question request contains duplicate field id')
    ids.add(field.id as string)
    nonEmpty(field.label, `${label}.label`)
    optionalText(field.description, `${label}.description`)
    optionalBoolean(field.required, `${label}.required`)
    if (field.kind === 'text') {
      optionalBoolean(field.multiline, `${label}.multiline`)
      lengthBounds(field.minLength, field.maxLength, label)
    } else if (field.kind === 'select') {
      optionalBoolean(field.multiple, `${label}.multiple`)
      if (!Array.isArray(field.options) || field.options.length === 0) throw new TypeError(`${label}.options must be a non-empty array`)
      const options = new Set<string>()
      for (const [optionIndex, optionValue] of field.options.entries()) {
        const optionLabel = `${label}.options[${optionIndex}]`
        const option = exactRecord(optionValue, ['id', 'label', 'description'], ['id', 'label'], optionLabel)
        localId(option.id, `${optionLabel}.id`)
        if (options.has(option.id as string)) throw new TypeError(`${label} contains duplicate option id`)
        options.add(option.id as string)
        nonEmpty(option.label, `${optionLabel}.label`)
        optionalText(option.description, `${optionLabel}.description`)
      }
    } else if (field.kind !== 'confirm') {
      throw new TypeError(`${label}.kind is invalid`)
    }
  }
}

function validateApprovalRequest(value: unknown): asserts value is ApprovalRequest {
  const request = requestRecord(value, ['kind', 'action', 'summary', 'details', 'risk'], 'Approval request')
  if (request.kind !== 'approval') throw new TypeError('Approval request.kind must be "approval"')
  nonEmpty(request.action, 'Approval request.action')
  nonEmpty(request.summary, 'Approval request.summary')
  if (request.risk !== undefined && request.risk !== 'low' && request.risk !== 'medium' && request.risk !== 'high') {
    throw new TypeError('Approval request.risk is invalid')
  }
  if (request.details !== undefined) {
    if (!Array.isArray(request.details)) throw new TypeError('Approval request.details must be an array')
    for (const [index, detailValue] of request.details.entries()) {
      const label = `Approval request.details[${index}]`
      const detail = exactRecord(detailValue, ['label', 'value', 'sensitivity'], ['label', 'value'], label)
      nonEmpty(detail.label, `${label}.label`)
      nonEmpty(detail.value, `${label}.value`)
      if (detail.sensitivity !== undefined && detail.sensitivity !== 'public' && detail.sensitivity !== 'private') {
        throw new TypeError(`${label}.sensitivity is invalid`)
      }
    }
  }
}

function validateSecretInputRequest(value: unknown): asserts value is SecretInputRequest {
  const request = requestRecord(value, ['kind', 'label', 'description', 'minLength', 'maxLength'], 'SecretInput request')
  if (request.kind !== 'secret-input') throw new TypeError('SecretInput request.kind must be "secret-input"')
  nonEmpty(request.label, 'SecretInput request.label')
  optionalText(request.description, 'SecretInput request.description')
  lengthBounds(request.minLength, request.maxLength, 'SecretInput request')
}

function validateInteractionResult(
  request: UserInteractionRequest,
  value: unknown,
): PresentationResult<UserInteractionValue> {
  if (request.kind === 'question') return validatePresentationResult(value, result => validateQuestionAnswers(request, result), 'Question result')
  if (request.kind === 'approval') return validatePresentationResult(value, validateApprovalValue, 'Approval result')
  return validatePresentationResult(value, result => validateSecretInputValue(request, result), 'SecretInput result')
}

function validateQuestionAnswers(request: QuestionRequest, value: unknown): QuestionAnswers {
  const result = exactRecord(value, ['answers'], ['answers'], 'Question answers')
  if (!record(result.answers)) throw new TypeError('Question answers.answers must be an object')
  const fields = new Map(request.fields.map(field => [field.id, field]))
  for (const field of request.fields) {
    if (field.required === true && !Object.hasOwn(result.answers, field.id)) throw new TypeError(`Question answers is missing required field ${JSON.stringify(field.id)}`)
  }
  for (const [id, answer] of Object.entries(result.answers)) {
    const field = fields.get(id)
    if (field === undefined) throw new TypeError(`Question answers contains unknown field ${JSON.stringify(id)}`)
    if (field.kind === 'text') {
      if (typeof answer !== 'string') throw new TypeError(`Question answer ${JSON.stringify(id)} must be a string`)
      if (field.minLength !== undefined && answer.length < field.minLength) throw new TypeError(`Question answer ${JSON.stringify(id)} is too short`)
      if (field.maxLength !== undefined && answer.length > field.maxLength) throw new TypeError(`Question answer ${JSON.stringify(id)} is too long`)
    } else if (field.kind === 'confirm') {
      if (typeof answer !== 'boolean') throw new TypeError(`Question answer ${JSON.stringify(id)} must be boolean`)
    } else {
      const allowed = new Set(field.options.map(option => option.id))
      const selected = field.multiple === true ? answer : [answer]
      if (!Array.isArray(selected) || selected.some(option => typeof option !== 'string' || !allowed.has(option))) {
        throw new TypeError(`Question answer ${JSON.stringify(id)} contains an invalid option`)
      }
    }
  }
  return freezeClone(value as QuestionAnswers)
}

function validateApprovalValue(value: unknown): ApprovalValue {
  const result = exactRecord(value, ['decision'], ['decision'], 'Approval value')
  if (result.decision !== 'approved' && result.decision !== 'denied') throw new TypeError('Approval value.decision is invalid')
  return freezeClone(value as ApprovalValue)
}

function validateSecretInputValue(request: SecretInputRequest, value: unknown): SecretInputValue {
  const result = exactRecord(value, ['secret'], ['secret'], 'SecretInput value')
  if (typeof result.secret !== 'string') throw new TypeError('SecretInput value.secret must be a string')
  if (request.minLength !== undefined && result.secret.length < request.minLength) throw new TypeError('SecretInput value.secret is too short')
  if (request.maxLength !== undefined && result.secret.length > request.maxLength) throw new TypeError('SecretInput value.secret is too long')
  return freezeClone(value as SecretInputValue)
}

function validatePresentationResult<T>(
  value: unknown,
  validateSubmitted: (submitted: unknown) => T,
  label: string,
): PresentationResult<T> {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  if (value.status === 'submitted') {
    const result = exactRecord(value, ['status', 'value'], ['status', 'value'], label)
    return deepFreeze({ status: 'submitted' as const, value: validateSubmitted(result.value) })
  }
  if (value.status === 'unavailable') {
    const result = exactRecord(value, ['status', 'reason'], ['status'], label)
    optionalText(result.reason, `${label}.reason`)
    return freezeClone(value as PresentationResult<T>)
  }
  if (value.status === 'cancelled' || value.status === 'expired') {
    exactRecord(value, ['status'], ['status'], label)
    return freezeClone(value as PresentationResult<T>)
  }
  throw new TypeError(`${label}.status is invalid`)
}

function validateAcceptedReceipt(value: unknown): { readonly accepted: true } {
  const receipt = exactRecord(value, ['accepted'], ['accepted'], 'Presentation receipt')
  if (receipt.accepted !== true) throw new TypeError('Presentation receipt.accepted must be true')
  return Object.freeze({ accepted: true })
}

function requestRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  const required = ['requestId', 'invocationId', 'origin', ...fields.filter(field => !['title', 'description', 'details', 'risk', 'level', 'deduplicationKey', 'sensitivity', 'minLength', 'maxLength'].includes(field))]
  const request = exactRecord(value, ['requestId', 'invocationId', 'origin', 'deadline', ...fields], required, label)
  nonEmpty(request.requestId, `${label}.requestId`)
  nonEmpty(request.invocationId, `${label}.invocationId`)
  nonEmpty(request.origin, `${label}.origin`)
  if (request.deadline !== undefined && (typeof request.deadline !== 'string' || Number.isNaN(Date.parse(request.deadline)))) {
    throw new TypeError(`${label}.deadline must be an RFC 3339 date-time`)
  }
  return request
}

function validateLimits(value: unknown): UserInteractionLimits {
  const limits = exactRecord(
    value,
    ['maxConcurrentRequests', 'maxFields', 'maxOptionsPerField', 'maxTextLength'],
    [],
    'UserInteraction limits',
  )
  for (const [name, limit] of Object.entries(limits)) positiveInteger(limit, `UserInteraction limits.${name}`)
  return freezeClone(value as UserInteractionLimits)
}

function operationList(value: unknown, label: string): readonly UserInteractionOperation[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`)
  const operations = value.map(operation => {
    if (operation !== 'question' && operation !== 'approval' && operation !== 'secret-input') throw new TypeError(`${label} contains an invalid operation`)
    return operation
  })
  if (new Set(operations).size !== operations.length) throw new TypeError(`${label} contains a duplicate operation`)
  return Object.freeze(operations)
}

function lengthBounds(minimum: unknown, maximum: unknown, label: string): void {
  if (minimum !== undefined) nonNegativeInteger(minimum, `${label}.minLength`)
  if (maximum !== undefined) nonNegativeInteger(maximum, `${label}.maxLength`)
  if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
    throw new TypeError(`${label}.minLength must not exceed maxLength`)
  }
}

function exactRecord(value: unknown, allowed: readonly string[], required: readonly string[], label: string): Record<string, unknown> {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}`)
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${label}.${key} is required`)
  return value
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`)
}

function validateInvocationScope(scope: PresentationInvocationScope): void {
  if (!record(scope)) throw new TypeError('Presentation invocation scope must be an object')
  nonEmpty(scope.invocationId, 'Presentation invocation scope.invocationId')
  nonEmpty(scope.origin, 'Presentation invocation scope.origin')
  if (scope.deadline !== undefined && (typeof scope.deadline !== 'string' || Number.isNaN(Date.parse(scope.deadline)))) {
    throw new TypeError('Presentation invocation scope.deadline must be an RFC 3339 date-time')
  }
  if (typeof scope.nextRequestId !== 'function') throw new TypeError('Presentation invocation scope.nextRequestId must be a function')
}

function requestFactory(scope: PresentationInvocationScope) {
  validateInvocationScope(scope)
  return <T extends object>(input: T): Readonly<T & PresentationRequestContext> => {
    if (!record(input)) throw new TypeError('Presentation input must be an object')
    const requestId = scope.nextRequestId()
    nonEmpty(requestId, 'Presentation requestId')
    return freezeClone({
      ...input,
      requestId,
      invocationId: scope.invocationId,
      origin: scope.origin,
      ...(scope.deadline === undefined ? {} : { deadline: scope.deadline }),
    })
  }
}

function optionalText(value: unknown, label: string): void {
  if (value !== undefined) nonEmpty(value, label)
}

function optionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`)
}

function localId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)) throw new TypeError(`${label} is invalid`)
}

function positiveInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError(`${label} must be a positive safe integer`)
}

function nonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative safe integer`)
}

function freezeClone<T>(value: T): T { return deepFreeze(structuredClone(value)) }

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
