import { prisma } from './prisma';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
}

export async function isEnabled(flag: string) {
  return (await prisma.featureFlag.findUnique({ where: { key: flag } }))?.enabled ?? false;
}
