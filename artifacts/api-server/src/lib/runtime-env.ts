const UNRESOLVED_TEMPLATE = /\$\{[^}]+\}/;

/**
 * Read an environment value only when the deployment replaced every template
 * reference. Managed artifact env entries remain as literal `${NAME}` strings
 * when the referenced secret does not exist, and those strings must never be
 * treated as working configuration.
 */
export function resolvedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value || UNRESOLVED_TEMPLATE.test(value)) return null;
  return value;
}

/** Return a validated absolute HTTP(S) URL from an environment variable. */
export function resolvedHttpUrl(name: string): string | null {
  const value = resolvedEnv(name);
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}