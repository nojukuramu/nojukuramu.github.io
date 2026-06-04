/**
 * Input - Handles keyboard, mouse, and touch input
 */
const Input = {
    move: new Vec2(0, 0),
    aim: new Vec2(1, 0),
    isMoving: false,
    joyStart: new Vec2(0, 0),
    joyCurr: new Vec2(0, 0),
    joyId: null,
    aimId: null,
    keys: {}
};

/**
 * Initialize all input listeners
 */
function initInput() {
    // Prevent scrolling on touch
    document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

    // Touch: Start
    document.addEventListener('touchstart', e => {
        if (Game.isMagicOpen) return;

        for (let i = 0; i < e.changedTouches.length; i++) {
            let t = e.changedTouches[i];
            let x = t.clientX;
            let y = t.clientY;

            if (e.target.id === 'btnToggleMagic') continue;

            if (x < window.innerWidth / 2) {
                // Left Half: Movement Joystick
                if (!Input.isMoving) {
                    Input.isMoving = true;
                    Input.joyId = t.identifier;
                    Input.joyStart = new Vec2(x, y);
                    Input.joyCurr = new Vec2(x, y);
                }
            } else {
                // Right Half: Aiming
                Input.aimId = t.identifier;
                updateAim(x, y);
            }
        }
    }, { passive: false });

    // Touch: Move
    document.addEventListener('touchmove', e => {
        if (Game.isMagicOpen) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            let t = e.changedTouches[i];
            if (t.identifier === Input.joyId) {
                Input.joyCurr = new Vec2(t.clientX, t.clientY);
                let diff = Input.joyCurr.sub(Input.joyStart);
                if (diff.mag() > 50) diff = diff.norm().mul(50);
                Input.move = diff.mul(1 / 50);
            } else if (t.identifier === Input.aimId) {
                updateAim(t.clientX, t.clientY);
            }
        }
    }, { passive: false });

    // Touch: End
    document.addEventListener('touchend', e => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            let t = e.changedTouches[i];
            if (t.identifier === Input.joyId) {
                Input.isMoving = false;
                Input.move = new Vec2(0, 0);
            } else if (t.identifier === Input.aimId) {
                Input.aimId = null;
            }
        }
    });

    // Keyboard
    window.addEventListener('keydown', e => {
        Input.keys[e.key.toLowerCase()] = true;
        updateKeys();

        // Dash on Space or Shift
        if ((e.key === ' ' || e.key === 'Shift') && !Game.isMagicOpen) {
            e.preventDefault();
            if (Game.player) Game.player.dash();
        }
    });

    window.addEventListener('keyup', e => {
        Input.keys[e.key.toLowerCase()] = false;
        updateKeys();
    });

    // Mouse Aim
    window.addEventListener('mousemove', e => {
        if (!Input.aimId) updateAim(e.clientX, e.clientY);
    });

    // Disable context menu for right-click
    document.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * Process keyboard state into movement vector
 */
function updateKeys() {
    let v = new Vec2(0, 0);
    if (Input.keys['w']) v.y--;
    if (Input.keys['s']) v.y++;
    if (Input.keys['a']) v.x--;
    if (Input.keys['d']) v.x++;
    if (v.mag() > 0) v = v.norm();
    Input.move = v;

    // Inventory Selection 1-8
    for (let i = 1; i <= 8; i++) {
        if (Input.keys[i.toString()]) {
            selectSlot(i - 1);
        }
    }
}

/**
 * Update aim direction from screen coordinates
 */
function updateAim(tx, ty) {
    let center = new Vec2(window.innerWidth / 2, window.innerHeight / 2);
    Input.aim = new Vec2(tx, ty).sub(center).norm();
}
