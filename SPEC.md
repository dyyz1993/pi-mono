===SPEC===
# 电商平台项目 Specification

## Why
构建一个完整的电商平台，支持商品展示、购物车、订单管理、支付集成等核心电商功能。

## What Changes
新建完整的电商平台后端服务

## ADDED Requirements
- 用户系统（注册、登录、权限管理）
- 商品模块（商品列表、详情、分类、搜索）
- 购物车模块（添加、删除、修改数量）
- 订单模块（创建订单、订单列表、订单状态）
- 支付模块（支付集成、退款）
- 库存模块（库存管理、库存扣减）

## Data Structures
### User
- id, username, email, password_hash, role, created_at

### Product
- id, name, description, price, category_id, stock, images, created_at

### Category
- id, name, parent_id

### Cart
- id, user_id, product_id, quantity

### Order
- id, user_id, status, total_amount, created_at

### OrderItem
- id, order_id, product_id, quantity, price

## Architecture
- 前后端分离架构
- RESTful API 设计
- MVC 分层设计
- 数据库: PostgreSQL/MySQL

## Implementation Files
- /src/models/ - 数据模型
- /src/controllers/ - 控制器
- /src/routes/ - 路由
- /src/services/ - 业务逻辑
- /src/middleware/ - 中间件

## Verification Criteria
- [ ] 用户可以注册和登录
- [ ] 商品可以展示和搜索
- [ ] 购物车功能正常
- [ ] 订单创建和查询正常
- [ ] 支付流程可跑通