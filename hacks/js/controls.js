/* controls.js — every action a player can take, what it is bound to by
 * default, and where each touch button sits until you move it.
 *
 * One table for all three: the key-binding screen lists ACTIONS, input.js
 * reads the binds it produces, the touch layout editor places TOUCH buttons,
 * and save.js re-checks whatever is stored against both. Pure data.
 *
 * Codes are KeyboardEvent.code for keys ("KeyW", "Space", "ShiftLeft"), and
 * "Mouse0"… for buttons and "WheelUp"/"WheelDown" for the wheel. The wheel
 * is bindable to jump on purpose: a notch is a fresh press, which is how
 * Source players bunny hop by hand. */

export const ACTIONS = [
  { id: "forward",  label: "Move forward",     def: ["KeyW", "ArrowUp"] },
  { id: "back",     label: "Move back",        def: ["KeyS", "ArrowDown"] },
  { id: "left",     label: "Strafe left",      def: ["KeyA", "ArrowLeft"] },
  { id: "right",    label: "Strafe right",     def: ["KeyD", "ArrowRight"] },
  { id: "jump",     label: "Jump",             def: ["Space", "WheelDown"] },
  { id: "crouch",   label: "Crouch / slide",   def: ["ControlLeft", "KeyC"] },
  { id: "sprint",   label: "Sprint",           def: ["ShiftLeft", ""] },
  { id: "fire",     label: "Fire",             def: ["Mouse0", ""] },
  { id: "ads",      label: "Aim down sights",  def: ["Mouse2", ""] },
  { id: "reload",   label: "Reload",           def: ["KeyR", ""] },
  { id: "lunge",    label: "Lunge (hold)",     def: ["KeyF", "Mouse3"] },
  { id: "melee",    label: "Quick melee",      def: ["KeyV", ""] },
  { id: "slot1",    label: "Primary",          def: ["Digit1", ""] },
  { id: "slot2",    label: "Secondary",        def: ["Digit2", ""] },
  { id: "slot3",    label: "Melee weapon",     def: ["Digit3", ""] },
  { id: "last",     label: "Last weapon",      def: ["KeyQ", ""] },
  { id: "next",     label: "Next weapon",      def: ["WheelUp", ""] },
  { id: "score",    label: "Scoreboard",       def: ["Tab", ""] },
  { id: "hacks",    label: "Hacks panel",      def: ["KeyH", "Backquote"] }
];
export const ACTION_IDS = ACTIONS.map((a) => a.id);

export function defaultBinds() {
  const b = {};
  for (const a of ACTIONS) b[a.id] = a.def.slice();
  return b;
}

/** A code as a person would read it. */
export function codeName(code) {
  if (!code) return "—";
  const named = { Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
    AltLeft: "L-Alt", AltRight: "R-Alt", Mouse0: "Mouse 1", Mouse1: "Mouse 3", Mouse2: "Mouse 2", Mouse3: "Mouse 4", Mouse4: "Mouse 5",
    WheelUp: "Wheel up", WheelDown: "Wheel down", Backquote: "`", Tab: "Tab", CapsLock: "Caps", Enter: "Enter", Backspace: "Backspace",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
  if (named[code]) return named[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return "Num " + code.slice(6);
  return code;
}
/** Codes the binding screen will accept. Escape is never bindable: it is always the way out. */
export const validCode = (c) => typeof c === "string" && c.length > 0 && c.length < 24 && /^[A-Za-z0-9]+$/.test(c) && c !== "Escape";

/* ---------------------------------------------------------------
   Touch: buttons, where they start, and what they do
   --------------------------------------------------------------- */
/*
 * x, y are the centre as a fraction of the screen; s is the diameter in CSS
 * pixels. Two starting layouts, because a thumb reaches different places on
 * a phone held sideways and one held upright. Every button stays on screen
 * at all times; the layout editor only moves, resizes and fades them.
 */
export const TOUCH = [
  { id: "stick",  action: "move",   icon: "move",    label: "Move" },
  { id: "fire",   action: "fire",   icon: "fire",    label: "Fire", look: true },
  { id: "fire2",  action: "fire",   icon: "fire",    label: "Fire (left)" },
  { id: "jump",   action: "jump",   icon: "jump",    label: "Jump" },
  { id: "crouch", action: "crouch", icon: "crouch",  label: "Crouch / slide" },
  { id: "ads",    action: "ads",    icon: "scope",   label: "Aim" },
  { id: "lunge",  action: "lunge",  icon: "lunge",   label: "Lunge (hold)", look: true },
  { id: "reload", action: "reload", icon: "reload",  label: "Reload" },
  { id: "swap",   action: "next",   icon: "swap",    label: "Next weapon" },
  { id: "melee",  action: "melee",  icon: "blade",   label: "Quick melee" },
  { id: "sprint", action: "sprint", icon: "sprint",  label: "Sprint (toggle)" },
  { id: "hacks",  action: "hacks",  icon: "code",    label: "Hacks" },
  { id: "score",  action: "score",  icon: "list",    label: "Scoreboard" },
  { id: "menu",   action: "menu",   icon: "pause",   label: "Menu" }
];
export const TOUCH_IDS = TOUCH.map((t) => t.id);

export const TOUCH_LAYOUTS = {
  landscape: {
    stick:  { x: 0.13, y: 0.72, s: 150 },
    fire:   { x: 0.86, y: 0.62, s: 84 },
    fire2:  { x: 0.22, y: 0.42, s: 58 },
    jump:   { x: 0.93, y: 0.82, s: 70 },
    crouch: { x: 0.8, y: 0.86, s: 62 },
    ads:    { x: 0.94, y: 0.45, s: 56 },
    lunge:  { x: 0.74, y: 0.7, s: 60 },
    reload: { x: 0.78, y: 0.44, s: 48 },
    swap:   { x: 0.66, y: 0.88, s: 52 },
    melee:  { x: 0.7, y: 0.52, s: 46 },
    sprint: { x: 0.26, y: 0.88, s: 50 },
    hacks:  { x: 0.9, y: 0.1, s: 44 },
    score:  { x: 0.83, y: 0.1, s: 40 },
    menu:   { x: 0.96, y: 0.1, s: 40 }
  },
  portrait: {
    stick:  { x: 0.24, y: 0.82, s: 140 },
    fire:   { x: 0.78, y: 0.7, s: 80 },
    fire2:  { x: 0.12, y: 0.58, s: 56 },
    jump:   { x: 0.88, y: 0.86, s: 66 },
    crouch: { x: 0.66, y: 0.9, s: 56 },
    ads:    { x: 0.9, y: 0.6, s: 52 },
    lunge:  { x: 0.62, y: 0.78, s: 56 },
    reload: { x: 0.9, y: 0.5, s: 46 },
    swap:   { x: 0.52, y: 0.9, s: 48 },
    melee:  { x: 0.75, y: 0.56, s: 44 },
    sprint: { x: 0.42, y: 0.92, s: 46 },
    hacks:  { x: 0.84, y: 0.06, s: 42 },
    score:  { x: 0.74, y: 0.06, s: 38 },
    menu:   { x: 0.94, y: 0.06, s: 38 }
  }
};
