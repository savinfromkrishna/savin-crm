/**
 * `--key value` pairs and bare `--flag` switches from a CLI argument list.
 * pnpm forwards a literal "--" ahead of script arguments; it is skipped.
 */
export function parseCliArgs(argv: readonly string[]): {
  get(key: string): string | undefined;
  has(key: string): boolean;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const tokens = argv.filter((token) => token !== "--");
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index];
    if (!key?.startsWith("--")) continue;
    const value = tokens[index + 1];
    if (value && !value.startsWith("--")) {
      values.set(key.slice(2), value);
      index += 1;
    } else {
      flags.add(key.slice(2));
    }
  }
  return {
    get: (key) => values.get(key),
    has: (key) => flags.has(key) || values.has(key),
  };
}
