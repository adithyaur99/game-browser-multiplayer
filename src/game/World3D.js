import * as THREE from 'three';
import { Pal3D } from './Pal3D.js';
import { Sphere3D } from './Sphere3D.js';

export class World3D {
    constructor(scene) {
        this.scene = scene;
        this.pals = [];
        this.spheres = [];
        this.generate();
    }

    generate() {
        // ... (existing generation code) ...
        // Ground - Stockholm natural terrain
        const groundGeo = new THREE.PlaneGeometry(100, 100);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x7A8B6F, // Earthy gray-green
            roughness: 0.9,
            metalness: 0.1
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Trees
        for (let i = 0; i < 20; i++) {
            this.createTree(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80
            );
        }

        // Rocks
        for (let i = 0; i < 15; i++) {
            this.createRock(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80
            );
        }

        // Pals
        for (let i = 0; i < 10; i++) {
            this.pals.push(new Pal3D(
                this.scene,
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80
            ));
        }
    }

    addSphere(position, direction) {
        this.spheres.push(new Sphere3D(this.scene, position, direction));
    }

    update(deltaTime) {
        this.pals.forEach(pal => pal.update(deltaTime));

        // Update Spheres and check collisions
        for (let i = this.spheres.length - 1; i >= 0; i--) {
            const sphere = this.spheres[i];
            sphere.update();

            if (!sphere.active) {
                this.spheres.splice(i, 1);
                continue;
            }

            // Check collision with Pals
            for (let j = this.pals.length - 1; j >= 0; j--) {
                const pal = this.pals[j];
                if (sphere.checkCollision(pal)) {
                    // Caught!
                    console.log("Caught Pal!");
                    this.scene.remove(pal.mesh);
                    this.pals.splice(j, 1);

                    // Remove sphere too
                    this.scene.remove(sphere.mesh);
                    this.spheres.splice(i, 1);
                    sphere.active = false;
                    break;
                }
            }
        }
    }

    createTree(x, z) {
        const group = new THREE.Group();

        // Trunk - darker Nordic pine
        const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 3, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4A3728 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.5;
        trunk.castShadow = true;
        group.add(trunk);

        // Leaves - darker Nordic green (pine/spruce)
        const leavesGeo = new THREE.ConeGeometry(1.8, 5, 8);
        const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2C5530 });
        const leaves = new THREE.Mesh(leavesGeo, leavesMat);
        leaves.position.y = 4;
        leaves.castShadow = true;
        group.add(leaves);

        group.position.set(x, 0, z);
        this.scene.add(group);
    }

    createRock(x, z) {
        const geo = new THREE.DodecahedronGeometry(Math.random() * 0.5 + 0.5);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x7A7D7F, // Natural granite gray
            roughness: 0.9
        });
        const rock = new THREE.Mesh(geo, mat);
        rock.position.set(x, 0.5, z);
        rock.castShadow = true;
        this.scene.add(rock);
    }
}
