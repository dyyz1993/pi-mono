import type { ChannelContract } from "@dyyz1993/pi-coding-agent";

export const COORDINATOR_CHANNEL_NAME = "coordinator";

export type SessionStatus = "idle" | "streaming" | "stopped" | "completed";

export interface DelegatedTask {
  sessionId: string;
  title: string;
  task: string;
  projectPath: string;
  dispatchedAt: number;
  status: SessionStatus;
  completedAt?: number;
  result?: string;
}

export interface DelegateCreateResult {
  sessionId: string;
  status: "started" | "already_running";
}

export interface DelegateSendResult {
  delivered: boolean;
  targetStatus: "active" | "started" | "not_found";
}

export interface DelegateListResult {
  tasks: DelegatedTask[];
}

export interface DelegateStatusExt {
  task: DelegatedTask | null;
  isCompacting?: boolean;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

export interface CoordinatorChannelContract extends ChannelContract {
  methods: {
    session_delegate: {
      params: { task: string; title?: string; projectPath?: string };
      return: DelegateCreateResult;
    };
    session_delegate_send: {
      params: { targetSessionId: string; message: string };
      return: DelegateSendResult;
    };
    session_delegate_status: {
      params: { sessionId: string };
      return: DelegateStatusExt;
    };
    session_delegate_list: {
      params: Record<string, never>;
      return: DelegateListResult;
    };
    session_delegate_stop: {
      params: { sessionId: string };
      return: { ok: boolean };
    };
    session_delegate_remove: {
      params: { sessionId: string };
      return: { ok: boolean };
    };
    session_delegate_clear_stopped: {
      params: Record<string, never>;
      return: { removed: number };
    };
    session_delegate_fork: {
      params: { sessionId: string; task: string; title?: string; projectPath?: string };
      return: DelegateCreateResult;
    };
  };
  events: {
    message_received: { fromSessionId: string; message: string };
    task_started: { sessionId: string; title: string; task: string };
    task_stopped: { sessionId: string };
    task_completed: { sessionId: string; result?: string };
    task_error: { sessionId: string; error: string };
  };
}
