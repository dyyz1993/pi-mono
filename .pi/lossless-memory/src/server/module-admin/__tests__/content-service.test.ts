import { describe, it, expect, beforeEach } from 'vitest'
import * as service from '../services/content-service'
import { resetMockContents } from '../services/content-service'

describe('Admin Content Service', () => {
  beforeEach(() => {
    // 重置 mock contents 以确保测试隔离
    resetMockContents()
  })
  describe('getContents', () => {
    it('should return all contents', () => {
      const result = service.getContents()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should filter contents by category', () => {
      const result = service.getContents({ category: 'article' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(content => {
        expect(content.category).toBe('article')
      })
    })

    it('should filter contents by status', () => {
      const result = service.getContents({ status: 'published' })
      expect(Array.isArray(result)).toBe(true)
      result.forEach(content => {
        expect(content.status).toBe('published')
      })
    })
  })

  describe('getContentById', () => {
    it('should return content when id exists', () => {
      const allContents = service.getContents()
      const firstContent = allContents[0]
      const result = service.getContentById(firstContent.id)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(firstContent.id)
    })

    it('should return null for non-existent content', () => {
      const result = service.getContentById('non-existent-content-id-xyz')
      expect(result).toBeNull()
      expect(result).toBeFalsy()
    })
  })

  describe('createContent', () => {
    it('should create a new content with default values', () => {
      const result = service.createContent({
        title: 'Test Title',
        content: 'Test Content',
        category: 'article',
      })

      expect(result).toMatchObject({
        title: 'Test Title',
        content: 'Test Content',
        category: 'article',
        status: 'draft',
        viewCount: 0,
        likeCount: 0,
      })
      expect(result.id).toBeDefined()
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })
  })

  describe('updateContent', () => {
    it('should update existing content', () => {
      const created = service.createContent({
        title: 'Original Title',
        content: 'Original Content',
        category: 'article',
      })

      const result = service.updateContent(created.id, {
        title: 'Updated Title',
        content: 'Updated Content',
      })

      expect(result).not.toBeNull()
      expect(result?.title).toBe('Updated Title')
      expect(result?.content).toBe('Updated Content')
    })

    it('should return null for non-existent content', () => {
      const result = service.updateContent('non-existent-content-id-xyz', { title: 'New Title' })
      expect(result).toBeNull()
      expect(result).toBeFalsy()
    })
  })

  describe('deleteContent', () => {
    it('should delete an existing content', () => {
      const created = service.createContent({
        title: 'To Delete',
        content: 'Content to delete',
        category: 'article',
      })

      const result = service.deleteContent(created.id)
      expect(result).toBe(true)

      const found = service.getContentById(created.id)
      expect(found).toBeNull()
    })

    it('should return false for non-existent content', () => {
      const result = service.deleteContent('non-existent-content-id-xyz')
      expect(result).toBe(false)
      expect(result).toBeFalsy()
    })
  })

  describe('publishContent', () => {
    it('should publish a draft content', () => {
      const created = service.createContent({
        title: 'To Publish',
        content: 'Content to publish',
        category: 'article',
      })

      const result = service.publishContent(created.id)

      expect(result).not.toBeNull()
      expect(result?.status).toBe('published')
      expect(result?.publishedAt).toBeDefined()
    })

    it('should return null for non-existent content', () => {
      const result = service.publishContent('non-existent-content-id-xyz')
      expect(result).toBeNull()
      expect(result).toBeFalsy()
    })
  })

  describe('archiveContent', () => {
    it('should archive a published content', () => {
      const created = service.createContent({
        title: 'To Archive',
        content: 'Content to archive',
        category: 'article',
      })
      service.publishContent(created.id)

      const result = service.archiveContent(created.id)

      expect(result).not.toBeNull()
      expect(result?.status).toBe('archived')
    })

    it('should return null for non-existent content', () => {
      const result = service.archiveContent('non-existent-content-id-xyz')
      expect(result).toBeNull()
      expect(result).toBeFalsy()
    })
  })
})
