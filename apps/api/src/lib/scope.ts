import { hasPermission, type ModuleKey, type Permission } from '@ivamarg/shared';
import type { PublicUser } from '../modules/users/service';
import { forbidden } from './errors';

/** Sem `<módulo>.viewAll` o utilizador só vê a sua carteira (registos de que é responsável). */
export const seesAll = (user: PublicUser, module: ModuleKey) => hasPermission(user, `${module}.viewAll` as Permission);

/** Filtro Prisma por responsável, ou {} se vê tudo. */
export const ownerFilter = (user: PublicUser, module: ModuleKey) => (seesAll(user, module) ? {} : { ownerId: user.id });

export function assertOwner(user: PublicUser, module: ModuleKey, ownerId: string | null | undefined) {
  if (!seesAll(user, module) && ownerId !== user.id) throw forbidden();
}
