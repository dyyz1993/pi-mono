import { Card, Statistic } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

interface StatsCardProps {
  title: string
  value: number
  prefix?: ReactNode
  suffix?: string
  trend?: {
    value: number
    isUp: boolean
  }
  loading?: boolean
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  prefix,
  suffix,
  trend,
  loading,
}) => {
  return (
    <Card loading={loading}>
      <Statistic
        title={title}
        value={value}
        prefix={prefix}
        suffix={suffix}
        valueStyle={{ fontSize: '24px', fontWeight: 'bold' }}
      />
      {trend && (
        <div className="mt-2">
          <span style={{ color: trend.isUp ? '#3f8600' : '#cf1322' }}>
            {trend.isUp ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(trend.value)}%
          </span>
          <span className="text-gray-400 ml-2">vs last month</span>
        </div>
      )}
    </Card>
  )
}
