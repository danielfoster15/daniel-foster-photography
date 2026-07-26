// Shared site footer — injected into <div id="site-footer"></div> on every page.
(function () {
  document.getElementById("site-footer").innerHTML = `
  <footer>
    <div class="max-w-screen-xl py-16 mx-auto">
      <div class="grid grid-cols-1 gap-8 text-center mx-auto">
        <div>
          <p class="font-signika"><b>DANIEL FOSTER PHOTOGRAPHY</b></p>
          <p class="mt-4 text-sm text-gray-300">Amsterdam, Netherlands<br /></p>
          <div class="flex mx-auto">
            <div class="mx-auto space-x-6 flex mt-8 text-gray-300">
              <a class="transition duration-300 hover:opacity-75"
                href="https://www.instagram.com/dfoster.photography" target="_blank" rel="noreferrer">
                <span class="sr-only">Instagram</span>
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/>
                  <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/>
                  <circle cx="17.4" cy="6.6" r="1.3"/>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
      <p class="mt-8 text-xs text-gray-300 text-center">
        &copy; 2023 Basis for website developed and designed by
        <a href="https://www.linkedin.com/in/jo%C3%A3o-franco-452161195/" class="underline">Jo&atilde;o Franco</a>
        All photos &copy; 2026 Daniel Foster
      </p>
    </div>
  </footer>`;
})();
