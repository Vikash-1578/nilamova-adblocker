// Page ke andar (MAIN world) chalta hai: bina click ke khulne wale popups rokta hai.
(() => {
  if (window.__vabGuard) return;
  Object.defineProperty(window, "__vabGuard", { value: true });

  const realOpen = window.open;
  const fakeWindow = () => {
    // kuch scripts null milne par crash karte hain, isliye ek nakli window object
    const noop = () => {};
    return { closed: true, close: noop, focus: noop, blur: noop, postMessage: noop,
             document: { write: noop, writeln: noop, close: noop, open: noop },
             location: { href: "", replace: noop, assign: noop } };
  };

  function guardedOpen(...args) {
    const ua = navigator.userActivation;
    const userClicked = ua ? ua.isActive : true;
    if (!userClicked) {
      window.postMessage({ __vab: "popupBlocked" }, "*");
      return fakeWindow();
    }
    return realOpen.apply(this, args);
  }
  try {
    Object.defineProperty(guardedOpen, "toString", { value: () => realOpen.toString() });
    window.open = guardedOpen;
  } catch (_) {}
})();
