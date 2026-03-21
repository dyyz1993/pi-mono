import { create } from 'zustand'

interface LoadingState {
  count: number
  isLoading: boolean
  loadingText?: string
  startLoading: (text?: string) => void
  stopLoading: () => void
}

export const useLoadingStore = create<LoadingState>(set => ({
  count: 0,
  isLoading: false,
  loadingText: undefined,
  startLoading: (text?: string) =>
    set(state => ({
      count: state.count + 1,
      isLoading: true,
      loadingText: text,
    })),
  stopLoading: () =>
    set(state => ({
      count: Math.max(0, state.count - 1),
      isLoading: state.count - 1 > 0,
      loadingText: state.count - 1 > 0 ? state.loadingText : undefined,
    })),
}))
