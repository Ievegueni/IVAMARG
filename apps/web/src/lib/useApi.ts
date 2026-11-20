import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** GET com estado de carregamento/erro. `path` null = não carregar. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

/** Escrita simples (POST/PATCH/PUT/DELETE) com erro em estado e recarga em caso de sucesso. */
export function useAction(reload: () => void) {
  const [error, setError] = useState('');
  const act = async (path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown) => {
    setError('');
    try {
      await api(path, { method, body });
      reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  return { error, act };
}
