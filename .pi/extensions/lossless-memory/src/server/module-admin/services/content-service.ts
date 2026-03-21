export interface Content {
  id: string
  title: string
  content: string
  category: 'article' | 'announcement' | 'tutorial' | 'news' | 'policy'
  status: 'draft' | 'published' | 'archived'
  author: string
  tags: string[]
  viewCount: number
  likeCount: number
  createdAt: string
  updatedAt: string
  publishedAt?: string
}

const CATEGORIES = ['article', 'announcement', 'tutorial', 'news', 'policy'] as const
const STATUSES = ['draft', 'published', 'archived'] as const

const TITLES = [
  '系统升级公告',
  '新功能发布说明',
  '用户使用指南',
  '常见问题解答',
  '隐私政策更新',
  '服务条款变更',
  '平台操作教程',
  '最佳实践分享',
]

const AUTHORS = ['管理员', '运营团队', '技术团队', '客服团队']

const TAGS = [
  ['系统', '升级'],
  ['功能', '新特性'],
  ['教程', '帮助'],
  ['FAQ', '常见问题'],
  ['政策', '隐私'],
  ['条款', '服务'],
  ['教程', '操作'],
  ['最佳实践', '经验'],
]

function randomDate(start: Date, end: Date): string {
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
  return date.toISOString()
}

function randomElement<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

// 使用 let 而不是 const，允许在测试中重置
export let MOCK_CONTENTS: Content[] = Array.from({ length: 20 }, (_, index) => {
  const category = randomElement(CATEGORIES)
  const status = randomElement(STATUSES)
  const createdAt = randomDate(new Date('2024-01-01'), new Date())
  const isPublished = status === 'published'

  return {
    id: `content-${index + 1}`,
    title: TITLES[index % TITLES.length],
    content: `这是${TITLES[index % TITLES.length]}的详细内容。这里包含了完整的文章内容，用户可以阅读和学习相关知识。`,
    category,
    status,
    author: randomElement(AUTHORS),
    tags: TAGS[index % TAGS.length],
    viewCount: Math.floor(Math.random() * 1000),
    likeCount: Math.floor(Math.random() * 100),
    createdAt,
    updatedAt: randomDate(new Date(createdAt), new Date()),
    publishedAt: isPublished ? randomDate(new Date(createdAt), new Date()) : undefined,
  }
})

// 用于测试的重置函数
export function resetMockContents(): void {
  MOCK_CONTENTS = Array.from({ length: 20 }, (_, index) => {
    const category = randomElement(CATEGORIES)
    const status = randomElement(STATUSES)
    const createdAt = randomDate(new Date('2024-01-01'), new Date())
    const isPublished = status === 'published'

    return {
      id: `content-${index + 1}`,
      title: TITLES[index % TITLES.length],
      content: `这是${TITLES[index % TITLES.length]}的详细内容。这里包含了完整的文章内容，用户可以阅读和学习相关知识。`,
      category,
      status,
      author: randomElement(AUTHORS),
      tags: TAGS[index % TAGS.length],
      viewCount: Math.floor(Math.random() * 1000),
      likeCount: Math.floor(Math.random() * 100),
      createdAt,
      updatedAt: randomDate(new Date(createdAt), new Date()),
      publishedAt: isPublished ? randomDate(new Date(createdAt), new Date()) : undefined,
    }
  })
}

export function getContents(filters?: {
  category?: Content['category']
  status?: Content['status']
  search?: string
}): Content[] {
  let result = [...MOCK_CONTENTS]

  if (filters?.category) {
    result = result.filter(c => c.category === filters.category)
  }

  if (filters?.status) {
    result = result.filter(c => c.status === filters.status)
  }

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase()
    result = result.filter(
      c =>
        c.title.toLowerCase().includes(searchLower) ||
        c.content.toLowerCase().includes(searchLower) ||
        c.tags.some(tag => tag.toLowerCase().includes(searchLower))
    )
  }

  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function getContentById(id: string): Content | null {
  return MOCK_CONTENTS.find(c => c.id === id) || null
}

export function createContent(data: Partial<Content>): Content {
  const newContent: Content = {
    id: `content-${Date.now()}`,
    title: data.title || '新内容',
    content: data.content || '',
    category: data.category || 'article',
    status: 'draft',
    author: data.author || '管理员',
    tags: data.tags || [],
    viewCount: 0,
    likeCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  MOCK_CONTENTS.push(newContent)
  return newContent
}

export function updateContent(id: string, data: Partial<Content>): Content | null {
  const content = MOCK_CONTENTS.find(c => c.id === id)
  if (content) {
    Object.assign(content, data, { updatedAt: new Date().toISOString() })
    return content
  }
  return null
}

export function deleteContent(id: string): boolean {
  const index = MOCK_CONTENTS.findIndex(c => c.id === id)
  if (index !== -1) {
    MOCK_CONTENTS.splice(index, 1)
    return true
  }
  return false
}

export function publishContent(id: string): Content | null {
  const content = MOCK_CONTENTS.find(c => c.id === id)
  if (content && content.status === 'draft') {
    content.status = 'published'
    content.publishedAt = new Date().toISOString()
    content.updatedAt = content.publishedAt
    return content
  }
  return null
}

export function archiveContent(id: string): Content | null {
  const content = MOCK_CONTENTS.find(c => c.id === id)
  if (content && content.status === 'published') {
    content.status = 'archived'
    content.updatedAt = new Date().toISOString()
    return content
  }
  return null
}
