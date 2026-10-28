/**
 * Svelte action: FLIP animation for grid layouts on window resize.
 *
 * Technique FLIP (First, Last, Invert, Play):
 *   1. On resize → capture every child's rect (BEFORE browser reflows)
 *   2. requestAnimationFrame → browser has reflowed, capture NEW rects
 *   3. For each child, apply inverse transform to "undo" the layout move
 *   4. Next frame → clear transforms, children animate to their new spots
 *
 * Usage: `<div class="grid" use:gridFlip>`
 */
export function gridFlip(node: HTMLElement) {
	const children = (): HTMLElement[] =>
		Array.from(node.children) as HTMLElement[];

	let prevRects: DOMRect[] = [];
	let rafId: number | null = null;
	let animating = false;

	function getRects() {
		return children().map((el) => el.getBoundingClientRect());
	}

	function cachePositions() {
		prevRects = getRects();
	}

	function flip() {
		const oldRects = prevRects;
		if (oldRects.length === 0) return;

		const newRects = getRects();
		if (oldRects.length !== newRects.length) {
			cachePositions();
			return;
		}

		const moved: { el: HTMLElement; dx: number; dy: number }[] = [];

		children().forEach((el, i) => {
			const oldRect = oldRects[i];
			const newRect = newRects[i];
			if (!oldRect || !newRect) return;

			const dx = oldRect.left - newRect.left;
			const dy = oldRect.top - newRect.top;

			if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
				el.style.willChange = 'transform';
				el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
				el.style.transition = 'transform 0.35s cubic-bezier(0.25, 0.4, 0.25, 1)';
				moved.push({ el, dx, dy });
			}
		});

		if (moved.length === 0) {
			cachePositions();
			animating = false;
			return;
		}

		// Force synchronous layout to "stick" the transforms
		void document.body.offsetHeight;

		// Next frame: remove transforms → children fly to their new positions
		rafId = requestAnimationFrame(() => {
			moved.forEach(({ el }) => {
				el.style.transform = 'translate3d(0, 0, 0)';
			});

			setTimeout(() => {
				moved.forEach(({ el }) => {
					el.style.transition = '';
					el.style.transform = '';
					el.style.willChange = '';
				});
				cachePositions();
				animating = false;
			}, 400);
		});
	}

	// Listen on window resize: fires BEFORE browser reflows
	// so getBoundingClientRect() returns OLD positions here.
	function onResize() {
		if (animating) return;

		// Capture OLD positions synchronously (layout not yet shifted)
		cachePositions();

		// Schedule FLIP for next animation frame (after reflow)
		rafId = requestAnimationFrame(() => {
			flip();
		});
	}

	window.addEventListener('resize', onResize, { passive: true });

	// Also use ResizeObserver as a fallback for container-size changes
	// (e.g. sidebar collapse, split-view, etc.)
	let ro: ResizeObserver | null = null;
	if (typeof ResizeObserver !== 'undefined') {
		ro = new ResizeObserver(() => {
			if (animating) return;
			cachePositions();
			rafId = requestAnimationFrame(() => {
				// Slight delay so the browser finalises layout
				requestAnimationFrame(() => flip());
			});
		});
		ro.observe(node);
	}

	// Initial positions
	cachePositions();

	return {
		destroy() {
			window.removeEventListener('resize', onResize);
			ro?.disconnect();
			if (rafId) cancelAnimationFrame(rafId);
		},
	};
}
