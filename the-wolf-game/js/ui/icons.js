/* icons.js — one drawn glyph per idea, and no emoji anywhere.
 *
 * Emoji were doing three jobs badly: they render as a different picture on
 * every platform, they are full-colour blobs in a two-tone interface, and they
 * are the single loudest signal that a thing is a web page rather than a game.
 *
 * Everything here is a 24x24 stroke path on currentColor, so a glyph inherits
 * the ink of whatever it sits in and goes bloody along with the rest of the UI
 * when the village starts losing people.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  /* Stroke paths. Kept deliberately spare — at 20px a wolf with fur is a smudge,
   * a wolf with two ears and a snout is a wolf. */
  var P = {
    /* --- wolves --- */
    wolf:        "M2.6 4.4l4.2 4.6h10.4l4.2-4.6.6 7.2c0 5-4.2 8.6-10 8.6S2 16.6 2 11.6z M8.8 12.4h.01 M15.2 12.4h.01 M12 15.2l-2.4 2.8h4.8z",
    wolfAlpha:   "M2.6 6.8l4.2 4h10.4l4.2-4 .6 5.4c0 4.8-4.2 8.4-10 8.4S2 17 2 12.2z M8.8 13h.01 M15.2 13h.01 M12 15.6l-2.4 2.6h4.8z M12 1l1.1 2.3 2.5.3-1.8 1.8.4 2.5L12 6.7 9.8 7.9l.4-2.5L8.4 3.6l2.5-.3z",
    wolfMask:    "M2.6 4.4l4.2 4.6h10.4l4.2-4.6.6 7.2c0 5-4.2 8.6-10 8.6S2 16.6 2 11.6z M4.4 12.2h15.2 M12 15.4l-2.2 2.6h4.4z M8.4 9.4v2.8 M15.6 9.4v2.8",
    herb:        "M12 21c0-6 2-10 7-12-1 7-3 10-7 12z M12 21c0-5-1.8-8.6-6-10.4C6.6 16 8.6 19 12 21z M12 21v-4",
    /* --- village --- */
    person:      "M12 12.4a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8z M4.6 20.4c0-3.6 3.3-5.8 7.4-5.8s7.4 2.2 7.4 5.8",
    eye:         "M1.8 12S5.5 5.5 12 5.5 22.2 12 22.2 12 18.5 18.5 12 18.5 1.8 12 1.8 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    cross:       "M9.6 3h4.8v6.6H21v4.8h-6.6V21H9.6v-6.6H3V9.6h6.6z",
    shield:      "M12 2.6l8 3v6c0 5-3.4 8.9-8 10.4-4.6-1.5-8-5.4-8-10.4v-6z",
    shieldMan:   "M12 2.6l8 3v6c0 5-3.4 8.9-8 10.4-4.6-1.5-8-5.4-8-10.4v-6z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8.6 17c0-2 1.5-3.2 3.4-3.2s3.4 1.2 3.4 3.2",
    footprint:   "M9.6 21.4c-2.2 0-3.6-1.5-3.6-3.6 0-2.7 1.5-3.8 1.5-6.5 0-1.7-.6-2.7-.6-4.2C6.9 4.7 8.6 2.8 11 2.8s4 1.9 4 4.3c0 1.7-.6 2.7-.6 4.4 0 2.5 1.5 3.5 1.5 6.3 0 2.1-1.5 3.6-3.7 3.6z M18.6 8.4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M20.9 11.6a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6z",
    trap:        "M2.6 8.4c0 4 4.2 7.2 9.4 7.2s9.4-3.2 9.4-7.2 M2.6 15.6c0-4 4.2-7.2 9.4-7.2s9.4 3.2 9.4 7.2 M6.6 10.2l1.4 1.8 M9.9 10.7l.4 1.8 M14.1 10.7l-.4 1.8 M17.4 10.2L16 12 M12 15.8v5 M9 20.8h6",
    sword:       "M20.5 3.5l-9 9M20.5 3.5h-3.6l-9.8 9.8 3.6 3.6 9.8-9.8zM7.1 13.3l-3 3 3.6 3.6 3-3M4.4 19.6l-1.6 1.6",
    potion:      "M9.6 2.6h4.8 M10.4 2.6v4.8L6.2 15c-1.2 2.4.3 5.2 2.8 5.2h6c2.5 0 4-2.8 2.8-5.2l-4.2-7.6V2.6 M6.9 13.6h10.2",
    skull:       "M12 2.6c-4.7 0-8 3.3-8 7.6 0 2.6 1.2 4.3 2.6 5.4v3.2c0 1.4 1 2.6 2.4 2.6h6c1.4 0 2.4-1.2 2.4-2.6v-3.2c1.4-1.1 2.6-2.8 2.6-5.4 0-4.3-3.3-7.6-8-7.6z M9.2 11.4a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z M14.8 11.4a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z M10.4 15.6v5.2 M13.6 15.6v5.2",
    brick:       "M2.6 6.6h18.8v4.8H2.6z M2.6 12.6h18.8v4.8H2.6z M8.4 6.6v4.8 M15.6 6.6v4.8 M5.4 12.6v4.8 M12 12.6v4.8 M18.6 12.6v4.8",
    crown:       "M3 17.6h18 M3 17.6L4.4 7.4l4.4 3.4L12 4.6l3.2 6.2 4.4-3.4L21 17.6",
    moon:        "M20.6 14.4A8.8 8.8 0 0 1 9.6 3.4a8.8 8.8 0 1 0 11 11z",
    virus:       "M12 18.6a6.6 6.6 0 1 0 0-13.2 6.6 6.6 0 0 0 0 13.2z M12 5.4V2.4 M12 21.6v-3 M18.6 12h3 M2.4 12h3 M16.7 7.3l2.1-2.1 M5.2 18.8l2.1-2.1 M16.7 16.7l2.1 2.1 M5.2 5.2l2.1 2.1 M10.2 10.6h.01 M14 13.4h.01",
    mask:        "M3.6 5.4h16.8v5.4c0 4.8-3.8 8.8-8.4 8.8S3.6 15.6 3.6 10.8z M8 10.4h2.6 M13.4 10.4H16 M9.4 14.6c1.6 1.2 3.6 1.2 5.2 0",
    tent:        "M2.4 20.4h19.2 M12 3.4L3.6 20.4 M12 3.4l8.4 17 M12 3.4v17 M7.8 20.4l4.2-8.2 4.2 8.2",
    swap:        "M4 8.4h12.6l-3.4-3.4 M20 15.6H7.4l3.4 3.4",
    ghost:       "M4.6 20.6V10a7.4 7.4 0 0 1 14.8 0v10.6l-2.5-2-2.4 2-2.5-2-2.5 2-2.4-2z M9.6 10.4h.01 M14.4 10.4h.01",
    wings:       "M12 21.4V9.4 M12 9.4C9.2 5.6 5.4 4.4 1.8 5c.6 5 3.8 8.2 10.2 8.6 M12 9.4c2.8-3.8 6.6-5 10.2-4.4-.6 5-3.8 8.2-10.2 8.6 M8.6 4.4a3.4 3.4 0 0 1 6.8 0",
    spirit:      "M12 2.4l1.9 4.4 4.7.5-3.5 3.2 1 4.7L12 12.9 7.9 15.2l1-4.7L5.4 7.3l4.7-.5z M12 15.6v5.8 M9.2 21.4h5.6 M3.4 4.2l1.4 1.4 M20.6 4.2l-1.4 1.4",
    stethoscope: "M5 3.4v5.2a4.4 4.4 0 0 0 8.8 0V3.4 M4 3.4h2 M12.8 3.4h2 M9.4 13v2.6a4.4 4.4 0 0 0 8.8 0v-1.4 M18.6 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    cat:         "M3.6 4.6l3 4.6h10.8l3-4.6v7.2c0 4.6-3.8 8.2-8.4 8.2S3.6 16.4 3.6 11.8z M9 12.6h.01 M15 12.6h.01 M12 15.2l-1.4 1.4h2.8z M1.4 13.6h4.6 M22.6 13.6H18 M1.8 16.8l4.2-1.6 M22.2 16.8L18 15.2",
    dog:         "M6.8 4.8C4.2 5.6 2.8 7.8 2.8 10.4v2.8c0 4 4 6.8 9.2 6.8s9.2-2.8 9.2-6.8v-2.8c0-2.6-1.4-4.8-4-5.6 M6.8 4.8L8.4 11 M17.2 4.8L15.6 11 M9.2 12.8h.01 M14.8 12.8h.01 M12 15.4v1.4 M10.2 18.4c1.2.9 2.4.9 3.6 0",
    badge:       "M12 2.6l7.4 3v6.2c0 4.6-3.1 8.2-7.4 9.6-4.3-1.4-7.4-5-7.4-9.6V5.6z M8.8 12.2l2.2 2.2 4.4-4.4",
    phone:       "M7.4 3.6H4.6c-1.1 0-2 .9-2 2C2.6 13.8 10.2 21.4 18.4 21.4c1.1 0 2-.9 2-2v-2.8l-4.6-1.8-2.2 2.6a13.4 13.4 0 0 1-5-5l2.6-2.2z",
    candle:      "M9.4 10.4h5.2v10.2H9.4z M7.6 20.6h8.8 M12 10.4V8 M12 8c1.4-1 2-2 2-3.2 0-1.4-1-2.4-2-3.2-1 .8-2 1.8-2 3.2C10 6 10.6 7 12 8z",
    flame:       "M12 21.4c3.6 0 6.4-2.6 6.4-6 0-4.6-4.4-6.4-4.4-10.4-2.2 1.2-3 3-3 4.8 0 1.4.6 2.4.6 3.4 0 1-.8 1.6-1.6 1.6-1.2 0-1.8-1-1.8-2.4-1.6 1.4-2.6 3-2.6 5 0 3.4 2.8 6 6.4 6z",
    flameBurst:  "M12 21.4c3.6 0 6.4-2.6 6.4-6 0-4.6-4.4-6.4-4.4-10.4-2.2 1.2-3 3-3 4.8 0 1.4.6 2.4.6 3.4 0 1-.8 1.6-1.6 1.6-1.2 0-1.8-1-1.8-2.4-1.6 1.4-2.6 3-2.6 5 0 3.4 2.8 6 6.4 6z M2.6 9.4l2.4.8 M21.4 9.4l-2.4.8 M4.4 3.6l1.8 1.8 M19.6 3.6l-1.8 1.8",
    jester:      "M12 8.4c3.6 0 6.4 1.6 6.4 3.6v1.4H5.6V12c0-2 2.8-3.6 6.4-3.6z M5.6 13.4h12.8v2.2H5.6z M8 8.6L5.4 4.4 3 6.6 M16 8.6l2.6-4.2L21 6.6 M12 8.4V3.6 M3 6.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z M21 6.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z M12 3.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z M7 15.6v4.8h10v-4.8",
    dagger:      "M12 2.6l2.6 11.4h-5.2z M8.2 14h7.6 M12 14v5.4 M9.8 19.4h4.4",
    hush:        "M2 12S5.6 5.6 12 5.6c1.7 0 3.2.5 4.5 1.2 M22 12s-3.6 6.4-10 6.4c-1.8 0-3.4-.5-4.7-1.3 M12 15.2a3.2 3.2 0 0 0 3-4.3 M3.2 3.2l17.6 17.6",
    /* --- actions and UI --- */
    door:        "M5 21V4.6c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2V21 M3 21h18 M14.6 12.4h.01",
    house:       "M3.4 10.6L12 3.4l8.6 7.2V20a1.4 1.4 0 0 1-1.4 1.4H4.8A1.4 1.4 0 0 1 3.4 20z M9.4 21.4v-6.8h5.2v6.8",
    village:     "M1.6 12l4.4-3.6L10.4 12v8.4H1.6z M13.6 9l4.4-3.6L22.4 9v11.4h-8.8z M4.6 20.4v-3.6h2.8v3.6 M16.6 20.4v-4.4h2.8v4.4",
    alarm:       "M2.6 9.4v5.2h3.8l7 4.4V5L6.4 9.4z M16.6 8.6a5 5 0 0 1 0 6.8 M19.4 5.8a9 9 0 0 1 0 12.4",
    scales:      "M12 3.4v17 M6.6 20.4h10.8 M4.4 6.6h15.2 M4.4 6.6L1.6 13a3 3 0 0 0 5.6 0z M19.6 6.6L16.8 13a3 3 0 0 0 5.6 0z M12 4.6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
    chat:        "M20.4 12.6c0 4-3.8 7.2-8.4 7.2-1.2 0-2.4-.2-3.4-.6l-5 1.6 1.7-4.2a6.6 6.6 0 0 1-1.7-4c0-4 3.8-7.2 8.4-7.2s8.4 3.2 8.4 7.2z",
    clock:       "M12 21.4a9.4 9.4 0 1 0 0-18.8 9.4 9.4 0 0 0 0 18.8z M12 6.8V12l3.4 2.4",
    star:        "M12 2.6l2.9 6 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9z",
    sun:         "M12 17.4a5.4 5.4 0 1 0 0-10.8 5.4 5.4 0 0 0 0 10.8z M12 1.6v2.6 M12 19.8v2.6 M22.4 12h-2.6 M4.2 12H1.6 M19.4 4.6l-1.8 1.8 M6.4 17.6l-1.8 1.8 M19.4 19.4l-1.8-1.8 M6.4 6.4L4.6 4.6",
    sunrise:     "M12 14.4a4.4 4.4 0 0 1 8.8 0 M3.2 14.4h1.6 M12 2.6v3.4 M5.6 8.2l1.2 1.2 M18.4 8.2l-1.2 1.2 M2.6 18h18.8 M6 21.4h12",
    gear:        "M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z M19.2 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.3 14h-.3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.9 3.3V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z",
    users:       "M16.4 20.4v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.4a3.6 3.6 0 0 0-3.6 3.6v1.8 M9.6 11.4a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z M21.4 20.4v-1.8a3.6 3.6 0 0 0-2.7-3.5 M15.4 4.2a3.6 3.6 0 0 1 0 7",
    check:       "M20 6.4L9.4 17 4.4 12",
    close:       "M18.4 5.6L5.6 18.4 M5.6 5.6l12.8 12.8",
    plus:        "M12 5v14 M5 12h14",
    minus:       "M5 12h14",
    arrowRight:  "M4.6 12h14.8 M13.4 6l6 6-6 6",
    expand:      "M8.6 3.4H3.4v5.2 M15.4 3.4h5.2v5.2 M20.6 15.4v5.2h-5.2 M3.4 15.4v5.2h5.2",
    contract:    "M3.4 8.6h5.2V3.4 M20.6 8.6h-5.2V3.4 M15.4 20.6v-5.2h5.2 M8.6 20.6v-5.2H3.4",
    download:    "M12 3.4v11.2 M7 10l5 4.6 5-4.6 M4 19.6h16",
    contrast:    "M12 21.4a9.4 9.4 0 1 0 0-18.8 9.4 9.4 0 0 0 0 18.8z M12 2.6v18.8a9.4 9.4 0 0 0 0-18.8z",
    link:        "M9.4 14.6a4.4 4.4 0 0 0 6.6.5l2.6-2.6a4.4 4.4 0 0 0-6.2-6.2l-1.5 1.5 M14.6 9.4a4.4 4.4 0 0 0-6.6-.5L5.4 11.5a4.4 4.4 0 0 0 6.2 6.2l1.5-1.5",
    copy:        "M8.6 8.6h9.8c1.1 0 2 .9 2 2v9.8c0 1.1-.9 2-2 2H8.6c-1.1 0-2-.9-2-2v-9.8c0-1.1.9-2 2-2z M3.4 15.4h-.8c-1.1 0-2-.9-2-2V3.6c0-1.1.9-2 2-2h9.8c1.1 0 2 .9 2 2v.8",
    blood:       "M12 21.4c3.4 0 6-2.6 6-5.8C18 11 12 2.6 12 2.6S6 11 6 15.6c0 3.2 2.6 5.8 6 5.8z",
    howl:        "M12 21.4a9.4 9.4 0 1 0 0-18.8 9.4 9.4 0 0 0 0 18.8z M12 15.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z M12 1.4v3.6 M12 19v3.6 M22.6 12H19 M5 12H1.4",
    flag:        "M5 21.4V3.4 M5 4.4h13.4l-2.4 4.2 2.4 4.2H5",
    play:        "M7 4.6l12 7.4-12 7.4z",
    back:        "M19.4 12H4.6 M10.6 6l-6 6 6 6",
    lock:        "M6.6 10.6h10.8c1.1 0 2 .9 2 2v6.8c0 1.1-.9 2-2 2H6.6c-1.1 0-2-.9-2-2v-6.8c0-1.1.9-2 2-2z M8 10.6V7.4a4 4 0 0 1 8 0v3.2",
    refresh:     "M20.6 12a8.6 8.6 0 1 1-2.5-6.1 M20.6 3.6v5.4h-5.4",
    hourglass:   "M6 2.6h12 M6 21.4h12 M7 2.6v3.8L12 12l5-5.6V2.6 M7 21.4v-3.8L12 12l5 5.6v3.8"
  };

  /* Roles and events name a glyph rather than owning one, so several can share
   * a drawing without any of them being "the emoji one". */
  var ALIAS = {
    village: "village", werewolf: "wolf", cult: "candle", solo: "jester",
    task: "hourglass", report: "alarm", stay_in: "door", peek: "door",
    wolf_vote: "howl", mark: "skull", infect: "virus",
    protect: "cross", guard: "shieldMan", save: "potion", poison: "potion",
    investigate: "eye", detect: "footprint", trap: "trap", revenge: "sword",
    copy: "mask", copy_appearance: "mask", swap_roles: "swap",
    revive: "wings", vet_revive: "stethoscope", albularyo_revive: "herb",
    bite: "cat", recruit: "candle", guard_cult: "shieldMan", save_cult: "cross",
    stalk: "eye", assassinate: "dagger", pulis_investigate: "eye",
    pulis_kill: "badge", call_center_block: "phone"
  };

  function path(name) {
    return P[name] || P[ALIAS[name]] || P.person;
  }

  /**
   * An <svg> element for one glyph. `size` is CSS px; stroke scales with it so
   * a 16px icon does not read as a smudge and a 48px one does not read as a
   * cartoon.
   */
  function node(name, size, opts) {
    size = size || 20;
    opts = opts || {};
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", opts.weight || (size >= 40 ? 1.3 : size >= 28 ? 1.5 : 1.7));
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "ico" + (opts.class ? " " + opts.class : ""));
    var d = document.createElementNS(ns, "path");
    d.setAttribute("d", path(name));
    svg.appendChild(d);
    return svg;
  }

  function markup(name, size, weight) {
    size = size || 20;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="' + (weight || 1.7) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ico"><path d="' +
      path(name) + '"/></svg>';
  }

  WG.icons = { node: node, markup: markup, path: path, has: function (n) { return !!(P[n] || ALIAS[n]); }, names: Object.keys(P) };
})(typeof window !== "undefined" ? window : globalThis);
