export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="bc-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M16 7c1 5 4 8 9 9-5 1-8 4-9 9-1-5-4-8-9-9 5-1 8-4 9-9z" fill="var(--bc-bg-raised)" />
    </svg>
  );
}
