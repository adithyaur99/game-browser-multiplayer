import * as THREE from 'three';

export class Pal3D {
    constructor(scene, x, z) {
        this.scene = scene;
        this.position = new THREE.Vector3(x, 1, z);
        this.speed = 0.05;
        this.moveDir = new THREE.Vector3();
        this.moveTimer = 0;

        // Mesh
        const geometry = new THREE.SphereGeometry(0.5, 16, 16);
        const material = new THREE.MeshStandardMaterial({ color: 0xf1c40f }); // Yellow
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.castShadow = true;
        this.scene.add(this.mesh);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8);
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.2, 0.2, 0.4);
        this.mesh.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.2, 0.2, 0.4);
        this.mesh.add(rightEye);
    }

    update(deltaTime = 0.016) {
        // Simple Wander AI
        this.moveTimer -= deltaTime;
        if (this.moveTimer <= 0) {
            this.moveTimer = 2 + Math.random() * 3;
            const angle = Math.random() * Math.PI * 2;
            this.moveDir.set(Math.cos(angle), 0, Math.sin(angle));
        }

        this.position.add(this.moveDir.clone().multiplyScalar(this.speed));

        // Keep within bounds (simple)
        if (this.position.x > 50) this.position.x = 50;
        if (this.position.x < -50) this.position.x = -50;
        if (this.position.z > 50) this.position.z = 50;
        if (this.position.z < -50) this.position.z = -50;

        this.mesh.position.copy(this.position);

        // Face movement direction
        if (this.moveDir.lengthSq() > 0) {
            const targetPos = this.position.clone().add(this.moveDir);
            this.mesh.lookAt(targetPos);
        }
    }
}
