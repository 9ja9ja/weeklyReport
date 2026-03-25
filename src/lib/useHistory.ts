import { useState, useCallback } from 'react';

export function useHistory<T>(initialState: T) {
  const [store, setStore] = useState({ history: [initialState], index: 0 });

  const setState = useCallback((newState: T | ((prev: T) => T)) => {
    setStore(prev => {
      const currentState = prev.history[prev.index];
      const nextState = typeof newState === 'function' ? (newState as Function)(currentState) : newState;
      
      const newHistory = prev.history.slice(0, prev.index + 1);
      newHistory.push(nextState);
      return { history: newHistory, index: prev.index + 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setStore(prev => ({ ...prev, index: Math.max(0, prev.index - 1) }));
  }, []);

  const redo = useCallback(() => {
    setStore(prev => ({ ...prev, index: Math.min(prev.history.length - 1, prev.index + 1) }));
  }, []);

  const setInitialState = useCallback((state: T) => {
    setStore({ history: [state], index: 0 });
  }, []);

  return { 
    state: store.history[store.index], 
    setState, 
    undo, 
    redo, 
    canUndo: store.index > 0, 
    canRedo: store.index < store.history.length - 1, 
    setInitialState 
  };
}
