import { homedir } from 'node:os';
import * as path from 'node:path';
import type { PermissionPolicy } from '../execution/types.js';
import type { ComputerConfiguration, TrustedLocation } from './types.js';

const policy = (value: unknown): value is PermissionPolicy => value === 'always_allow' || value === 'ask' || value === 'deny';
export function parseComputerConfiguration(value: unknown = {}, errors: string[] = []): ComputerConfiguration {
  const raw = record(value) ? value : (errors.push('computer must be a YAML object.'), {});
  const pick = (key: keyof Omit<ComputerConfiguration, 'trustedLocations' | 'dryRun' | 'activityLogRetentionDays'>, fallback: PermissionPolicy): PermissionPolicy => raw[key] === undefined ? fallback : policy(raw[key]) ? raw[key] : (errors.push(`computer.${key} must be always_allow, ask, or deny.`), fallback);
  const trustedLocations = parseLocations(raw.trustedLocations, errors);
  const days = raw.activityLogRetentionDays === undefined ? 90 : Number(raw.activityLogRetentionDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) errors.push('computer.activityLogRetentionDays must be an integer from 1 to 3650.');
  if (raw.dryRun !== undefined && typeof raw.dryRun !== 'boolean') errors.push('computer.dryRun must be a boolean.');
  return {
    readOutsideWorkspace: pick('readOutsideWorkspace', 'ask'), writeOutsideWorkspace: pick('writeOutsideWorkspace', 'ask'),
    trustedLocations, systemCommandPolicy: pick('systemCommandPolicy', 'ask'), packageInstallationPolicy: pick('packageInstallationPolicy', 'ask'),
    elevatedCommandPolicy: pick('elevatedCommandPolicy', 'ask'), dryRun: typeof raw.dryRun === 'boolean' ? raw.dryRun : true,
    externalDocumentAccess: pick('externalDocumentAccess', 'ask'), activityLogRetentionDays: Number.isInteger(days) && days >= 1 && days <= 3650 ? days : 90
  };
}
function parseLocations(value: unknown, errors: string[]): TrustedLocation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { errors.push('computer.trustedLocations must be an array.'); return []; }
  const result: TrustedLocation[] = [];
  for (const [index, item] of value.entries()) {
    if (!record(item) || typeof item.path !== 'string' || !item.path.trim() || !policy(item.read) || !policy(item.write)) { errors.push(`computer.trustedLocations[${index}] must include path, read, and write policies.`); continue; }
    result.push({ path: normalize(item.path), read: item.read, write: item.write });
  }
  return result.slice(0, 100);
}
export function normalize(value: string): string { return path.resolve(value === '~' ? homedir() : value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
