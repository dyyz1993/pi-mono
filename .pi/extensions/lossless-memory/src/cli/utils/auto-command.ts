import { Command } from 'commander'
import type { ZodType, ZodObject, ZodOptional } from 'zod'
import { getClient } from './api'
import { getLogger } from './logger'

type RouteConfig = {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch'
  path: string
  command: string
  description: string
  params?: ZodObject<Record<string, ZodType>>
  body?: ZodType
  query?: ZodObject<Record<string, ZodType>>
}

type CliCommandConfig = {
  name: string
  description: string
  action: (options: Record<string, unknown>, args: string[]) => Promise<void>
  options?: Array<{
    flags: string
    description: string
    required?: boolean
    defaultValue?: string
  }>
  arguments?: Array<{
    name: string
    description: string
    required?: boolean
  }>
}

function extractZodInfo(schema: ZodType): {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'object'
  required: boolean
  enumValues?: string[]
  defaultValue?: unknown
} {
  const def = (schema as unknown as { _def: { typeName: string } })._def

  if (def.typeName === 'ZodOptional') {
    const inner = (schema as ZodOptional<ZodType>)._def.innerType
    const info = extractZodInfo(inner)
    return { ...info, required: false }
  }

  if (def.typeName === 'ZodDefault') {
    const innerDef = (
      schema as unknown as { _def: { innerType: ZodType; defaultValue: () => unknown } }
    )._def
    const defaultValue = innerDef.defaultValue()
    const info = extractZodInfo(innerDef.innerType)
    return { ...info, required: false, defaultValue }
  }

  if (def.typeName === 'ZodEnum') {
    const enumValues = [...(schema as unknown as { _def: { values: string[] } })._def.values]
    return { type: 'enum', required: true, enumValues }
  }

  if (def.typeName === 'ZodString') return { type: 'string', required: true }
  if (def.typeName === 'ZodNumber') return { type: 'number', required: true }
  if (def.typeName === 'ZodBoolean') return { type: 'boolean', required: true }
  if (def.typeName === 'ZodObject') return { type: 'object', required: true }

  return { type: 'string', required: true }
}

function schemaToOptions(schema: ZodObject<Record<string, ZodType>>): CliCommandConfig['options'] {
  const options: CliCommandConfig['options'] = []
  const shape = schema.shape

  for (const [key, zodType] of Object.entries(shape)) {
    const info = extractZodInfo(zodType as ZodType)
    const longFlag = key.replace(/([A-Z])/g, '-$1').toLowerCase()

    let flags = `--${longFlag} <value>`
    if (info.type === 'boolean') {
      flags = `--${longFlag}`
    }

    let description: string = String(info.type)
    if (info.enumValues) {
      description = `${info.type} (${info.enumValues.join('|')})`
    }

    options.push({
      flags,
      description,
      required: info.required,
      defaultValue: info.defaultValue as string | undefined,
    })
  }

  return options
}

function pathToApiCall(client: ReturnType<typeof getClient>, _method: string, path: string) {
  const pathParts = path.split('/').filter(Boolean)
  let current: unknown = client.api

  for (const part of pathParts) {
    if (part.startsWith('{') && part.endsWith('}')) {
      continue
    }
    current =
      (current as Record<string, unknown>)[part] || (current as Record<string, unknown>)[`:${part}`]
  }

  return current as Record<
    string,
    (args: {
      param?: Record<string, string>
      query?: Record<string, string>
      json?: Record<string, unknown>
    }) => Promise<Response>
  >
}

export function createCommandFromRoute(config: RouteConfig): CliCommandConfig {
  const options: CliCommandConfig['options'] = []
  const arguments_: CliCommandConfig['arguments'] = []

  if (config.params) {
    const shape = config.params.shape
    for (const [key] of Object.entries(shape)) {
      arguments_.push({
        name: key,
        description: `${key} parameter`,
        required: true,
      })
    }
  }

  if (config.body) {
    const bodySchema = config.body as ZodObject<Record<string, ZodType>>
    if (bodySchema.shape) {
      options.push(...(schemaToOptions(bodySchema) || []))
    }
  }

  if (config.query) {
    options.push(...(schemaToOptions(config.query) || []))
  }

  return {
    name: config.command,
    description: config.description,
    options,
    arguments: arguments_,
    action: async (opts: Record<string, unknown>, args: string[]) => {
      const logger = getLogger()
      const client = getClient()

      const param: Record<string, string> = {}
      if (config.params) {
        const shape = config.params.shape
        const keys = Object.keys(shape)
        keys.forEach((key, i) => {
          param[key] = args[i] || String(opts[key])
        })
      }

      const json: Record<string, unknown> = {}
      if (config.body && opts) {
        const bodySchema = config.body as ZodObject<Record<string, ZodType>>
        if (bodySchema.shape) {
          const shape = bodySchema.shape
          for (const key of Object.keys(shape)) {
            if (opts[key] !== undefined) {
              json[key] = opts[key]
            }
          }
        }
      }

      const query: Record<string, string> = {}
      if (config.query && opts) {
        const shape = config.query.shape
        for (const key of Object.keys(shape)) {
          if (opts[key] !== undefined) {
            query[key] = String(opts[key])
          }
        }
      }

      const apiCall = pathToApiCall(client, config.method, config.path)
      const methodCall =
        apiCall[`$${config.method.charAt(0).toUpperCase() + config.method.slice(1)}`] ||
        apiCall.$get

      const res = await methodCall.call(apiCall, {
        param: Object.keys(param).length > 0 ? param : undefined,
        query: Object.keys(query).length > 0 ? query : undefined,
        json: Object.keys(json).length > 0 ? json : undefined,
      })

      const data = await res.json()
      logger.info(JSON.stringify(data, null, 2))
    },
  }
}

export function registerAutoCommand(program: Command, config: RouteConfig) {
  const cmd = createCommandFromRoute(config)

  const command = program
    .command(cmd.name)
    .description(cmd.description)
    .action(async (firstArg, opts) => {
      const args = typeof firstArg === 'string' ? [firstArg] : []
      const options = (typeof firstArg === 'object' ? firstArg : opts) || {}
      await cmd.action(options, args)
    })

  cmd.options?.forEach(opt => {
    if (opt.required) {
      command.requiredOption(opt.flags, opt.description, opt.defaultValue)
    } else {
      command.option(opt.flags, opt.description, opt.defaultValue)
    }
  })

  cmd.arguments?.forEach(arg => {
    command.argument(arg.required ? `<${arg.name}>` : `[${arg.name}]`, arg.description)
  })
}

export { type RouteConfig, type CliCommandConfig }
