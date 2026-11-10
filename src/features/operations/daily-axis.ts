/**
 * Which day labels to print under the daily bar chart.
 * Prints the first day, the last day and roughly eight ticks in between,
 * but drops a tick that sits so close to the last day that the two labels would overlap.
 */
export function showDailyAxisLabel(index: number, length: number): boolean {
  const last = length - 1;
  if (index === 0 || index === last) return true;
  const step = Math.max(1, Math.ceil(length / 8));
  if (index % step !== 0) return false;
  return last - index >= Math.ceil(step / 2);
}
