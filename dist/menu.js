// Getting hamburguer menu in small screens
const menu = document.getElementById("menu");
const ulMenu = document.getElementById("ulMenu");

function menuToggle() {
  // height:auto (via .menu-open) so the menu fits any number of items,
  // including the expanded WORK submenu
  menu.classList.toggle("menu-open");
}

// Browser resize listener
window.addEventListener("resize", menuResize);

// Resize menu if user changing the width with responsive menu opened
function menuResize() {
  // First get the size from the window
  const window_size = window.innerWidth || document.body.clientWidth;
  if (window_size >= 1024) {
    menu.classList.remove("menu-open");
  }
}
