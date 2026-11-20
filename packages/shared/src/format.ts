export const TIMEZONE = 'Africa/Luanda';

/** 1440000 → "1.440.000 Kz" (AOA é sempre inteiro). */
export function formatKz(value: number) {
  const n = Math.round(value);
  const digits = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${digits} Kz`;
}

/** Data/hora em Africa/Luanda, formato dd/mm/aaaa hh:mm. */
export function formatDateTime(d: Date | string) {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(d));
}

export function formatDate(d: Date | string) {
  return new Intl.DateTimeFormat('pt-PT', { timeZone: TIMEZONE, dateStyle: 'short' }).format(new Date(d));
}
