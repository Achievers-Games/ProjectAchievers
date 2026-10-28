/**
 * Svelte action: FLIP animation for grid layouts on resize.
 *
 * Technique standard:
 *   1. On resize start → capture every child's rect (BEFORE layout shift)
 *   2. requestAnimationFrame → browser has reflowed, capture NEW rects
 *   3. For each child, apply inverse transform to "undo" the move
 *   4. Next frame → zero the transform, children animate to their new spots
 *
 * Usage: `<div class="grid" use:gridFlip>`
 */
export function gridFlip(node: HTMLElement) {
	const children = (): HTMLElement[] =>
		Array.from(node.children) as HTMLElement[];

	let prevRects: DOMRect[] = [];
	let resizeObserver: ResizeObserver | null = null;
	let rafId: number | null = null;
	let running = false;

	function cachePositions() {
		prevRects = children().map((el) => el.getBoundingClientRect());
	}

	function flush() {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = null;
		running = false;
	}

	function flip() {
		if (running) return; // skip if already in-flight
		running = true;

		const oldRects = prevRects;
		if (oldRects.length === 0) {
			running = false;
			return;
		}

		// Read new positions AFTER layout reflow
		const newRects = children().map((el) => el.getBoundingClientRect());

		// Apply inverse transform so each child sits at its OLD spot
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
			flush();
			return;
		}

		// Force a synchronised layout to make the above transforms "stick"
		void document.body.offsetHeight;

		// Next frame: clear transforms so children animate to new positions
		rafId = requestAnimationFrame(() => {
			moved.forEach(({ el }) => {
				el.style.transform = 'translate3d(0, 0, 0)';
			});

			// Clean up after transition completes
			setTimeout(() => {
				children().forEach((el) => {
					el.style.transform = '';
					el.style.transition = '';
					el.style.willChange = '';
				});
				cachePositions();
				running = false;
			}, 400);
		});
	}

	// ResizeObserver triggers when grid container size changes
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(() => {
			if (!running) cachePositions();
			rafId = requestAnimationFrame(flip);
		});
		resizeObserver.observe(node);
	}

	// Fallback for SSR / older browsers: window resize listener
	if (typeof window !== 'undefined' && !resizeObserver) {
		const onResize = () => {
			if (!running) cachePositions();
			rafId = requestAnimationFrame(flip);
		};
		window.addEventListener('resize', onResize, { passive: true });
	}

	// Initial capture
	cachePositions();

	return {
		destroy() {
			resizeObserver?.disconnect();
			if (rafId) cancelAnimationFrame(rafId);
		},
	};
}
