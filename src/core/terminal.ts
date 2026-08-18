export interface TerminalStyler {
  readonly enabled: boolean;
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  blue(text: string): string;
  cyan(text: string): string;
  gray(text: string): string;
}

/**
 * Creates an ANSI terminal styler respecting NO_COLOR, FORCE_COLOR, and TTY status.
 */
export function createStyler(options?: { readonly color?: boolean }): TerminalStyler {
  const envNoColor = Boolean(process.env["NO_COLOR"]);
  const envForceColor = Boolean(process.env["FORCE_COLOR"]);
  const isTTY = Boolean(process.stdout && process.stdout.isTTY);

  let enabled = false;
  if (options?.color !== undefined) {
    enabled = options.color;
  } else if (envNoColor) {
    enabled = false;
  } else if (envForceColor) {
    enabled = true;
  } else {
    enabled = isTTY;
  }

  const wrap = (open: string, close: string) => (text: string) => {
    if (!enabled || !text) {
      return text;
    }
    return `\u001B[${open}m${text}\u001B[${close}m`;
  };

  return {
    enabled,
    bold: wrap("1", "22"),
    dim: wrap("2", "22"),
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
    blue: wrap("34", "39"),
    cyan: wrap("36", "39"),
    gray: wrap("90", "39"),
  };
}
