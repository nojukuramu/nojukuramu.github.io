var Modes = (function () {
  var _root = null;
  var _manualMode = null; // null = auto, 'compact', 'full'

  function init(rootEl) {
    _root = rootEl || document.documentElement;
    var settings = Store.getSettings();
    _manualMode = settings.mode !== 'full' ? settings.mode : null;
    _apply();
    window.addEventListener('resize', _onResize);
  }

  function _autoMode() {
    return window.innerWidth < 640 ? 'compact' : 'full';
  }

  function _apply() {
    var mode = _manualMode || _autoMode();
    _root.setAttribute('data-mode', mode);
  }

  function _onResize() {
    if (!_manualMode) _apply();
  }

  function toggle() {
    var current = _root.getAttribute('data-mode');
    _manualMode = current === 'compact' ? 'full' : 'compact';
    Store.updateSettings({ mode: _manualMode });
    _apply();
  }

  function getMode() {
    return _root.getAttribute('data-mode') || 'full';
  }

  function popOut(taskId) {
    var url = 'index.html?mode=sticky' + (taskId ? '&task=' + encodeURIComponent(taskId) : '');
    var features = 'width=320,height=420,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no';
    window.open(url, 'tn-sticky-' + (taskId || 'all'), features);
  }

  function initFromUrl() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'sticky') {
      _manualMode = 'compact';
      _apply();
      // If a specific task, signal UI to highlight it
      var taskId = params.get('task');
      if (taskId) {
        document.documentElement.setAttribute('data-popout-task', taskId);
      }
    }
  }

  return { init: init, toggle: toggle, getMode: getMode, popOut: popOut, initFromUrl: initFromUrl };
})();
