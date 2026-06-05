/**
 * Platform — lightweight mobile/touch detection.
 */
const Platform = (function () {
    function isMobile() {
        return (
            ('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
        );
    }
    return { isMobile };
})();
