/**
 * Unit tests for Todo store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTodoStore } from '../todoStore';

// Mock the API client
vi.mock('@client/services/apiClient', () => ({
  apiClient: {
    api: {
      todos: {
        $get: vi.fn(),
        $post: vi.fn(),
        ':id': {
          $put: vi.fn(),
          $delete: vi.fn(),
        },
      },
    },
  },
}));

describe('Todo Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTodoStore.setState({
      todos: [],
      loading: false,
      error: null,
    });
  });

  describe('Initial State', () => {
    it('should have empty initial state', () => {
      const { result } = renderHook(() => useTodoStore());

      expect(result.current.todos).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('setError', () => {
    it('should set error message', () => {
      const { result } = renderHook(() => useTodoStore());

      act(() => {
        result.current.setError('Test error');
      });

      expect(result.current.error).toBe('Test error');
    });

    it('should clear error message', () => {
      const { result } = renderHook(() => useTodoStore());

      act(() => {
        result.current.setError('Test error');
      });

      act(() => {
        result.current.setError(null);
      });

      expect(result.current.error).toBeNull();
    });
  });
});
