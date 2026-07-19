/**
 * Test kit for the learning extension.
 *
 * Centralizes the fake-pi / fake-channel / event-emitter boilerplate that
 * every harness test used to reinvent. The fakes are intentionally minimal:
 * they implement only the surface area the learning extension touches.
 *
 * Usage:
 *   const { pi, handlers, channel, outputs } = createLearningTestRuntime();
 *   await emit(handlers, "session_start", {});
 *   const result = await callMethod(pi, "learning.listCandidates");
 */

import { vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/types.ts";

/** Event handler registry: event name → registered handlers. */
export type HandlerRegistry = Record<string, Array<(event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>>>;

/** A captured channel output message. */
export interface ChannelOutput {
  type: string;
  payload: unknown;
}

export interface FakeChannel {
  name: string;
  send: ReturnType<typeof vi.fn>;
  onReceive: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
}

export interface LearningTestRuntime {
  /** Fake pi with all the methods learning extension touches. */
  pi: ExtensionAPI;
  /** Event handler registry (so tests can emit events). */
  handlers: HandlerRegistry;
  /** Capturing channel (records emit() calls). */
  channel: FakeChannel;
  /** Captured channel outputs (pushed by channel.send). */
  outputs: ChannelOutput[];
}

/**
 * Create a minimal fake channel that records send/invoke/call invocations.
 */
export function createFakeChannel(outputs: ChannelOutput[] = []): FakeChannel {
  return {
    name: "test-channel",
    send: vi.fn((type: string, payload: unknown) => {
      outputs.push({ type, payload });
    }),
    onReceive: vi.fn(() => () => {}),
    invoke: vi.fn(async () => ({})),
    call: vi.fn(async () => ({})),
  };
}

/**
 * Create a fake pi object pre-populated with sensible defaults for learning
 * extension tests. Override any field via `overrides`.
 *
 * The returned object is typed as ExtensionAPI via `as unknown` because the
 * fake doesn't implement every method — only the ones learning uses.
 */
export function createFakePi(
  handlers: HandlerRegistry,
  channel: FakeChannel,
  overrides: Partial<ExtensionAPI> = {},
): ExtensionAPI {
  const fakeCallLLM = vi.fn(async () => JSON.stringify({ selected: [] }));
  return {
    on: vi.fn((event: string, handler: (event: unknown, context: ExtensionContext) => unknown | Promise<unknown>) => {
      handlers[event] ??= [];
      handlers[event]!.push(handler);
    }),
    callLLM: fakeCallLLM,
    callLLMSafe: fakeCallLLM,
    registerTool: vi.fn(),
    registerChannel: vi.fn(() => channel),
    registerCommand: vi.fn(),
    appendEntry: vi.fn((customType: string, _data?: unknown) => {
      void customType;
    }),
    ...overrides,
  } as unknown as ExtensionAPI;
}

/**
 * Create a complete learning test runtime: fake pi + handler registry +
 * capturing channel. Returns everything a harness test needs.
 */
export function createLearningTestRuntime(
  overrides: Partial<ExtensionAPI> = {},
): LearningTestRuntime {
  const handlers: HandlerRegistry = {};
  const outputs: ChannelOutput[] = [];
  const channel = createFakeChannel(outputs);
  const pi = createFakePi(handlers, channel, overrides);
  return { pi, handlers, channel, outputs };
}

/**
 * Emit an event to all registered handlers for that event type.
 *
 * Learning extension's real handlers are async; this awaits them all.
 */
export async function emit(
  handlers: HandlerRegistry,
  event: string,
  payload: unknown,
  ctx?: Partial<ExtensionContext>,
): Promise<void> {
  const fakeCtx = { cwd: process.cwd(), projectRoot: process.cwd(), ...ctx } as ExtensionContext;
  const list = handlers[event] ?? [];
  await Promise.all(list.map((h) => h(payload, fakeCtx)));
}

/**
 * Reset all mock call counts. Useful between subtests that share a runtime.
 */
export function resetMocks(runtime: LearningTestRuntime): void {
  for (const fn of [runtime.channel.send, runtime.channel.invoke, runtime.channel.call]) {
    (fn as unknown as { mockClear?: () => void }).mockClear?.();
  }
}
