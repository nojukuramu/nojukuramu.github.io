/* Rubiks — sheets, the session drawer, and the undo toast
 *
 * One sheet open at a time, one scrim behind it. The info sheet (info.js) is
 * the routecast one and stacks above these, so an (i) inside settings opens
 * over settings and closing it lands back there.
 *
 * On a phone the session column is a drawer with the same scrim; on a wide
 * screen it is always visible and open/close do nothing to it. */
"use strict";

var RK = RK || {};

RK.sheets = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var current = null, sideOpen = false, toastTimer = null, undoFn = null;

  function scrim(on) { $("scrim").hidden = !on; }

  function open(id) {
    close();
    var el = $("sheet-" + id);
    if (!el) return null;
    current = el;
    el.hidden = false;
    scrim(true);
    document.body.classList.add("sheet-open");
    try { el.focus({ preventScroll: true }); } catch (e) {}
    return el;
  }

  function close() {
    if (current) current.hidden = true;
    current = null;
    if (sideOpen) { sideOpen = false; $("side").classList.remove("open"); }
    scrim(false);
    document.body.classList.remove("sheet-open");
  }

  function openSide() {
    close();
    sideOpen = true;
    $("side").classList.add("open");
    scrim(true);
    document.body.classList.add("sheet-open");
  }

  function isOpen() {
    var info = document.querySelector(".info-sheet");
    return !!current || sideOpen || !!(info && !info.hidden);
  }

  function toast(text, onUndo) {
    clearTimeout(toastTimer);
    undoFn = onUndo || null;
    $("toast-text").textContent = text;
    $("toast-undo").hidden = !undoFn;
    $("toast").hidden = false;
    toastTimer = setTimeout(hideToast, undoFn ? 6000 : 2400);
  }

  function hideToast() { $("toast").hidden = true; undoFn = null; }

  function init() {
    document.querySelectorAll(".sheet").forEach(function (s) { s.tabIndex = -1; });
    $("scrim").addEventListener("click", close);
    $("side-close").addEventListener("click", close);
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-close]")) close();
    });
    $("toast-undo").addEventListener("click", function () {
      var fn = undoFn;
      hideToast();
      if (fn) fn();
    });
  }

  return { init: init, open: open, close: close, openSide: openSide, isOpen: isOpen, toast: toast, current: function () { return current; } };
})();
