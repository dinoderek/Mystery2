/** What the status bar says about the accusations a player has left, for any count. */
export function accusationsLeftText(left: number): string {
  if (left <= 0) return 'No accusations left';
  return left === 1 ? '1 accusation left' : `${left} accusations left`;
}
