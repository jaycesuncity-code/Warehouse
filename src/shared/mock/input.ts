import { validation } from './errors';

export function readBoolean(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw validation({ [field]: 'Use true or false.' });
  return value;
}

export function readText(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== 'string' || value.length > maxLength)
    throw validation({ [field]: `Use text of at most ${maxLength} characters.` });
  return value;
}

export function readNullableText(value: unknown, field: string, maxLength = 200): string | null {
  return value === null || value === undefined ? null : readText(value, field, maxLength);
}
