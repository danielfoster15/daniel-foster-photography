// Shared site navigation — injected into <div id="site-nav"></div> on every page.
// Works from both the site root (index.html) and dist/ pages.
(function () {
  const inDist = window.location.pathname.includes("/dist/");
  const root = inDist ? "../" : "";
  const d = inDist ? "" : "dist/";

  const link =
    'class="font-signika text-2xl lg:text-lg xl:text-2xl tap-highlight-transparent uppercase"';
  const underline =
    '<span class="hidden lg:block max-w-0 group-hover:max-w-full transition-all duration-500 h-0.5 bg-white"></span>';

  document.getElementById("site-nav").innerHTML = `
  <header class="flex w-full pt-10 pb-1">
    <nav id="nav" role="navigation" class="w-full">
      <div class="container mx-auto flex flex-wrap items-center lg:flex-no-wrap">
        <div class="mr-4 lg:mr-8">
          <a href="${root}index.html" class="text-2xl lg:text-lg xl:text-2xl font-signika font-bold">DANIEL FOSTER PHOTOGRAPHY</a>
        </div>
        <div class="ml-auto lg:hidden flex items-center justify-start">
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
          class="w-full h-0 overflow-hidden transition-all ease-out duration-500 lg:transition-none lg:w-auto lg:h-auto lg:overflow-visible lg:flex-grow lg:flex lg:items-center">
          <ul id="ulMenu"
            class="flex flex-col mt-5 lg:flex-row lg:items-center lg:ml-auto lg:mt-0 lg:space-x-4 xl:space-x-5">
            <li class="group transition duration-300">
              <a href="${root}index.html" ${link}>HOME${underline}</a>
            </li>
            <li class="group relative transition duration-300" x-data="{ work: false }"
              @mouseenter="if (window.innerWidth >= 1024) work = true"
              @mouseleave="if (window.innerWidth >= 1024) work = false">
              <button @click="work = !work" ${link}>
                WORK &#9662;${underline}
              </button>
              <ul x-cloak x-show="work" x-transition
                class="flex flex-col pl-4 lg:pl-0 lg:absolute lg:left-0 lg:top-full lg:bg-black lg:border lg:border-neutral-700 lg:px-4 lg:py-2 lg:min-w-max z-50">
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
            <li class="mt-2 lg:mt-0">
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
