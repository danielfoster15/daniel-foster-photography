// Full-screen viewer (PhotoSwipe, MIT) with a download button for the
// full-size file, the one-at-a-time viewer, and the grid switch. Without
// JavaScript, the links still open each photo and the viewer still scrolls.
import PhotoSwipeLightbox from "./photoswipe/photoswipe-lightbox.esm.min.js";

// Each of the highlights, viewer and grid opens full screen with its own photos.
const lightbox = new PhotoSwipeLightbox({
  gallery: ".highlights, .slides, .grid",
  children: "a.photo",
  pswpModule: () => import("./photoswipe/photoswipe.esm.min.js"),
  bgOpacity: 1,
});

lightbox.on("uiRegister", () => {
  lightbox.pswp.ui.registerElement({
    name: "download-button",
    order: 8,
    isButton: true,
    tagName: "a",
    title: "Download full size",
    html: {
      isCustomSVG: true,
      inner:
        '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
      outlineID: "pswp__icn-download",
    },
    onInit: (el, pswp) => {
      const point = () => {
        const link = pswp.currSlide?.data.element;
        if (!link) return;
        el.href = link.dataset.download;
        el.setAttribute("download", link.dataset.filename);
      };
      pswp.on("change", point);
      point();
    },
  });
});

lightbox.init();

const viewer = document.querySelector(".viewer");
const slides = document.querySelector(".slides");
const grid = document.querySelector(".grid");

if (viewer && slides) {
  const items = [...slides.children];
  const prev = viewer.querySelector(".arrow.prev");
  const next = viewer.querySelector(".arrow.next");
  const count = viewer.querySelector(".count");
  const save = viewer.querySelector(".save-current");
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let index = 0;

  const go = (i, animate = smooth) => {
    const target = Math.max(0, Math.min(items.length - 1, i));
    slides.scrollTo({ left: target * slides.clientWidth, behavior: animate ? "smooth" : "auto" });
  };

  // Follows the scroll position, whether it moved by swipe, arrow or key.
  const update = () => {
    if (slides.clientWidth === 0) return; // hidden
    index = Math.max(0, Math.min(items.length - 1, Math.round(slides.scrollLeft / slides.clientWidth)));
    count.textContent = `${index + 1} / ${items.length}`;
    const link = items[index].querySelector("a.photo");
    save.href = link.dataset.download;
    save.setAttribute("download", link.dataset.filename);
    prev.disabled = index === 0;
    next.disabled = index === items.length - 1;
    // Start loading the neighbours before they're swiped to.
    for (const j of [index - 1, index + 1, index + 2]) items[j]?.querySelector("img")?.setAttribute("loading", "eager");
  };

  let frame = 0;
  slides.addEventListener(
    "scroll",
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    },
    { passive: true },
  );
  // After full screen, stay on the photo it was closed on. On close so the
  // zoom-out lands on it, and again after PhotoSwipe hands focus back to the
  // photo that was clicked, since focusing scrolls that one back into view.
  let closedOn = -1;
  lightbox.on("close", () => {
    const slide = lightbox.pswp?.currSlide?.data.element?.closest(".slide");
    closedOn = slide ? items.indexOf(slide) : -1;
    if (closedOn >= 0) go(closedOn, false);
  });
  lightbox.on("destroy", () => {
    if (closedOn < 0) return;
    const target = closedOn;
    requestAnimationFrame(() => {
      if (slides.contains(document.activeElement)) items[target].querySelector("a.photo").focus({ preventScroll: true });
      go(target, false);
    });
  });
  prev.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));
  // Keep the same photo in view when the window is resized or the phone turned.
  addEventListener("resize", () => go(index, false));

  // Arrow keys step through while the viewer is on screen, unless the full-screen view is open.
  addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (viewer.hidden || document.querySelector(".pswp--open")) return;
    const box = viewer.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) return;
    e.preventDefault();
    go(index + (e.key === "ArrowRight" ? 1 : -1));
  });

  const toggle = document.querySelector(".toggle");
  const heading = document.querySelector(".section-bar h2");
  toggle?.addEventListener("click", () => {
    const showGrid = grid.hidden;
    grid.hidden = !showGrid;
    viewer.hidden = showGrid;
    const mode = showGrid ? "grid" : "viewer";
    toggle.textContent = toggle.dataset[mode];
    heading.textContent = heading.dataset[mode];
    if (!showGrid) {
      go(index, false);
      update();
    }
  });

  update();
}
