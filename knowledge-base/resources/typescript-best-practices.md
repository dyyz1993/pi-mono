# TypeScript Best Practices

## Type Definitions

### Prefer Interfaces for Objects

```typescript
// ✅ Good
interface User {
  id: string;
  name: string;
  email: string;
}

// ❌ Avoid
type User = {
  id: string;
  name: string;
  email: string;
}
```

### Use Type for Unions

```typescript
// ✅ Good
type Status = 'pending' | 'active' | 'completed';
type Result = Success | Error;
```

## Generics

### Generic Functions

```typescript
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Usage
const user = { name: 'Alice', age: 30 };
const name = getProperty(user, 'name'); // string
```

### Generic Constraints

```typescript
interface ApiResponse<T extends object> {
  data: T;
  status: number;
  message: string;
}
```

## Strict Mode

Always enable strict mode in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

## Error Handling

### Use Unknown for Errors

```typescript
try {
  // ...
} catch (error: unknown) {
  if (error instanceof Error) {
    console.error(error.message);
  }
}
```

## Async/Await

### Prefer Async/Await

```typescript
// ✅ Good
async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }
  return response.json();
}

// ❌ Avoid
function fetchUser(id: string): Promise<User> {
  return fetch(`/api/users/${id}`)
    .then(response => response.json());
}
```

## Component Props

### Define Props Interface

```typescript
interface ButtonProps {
  text: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

function Button({ text, onClick, variant = 'primary', disabled = false }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`btn btn-${variant}`}
      disabled={disabled}
    >
      {text}
    </button>
  );
}
```

## Utility Types

### Common Patterns

```typescript
// Partial - all properties optional
type PartialUser = Partial<User>;

// Required - all properties required
type RequiredUser = Required<User>;

// Pick - select specific properties
type UserPreview = Pick<User, 'id' | 'name'>;

// Omit - exclude specific properties
type UserWithoutId = Omit<User, 'id'>;

// Record - object with string keys
type UserMap = Record<string, User>;
```

## Performance

### Avoid Any

```typescript
// ❌ Bad
function process(data: any) {
  return data.value;
}

// ✅ Good
function process<T extends { value: unknown }>(data: T): T['value'] {
  return data.value;
}
```

## Testing

### Type-Safe Mocks

```typescript
import { User } from './types';

function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-id',
    name: 'Test User',
    email: 'test@example.com',
    ...overrides,
  };
}
```

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [Type Challenges](https://github.com/type-challenges/type-challenges)
