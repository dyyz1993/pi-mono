import type { NewPermissionAuditLog } from '../../db/schema/permission-audit-logs'
import { getDb } from '../../db'
import { permissionAuditLogs } from '../../db/schema'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import { transformAuditLog } from '../../utils/date'

export class AuditLogService {
  async create(data: NewPermissionAuditLog): Promise<ReturnType<typeof transformAuditLog>> {
    const db = await getDb()
    const rows = await db
      .insert(permissionAuditLogs)
      .values({
        ...data,
        createdAt: new Date(),
      })
      .returning()
    return transformAuditLog(rows[0])
  }

  async getAll(limit = 50, offset = 0): Promise<ReturnType<typeof transformAuditLog>[]> {
    const db = await getDb()
    const rows = await db
      .select()
      .from(permissionAuditLogs)
      .orderBy(desc(permissionAuditLogs.createdAt))
      .limit(limit)
      .offset(offset)
    return rows.map(transformAuditLog)
  }

  async getByUserId(userId: string, limit = 50): Promise<ReturnType<typeof transformAuditLog>[]> {
    const db = await getDb()
    const rows = await db
      .select()
      .from(permissionAuditLogs)
      .where(eq(permissionAuditLogs.userId, userId))
      .orderBy(desc(permissionAuditLogs.createdAt))
      .limit(limit)
    return rows.map(transformAuditLog)
  }

  async getByResource(
    resourceType: string,
    resourceId?: string
  ): Promise<ReturnType<typeof transformAuditLog>[]> {
    const db = await getDb()
    const conditions = [eq(permissionAuditLogs.resourceType, resourceType)]
    if (resourceId) {
      conditions.push(eq(permissionAuditLogs.resourceId, resourceId))
    }
    const rows = await db
      .select()
      .from(permissionAuditLogs)
      .where(and(...conditions))
      .orderBy(desc(permissionAuditLogs.createdAt))
    return rows.map(transformAuditLog)
  }

  async search(query: {
    userId?: string
    action?: string
    resourceType?: string
    startDate?: Date
    endDate?: Date
  }): Promise<ReturnType<typeof transformAuditLog>[]> {
    const db = await getDb()
    const conditions = []

    if (query.userId) {
      conditions.push(eq(permissionAuditLogs.userId, query.userId))
    }
    if (query.action) {
      conditions.push(eq(permissionAuditLogs.action, query.action))
    }
    if (query.resourceType) {
      conditions.push(eq(permissionAuditLogs.resourceType, query.resourceType))
    }
    if (query.startDate) {
      conditions.push(gte(permissionAuditLogs.createdAt, query.startDate))
    }
    if (query.endDate) {
      conditions.push(lte(permissionAuditLogs.createdAt, query.endDate))
    }

    const rows = await db
      .select()
      .from(permissionAuditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(permissionAuditLogs.createdAt))
    return rows.map(transformAuditLog)
  }

  async deleteOlderThan(days: number): Promise<number> {
    const db = await getDb()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const rows = await db
      .delete(permissionAuditLogs)
      .where(lte(permissionAuditLogs.createdAt, cutoff))
      .returning()

    return rows.length
  }
}

export const auditLogService = new AuditLogService()
