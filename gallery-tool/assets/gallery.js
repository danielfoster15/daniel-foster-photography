// Full-screen viewer (PhotoSwipe, MIT) with a download button for the
// full-size file. Without JavaScript, the links still open each photo.
import PhotoSwipeLightbox from "./photoswipe/photoswipe-lightbox.esm.min.js";

const lightbox = new PhotoSwipeLightbox({
  gallery: ".grid",
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
