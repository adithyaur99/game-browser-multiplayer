
import * as THREE from 'three';

export class Player3D {
    constructor(scene, input, camera, world) {
        this.scene = scene;
        this.input = input;
        this.camera = camera;
        this.world = world;

        this.position = new THREE.Vector3(0, 1, 0);
        this.velocity = new THREE.Vector3();
        this.speed = 0.1;
        this.rotationSpeed = 0.05;
        this.throwCooldown = 0;

        // Mesh
        const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
        const material = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);

        // Camera Offset
        this.cameraOffset = new THREE.Vector3(0, 5, 8);
    }

    update() {
        // Throwing
        if (this.throwCooldown > 0) this.throwCooldown--;
        if (this.input.mouse.down && this.throwCooldown <= 0) {
            const throwDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
            throwDir.y = 0.5; // Aim up slightly
            throwDir.normalize();

            this.world.addSphere(this.position.clone().add(new THREE.Vector3(0, 1, 0)), throwDir);
            this.throwCooldown = 30; // 0.5s at 60fps

            // Update UI (Mock)
            const countEl = document.getElementById('sphere-count');
            if (countEl) {
                let count = parseInt(countEl.innerText);
                if (count > 0) countEl.innerText = count - 1;
            }
        }
        // Movement
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);

        let moveDir = new THREE.Vector3();

        if (this.input.isDown('KeyW')) moveDir.add(forward);
        if (this.input.isDown('KeyS')) moveDir.sub(forward);
        if (this.input.isDown('KeyA')) moveDir.sub(right);
        if (this.input.isDown('KeyD')) moveDir.add(right);

        // Mouse Rotation
        const mouseDelta = this.input.getMouseDelta();
        if (mouseDelta.x !== 0) {
            this.mesh.rotation.y -= mouseDelta.x * 0.002;
        }

        // Jumping
        if (this.input.isDown('Space') && this.position.y <= 1.01) {
            this.velocity.y = 0.2;
        }

        // Gravity
        this.velocity.y -= 0.01; // Gravity
        this.position.y += this.velocity.y;

        // Ground Collision
        if (this.position.y < 1) {
            this.position.y = 1;
            this.velocity.y = 0;
        }

        if (moveDir.length() > 0) {
            moveDir.normalize().multiplyScalar(this.speed);
            this.position.add(moveDir);
        }

        // Update Mesh
        this.mesh.position.copy(this.position);

        // Update Camera
        // Simple 3rd person follow
        const idealOffset = this.cameraOffset.clone().applyQuaternion(this.mesh.quaternion);
        const idealLookAt = this.position.clone().add(new THREE.Vector3(0, 0, 0));

        const currentPos = new THREE.Vector3().copy(this.camera.position);
        const targetPos = this.position.clone().add(idealOffset);

        currentPos.lerp(targetPos, 0.1);
        this.camera.position.copy(currentPos);
        this.camera.lookAt(idealLookAt);
    }
}
