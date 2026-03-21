import { eq, desc } from 'drizzle-orm'
import type {
  Todo,
  CreateTodoInput,
  UpdateTodoInput,
  TodoAttachment,
  TodoWithAttachments,
} from '@shared/schemas'
import { getDb } from '../../db'
import { todos, todoAttachments, type TodoTable, type TodoAttachmentTable } from '../../db/schema'
import { toISOString } from '../../utils/date'
import { saveFile, deleteFile, validateFile, getUploadConfig } from '../../utils/file-storage'

const TODO_NAMESPACE = 'todos'

export async function listTodos(): Promise<Todo[]> {
  const db = await getDb()
  const rows = await db.select().from(todos).orderBy(desc(todos.createdAt))
  return rows.map((row: TodoTable) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  }))
}

export async function getTodo(id: number): Promise<Todo | null> {
  const db = await getDb()
  const rows = await db.select().from(todos).where(eq(todos.id, id))
  const row = rows[0]

  if (!row) return null

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  }
}

export async function createTodo(input: CreateTodoInput): Promise<Todo> {
  const db = await getDb()
  const now = new Date()
  const result = await db
    .insert(todos)
    .values({
      title: input.title,
      description: input.description ?? null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  const row = result[0]
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  }
}

export async function updateTodo(id: number, input: UpdateTodoInput): Promise<Todo | null> {
  const db = await getDb()
  const now = new Date()
  const updateData: Partial<TodoTable> = {
    updatedAt: now,
  }

  if (input.title !== undefined) {
    updateData.title = input.title
  }
  if (input.description !== undefined) {
    updateData.description = input.description
  }
  if (input.status !== undefined) {
    updateData.status = input.status
  }

  const result = await db.update(todos).set(updateData).where(eq(todos.id, id)).returning()

  if (result.length === 0) return null

  const row = result[0]
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    createdAt: toISOString(row.createdAt),
    updatedAt: toISOString(row.updatedAt),
  }
}

export async function deleteTodo(id: number): Promise<boolean> {
  const db = await getDb()

  const attachments = await db.select().from(todoAttachments).where(eq(todoAttachments.todoId, id))

  for (const attachment of attachments) {
    await deleteFile(attachment.path)
  }

  const result = await db.delete(todos).where(eq(todos.id, id)).returning()
  return result.length > 0
}

export async function uploadAttachment(
  todoId: number,
  file: { name: string; type: string; size: number; data: ArrayBuffer },
  uploadedBy?: string
): Promise<TodoAttachment> {
  const db = await getDb()

  const config = getUploadConfig(TODO_NAMESPACE)
  const validation = validateFile(file, config)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const uploadedFile = await saveFile(TODO_NAMESPACE, file)

  const now = new Date()
  const result = await db
    .insert(todoAttachments)
    .values({
      todoId,
      fileName: uploadedFile.filename,
      originalName: uploadedFile.originalName,
      mimeType: uploadedFile.mimeType,
      size: uploadedFile.size,
      path: uploadedFile.path,
      uploadedBy: uploadedBy ?? null,
      createdAt: now,
    })
    .returning()

  const row = result[0]
  return {
    id: row.id,
    todoId: row.todoId,
    fileName: row.fileName,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    path: row.path,
    uploadedBy: row.uploadedBy ?? undefined,
    createdAt: toISOString(row.createdAt),
  }
}

export async function listAttachments(todoId: number): Promise<TodoAttachment[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(todoAttachments)
    .where(eq(todoAttachments.todoId, todoId))
    .orderBy(desc(todoAttachments.createdAt))

  return rows.map((row: TodoAttachmentTable) => ({
    id: row.id,
    todoId: row.todoId,
    fileName: row.fileName,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    path: row.path,
    uploadedBy: row.uploadedBy ?? undefined,
    createdAt: toISOString(row.createdAt),
  }))
}

export async function getTodoWithAttachments(id: number): Promise<TodoWithAttachments | null> {
  const todo = await getTodo(id)
  if (!todo) return null

  const attachments = await listAttachments(id)
  return { ...todo, attachments }
}

export async function deleteAttachment(attachmentId: number): Promise<boolean> {
  const db = await getDb()

  const rows = await db.select().from(todoAttachments).where(eq(todoAttachments.id, attachmentId))

  if (rows.length === 0) return false

  const attachment = rows[0]

  await deleteFile(attachment.path)

  await db.delete(todoAttachments).where(eq(todoAttachments.id, attachmentId))
  return true
}
