import * as THREE from 'three';

export class Sphere3D {
    constructor(scene, position, direction) {
        this.scene = scene;
        this.position = position.clone();
        this.velocity = direction.clone().multiplyScalar(0.5); // Speed
        this.velocity.y = 0.2; // Initial arc
        this.radius = 0.2;
        this.active = true;

        // Mesh
        const geometry = new THREE.SphereGeometry(this.radius, 16, 16);
        const material = new THREE.MeshStandardMaterial({
            color: 0x3498db,
            metalness: 0.5,
            roughness: 0.1
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);
    }

    update() {
        if (!this.active) return;

        this.velocity.y -= 0.01; // Gravity
        this.position.add(this.velocity);

        // Ground collision
        if (this.position.y < this.radius) {
            this.active = false;
            this.scene.remove(this.mesh);
        }

        this.mesh.position.copy(this.position);
    }

    checkCollision(pal) {
        if (!this.active) return false;
        const dist = this.position.distanceTo(pal.position);
        return dist < (this.radius + 0.5); // 0.5 is Pal radius
    }
}
