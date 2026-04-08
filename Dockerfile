# Backend stage
FROM node:20-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
COPY packages/backend/package*.json ./packages/backend/
RUN npm ci
WORKDIR /app/packages/backend
RUN npm run build

# Frontend stage
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
COPY packages/frontend/package*.json ./packages/frontend/
RUN npm ci
WORKDIR /app/packages/frontend
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=frontend-builder /app/packages/frontend/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
