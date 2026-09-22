import { useEffect, type RefObject } from "react";

export function useDismissibleDetails(
  detailsRef: RefObject<HTMLDetailsElement | null>,
): void {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (
        !details?.open ||
        !(event.target instanceof Node) ||
        details.contains(event.target)
      ) {
        return;
      }

      details.removeAttribute("open");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        detailsRef.current?.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailsRef]);
}
