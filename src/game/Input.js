export class Input {
    constructor() {
        this.keys = {};
        this.mouse = { x: 0, y: 0, down: false, movementX: 0, movementY: 0 };
        this.isLocked = false;

        window.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;

            if (this.isLocked) {
                this.mouse.movementX = e.movementX || 0;
                this.mouse.movementY = e.movementY || 0;
            } else {
                this.mouse.movementX = 0;
                this.mouse.movementY = 0;
            }
        });

        window.addEventListener('mousedown', () => {
            this.mouse.down = true;
            if (!this.isLocked) {
                document.body.requestPointerLock();
            }
        });

        window.addEventListener('mouseup', () => {
            this.mouse.down = false;
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === document.body;
        });
    }

    isDown(code) {
        return !!this.keys[code];
    }

    getMouseDelta() {
        const delta = { x: this.mouse.movementX, y: this.mouse.movementY };
        // Reset delta after reading to avoid continuous movement
        this.mouse.movementX = 0;
        this.mouse.movementY = 0;
        return delta;
    }
}
