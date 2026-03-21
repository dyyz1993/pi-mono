import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as notificationService from '../services/notification-service'
import type { CreateNotificationInput } from '@shared/schemas'

vi.mock('@server/core', () => ({
  realtime: {
    broadcast: vi.fn(),
  },
}))

describe('Notification Service', () => {
  beforeEach(() => {
    notificationService.clearAllNotifications()
  })

  describe('createNotification', () => {
    it('should create a notification with all required fields', () => {
      const input: CreateNotificationInput = {
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test message',
      }

      const result = notificationService.createNotification(input)

      expect(result.id).toBeDefined()
      expect(result.type).toBe('info')
      expect(result.title).toBe('Test Notification')
      expect(result.message).toBe('This is a test message')
      expect(result.read).toBe(false)
      expect(result.createdAt).toBeDefined()
    })

    it('should create notification with different types', () => {
      const types: Array<'info' | 'warning' | 'error' | 'success'> = [
        'info',
        'warning',
        'error',
        'success',
      ]

      types.forEach(type => {
        const result = notificationService.createNotification({
          type,
          title: `${type} notification`,
          message: `Message for ${type}`,
        })
        expect(result.type).toBe(type)
      })
    })
  })

  describe('listNotifications', () => {
    it('should return empty array when no notifications exist', () => {
      const result = notificationService.listNotifications({})

      expect(result.data).toEqual([])
      expect(result.nextCursor).toBeUndefined()
    })

    it('should return all notifications sorted by createdAt DESC', () => {
      notificationService.createNotification({ type: 'info', title: 'First', message: 'msg1' })
      notificationService.createNotification({ type: 'info', title: 'Second', message: 'msg2' })

      const result = notificationService.listNotifications({})

      expect(result.data.length).toBe(2)
      expect(result.data[0].title).toBe('Second')
      expect(result.data[1].title).toBe('First')
    })

    it('should filter unread only when unreadOnly is true', () => {
      notificationService.createNotification({ type: 'info', title: 'Unread', message: 'msg1' })
      notificationService.createNotification({ type: 'info', title: 'Read', message: 'msg2' })

      const allNotifications = notificationService.listNotifications({})
      const readNotification = allNotifications.data.find(n => n.title === 'Read')
      if (readNotification) {
        notificationService.markAsRead(readNotification.id)
      }

      const result = notificationService.listNotifications({ unreadOnly: true })

      expect(result.data.length).toBe(1)
      expect(result.data[0].title).toBe('Unread')
    })

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        notificationService.createNotification({
          type: 'info',
          title: `Notif ${i}`,
          message: `msg${i}`,
        })
      }

      const result = notificationService.listNotifications({ limit: 5 })

      expect(result.data.length).toBe(5)
      expect(result.nextCursor).toBeDefined()
    })
  })

  describe('getNotification', () => {
    it('should return notification by id', () => {
      const created = notificationService.createNotification({
        type: 'info',
        title: 'Test',
        message: 'msg',
      })

      const result = notificationService.getNotification(created.id)

      expect(result).toBeDefined()
      expect(result?.id).toBe(created.id)
    })

    it('should return undefined for non-existent id', () => {
      const result = notificationService.getNotification('non-existent-id')

      expect(result).toBeUndefined()
    })
  })

  describe('markAsRead', () => {
    it('should mark notification as read', () => {
      const created = notificationService.createNotification({
        type: 'info',
        title: 'Test',
        message: 'msg',
      })

      const result = notificationService.markAsRead(created.id)

      expect(result?.read).toBe(true)
    })

    it('should return undefined for non-existent id', () => {
      const result = notificationService.markAsRead('non-existent-id')

      expect(result).toBeUndefined()
    })
  })

  describe('deleteNotification', () => {
    it('should delete notification and return true', () => {
      const created = notificationService.createNotification({
        type: 'info',
        title: 'Test',
        message: 'msg',
      })

      const result = notificationService.deleteNotification(created.id)

      expect(result).toBe(true)
      expect(notificationService.getNotification(created.id)).toBeUndefined()
    })

    it('should return false for non-existent id', () => {
      const result = notificationService.deleteNotification('non-existent-id')

      expect(result).toBe(false)
    })
  })

  describe('getUnreadCount', () => {
    it('should return correct unread count', () => {
      notificationService.createNotification({ type: 'info', title: '1', message: 'msg1' })
      notificationService.createNotification({ type: 'info', title: '2', message: 'msg2' })

      expect(notificationService.getUnreadCount()).toBe(2)

      notificationService.markAsRead(notificationService.listNotifications({}).data[0].id)

      expect(notificationService.getUnreadCount()).toBe(1)
    })
  })

  describe('markAllAsRead', () => {
    it('should mark all notifications as read', () => {
      notificationService.createNotification({ type: 'info', title: '1', message: 'msg1' })
      notificationService.createNotification({ type: 'info', title: '2', message: 'msg2' })

      const count = notificationService.markAllAsRead()

      expect(count).toBe(2)
      expect(notificationService.getUnreadCount()).toBe(0)
    })
  })

  describe('clearAllNotifications', () => {
    it('should clear all notifications', () => {
      notificationService.createNotification({ type: 'info', title: '1', message: 'msg1' })
      notificationService.createNotification({ type: 'info', title: '2', message: 'msg2' })

      notificationService.clearAllNotifications()

      expect(notificationService.listNotifications({}).data.length).toBe(0)
    })

    it('should clear all notifications when empty', () => {
      notificationService.clearAllNotifications()
      expect(notificationService.listNotifications({}).data.length).toBe(0)
    })
  })

  describe('createNotificationAndBroadcast', () => {
    it('should create notification and broadcast it', async () => {
      const input: CreateNotificationInput = {
        type: 'info',
        title: 'Broadcast Test',
        message: 'Test message',
      }
      const result = await notificationService.createNotificationAndBroadcast(input)

      expect(result.id).toBeDefined()
      expect(result.title).toBe('Broadcast Test')
      expect(result.message).toBe('Test message')
    })
  })

  describe('Error Scenarios', () => {
    it('should handle empty title gracefully', () => {
      const result = notificationService.createNotification({
        type: 'info',
        title: '',
        message: 'msg',
      })
      expect(result.title).toBe('')
    })

    it('should handle empty message gracefully', () => {
      const result = notificationService.createNotification({
        type: 'info',
        title: 'title',
        message: '',
      })
      expect(result.message).toBe('')
    })
  })
})
