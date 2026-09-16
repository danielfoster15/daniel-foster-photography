// Shared site navigation — injected into <div id="site-nav"></div> on every page.
// Works from both the site root (index.html) and dist/ pages.
(function () {
  const inDist = window.location.pathname.includes("/dist/");
  const root = inDist ? "../" : "";
  const d = inDist ? "" : "dist/";

  const link =
    'class="font-signika text-2xl tap-highlight-transparent uppercase"';
  const underline =
    '<span class="hidden md:block max-w-0 group-hover:max-w-full transition-all duration-500 h-0.5 bg-white"></span>';

  document.getElementById("site-nav").innerHTML = `
  <header class="flex w-full pt-10 pb-1">
    <nav id="nav" role="navigation" class="w-full">
      <div class="container mx-auto flex flex-wrap items-center md:flex-no-wrap">
        <div class="mr-4 md:mr-8">
          <a href="${root}index.html" class="text-2xl font-signika font-bold">DANIEL FOSTER PHOTOGRAPHY</a>
        </div>
        <div class="ml-auto md:hidden flex items-center justify-start">
          <button onclick="menuToggle()" aria-label="Open main menu"
            class="tap-highlight-transparent text-white w-5 h-5 relative focus:outline-none">
            <div class="block w-5 absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
              <span aria-hidden="true" class="block absolute h-0.5 w-5 bg-current -translate-y-1.5"></span>
              <span aria-hidden="true" class="block absolute h-0.5 w-5 bg-current"></span>
              <span aria-hidden="true" class="block absolute h-0.5 w-5 bg-current translate-y-1.5"></span>
            </div>
          </button>
        </div>
        <div id="menu"
          class="w-full h-0 overflow-hidden transition-all ease-out duration-500 md:transition-none md:w-auto md:h-auto md:overflow-visible md:flex-grow md:flex md:items-center">
          <ul id="ulMenu"
            class="flex flex-col md:space-x-5 mt-5 md:flex-row md:items-center md:ml-auto md:mt-0">
            <li class="group transition duration-300">
              <a href="${root}index.html" ${link}>HOME${underline}</a>
            </li>
            <li class="group relative transition duration-300" x-data="{ work: false }"
              @mouseenter="if (window.innerWidth >= 768) work = true"
              @mouseleave="if (window.innerWidth >= 768) work = false">
              <button @click="work = !work" ${link}>
                WORK &#9662;${underline}
              </button>
              <ul x-cloak x-show="work" x-transition
                class="flex flex-col pl-4 md:pl-0 md:absolute md:left-0 md:top-full md:bg-black md:border md:border-neutral-700 md:px-4 md:py-2 md:min-w-max z-50">
                <li class="group/sub py-1">
                  <a href="${d}absent_company.html" class="font-signika text-xl tap-highlight-transparent uppercase">Absent Company</a>
                </li>
                <li class="group/sub py-1">
                  <a href="${d}events.html" class="font-signika text-xl tap-highlight-transparent uppercase">Events</a>
                </li>
              </ul>
            </li>
            <li class="group transition duration-300">
              <a href="${d}workshops.html" ${link}>WORKSHOPS${underline}</a>
            </li>
            <li class="group transition duration-300">
              <a href="${d}about_me.html" ${link}>ABOUT ME${underline}</a>
            </li>
            <li class="group transition duration-300">
              <a href="${d}contact.html" ${link}>CONTACT${underline}</a>
            </li>
            <li class="mt-2 md:mt-0">
              <a href="https://www.instagram.com/danielfoster.photography" target="_blank" rel="noreferrer">
                <span class="sr-only">Instagram</span>
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/>
                  <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
                  <circle cx="17.4" cy="6.6" r="1.3"/>
                </svg>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  </header>`;
})();
