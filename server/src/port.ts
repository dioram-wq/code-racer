/** Port used when `PORT` is unset or empty. */
export const DEFAULT_PORT = 3001;

/**
 * Reads `PORT` for the process entry. An unset or empty value is
 * `DEFAULT_PORT`. Any other value must be an integer from 0 to 65535.
 */
export function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`PORT must be an integer from 0 to 65535, received ${raw}`);
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, received ${raw}`);
  }
  return port;
}
