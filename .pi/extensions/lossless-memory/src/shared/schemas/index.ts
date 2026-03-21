// Re-export global types for convenience (these are declared in types/global.d.ts)
export type { WSClient, WSProtocol, SSEProtocol, SSEClient, WSStatus }

// Re-export core
export {
  ApiSuccessSchema,
  ApiErrorSchema,
  ApiResponseSchema,
  type ApiSuccess,
  type ApiError,
  type ApiResponse,
  type RpcMethod,
  type EventName,
  type RpcInput,
  type RpcOutput,
  type EventPayload,
  createWSClient,
  createSSEClient,
} from '../core'

// Re-export modules
export {
  ChatProtocolSchema,
  WebSocketStatusSchema,
  type ChatProtocol,
  type WebSocketStatus,
} from '../modules/chat'
export {
  FileDownloadSchema,
  PrivateFileQuerySchema,
  PublicFileUrlSchema,
  PrivateFileUrlSchema,
  GenerateUrlRequestSchema,
  FileUrlResponseSchema,
  EmptySchema,
} from '../modules/files'
export {
  TodoSchema,
  TodoStatusSchema,
  CreateTodoSchema,
  UpdateTodoSchema,
  TodoIdSchema,
  TodoIdResponseSchema,
  TodoAttachmentSchema,
  TodoAttachmentListSchema,
  TodoWithAttachmentsSchema,
  UploadFileSchema,
  AttachmentIdResponseSchema,
  type Todo,
  type TodoStatus,
  type CreateTodoInput,
  type UpdateTodoInput,
  type TodoIdResponse,
  type TodoAttachment,
  type TodoWithAttachments,
} from '../modules/todos'
export {
  NotificationSchema,
  NotificationTypeSchema,
  CreateNotificationSchema,
  NotificationListQuerySchema,
  SSEEventSchema,
  AppSSEProtocolSchema,
  UnreadCountSchema,
  NotificationIdSchema,
  UnreadCountEventSchema,
  type AppNotification,
  type NotificationType,
  type CreateNotificationInput,
  type NotificationListQuery,
  type SSEEvent,
  type AppSSEProtocol,
  type UnreadCount,
  type NotificationId,
  type UnreadCountEvent,
} from '../modules/notifications'
