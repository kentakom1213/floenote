const SWIPE_DISTANCE = 48;
const HORIZONTAL_BIAS = 1.2;

export type MobileDrawerSwipeDirection = "open" | "close";

export type MobileDrawerSwipe = {
  direction: MobileDrawerSwipeDirection;
  startX: number;
  startY: number;
};

export function shouldCompleteMobileDrawerSwipe(
  swipe: MobileDrawerSwipe,
  endX: number,
  endY: number,
): boolean {
  const deltaX = endX - swipe.startX;
  const deltaY = endY - swipe.startY;

  if (Math.abs(deltaX) < SWIPE_DISTANCE) return false;
  if (Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_BIAS) return false;

  return swipe.direction === "open" ? deltaX > 0 : deltaX < 0;
}

export function isHorizontalMobileDrawerSwipe(
  swipe: MobileDrawerSwipe,
  currentX: number,
  currentY: number,
): boolean {
  const deltaX = currentX - swipe.startX;
  const deltaY = currentY - swipe.startY;

  return Math.abs(deltaX) >= 10 && Math.abs(deltaX) > Math.abs(deltaY);
}
