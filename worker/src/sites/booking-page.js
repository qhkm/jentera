// Server-rendered calendar links load a fresh document. Browsers do not
// reliably align a fragment when its target is already partly visible, which
// makes phone-sized pages appear to jump back to the top. Align it explicitly
// after layout, while keeping the page fully usable when JavaScript is off.
function scrollToBookingTarget() {
  if (!window.location.hash) return;
  const target = document.getElementById(window.location.hash.slice(1));
  if (!target) return;
  requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ block: 'start' })));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scrollToBookingTarget, { once: true });
} else {
  scrollToBookingTarget();
}

window.addEventListener('pageshow', (event) => {
  if (event.persisted) scrollToBookingTarget();
});
