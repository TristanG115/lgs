import type { JsonSchema } from './types.js';

export type ValidationIssue = { path: string; message: string };

export function validateSchema(schema: JsonSchema, value: unknown, path = '$'): ValidationIssue[] {
  if (schema.type === 'string') {
    if (typeof value !== 'string') return [{ path, message: 'must be a string' }];
    if (schema.minLength !== undefined && value.length < schema.minLength) return [{ path, message: `must contain at least ${schema.minLength} characters` }];
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return [{ path, message: `must contain at most ${schema.maxLength} characters` }];
    if (schema.enum && !schema.enum.includes(value)) return [{ path, message: `must be one of: ${schema.enum.join(', ')}` }];
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(value)) return [{ path, message: `must match ${schema.pattern}` }]; }
      catch { return [{ path, message: 'has an invalid schema pattern' }]; }
    }
    return [];
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) return [{ path, message: 'must be a safe integer' }];
    const integer = value as number;
    if (schema.minimum !== undefined && integer < schema.minimum) return [{ path, message: `must be at least ${schema.minimum}` }];
    if (schema.maximum !== undefined && integer > schema.maximum) return [{ path, message: `must be at most ${schema.maximum}` }];
    return [];
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? [] : [{ path, message: 'must be a boolean' }];
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [{ path, message: 'must be an array' }];
    const issues: ValidationIssue[] = [];
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path, message: `must contain at least ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path, message: `must contain at most ${schema.maxItems} items` });
    value.forEach((item, index) => issues.push(...validateSchema(schema.items, item, `${path}[${index}]`)));
    return issues;
  }
  if (!isPlainObject(value)) return [{ path, message: 'must be an object' }];
  const issues: ValidationIssue[] = [];
  for (const required of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, required)) issues.push({ path: `${path}.${required}`, message: 'is required' });
  for (const [key, child] of Object.entries(value)) {
    const property = schema.properties[key];
    if (!property) {
      if (schema.additionalProperties !== true) issues.push({ path: `${path}.${key}`, message: 'is not allowed' });
      continue;
    }
    issues.push(...validateSchema(property, child, `${path}.${key}`));
  }
  return issues;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
