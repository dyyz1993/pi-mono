import { Typography, Breadcrumb } from 'antd'
import { HomeOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

const { Title } = Typography

interface BreadcrumbItem {
  title: string
  href?: string
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  breadcrumbs?: BreadcrumbItem[]
  extra?: ReactNode
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, breadcrumbs, extra }) => {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb className="mb-2">
          <Breadcrumb.Item>
            <HomeOutlined />
          </Breadcrumb.Item>
          {breadcrumbs.map((item, index) => (
            <Breadcrumb.Item key={index} href={item.href}>
              {item.title}
            </Breadcrumb.Item>
          ))}
        </Breadcrumb>
      )}
      <div className="flex items-center justify-between">
        <div>
          <Title level={2} style={{ margin: 0 }}>
            {title}
          </Title>
          {subtitle && <p className="text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {extra && <div>{extra}</div>}
      </div>
    </div>
  )
}
