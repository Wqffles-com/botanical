/** Passcode the suite types into /login. The MVP stack uses BOTANICAL_PASSCODE. */
export function passcode(): string {
  const value =
    process.env.BOTANICAL_PASSCODE?.trim() ||
    process.env.BOTANICAL_PASSWORD?.trim() ||
    process.env.E2E_PASSCODE?.trim() ||
    "botanical";
  return value;
}
