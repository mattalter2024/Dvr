import { useEffect } from 'react';

/**
 * Spatial D-pad / Smart TV Remote Keyboard Navigation.
 * Allows navigating any visible interactive element with ArrowUp/Down/Left/Right,
 * without interfering when typing inside an <input> or when a fullscreen player owns keys.
 */
export function useTvNavigation(disabled: boolean) {
  useEffect(() => {
    if (disabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT')
      ) {
        return;
      }

      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex="0"]:not([disabled])',
        ),
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (candidates.length === 0) return;

      if (!active || !candidates.includes(active)) {
        e.preventDefault();
        candidates[0].focus();
        return;
      }

      const from = active.getBoundingClientRect();
      const fromCx = from.left + from.width / 2;
      const fromCy = from.top + from.height / 2;

      let best: HTMLElement | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const el of candidates) {
        if (el === active) continue;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = cx - fromCx;
        const dy = cy - fromCy;

        let primary = 0;
        let orthogonal = 0;

        if (e.key === 'ArrowRight') {
          if (dx <= 6) continue;
          primary = dx;
          orthogonal = Math.abs(dy);
        } else if (e.key === 'ArrowLeft') {
          if (dx >= -6) continue;
          primary = -dx;
          orthogonal = Math.abs(dy);
        } else if (e.key === 'ArrowDown') {
          if (dy <= 6) continue;
          primary = dy;
          orthogonal = Math.abs(dx);
        } else if (e.key === 'ArrowUp') {
          if (dy >= -6) continue;
          primary = -dy;
          orthogonal = Math.abs(dx);
        }

        const score = primary + orthogonal * 2.4;
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }

      if (best) {
        e.preventDefault();
        best.focus();
        best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled]);
}
