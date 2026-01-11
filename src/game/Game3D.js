import * as THREE from 'three';
import { Player3D } from './Player3D.js';
import { World3D } from './World3D.js';
import { Input } from './Input.js';

export class Game3D {
    constructor(canvas) {
        this.canvas = canvas;
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setSize(this.width, this.height);
        this.renderer.shadowMap.enabled = true;

        // Scene
        this.scene = new THREE.Scene();
        // Stockholm-like Nordic sky - soft gray-blue
        this.scene.background = new THREE.Color(0xB8C5D6);
        this.scene.fog = new THREE.Fog(0xB8C5D6, 30, 120);

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 1000);
        this.camera.position.set(0, 5, 10);

        // Lights - Nordic soft lighting
        const ambientLight = new THREE.AmbientLight(0xD4E4F7, 0.7);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xFFF8E7, 0.6);
        dirLight.position.set(30, 40, 30);
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 50;
        dirLight.shadow.camera.bottom = -50;
        dirLight.shadow.camera.left = -50;
        dirLight.shadow.camera.right = 50;
        this.scene.add(dirLight);

        // Systems
        this.input = new Input();
        this.world = new World3D(this.scene);
        this.player = new Player3D(this.scene, this.input, this.camera, this.world);

        // Bind resize
        this.resize(this.width, this.height);
    }

    start() {
        this.renderer.setAnimationLoop(() => this.loop());
    }

    loop() {
        this.player.update();
        this.world.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize(width, height) {
        this.width = width;
        this.height = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}
