// Access token só em memória; refresh token em cookie httpOnly (gerido pelo browser).
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => (accessToken = t);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
let onSessionExpired: () => void = () => {};
export const setOnSessionExpired = (fn: () => void) => (onSessionExpired = fn);

export async function tryRefresh() {
  // Um único refresh em curso, mesmo com vários pedidos a falhar em simultâneo.
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) return false;
      const data = await r.json();
      accessToken = data.accessToken;
      refreshedUser = data.user;
      return true;
    })
    .catch(() => false)
    .finally(() => (refreshing = null));
  return refreshing;
}
export let refreshedUser: unknown = null;

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(opts.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api(path, opts, false);
    onSessionExpired();
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Erro de comunicação com o servidor', e.details);
  }
  return data as T;
}

export const toQuery = (params: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

/** Abre um ficheiro protegido (ex.: PDF) num separador novo. */
export async function openFile(path: string, retry = true): Promise<void> {
  const tab = window.open('', '_blank'); // aberto já, para não ser bloqueado como popup
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (res.status === 401 && retry && (await tryRefresh())) {
    tab?.close();
    return openFile(path, false);
  }
  if (!res.ok) {
    tab?.close();
    throw new ApiError(res.status, 'ERROR', 'Não foi possível abrir o ficheiro');
  }
  const url = URL.createObjectURL(await res.blob());
  if (tab) tab.location.href = url;
  else window.location.href = url;
}

/** Upload multipart (ficheiro + metadados JSON no campo "meta"). */
export async function upload<T>(path: string, file: File, meta?: unknown, retry = true): Promise<T> {
  const fd = new FormData();
  if (meta !== undefined) fd.append('meta', JSON.stringify(meta));
  fd.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, body: fd });
  if (res.status === 401 && retry && (await tryRefresh())) return upload(path, file, meta, false);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Erro no envio do ficheiro', data?.error?.details);
  return data as T;
}
