export function BatteryIcon({ level }: { level: number }) {
  const clamped = Math.max(0, Math.min(100, level));
  const color = clamped > 50 ? "#10b981" : clamped > 20 ? "#f59e0b" : "#ef4444";

  return (
    <svg viewBox="0 0 24 12" width="28" height="14" fill="none" aria-label={`Batería al ${clamped}%`}>
      <rect x="0.5" y="0.5" width="20" height="11" rx="2" stroke="currentColor" strokeOpacity="0.5" />
      <rect x="21" y="3" width="2.5" height="6" rx="0.5" fill="currentColor" fillOpacity="0.5" />
      <rect x="2" y="2" width={Math.max(1, (16 * clamped) / 100)} height="8" rx="1" fill={color} />
    </svg>
  );
}
