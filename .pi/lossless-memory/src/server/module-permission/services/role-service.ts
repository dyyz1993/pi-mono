import type { Role, NewRole } from '../../db/schema/roles'
import { getDb } from '../../db'
import { roles, userRoles } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { transformRole } from '../../utils/date'

export class RoleService {
  async getAll(): Promise<ReturnType<typeof transformRole>[]> {
    const db = await getDb()
    const result = await db.select().from(roles).where(eq(roles.isActive, true))
    return result.map(transformRole)
  }

  async getById(id: string): Promise<ReturnType<typeof transformRole> | undefined> {
    const db = await getDb()
    const rows = await db.select().from(roles).where(eq(roles.id, id))
    return rows[0] ? transformRole(rows[0]) : undefined
  }

  async getByCode(code: string): Promise<ReturnType<typeof transformRole> | undefined> {
    const db = await getDb()
    const rows = await db.select().from(roles).where(eq(roles.code, code))
    return rows[0] ? transformRole(rows[0]) : undefined
  }

  async create(data: NewRole): Promise<ReturnType<typeof transformRole>> {
    const db = await getDb()
    const rows = await db
      .insert(roles)
      .values({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    return transformRole(rows[0])
  }

  async update(
    id: string,
    data: Partial<NewRole>
  ): Promise<ReturnType<typeof transformRole> | undefined> {
    const db = await getDb()
    const rows = await db
      .update(roles)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id))
      .returning()
    return rows[0] ? transformRole(rows[0]) : undefined
  }

  async delete(id: string): Promise<boolean> {
    const db = await getDb()
    const role = await this.getById(id)
    if (!role || role.isSystem) return false

    const rows = await db.update(roles).set({ isActive: false }).where(eq(roles.id, id)).returning()
    return rows.length > 0
  }

  async assignRoleToUser(userId: string, roleId: string, assignedBy?: string): Promise<void> {
    const db = await getDb()
    const existing = await db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.roleId, roleId),
          eq(userRoles.isActive, true)
        )
      )

    if (existing.length === 0) {
      await db.insert(userRoles).values({
        id: `ur_${Date.now()}`,
        userId,
        roleId,
        assignedBy: assignedBy ?? null,
        assignedAt: new Date(),
        expiresAt: null,
        isActive: true,
      })
    }
  }

  async revokeRoleFromUser(userId: string, roleId: string): Promise<void> {
    const db = await getDb()
    await db
      .update(userRoles)
      .set({ isActive: false })
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
  }

  async getUserRoles(userId: string): Promise<Role[]> {
    const db = await getDb()
    const userRoleRows = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)))

    if (userRoleRows.length === 0) {
      return []
    }

    const roleIds = userRoleRows.map(ur => ur.roleId)
    const roleRows = await db.select().from(roles).where(eq(roles.isActive, true))

    return roleRows.filter(r => roleIds.includes(r.id))
  }
}

export const roleService = new RoleService()
