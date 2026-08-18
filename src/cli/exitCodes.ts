export const EXIT_CODES = {
  SUCCESS: 0,
  POLICY_VIOLATION: 1,
  USER_ERROR: 2,
  INTERNAL_ERROR: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
