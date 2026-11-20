export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Registo') => new AppError(404, 'NOT_FOUND', `${what} não encontrado`);
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'Sem permissão para esta acção');
export const unauthorized = (message = 'Sessão inválida ou expirada') => new AppError(401, 'UNAUTHORIZED', message);
