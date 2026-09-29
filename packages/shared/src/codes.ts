export const ERROR_CODES = [
  'payload_too_large',
  'invalid_json',
  'invalid_field',
  'too_many_items',
  'skill_not_registered',
  'ip_limit',
  'global_limit',
  'unauthorized',
  'forbidden',
  'not_found',
  'skill_required',
  'invalid_status',
  'old_name',
  'name_conflict',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
