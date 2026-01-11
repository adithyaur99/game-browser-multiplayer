import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// --- Game Constants ---
const DIFFICULTY_SETTINGS = {
    easy: { truckSpeed: 18, gapSize: 16, spawnDistance: 90 },
    medium: { truckSpeed: 24, gapSize: 15, spawnDistance: 90 },
    hard: { truckSpeed: 30, gapSize: 14, spawnDistance: 90 },
    insane: { truckSpeed: 38, gapSize: 13, spawnDistance: 90 },
};
let selectedDifficulty = 'hard';
let TRUCK_SPEED = DIFFICULTY_SETTINGS[selectedDifficulty].truckSpeed;
const PLAYER_ACCEL = 45;
const PLAYER_MAX_SPEED = 38;
const PLAYER_DRAG = 12;
const GRAVITY = 45;
const JUMP_FORCE = 19;
let GAP_SIZE = DIFFICULTY_SETTINGS[selectedDifficulty].gapSize;

// Swedish Summer Countryside Color Palette
const COLORS = {
    skyTop: 0x4a90d9,      // Bright Swedish blue
    skyBottom: 0x87ceeb,    // Light sky blue
    sunColor: 0xfffaf0,     // Warm white sun
    horizon: 0xffeedd,      // Warm horizon
    fog: 0xc9dff2,          // Light blue fog
    grass: 0x4a7c23,        // Lush green Swedish meadow
    grassLight: 0x5d9a2d,   // Lighter green grass
    grassDark: 0x3a6a1a,    // Darker green patches
    dirt: 0x6a5a3a,         // Dirt/gravel color
    asphalt: 0x4a4a4a,      // Road
    asphaltDark: 0x3a3a3a,
    roadMarking: 0xf5f5f5,
    scaniaBlue: 0x003366,   // Official Scania blue
    scaniaGray: 0x4a4a4a,   // Scania dark gray
    chrome: 0xe8e8e8,
    rubber: 0x1a1a1a,
    concrete: 0x999999,
    bark: 0x4a3728,
    pineNeedles: 0x2d5a2d,
    pineNeedlesLight: 0x3d7a3d,
    deadGrass: 0x6a8a3a,    // Slightly yellower grass patches
    soil: 0x5a4a30,         // Exposed soil
};

// --- Globals ---
let scene, camera, renderer, composer;
let player;
let trucks = [];
let ramp;
let lastTime = 0;
let envMap;
let dustParticles;

// State
let playerVelocity = new THREE.Vector3(0, 0, 0);
let isAccelerating = false;
let isJumping = false;
let hasJumped = false;
let passedThroughTrucks = false;
let gameOver = false;
let gameWon = false;
let gameStarted = false;
let gameFailed = false;
let score = 0;
let startTime = 0;
let elapsedTime = 0;
let bestTime = localStorage.getItem('bestTime') ? parseFloat(localStorage.getItem('bestTime')) : null;
let difficulty = 1;

// Crash physics state
let crashState = null;
let bikeGroup = null;
let riderGroup = null;
let crashDebris = [];

// Multiplayer state
let isMultiplayer = false;
let isHost = false;
let peer = null;
let conn = null;
let remotePlayer = null;
let remotePlayerData = { x: 0, y: 0, z: 55, vy: 0, crashed: false, won: false };
let localPlayerNum = 1;

// --- Custom Shaders ---

// Sunny Swedish Sky Shader
const SkyShader = {
    uniforms: {
        sunPosition: { value: new THREE.Vector3(80, 100, 40) },
        sunColor: { value: new THREE.Color(COLORS.sunColor) },
        skyColorTop: { value: new THREE.Color(COLORS.skyTop) },
        skyColorBottom: { value: new THREE.Color(COLORS.skyBottom) },
        horizonColor: { value: new THREE.Color(COLORS.horizon) },
        sunIntensity: { value: 2.0 },
    },
    vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 sunPosition;
        uniform vec3 sunColor;
        uniform vec3 skyColorTop;
        uniform vec3 skyColorBottom;
        uniform vec3 horizonColor;
        uniform float sunIntensity;
        varying vec3 vWorldPosition;

        void main() {
            vec3 viewDir = normalize(vWorldPosition - cameraPosition);
            float height = viewDir.y * 0.5 + 0.5;

            // Sky gradient - brighter, more Swedish summer feel
            vec3 skyColor = mix(skyColorBottom, skyColorTop, pow(height, 0.4));

            // Warm horizon blend
            float horizonFactor = pow(1.0 - abs(viewDir.y), 6.0);
            skyColor = mix(skyColor, horizonColor, horizonFactor * 0.4);

            // Sun
            vec3 sunDir = normalize(sunPosition);
            float sunDot = dot(viewDir, sunDir);

            // Sun disc - bright and warm
            float sunDisc = smoothstep(0.9993, 0.9998, sunDot);

            // Sun glow - larger, warmer
            float sunGlow = pow(max(0.0, sunDot), 4.0) * 0.6;
            float sunHalo = pow(max(0.0, sunDot), 32.0) * 1.5;

            // Combine
            vec3 finalColor = skyColor;
            finalColor += sunColor * sunGlow * sunIntensity * 0.3;
            finalColor += sunColor * sunHalo * sunIntensity;
            finalColor = mix(finalColor, sunColor * 1.5, sunDisc);

            gl_FragColor = vec4(finalColor, 1.0);
        }
    `
};

// Vignette + Film Grain Shader (lighter for sunny day)
const VignetteGrainShader = {
    uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        vignetteIntensity: { value: 0.25 },
        vignetteRadius: { value: 0.9 },
        grainIntensity: { value: 0.03 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float vignetteIntensity;
        uniform float vignetteRadius;
        uniform float grainIntensity;
        varying vec2 vUv;

        float random(vec2 co) {
            return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);

            // Light vignette
            vec2 center = vec2(0.5);
            float dist = distance(vUv, center);
            float vignette = smoothstep(vignetteRadius, vignetteRadius - 0.5, dist);
            vignette = mix(1.0, vignette, vignetteIntensity);

            // Subtle grain
            float grain = random(vUv + time) * 2.0 - 1.0;
            grain *= grainIntensity;

            color.rgb *= vignette;
            color.rgb += grain;

            // Warm sunny color grading
            color.rgb *= vec3(1.02, 1.01, 0.98);

            gl_FragColor = color;
        }
    `
};

// --- Helpers ---
function createWheel(radius = 0.6, isDouble = false) {
    const group = new THREE.Group();

    const createSingleWheel = (zOffset = 0) => {
        // Tire
        const tireGeo = new THREE.TorusGeometry(radius, radius * 0.35, 16, 32);
        const tireMat = new THREE.MeshStandardMaterial({
            color: COLORS.rubber,
            roughness: 0.9,
            metalness: 0.0,
        });
        const tire = new THREE.Mesh(tireGeo, tireMat);
        tire.rotation.y = Math.PI / 2;
        tire.position.z = zOffset;
        tire.castShadow = true;
        group.add(tire);

        // Rim with Scania style
        const rimGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, radius * 0.25, 24);
        const rimMat = new THREE.MeshStandardMaterial({
            color: COLORS.chrome,
            roughness: 0.15,
            metalness: 0.9,
            envMap: envMap,
            envMapIntensity: 1.0,
        });
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.z = zOffset;
        group.add(rim);

        // Hub cap
        const hubGeo = new THREE.CylinderGeometry(radius * 0.2, radius * 0.15, radius * 0.3, 12);
        const hub = new THREE.Mesh(hubGeo, rimMat);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = zOffset;
        group.add(hub);
    };

    if (isDouble) {
        createSingleWheel(-0.25);
        createSingleWheel(0.25);
    } else {
        createSingleWheel(0);
    }

    return group;
}

function createPineTree(x, z) {
    const tree = new THREE.Group();
    const scale = 0.7 + Math.random() * 0.6;

    // Trunk
    const trunkHeight = 3.5 * scale;
    const trunkGeo = new THREE.CylinderGeometry(0.25 * scale, 0.4 * scale, trunkHeight, 8);
    const trunkMat = new THREE.MeshStandardMaterial({
        color: COLORS.bark,
        roughness: 1.0,
        metalness: 0.0,
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    // Multiple cone layers - lush Swedish pine
    const layers = 5;
    let yOffset = trunkHeight * 0.5;

    for (let i = 0; i < layers; i++) {
        const layerScale = 1 - (i / layers) * 0.6;
        const coneRadius = 2.2 * scale * layerScale;
        const coneHeight = 2.5 * scale * layerScale;

        const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 8);
        const shade = 0.8 + Math.random() * 0.2;
        const leavesMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(COLORS.pineNeedles).multiplyScalar(shade),
            roughness: 0.8,
            metalness: 0.0,
        });

        const cone = new THREE.Mesh(coneGeo, leavesMat);
        cone.position.y = yOffset + coneHeight / 2;
        cone.rotation.y = Math.random() * Math.PI;
        cone.castShadow = true;
        cone.receiveShadow = true;
        tree.add(cone);

        yOffset += coneHeight * 0.45;
    }

    tree.position.set(x, 0, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    return tree;
}

function createRock(x, z, scale = 1) {
    const rockGeo = new THREE.DodecahedronGeometry(scale, 1);

    const positions = rockGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const px = positions.getX(i);
        const py = positions.getY(i);
        const pz = positions.getZ(i);
        const noise = (Math.random() - 0.5) * 0.3;
        positions.setXYZ(i, px + noise, py + noise * 0.5, pz + noise);
    }
    rockGeo.computeVertexNormals();

    const rockMat = new THREE.MeshStandardMaterial({
        color: 0x666666,
        roughness: 0.9,
        metalness: 0.05,
    });

    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(x, scale * 0.3, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.set(1, 0.5 + Math.random() * 0.4, 1);
    rock.castShadow = true;
    rock.receiveShadow = true;
    return rock;
}

function createGrassField() {
    const grassGroup = new THREE.Group();

    // Autumn dry grass - more varied colors
    const grassColors = [
        COLORS.grass,
        COLORS.grassLight,
        COLORS.grassDark,
        COLORS.deadGrass,
    ];

    const grassCount = 12000; // More grass for denser field
    const fieldSize = 200;

    const bladeGeo = new THREE.ConeGeometry(0.05, 0.6, 4);
    bladeGeo.translate(0, 0.3, 0);

    // Create multiple grass layers with different colors
    grassColors.forEach((color, colorIdx) => {
        const grassMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.9,
            metalness: 0.0,
        });

        const count = Math.floor(grassCount / grassColors.length);
        const grassMesh = new THREE.InstancedMesh(bladeGeo, grassMat, count);
        grassMesh.receiveShadow = true;

        const dummy = new THREE.Object3D();
        let index = 0;

        for (let i = 0; i < count * 2 && index < count; i++) {
            const gx = (Math.random() - 0.5) * fieldSize;
            const gz = (Math.random() - 0.5) * fieldSize;

            if (Math.abs(gx) < 8 || Math.abs(gz) < 8) continue;

            dummy.position.set(gx, 0, gz);
            dummy.rotation.y = Math.random() * Math.PI * 2;
            dummy.rotation.x = (Math.random() - 0.5) * 0.3; // Slight tilt
            dummy.scale.setScalar(0.5 + Math.random() * 1.0);
            dummy.updateMatrix();

            grassMesh.setMatrixAt(index, dummy.matrix);
            index++;
        }

        grassMesh.instanceMatrix.needsUpdate = true;
        grassGroup.add(grassMesh);
    });

    return grassGroup;
}

function createTreeLine() {
    const treeLineGroup = new THREE.Group();

    // Dense tree line in the background (like reference image)
    // Back tree line (far)
    for (let i = 0; i < 80; i++) {
        const x = (Math.random() - 0.5) * 250;
        const z = -70 - Math.random() * 40;
        treeLineGroup.add(createPineTree(x, z));
    }

    // Side tree lines
    for (let i = 0; i < 40; i++) {
        const z = (Math.random() - 0.5) * 150;
        const xLeft = -80 - Math.random() * 30;
        const xRight = 80 + Math.random() * 30;
        if (Math.abs(z) > 15) {
            treeLineGroup.add(createPineTree(xLeft, z));
            treeLineGroup.add(createPineTree(xRight, z));
        }
    }

    // Scattered trees around the field (but not on roads)
    for (let i = 0; i < 25; i++) {
        const x = (Math.random() - 0.5) * 160;
        const z = (Math.random() - 0.5) * 120;
        if (Math.abs(x) > 15 && Math.abs(z) > 15) {
            treeLineGroup.add(createPineTree(x, z));
        }
    }

    return treeLineGroup;
}

function createDustParticles() {
    const particleCount = 150;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 100;
        positions[i * 3 + 1] = Math.random() * 15;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 100;

        velocities[i * 3] = (Math.random() - 0.5) * 0.08;
        velocities[i * 3 + 1] = Math.random() * 0.015;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.08;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.userData.velocities = velocities;

    const material = new THREE.PointsMaterial({
        color: 0xffffee,
        size: 0.12,
        transparent: true,
        opacity: 0.3,
        sizeAttenuation: true,
    });

    return new THREE.Points(geometry, material);
}

function createEnvMap() {
    const size = 128;
    const cubeTexture = new THREE.CubeTexture([]);
    const canvases = [];

    // Swedish summer sky colors for each face
    const faceColors = [
        [135, 190, 235], // +X bright sky
        [135, 190, 235], // -X
        [74, 144, 217],  // +Y (top - deeper blue)
        [74, 124, 35],   // -Y (bottom - green grass)
        [135, 190, 235], // +Z
        [135, 190, 235], // -Z
    ];

    for (let i = 0; i < 6; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, size);
        const col = faceColors[i];
        gradient.addColorStop(0, `rgb(${col[0]}, ${col[1]}, ${col[2]})`);
        gradient.addColorStop(1, `rgb(${Math.floor(col[0]*0.85)}, ${Math.floor(col[1]*0.85)}, ${Math.floor(col[2]*0.9)})`);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        canvases.push(canvas);
    }

    cubeTexture.images = canvases;
    cubeTexture.needsUpdate = true;
    return cubeTexture;
}

// --- Crash Physics System ---
function initCrash(impactDirection, truckVelocity) {
    crashState = {
        riderParts: [],
        bikeParts: [],
        sparks: [],
        time: 0,
    };

    // Calculate impact force and direction
    const impactForce = Math.abs(playerVelocity.z) + Math.abs(truckVelocity);
    const launchAngle = impactDirection > 0 ? -1 : 1;

    // Separate rider from bike - rider flies off
    if (riderGroup && bikeGroup) {
        // Get world positions
        const riderWorldPos = new THREE.Vector3();
        riderGroup.getWorldPosition(riderWorldPos);
        const bikeWorldPos = new THREE.Vector3();
        bikeGroup.getWorldPosition(bikeWorldPos);

        // Move rider to scene directly with physics
        riderGroup.traverse((child) => {
            if (child.isMesh) {
                const worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);

                // Create physics body for each part
                const partData = {
                    mesh: child.clone(),
                    velocity: new THREE.Vector3(
                        (Math.random() - 0.5) * 8 + launchAngle * impactForce * 0.6,
                        12 + Math.random() * 8, // Launch upward
                        playerVelocity.z * 0.5 + (Math.random() - 0.5) * 5
                    ),
                    angularVel: new THREE.Vector3(
                        (Math.random() - 0.5) * 15,
                        (Math.random() - 0.5) * 15,
                        (Math.random() - 0.5) * 15
                    ),
                    gravity: 35,
                    bounceCount: 0,
                    friction: 0.7,
                };

                partData.mesh.position.copy(worldPos);
                scene.add(partData.mesh);
                crashState.riderParts.push(partData);
            }
        });

        // Bike tumbles differently - slides and spins
        bikeGroup.traverse((child) => {
            if (child.isMesh) {
                const worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);

                const partData = {
                    mesh: child.clone(),
                    velocity: new THREE.Vector3(
                        launchAngle * impactForce * 0.3 + (Math.random() - 0.5) * 3,
                        4 + Math.random() * 3,
                        playerVelocity.z * 0.7 + (Math.random() - 0.5) * 2
                    ),
                    angularVel: new THREE.Vector3(
                        (Math.random() - 0.5) * 8,
                        (Math.random() - 0.5) * 10,
                        (Math.random() - 0.5) * 8
                    ),
                    gravity: 40,
                    bounceCount: 0,
                    friction: 0.5,
                };

                partData.mesh.position.copy(worldPos);
                scene.add(partData.mesh);
                crashState.bikeParts.push(partData);
            }
        });

        // Hide original player
        player.visible = false;
    }

    // Create impact sparks
    createCrashSparks(player.position.clone(), impactDirection);
}

function createCrashSparks(position, direction) {
    const sparkCount = 30;
    const sparkGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(sparkCount * 3);
    const velocities = [];

    for (let i = 0; i < sparkCount; i++) {
        positions[i * 3] = position.x + (Math.random() - 0.5) * 0.5;
        positions[i * 3 + 1] = position.y + 1 + Math.random() * 0.5;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;

        velocities.push(new THREE.Vector3(
            direction * (5 + Math.random() * 10) + (Math.random() - 0.5) * 8,
            Math.random() * 8,
            (Math.random() - 0.5) * 8
        ));
    }

    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const sparkMat = new THREE.PointsMaterial({
        color: 0xffaa00,
        size: 0.15,
        transparent: true,
        opacity: 1.0,
    });

    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.userData.velocities = velocities;
    sparks.userData.life = 1.0;
    scene.add(sparks);
    crashState.sparks.push(sparks);
}

function updateCrashPhysics(delta) {
    if (!crashState) return;

    crashState.time += delta;

    // Update rider parts (ragdoll)
    crashState.riderParts.forEach(part => {
        // Apply gravity
        part.velocity.y -= part.gravity * delta;

        // Update position
        part.mesh.position.add(part.velocity.clone().multiplyScalar(delta));

        // Update rotation (tumbling)
        part.mesh.rotation.x += part.angularVel.x * delta;
        part.mesh.rotation.y += part.angularVel.y * delta;
        part.mesh.rotation.z += part.angularVel.z * delta;

        // Ground collision with bounce
        if (part.mesh.position.y < 0.1 && part.bounceCount < 3) {
            part.mesh.position.y = 0.1;
            part.velocity.y = -part.velocity.y * part.friction;
            part.velocity.x *= 0.7;
            part.velocity.z *= 0.7;
            part.angularVel.multiplyScalar(0.6);
            part.bounceCount++;
        } else if (part.mesh.position.y < 0.1) {
            part.mesh.position.y = 0.1;
            part.velocity.multiplyScalar(0.95);
            part.angularVel.multiplyScalar(0.9);
        }
    });

    // Update bike parts
    crashState.bikeParts.forEach(part => {
        part.velocity.y -= part.gravity * delta;
        part.mesh.position.add(part.velocity.clone().multiplyScalar(delta));

        part.mesh.rotation.x += part.angularVel.x * delta;
        part.mesh.rotation.y += part.angularVel.y * delta;
        part.mesh.rotation.z += part.angularVel.z * delta;

        if (part.mesh.position.y < 0.1 && part.bounceCount < 2) {
            part.mesh.position.y = 0.1;
            part.velocity.y = -part.velocity.y * part.friction;
            part.velocity.x *= 0.6;
            part.velocity.z *= 0.6;
            part.angularVel.multiplyScalar(0.5);
            part.bounceCount++;
        } else if (part.mesh.position.y < 0.1) {
            part.mesh.position.y = 0.1;
            part.velocity.multiplyScalar(0.92);
            part.angularVel.multiplyScalar(0.85);
        }
    });

    // Update sparks
    crashState.sparks.forEach((sparks, idx) => {
        const positions = sparks.geometry.attributes.position.array;
        const velocities = sparks.userData.velocities;

        sparks.userData.life -= delta * 1.5;
        sparks.material.opacity = Math.max(0, sparks.userData.life);

        for (let i = 0; i < velocities.length; i++) {
            velocities[i].y -= 25 * delta;
            positions[i * 3] += velocities[i].x * delta;
            positions[i * 3 + 1] += velocities[i].y * delta;
            positions[i * 3 + 2] += velocities[i].z * delta;

            if (positions[i * 3 + 1] < 0) {
                positions[i * 3 + 1] = 0;
                velocities[i].y = -velocities[i].y * 0.3;
            }
        }

        sparks.geometry.attributes.position.needsUpdate = true;

        if (sparks.userData.life <= 0) {
            scene.remove(sparks);
        }
    });

    // Clean up dead sparks
    crashState.sparks = crashState.sparks.filter(s => s.userData.life > 0);
}

function cleanupCrash() {
    if (!crashState) return;

    crashState.riderParts.forEach(part => scene.remove(part.mesh));
    crashState.bikeParts.forEach(part => scene.remove(part.mesh));
    crashState.sparks.forEach(spark => scene.remove(spark));

    crashState = null;
    player.visible = true;
}

// --- Sleek Modern Semi-Truck ---
class Truck {
    constructor(direction, laneOffset = 0, startX = null) {
        this.direction = direction;
        this.mesh = new THREE.Group();

        // === MATERIALS - Glossy and Premium ===
        const navyBlue = new THREE.MeshStandardMaterial({
            color: 0x0a1628,
            roughness: 0.15,
            metalness: 0.85,
            envMap: envMap,
            envMapIntensity: 1.2,
        });

        const navyBlueLight = new THREE.MeshStandardMaterial({
            color: 0x1a3050,
            roughness: 0.2,
            metalness: 0.8,
            envMap: envMap,
        });

        // Scania logo texture (SVG)
        const textureLoader = new THREE.TextureLoader();
        const scaniaLogoTexture = textureLoader.load('assets/scania_logo.svg?v=' + Date.now());
        scaniaLogoTexture.colorSpace = THREE.SRGBColorSpace;

        const scaniaLogoMat = new THREE.MeshStandardMaterial({
            map: scaniaLogoTexture,
            transparent: true,
            roughness: 0.2,
            metalness: 0.4,
        });

        const chrome = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.05,
            metalness: 1.0,
            envMap: envMap,
            envMapIntensity: 1.5,
        });

        const darkChrome = new THREE.MeshStandardMaterial({
            color: 0x333340,
            roughness: 0.1,
            metalness: 0.95,
            envMap: envMap,
        });

        const blackGloss = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 0.2,
            metalness: 0.6,
        });

        const rubber = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.9,
            metalness: 0.0,
        });

        const glass = new THREE.MeshStandardMaterial({
            color: 0x1a2a3a,
            roughness: 0.0,
            metalness: 0.5,
            transparent: true,
            opacity: 0.7,
            envMap: envMap,
            envMapIntensity: 2.0,
        });

        const headlightMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffee,
            emissiveIntensity: 2.0,
            roughness: 0.0,
        });

        const ledStripMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xaaccff,
            emissiveIntensity: 1.0,
        });

        const tailLightMat = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 1.5,
        });

        // === SLEEK CAB - Proper 3D Design ===
        const cabGroup = new THREE.Group();
        cabGroup.position.set(13, 0, 0);
        this.mesh.add(cabGroup);

        // Lower cab section (engine/base area)
        const cabLower = new THREE.Mesh(
            new THREE.BoxGeometry(4.0, 1.5, 2.6),
            navyBlue
        );
        cabLower.position.set(0, 1.25, 0);
        cabLower.castShadow = true;
        cabGroup.add(cabLower);

        // Main cab body
        const cabMain = new THREE.Mesh(
            new THREE.BoxGeometry(3.8, 2.8, 2.6),
            navyBlue
        );
        cabMain.position.set(-0.1, 3.4, 0);
        cabMain.castShadow = true;
        cabGroup.add(cabMain);

        // Windshield area - angled front top
        const windshieldFrame = new THREE.Mesh(
            new THREE.BoxGeometry(1.0, 2.0, 2.5),
            navyBlue
        );
        windshieldFrame.position.set(1.6, 3.0, 0);
        windshieldFrame.rotation.z = -0.25;
        cabGroup.add(windshieldFrame);

        // Roof fairing - matches trailer height smoothly
        const roofFairing = new THREE.Mesh(
            new THREE.BoxGeometry(3.5, 2.8, 2.6),
            navyBlue
        );
        roofFairing.position.set(-0.3, 6.2, 0);
        roofFairing.castShadow = true;
        cabGroup.add(roofFairing);

        // Fairing front slope
        const fairingSlope = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 2.0, 2.55),
            navyBlue
        );
        fairingSlope.position.set(1.2, 5.5, 0);
        fairingSlope.rotation.z = -0.4;
        cabGroup.add(fairingSlope);

        // Windshield glass
        const windshield = new THREE.Mesh(
            new THREE.PlaneGeometry(2.2, 2.4),
            glass
        );
        windshield.position.set(1.85, 3.5, 0);
        windshield.rotation.y = Math.PI / 2;
        windshield.rotation.z = -0.25;
        cabGroup.add(windshield);

        // Side windows
        [-1, 1].forEach(side => {
            const sideWin = new THREE.Mesh(
                new THREE.PlaneGeometry(2.5, 1.6),
                glass
            );
            sideWin.position.set(0, 3.6, side * 1.31);
            sideWin.rotation.y = side * Math.PI / 2;
            cabGroup.add(sideWin);
        });

        // Headlights - integrated into front
        [-0.9, 0.9].forEach(side => {
            const hlUnit = new THREE.Mesh(
                new THREE.BoxGeometry(0.15, 0.4, 0.6),
                blackGloss
            );
            hlUnit.position.set(2.0, 1.8, side);
            cabGroup.add(hlUnit);

            const hlLed = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.3, 0.5),
                headlightMat
            );
            hlLed.position.set(2.05, 1.8, side);
            cabGroup.add(hlLed);
        });

        // Grille
        const grille = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 1.0, 1.8),
            darkChrome
        );
        grille.position.set(2.0, 1.5, 0);
        cabGroup.add(grille);

        // Chrome grille bars
        for (let i = -0.7; i <= 0.7; i += 0.2) {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.06, 1.6),
                chrome
            );
            bar.position.set(2.03, 1.5 + i, 0);
            cabGroup.add(bar);
        }

        // Bumper
        const bumper = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.4, 2.7),
            chrome
        );
        bumper.position.set(2.1, 0.5, 0);
        cabGroup.add(bumper);

        // Side mirrors on stalks
        [-1, 1].forEach(side => {
            const stalk = new THREE.Mesh(
                new THREE.BoxGeometry(0.6, 0.08, 0.08),
                blackGloss
            );
            stalk.position.set(1.5, 4.2, side * 1.5);
            cabGroup.add(stalk);

            const mirror = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.5, 0.3),
                blackGloss
            );
            mirror.position.set(1.8, 4.0, side * 1.55);
            cabGroup.add(mirror);
        });

        // Side fuel tanks
        [-1, 1].forEach(side => {
            const tank = new THREE.Mesh(
                new THREE.CylinderGeometry(0.4, 0.4, 2.0, 20),
                chrome
            );
            tank.rotation.z = Math.PI / 2;
            tank.position.set(11, 1.0, side * 1.45);
            this.mesh.add(tank);
        });

        // Cab side panels (aero skirts)
        [-1, 1].forEach(side => {
            const skirt = new THREE.Mesh(
                new THREE.BoxGeometry(3.5, 1.0, 0.08),
                navyBlueLight
            );
            skirt.position.set(0, 0.7, side * 1.32);
            cabGroup.add(skirt);
        });

        // Chrome trim line
        [-1, 1].forEach(side => {
            const trim = new THREE.Mesh(
                new THREE.BoxGeometry(3.8, 0.06, 0.02),
                chrome
            );
            trim.position.set(-0.1, 2.0, side * 1.31);
            cabGroup.add(trim);
        });

        // Steps
        [-1, 1].forEach(side => {
            const step = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 0.08, 0.3),
                chrome
            );
            step.position.set(0.5, 0.8, side * 1.4);
            cabGroup.add(step);
        });

        // === SLEEK TRAILER WITH GAP ===
        const trailerHeight = 5.5;
        const trailerWidth = 2.6;
        const sectionLength = 7;

        // Front trailer section - smooth panels
        const frontTrailer = new THREE.Mesh(
            new THREE.BoxGeometry(sectionLength, trailerHeight, trailerWidth),
            navyBlue
        );
        frontTrailer.position.set(8, trailerHeight / 2 + 1.5, 0);
        frontTrailer.castShadow = true;
        frontTrailer.receiveShadow = true;
        this.mesh.add(frontTrailer);

        // Front section rounded top edges
        const frontTopEdge = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.15, sectionLength, 16, 1, false, 0, Math.PI),
            navyBlue
        );
        frontTopEdge.rotation.z = Math.PI / 2;
        frontTopEdge.position.set(8, trailerHeight + 1.5, 0);
        this.mesh.add(frontTopEdge);

        // Back trailer section
        const backTrailer = new THREE.Mesh(
            new THREE.BoxGeometry(sectionLength, trailerHeight, trailerWidth),
            navyBlue
        );
        backTrailer.position.set(-8, trailerHeight / 2 + 1.5, 0);
        backTrailer.castShadow = true;
        backTrailer.receiveShadow = true;
        this.mesh.add(backTrailer);

        // Back section rounded top edges
        const backTopEdge = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.15, sectionLength, 16, 1, false, 0, Math.PI),
            navyBlue
        );
        backTopEdge.rotation.z = Math.PI / 2;
        backTopEdge.position.set(-8, trailerHeight + 1.5, 0);
        this.mesh.add(backTopEdge);

        // Sleek continuous roof over gap
        const fullRoof = new THREE.Mesh(
            new THREE.BoxGeometry(22, 0.15, trailerWidth),
            navyBlue
        );
        fullRoof.position.set(0, trailerHeight + 1.58, 0);
        fullRoof.castShadow = true;
        this.mesh.add(fullRoof);

        // Chrome roof rail trim
        [-1, 1].forEach(side => {
            const roofRail = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 22),
                chrome
            );
            roofRail.rotation.z = Math.PI / 2;
            roofRail.position.set(0, trailerHeight + 1.7, side * (trailerWidth / 2 - 0.1));
            this.mesh.add(roofRail);
        });

        // === BIGGER SCANIA BRANDING ===
        [8, -8].forEach(xPos => {
            [-1, 1].forEach(side => {
                // Large Scania logo - BIGGER
                const logo = new THREE.Mesh(
                    new THREE.PlaneGeometry(9.0, 5.0),
                    scaniaLogoMat
                );
                logo.position.set(xPos, 4.2, (trailerWidth / 2 + 0.02) * side);
                logo.rotation.y = side < 0 ? Math.PI : 0;
                this.mesh.add(logo);
            });
        });

        // Sleek chrome trim lines on trailer sides
        [8, -8].forEach(xPos => {
            [-1, 1].forEach(side => {
                // Horizontal chrome accent
                const trimLine = new THREE.Mesh(
                    new THREE.BoxGeometry(sectionLength - 0.5, 0.06, 0.02),
                    chrome
                );
                trimLine.position.set(xPos, 2.0, side * (trailerWidth / 2 + 0.01));
                this.mesh.add(trimLine);

                // Lower accent line
                const trimLine2 = new THREE.Mesh(
                    new THREE.BoxGeometry(sectionLength - 0.5, 0.04, 0.02),
                    chrome
                );
                trimLine2.position.set(xPos, 6.8, side * (trailerWidth / 2 + 0.01));
                this.mesh.add(trimLine2);
            });
        });

        // Aerodynamic side skirts (full length)
        [-1, 1].forEach(side => {
            // Front skirt
            const skirtFront = new THREE.Mesh(
                new THREE.BoxGeometry(sectionLength, 0.8, 0.06),
                navyBlueLight
            );
            skirtFront.position.set(8, 1.0, side * (trailerWidth / 2 + 0.03));
            this.mesh.add(skirtFront);

            // Back skirt
            const skirtBack = new THREE.Mesh(
                new THREE.BoxGeometry(sectionLength, 0.8, 0.06),
                navyBlueLight
            );
            skirtBack.position.set(-8, 1.0, side * (trailerWidth / 2 + 0.03));
            this.mesh.add(skirtBack);
        });

        // Undercarriage frame
        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(26, 0.2, 0.6),
            blackGloss
        );
        frame.position.set(0, 1.4, 0);
        this.mesh.add(frame);

        // Cross beams in gap
        for (let x = -2; x <= 2; x += 2) {
            const crossBeam = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.15, trailerWidth - 0.6),
                blackGloss
            );
            crossBeam.position.set(x, 1.45, 0);
            this.mesh.add(crossBeam);
        }

        // Rear doors with modern design
        const doorPanel = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, trailerHeight - 0.2, trailerWidth - 0.1),
            navyBlue
        );
        doorPanel.position.set(-11.55, trailerHeight / 2 + 1.5, 0);
        this.mesh.add(doorPanel);

        // Rear logo - bigger
        const rearLogo = new THREE.Mesh(
            new THREE.PlaneGeometry(2.0, 2.2),
            scaniaLogoMat
        );
        rearLogo.position.set(-11.6, 4.5, 0);
        rearLogo.rotation.y = -Math.PI / 2;
        this.mesh.add(rearLogo);

        // Modern LED tail lights
        [-1, 1].forEach(side => {
            // LED strip tail light
            const tailStrip = new THREE.Mesh(
                new THREE.BoxGeometry(0.06, 0.8, 0.15),
                tailLightMat
            );
            tailStrip.position.set(-11.58, 3.5, side * 1.1);
            this.mesh.add(tailStrip);

            // Reflector
            const reflector = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.3, 0.3),
                new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0x330000 })
            );
            reflector.position.set(-11.58, 2.2, side * 1.0);
            this.mesh.add(reflector);
        });

        // Chrome rear bumper
        const rearBumper = new THREE.Mesh(
            new THREE.BoxGeometry(0.12, 0.3, 2.5),
            chrome
        );
        rearBumper.position.set(-11.55, 0.65, 0);
        this.mesh.add(rearBumper);

        // === WHEELS - Low profile, sporty ===
        const createWheel = (x, z, isDouble = false) => {
            const wheelGroup = new THREE.Group();
            const radius = 0.52;

            const addWheel = (zOffset) => {
                // Low profile tire
                const tire = new THREE.Mesh(
                    new THREE.TorusGeometry(radius, 0.15, 16, 32),
                    rubber
                );
                tire.rotation.y = Math.PI / 2;
                tire.position.z = zOffset;
                wheelGroup.add(tire);

                // Sporty alloy rim
                const rim = new THREE.Mesh(
                    new THREE.CylinderGeometry(radius - 0.1, radius - 0.1, 0.28, 32),
                    chrome
                );
                rim.rotation.x = Math.PI / 2;
                rim.position.z = zOffset;
                wheelGroup.add(rim);

                // Hub with Scania logo area
                const hub = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.15, 0.15, 0.3, 24),
                    darkChrome
                );
                hub.rotation.x = Math.PI / 2;
                hub.position.z = zOffset;
                wheelGroup.add(hub);
            };

            if (isDouble) {
                addWheel(-0.22);
                addWheel(0.22);
            } else {
                addWheel(0);
            }

            wheelGroup.position.set(x, radius, z);
            this.mesh.add(wheelGroup);
        };

        // Front steer axle
        createWheel(15.2, 1.15, false);
        createWheel(15.2, -1.15, false);

        // Drive axles
        createWheel(11.8, 1.15, true);
        createWheel(11.8, -1.15, true);

        // Trailer axles
        createWheel(-8.5, 1.15, true);
        createWheel(-8.5, -1.15, true);
        createWheel(-10.5, 1.15, true);
        createWheel(-10.5, -1.15, true);

        // === ORIENTATION & POSITION ===
        if (direction === -1) {
            this.mesh.rotation.y = Math.PI;
        }

        const spawnX = startX !== null ? startX : (direction === 1 ? -130 : 130);
        this.mesh.position.set(spawnX, 0, laneOffset);

        scene.add(this.mesh);
        this.box = new THREE.Box3().setFromObject(this.mesh);
    }

    update(delta) {
        this.mesh.position.x += this.direction * TRUCK_SPEED * delta;
        this.box.setFromObject(this.mesh);
    }

    checkCollision(playerBox) {
        if (!this.box.intersectsBox(playerBox)) return false;

        const truckPos = this.mesh.position;
        const playerPos = player.position;

        let localX = playerPos.x - truckPos.x;
        if (this.direction === -1) localX = -localX;

        const gapStart = -GAP_SIZE / 2 + 1;
        const gapEnd = GAP_SIZE / 2 - 1;
        const gapBottom = 1.8;
        const gapTop = 7.0;

        if (localX > gapStart && localX < gapEnd) {
            if (playerPos.y > gapBottom && playerPos.y < gapTop) {
                return false;
            }
        }

        return true;
    }

    getDirection() {
        return this.direction;
    }

    remove() {
        scene.remove(this.mesh);
    }
}

// --- UI Functions ---
function updateUI() {
    const infoEl = document.getElementById('info');
    const speed = Math.abs(playerVelocity.z).toFixed(0);
    const timeStr = elapsedTime.toFixed(2);
    let bestStr = bestTime ? `Best: ${bestTime.toFixed(2)}s` : '';
    const diffLabel = selectedDifficulty.toUpperCase();

    if (gameOver && !gameWon) {
        infoEl.innerHTML = `<span style="color:#ff6b6b">CRASH!</span> Time: ${timeStr}s | ${diffLabel} | Press ENTER to restart`;
    } else if (gameWon) {
        infoEl.innerHTML = `<span style="color:#6bcb77">SUCCESS!</span> Time: ${timeStr}s | ${diffLabel} ${bestStr} | Press ENTER to play again`;
    } else if (gameFailed) {
        infoEl.innerHTML = `<span style="color:#ff6b6b">FAILED!</span> Time: ${timeStr}s | ${diffLabel} | Press ENTER to restart`;
    } else {
        infoEl.innerHTML = `${diffLabel} | Time: ${timeStr}s | Speed: ${speed} km/h ${bestStr ? '| ' + bestStr : ''}`;
    }
}

function showOverlay(title, message) {
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayMessage = document.getElementById('overlay-message');
    overlayTitle.textContent = title;
    overlayMessage.textContent = message;
    overlay.classList.remove('hidden');
}

function hideOverlay() {
    document.getElementById('overlay').classList.add('hidden');
}

function startGame() {
    document.getElementById('start-screen').style.display = 'none';
    gameStarted = true;
    startTime = Date.now();
}

// --- Initialization ---
function init() {
    scene = new THREE.Scene();
    envMap = createEnvMap();
    scene.environment = envMap;

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 10, 60);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2; // Brighter for sunny day
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    // Sunny Swedish sky
    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
        uniforms: SkyShader.uniforms,
        vertexShader: SkyShader.vertexShader,
        fragmentShader: SkyShader.fragmentShader,
        side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // Light atmospheric fog
    scene.fog = new THREE.FogExp2(COLORS.fog, 0.006);

    // Post-Processing
    composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.25, 0.6, 0.92
    );
    composer.addPass(bloomPass);

    const smaaPass = new SMAAPass(window.innerWidth, window.innerHeight);
    composer.addPass(smaaPass);

    const vignettePass = new ShaderPass(VignetteGrainShader);
    composer.addPass(vignettePass);

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // === LIGHTING - Sunny Swedish Summer ===
    const ambientLight = new THREE.AmbientLight(0x6688aa, 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, COLORS.grass, 0.7);
    scene.add(hemiLight);

    // Bright warm sun
    const sunLight = new THREE.DirectionalLight(0xfffaf0, 3.0);
    sunLight.position.set(80, 100, 40);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    sunLight.shadow.camera.left = -100;
    sunLight.shadow.camera.right = 100;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 400;
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    // Soft fill light
    const fillLight = new THREE.DirectionalLight(0x8ab4ff, 0.4);
    fillLight.position.set(-50, 30, -50);
    scene.add(fillLight);

    // === GROUND - Autumn Swedish Countryside ===
    const groundGroup = new THREE.Group();
    scene.add(groundGroup);

    // Main terrain with rolling hills
    const groundGeo = new THREE.PlaneGeometry(400, 400, 100, 100);
    const groundMat = new THREE.MeshStandardMaterial({
        color: COLORS.grass, // Golden autumn grass
        roughness: 0.95,
        metalness: 0.0,
    });

    const positions = groundGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const gx = positions.getX(i);
        const gz = positions.getY(i);
        // Keep roads flat
        if (Math.abs(gx) < 10 || Math.abs(gz) < 10) continue;
        // Rolling terrain with gentle hills
        const y = Math.sin(gx * 0.03) * 0.8 +
                  Math.sin(gz * 0.025) * 0.6 +
                  Math.sin(gx * 0.08 + gz * 0.06) * 0.3 +
                  Math.random() * 0.15;
        positions.setZ(i, y);
    }
    groundGeo.computeVertexNormals();

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    groundGroup.add(ground);

    // Dirt patches scattered across the field
    for (let i = 0; i < 30; i++) {
        const px = (Math.random() - 0.5) * 150;
        const pz = (Math.random() - 0.5) * 150;
        if (Math.abs(px) < 12 || Math.abs(pz) < 12) continue;

        const patchGeo = new THREE.CircleGeometry(1.5 + Math.random() * 3, 8);
        const patchMat = new THREE.MeshStandardMaterial({
            color: COLORS.dirt,
            roughness: 1.0,
            metalness: 0.0,
        });
        const patch = new THREE.Mesh(patchGeo, patchMat);
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(px, 0.02, pz);
        patch.receiveShadow = true;
        groundGroup.add(patch);
    }

    const grassField = createGrassField();
    groundGroup.add(grassField);

    // Dense tree line (like reference image)
    const treeLines = createTreeLine();
    groundGroup.add(treeLines);

    // === ROADS ===
    const roadMat = new THREE.MeshStandardMaterial({
        color: COLORS.asphalt,
        roughness: 0.75,
        metalness: 0.1,
    });

    // Main horizontal road (where trucks drive) - narrower
    const roadH = new THREE.Mesh(new THREE.PlaneGeometry(200, 8), roadMat);
    roadH.rotation.x = -Math.PI / 2;
    roadH.position.y = 0.05;
    roadH.receiveShadow = true;
    groundGroup.add(roadH);

    // Vertical road - gravel/dirt road (like reference)
    const dirtRoadMat = new THREE.MeshStandardMaterial({
        color: COLORS.dirt,
        roughness: 0.95,
        metalness: 0.0,
    });
    const roadV = new THREE.Mesh(new THREE.PlaneGeometry(6, 200), dirtRoadMat);
    roadV.rotation.x = -Math.PI / 2;
    roadV.position.y = 0.03;
    roadV.receiveShadow = true;
    groundGroup.add(roadV);

    // Gravel texture on dirt road (small stones)
    for (let i = 0; i < 150; i++) {
        const stoneGeo = new THREE.SphereGeometry(0.05 + Math.random() * 0.08, 4, 4);
        const stoneMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x8a8070).lerp(new THREE.Color(0x6a6050), Math.random()),
            roughness: 1.0,
        });
        const stone = new THREE.Mesh(stoneGeo, stoneMat);
        stone.position.set(
            (Math.random() - 0.5) * 5,
            0.04,
            (Math.random() - 0.5) * 180
        );
        stone.scale.y = 0.5;
        groundGroup.add(stone);
    }

    // === ROCKS ===
    for (let i = 0; i < 20; i++) {
        const rx = (Math.random() - 0.5) * 160;
        const rz = (Math.random() - 0.5) * 160;
        if (Math.abs(rx) < 14 || Math.abs(rz) < 14) continue;
        groundGroup.add(createRock(rx, rz, 0.4 + Math.random() * 1.2));
    }

    // === RAMP ===
    const rampShape = new THREE.Shape();
    rampShape.moveTo(0, 0);
    rampShape.lineTo(4.5, 0);
    rampShape.lineTo(4.5, 2.8);
    rampShape.lineTo(0, 0);

    const rampGeo = new THREE.ExtrudeGeometry(rampShape, {
        depth: 4.5,
        bevelEnabled: true,
        bevelSize: 0.08,
        bevelThickness: 0.08,
    });

    const rampMat = new THREE.MeshStandardMaterial({
        color: COLORS.concrete,
        roughness: 0.85,
        metalness: 0.1,
    });

    ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.rotation.y = Math.PI / 2;
    ramp.position.set(-2.25, 0, 10);
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    scene.add(ramp);

    // === PLAYER (Realistic Sports Motorcycle + Rider) ===
    player = new THREE.Group();

    // Reset group references for crash system
    bikeGroup = null;
    riderGroup = null;

    // --- MATERIALS ---
    const bikePrimaryMat = new THREE.MeshStandardMaterial({
        color: 0xcc0000, // Red fairing
        roughness: 0.15,
        metalness: 0.8,
        envMap: envMap,
        envMapIntensity: 1.0,
    });

    const bikeSecondaryMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, // Black accents
        roughness: 0.3,
        metalness: 0.6,
    });

    const chromeMatBike = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        roughness: 0.05,
        metalness: 0.95,
        envMap: envMap,
        envMapIntensity: 1.5,
    });

    const engineMat = new THREE.MeshStandardMaterial({
        color: 0x444444,
        roughness: 0.4,
        metalness: 0.8,
    });

    const seatMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.9,
        metalness: 0.0,
    });

    // --- MOTORCYCLE ---
    bikeGroup = new THREE.Group();
    player.add(bikeGroup);

    // Wheels
    const frontWheel = createWheel(0.42);
    frontWheel.position.set(0, 0.42, -0.85);
    bikeGroup.add(frontWheel);

    const backWheel = createWheel(0.45);
    backWheel.position.set(0, 0.45, 0.75);
    bikeGroup.add(backWheel);

    // Front forks (inverted USD style)
    [-0.12, 0.12].forEach(xOffset => {
        // Upper fork (gold/bronze color like sport bikes)
        const upperFork = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.5),
            new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.2, metalness: 0.9 })
        );
        upperFork.position.set(xOffset, 0.85, -0.75);
        upperFork.rotation.x = 0.25;
        bikeGroup.add(upperFork);

        // Lower fork (chrome)
        const lowerFork = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 0.35),
            chromeMatBike
        );
        lowerFork.position.set(xOffset, 0.5, -0.82);
        lowerFork.rotation.x = 0.25;
        bikeGroup.add(lowerFork);
    });

    // Triple clamp
    const tripleClamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.06, 0.15),
        bikeSecondaryMat
    );
    tripleClamp.position.set(0, 1.05, -0.68);
    bikeGroup.add(tripleClamp);

    // Handlebars (clip-ons)
    [-0.22, 0.22].forEach(xOffset => {
        const clipOn = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 0.18),
            bikeSecondaryMat
        );
        clipOn.position.set(xOffset, 1.08, -0.62);
        clipOn.rotation.z = Math.PI / 2;
        clipOn.rotation.y = xOffset > 0 ? -0.3 : 0.3;
        bikeGroup.add(clipOn);

        // Grip
        const grip = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.025, 0.12),
            new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 1.0 })
        );
        grip.position.set(xOffset * 1.4, 1.08, -0.58);
        grip.rotation.z = Math.PI / 2;
        bikeGroup.add(grip);
    });

    // Main frame (backbone)
    const frameGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2);
    const frame = new THREE.Mesh(frameGeo, bikeSecondaryMat);
    frame.position.set(0, 0.85, 0);
    frame.rotation.x = Math.PI / 2 + 0.15;
    bikeGroup.add(frame);

    // Fuel tank
    const tankGeo = new THREE.BoxGeometry(0.38, 0.22, 0.55);
    const tank = new THREE.Mesh(tankGeo, bikePrimaryMat);
    tank.position.set(0, 1.08, 0.05);
    tank.castShadow = true;
    bikeGroup.add(tank);

    // Tank knee cutouts
    [-0.2, 0.2].forEach(xOffset => {
        const cutout = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.18, 0.3),
            bikeSecondaryMat
        );
        cutout.position.set(xOffset, 1.05, 0.05);
        bikeGroup.add(cutout);
    });

    // Front fairing
    const fairingGeo = new THREE.BoxGeometry(0.4, 0.35, 0.25);
    const fairing = new THREE.Mesh(fairingGeo, bikePrimaryMat);
    fairing.position.set(0, 0.95, -0.55);
    fairing.castShadow = true;
    bikeGroup.add(fairing);

    // Windscreen
    const windscreenMat = new THREE.MeshStandardMaterial({
        color: 0x88aacc,
        roughness: 0.0,
        metalness: 0.3,
        transparent: true,
        opacity: 0.6,
    });
    const windscreen = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.25, 0.03),
        windscreenMat
    );
    windscreen.position.set(0, 1.15, -0.58);
    windscreen.rotation.x = -0.4;
    bikeGroup.add(windscreen);

    // Headlight
    const headlightMat = new THREE.MeshStandardMaterial({
        color: 0xffffee,
        emissive: 0xffffaa,
        emissiveIntensity: 2.0,
    });
    const headlight = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 16, 16, 0, Math.PI),
        headlightMat
    );
    headlight.position.set(0, 0.88, -0.68);
    headlight.rotation.y = Math.PI / 2;
    bikeGroup.add(headlight);

    // Engine block
    const engineBlock = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.3, 0.4),
        engineMat
    );
    engineBlock.position.set(0, 0.6, 0.1);
    engineBlock.castShadow = true;
    bikeGroup.add(engineBlock);

    // Cylinders
    [-0.12, 0.12].forEach(xOffset => {
        const cylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 0.15),
            engineMat
        );
        cylinder.position.set(xOffset, 0.65, -0.1);
        cylinder.rotation.x = -0.3;
        bikeGroup.add(cylinder);
    });

    // Exhaust
    const exhaustPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.04, 0.8),
        chromeMatBike
    );
    exhaustPipe.position.set(0.2, 0.5, 0.4);
    exhaustPipe.rotation.x = Math.PI / 2;
    bikeGroup.add(exhaustPipe);

    const exhaustCan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.05, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.3, metalness: 0.8 })
    );
    exhaustCan.position.set(0.2, 0.5, 0.85);
    exhaustCan.rotation.x = Math.PI / 2;
    bikeGroup.add(exhaustCan);

    // Seat
    const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.1, 0.6),
        seatMat
    );
    seat.position.set(0, 0.98, 0.45);
    bikeGroup.add(seat);

    // Rear cowl/tail
    const rearCowl = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.15, 0.35),
        bikePrimaryMat
    );
    rearCowl.position.set(0, 0.95, 0.8);
    rearCowl.rotation.x = 0.2;
    bikeGroup.add(rearCowl);

    // Taillight
    const taillightMat = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 1.5,
    });
    const taillight = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.05, 0.03),
        taillightMat
    );
    taillight.position.set(0, 0.92, 0.98);
    bikeGroup.add(taillight);

    // Swingarm
    const swingarm = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, 0.5),
        bikeSecondaryMat
    );
    swingarm.position.set(0, 0.45, 0.5);
    bikeGroup.add(swingarm);

    // Rear shock
    const rearShock = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.03, 0.3),
        chromeMatBike
    );
    rearShock.position.set(0, 0.7, 0.55);
    rearShock.rotation.x = 0.3;
    bikeGroup.add(rearShock);

    // Foot pegs
    [-0.2, 0.2].forEach(xOffset => {
        const peg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, 0.1),
            bikeSecondaryMat
        );
        peg.position.set(xOffset, 0.4, 0.25);
        peg.rotation.z = Math.PI / 2;
        bikeGroup.add(peg);
    });

    // --- REALISTIC RIDER ---
    riderGroup = new THREE.Group();
    player.add(riderGroup);

    // Racing suit materials
    const suitMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, // Black leather suit
        roughness: 0.6,
        metalness: 0.1,
    });

    const suitAccentMat = new THREE.MeshStandardMaterial({
        color: 0xcc0000, // Red accents matching bike
        roughness: 0.5,
        metalness: 0.1,
    });

    const skinMat = new THREE.MeshStandardMaterial({
        color: 0xe8beac, // Skin tone
        roughness: 0.8,
        metalness: 0.0,
    });

    const gloveMat = new THREE.MeshStandardMaterial({
        color: 0x222222,
        roughness: 0.7,
        metalness: 0.1,
    });

    const bootMat = new THREE.MeshStandardMaterial({
        color: 0x111111,
        roughness: 0.6,
        metalness: 0.2,
    });

    // Torso (leaning forward in racing position)
    const torso = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.5, 0.25),
        suitMat
    );
    torso.position.set(0, 1.35, 0.15);
    torso.rotation.x = 0.7; // Leaning forward
    torso.castShadow = true;
    riderGroup.add(torso);

    // Chest/back hump (racing suit back protector)
    const backHump = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 12, 12),
        suitMat
    );
    backHump.position.set(0, 1.45, 0.35);
    backHump.scale.set(1, 0.7, 1.2);
    riderGroup.add(backHump);

    // Red stripe on suit
    const suitStripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.48, 0.26),
        suitAccentMat
    );
    suitStripe.position.set(0, 1.35, 0.15);
    suitStripe.rotation.x = 0.7;
    riderGroup.add(suitStripe);

    // Neck
    const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.08, 0.1),
        suitMat
    );
    neck.position.set(0, 1.55, -0.1);
    neck.rotation.x = 0.5;
    riderGroup.add(neck);

    // Head/Helmet
    const helmetMat = new THREE.MeshStandardMaterial({
        color: 0xcc0000,
        roughness: 0.1,
        metalness: 0.7,
        envMap: envMap,
        envMapIntensity: 1.0,
    });

    // Helmet shell
    const helmetShell = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 24, 24),
        helmetMat
    );
    helmetShell.position.set(0, 1.65, -0.22);
    helmetShell.scale.set(1, 1.1, 1.2);
    helmetShell.castShadow = true;
    riderGroup.add(helmetShell);

    // Helmet chin
    const helmetChin = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.12, 0.15),
        helmetMat
    );
    helmetChin.position.set(0, 1.55, -0.35);
    helmetChin.rotation.x = 0.2;
    riderGroup.add(helmetChin);

    // Visor
    const visorMat = new THREE.MeshStandardMaterial({
        color: 0x111122,
        roughness: 0.0,
        metalness: 0.95,
        envMap: envMap,
        envMapIntensity: 2.0,
        transparent: true,
        opacity: 0.85,
    });

    const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI, 0, Math.PI * 0.5),
        visorMat
    );
    visor.position.set(0, 1.68, -0.28);
    visor.rotation.x = -0.8;
    visor.scale.set(1, 0.8, 1);
    riderGroup.add(visor);

    // White helmet stripe
    const helmetStripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.02, 0.35),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
    );
    helmetStripe.position.set(0, 1.82, -0.2);
    helmetStripe.rotation.x = 0.2;
    riderGroup.add(helmetStripe);

    // --- ARMS ---
    [-1, 1].forEach(side => {
        // Upper arm
        const upperArm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.055, 0.06, 0.28),
            suitMat
        );
        upperArm.position.set(side * 0.25, 1.4, 0.0);
        upperArm.rotation.z = side * 0.8;
        upperArm.rotation.x = 0.6;
        upperArm.castShadow = true;
        riderGroup.add(upperArm);

        // Elbow pad
        const elbowPad = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 8),
            suitAccentMat
        );
        elbowPad.position.set(side * 0.38, 1.28, -0.15);
        riderGroup.add(elbowPad);

        // Forearm
        const forearm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.05, 0.25),
            suitMat
        );
        forearm.position.set(side * 0.38, 1.18, -0.38);
        forearm.rotation.x = 1.2;
        forearm.castShadow = true;
        riderGroup.add(forearm);

        // Gloved hand gripping handlebar
        const hand = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.06, 0.1),
            gloveMat
        );
        hand.position.set(side * 0.32, 1.08, -0.58);
        riderGroup.add(hand);
    });

    // --- LEGS ---
    [-1, 1].forEach(side => {
        // Thigh
        const thigh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.09, 0.35),
            suitMat
        );
        thigh.position.set(side * 0.12, 1.05, 0.25);
        thigh.rotation.x = 1.3;
        thigh.rotation.z = side * -0.15;
        thigh.castShadow = true;
        riderGroup.add(thigh);

        // Knee with slider
        const knee = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 10, 10),
            suitMat
        );
        knee.position.set(side * 0.18, 0.78, 0.08);
        riderGroup.add(knee);

        // Knee slider (bright colored)
        const kneeSlider = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.08, 0.04),
            new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.3 })
        );
        kneeSlider.position.set(side * 0.23, 0.78, 0.06);
        riderGroup.add(kneeSlider);

        // Shin
        const shin = new THREE.Mesh(
            new THREE.CylinderGeometry(0.055, 0.06, 0.3),
            suitMat
        );
        shin.position.set(side * 0.2, 0.55, 0.15);
        shin.rotation.x = -0.4;
        shin.rotation.z = side * -0.1;
        shin.castShadow = true;
        riderGroup.add(shin);

        // Boot
        const boot = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.12, 0.22),
            bootMat
        );
        boot.position.set(side * 0.2, 0.4, 0.25);
        boot.rotation.x = 0.2;
        riderGroup.add(boot);

        // Boot toe on foot peg
        const bootToe = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.06, 0.08),
            bootMat
        );
        bootToe.position.set(side * 0.2, 0.38, 0.12);
        riderGroup.add(bootToe);
    });

    scene.add(player);

    // Dust particles
    dustParticles = createDustParticles();
    scene.add(dustParticles);

    resetGame();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Difficulty button handlers
    document.querySelectorAll('.difficulty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.difficulty-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedDifficulty = btn.dataset.difficulty;
        });
    });

    // Start button click handler
    document.getElementById('start-btn').addEventListener('click', startGame);

    // Multiplayer UI handlers
    setupMultiplayerUI();

    requestAnimationFrame(animate);
}

// --- Multiplayer Functions ---
function setupMultiplayerUI() {
    const soloBtn = document.getElementById('solo-btn');
    const multiplayerBtn = document.getElementById('multiplayer-btn');
    const soloOptions = document.getElementById('solo-options');
    const multiplayerOptions = document.getElementById('multiplayer-options');
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const roomCodeInput = document.getElementById('room-code-input');
    const startMpBtn = document.getElementById('start-mp-btn');

    soloBtn.addEventListener('click', () => {
        isMultiplayer = false;
        document.getElementById('mode-select').classList.add('hidden');
        soloOptions.classList.remove('hidden');
        multiplayerOptions.classList.add('hidden');
    });

    multiplayerBtn.addEventListener('click', () => {
        isMultiplayer = true;
        document.getElementById('mode-select').classList.add('hidden');
        soloOptions.classList.add('hidden');
        multiplayerOptions.classList.remove('hidden');
    });

    createRoomBtn.addEventListener('click', createRoom);
    joinRoomBtn.addEventListener('click', () => joinRoom(roomCodeInput.value.toUpperCase()));

    roomCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });

    startMpBtn.addEventListener('click', startMultiplayerGame);
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function createRoom() {
    const roomCode = generateRoomCode();

    peer = new Peer('scania-' + roomCode);
    isHost = true;
    localPlayerNum = 1;

    peer.on('open', (id) => {
        document.getElementById('mp-lobby').classList.add('hidden');
        document.getElementById('mp-waiting').classList.remove('hidden');
        document.getElementById('room-code-display').textContent = roomCode;
    });

    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        document.getElementById('connection-status').textContent = 'Error: ' + err.type;
    });
}

function joinRoom(code) {
    if (!code || code.length < 4) {
        alert('Please enter a valid room code');
        return;
    }

    peer = new Peer();
    isHost = false;
    localPlayerNum = 2;

    peer.on('open', () => {
        conn = peer.connect('scania-' + code);

        conn.on('open', () => {
            setupConnection();
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
            alert('Failed to connect. Check the room code.');
        });
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        alert('Connection failed: ' + err.type);
    });
}

function setupConnection() {
    document.getElementById('mp-lobby').classList.add('hidden');
    document.getElementById('mp-waiting').classList.add('hidden');
    document.getElementById('mp-ready').classList.remove('hidden');

    conn.on('data', (data) => {
        handleNetworkData(data);
    });

    conn.on('close', () => {
        console.log('Connection closed');
        if (gameStarted) {
            showOverlay('DISCONNECTED', 'Other player left');
        }
    });

    // Send a handshake
    conn.send({ type: 'handshake', playerNum: localPlayerNum });
}

function handleNetworkData(data) {
    switch (data.type) {
        case 'handshake':
            console.log('Player ' + data.playerNum + ' connected');
            break;
        case 'playerUpdate':
            remotePlayerData = data.state;
            if (remotePlayer) {
                remotePlayer.position.set(data.state.x, data.state.y, data.state.z);
            }
            break;
        case 'startGame':
            if (!isHost) {
                selectedDifficulty = data.difficulty;
                startMultiplayerGame();
            }
            break;
        case 'gameEvent':
            if (data.event === 'crashed') {
                remotePlayerData.crashed = true;
            } else if (data.event === 'won') {
                remotePlayerData.won = true;
                checkMultiplayerEnd();
            }
            break;
    }
}

function sendPlayerUpdate() {
    if (conn && conn.open) {
        conn.send({
            type: 'playerUpdate',
            state: {
                x: player.position.x,
                y: player.position.y,
                z: player.position.z,
                vy: playerVelocity.y,
                crashed: gameOver,
                won: gameWon
            }
        });
    }
}

function sendGameEvent(event) {
    if (conn && conn.open) {
        conn.send({ type: 'gameEvent', event: event });
    }
}

function startMultiplayerGame() {
    if (isHost && conn && conn.open) {
        conn.send({ type: 'startGame', difficulty: selectedDifficulty });
    }

    // Create remote player (different color motorcycle)
    createRemotePlayer();

    // Start the game
    startGame();
}

function createRemotePlayer() {
    // Create a simple representation of the other player
    remotePlayer = new THREE.Group();

    // Simple motorcycle shape for remote player
    const bodyMat = new THREE.MeshStandardMaterial({
        color: localPlayerNum === 1 ? 0xff4444 : 0x4444ff,
        metalness: 0.6,
        roughness: 0.3
    });

    // Body
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.6, 1.8),
        bodyMat
    );
    body.position.y = 0.6;
    remotePlayer.add(body);

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const frontWheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16),
        wheelMat
    );
    frontWheel.rotation.x = Math.PI / 2;
    frontWheel.position.set(0, 0.35, -0.6);
    remotePlayer.add(frontWheel);

    const rearWheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16),
        wheelMat
    );
    rearWheel.rotation.x = Math.PI / 2;
    rearWheel.position.set(0, 0.35, 0.6);
    remotePlayer.add(rearWheel);

    // Rider
    const riderMat = new THREE.MeshStandardMaterial({
        color: localPlayerNum === 1 ? 0xaa2222 : 0x2222aa
    });
    const riderBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.7, 0.4),
        riderMat
    );
    riderBody.position.set(0, 1.2, 0.1);
    remotePlayer.add(riderBody);

    // Head
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xffcc99 })
    );
    head.position.set(0, 1.7, 0);
    remotePlayer.add(head);

    // Helmet
    const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        riderMat
    );
    helmet.position.set(0, 1.75, 0);
    helmet.scale.set(1, 0.9, 1.1);
    remotePlayer.add(helmet);

    // Player label
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = localPlayerNum === 1 ? '#ff4444' : '#4444ff';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('P' + (localPlayerNum === 1 ? '2' : '1'), 64, 45);

    const labelTexture = new THREE.CanvasTexture(canvas);
    const labelMat = new THREE.SpriteMaterial({ map: labelTexture });
    const label = new THREE.Sprite(labelMat);
    label.position.set(0, 2.5, 0);
    label.scale.set(1, 0.5, 1);
    remotePlayer.add(label);

    remotePlayer.position.set(0, 0, 55);
    scene.add(remotePlayer);
}

function checkMultiplayerEnd() {
    if (!isMultiplayer) return;

    const localWon = gameWon;
    const localCrashed = gameOver && !gameWon;
    const remoteWon = remotePlayerData.won;
    const remoteCrashed = remotePlayerData.crashed;

    if (localWon && remoteWon) {
        showOverlay('BOTH WIN!', 'Amazing teamwork! Press ENTER to restart');
    } else if (localWon && remoteCrashed) {
        showOverlay('YOU WIN!', 'Player ' + (localPlayerNum === 1 ? '2' : '1') + ' crashed! Press ENTER');
    } else if (localCrashed && remoteWon) {
        showOverlay('YOU LOSE!', 'Player ' + (localPlayerNum === 1 ? '2' : '1') + ' made it! Press ENTER');
    } else if (localCrashed && remoteCrashed) {
        showOverlay('BOTH CRASHED!', 'Try again! Press ENTER to restart');
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
    if (event.code === 'Space') {
        event.preventDefault();
        if (gameStarted && !gameOver && !gameWon && !gameFailed) {
            isAccelerating = true;
        }
    }
    if (event.code === 'Enter') {
        event.preventDefault();
        if (gameOver || gameWon || gameFailed) {
            resetGame();
        }
    }
}

function onKeyUp(event) {
    if (event.code === 'Space') {
        isAccelerating = false;
    }
}

function resetGame() {
    gameOver = false;
    gameWon = false;
    gameFailed = false;

    // Apply difficulty settings
    const settings = DIFFICULTY_SETTINGS[selectedDifficulty];
    TRUCK_SPEED = settings.truckSpeed;
    GAP_SIZE = settings.gapSize;

    // Clean up crash debris
    cleanupCrash();

    trucks.forEach(t => t.remove());
    trucks = [];

    player.position.set(0, 0, 55);
    player.rotation.set(0, 0, 0);
    player.visible = true;
    playerVelocity.set(0, 0, 0);
    isJumping = false;
    hasJumped = false;
    passedThroughTrucks = false;
    isAccelerating = false;

    startTime = Date.now();
    elapsedTime = 0;

    // Reset multiplayer state
    if (isMultiplayer) {
        remotePlayerData = { x: 0, y: 0, z: 55, vy: 0, crashed: false, won: false };
        if (remotePlayer) {
            remotePlayer.position.set(0, 0, 55);
            remotePlayer.visible = true;
        }
    }

    // Spawn trucks based on difficulty - closer spawn = less reaction time
    const spawnDist = settings.spawnDistance;
    trucks.push(new Truck(1, 0, -spawnDist));
    trucks.push(new Truck(-1, 0, spawnDist));

    document.getElementById('overlay').classList.add('hidden');
    updateUI();
}

function animate(time) {
    requestAnimationFrame(animate);

    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    // Update shader time
    VignetteGrainShader.uniforms.time.value = time * 0.001;

    // Update dust
    if (dustParticles) {
        const pos = dustParticles.geometry.attributes.position.array;
        const vel = dustParticles.geometry.userData.velocities;

        for (let i = 0; i < pos.length / 3; i++) {
            pos[i * 3] += vel[i * 3];
            pos[i * 3 + 1] += vel[i * 3 + 1];
            pos[i * 3 + 2] += vel[i * 3 + 2];

            if (pos[i * 3 + 1] > 20 || Math.abs(pos[i * 3]) > 60) {
                pos[i * 3] = (Math.random() - 0.5) * 100;
                pos[i * 3 + 1] = Math.random() * 3;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 100;
            }
        }
        dustParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (!gameStarted) {
        composer.render();
        return;
    }

    if (!gameOver && !gameWon && !gameFailed) {
        elapsedTime = (Date.now() - startTime) / 1000;
        updateUI();

        // Check if player is passing through the truck zone while trucks are present
        if (hasJumped && !passedThroughTrucks && !gameFailed && player.position.z < 5 && player.position.z > -5) {
            // Check if both trucks are in the crossing zone (near x=0)
            const truck1Near = trucks[0] && Math.abs(trucks[0].mesh.position.x) < 25;
            const truck2Near = trucks[1] && Math.abs(trucks[1].mesh.position.x) < 25;
            if (truck1Near && truck2Near) {
                passedThroughTrucks = true;
            } else {
                // Jumped too early or too late - immediate fail
                gameFailed = true;
                if (isMultiplayer) {
                    sendGameEvent('crashed');
                    checkMultiplayerEnd();
                } else {
                    showOverlay('FAILED', 'Bad timing! Press ENTER to restart');
                }
            }
        }

        // Player physics
        if (isAccelerating) {
            playerVelocity.z -= PLAYER_ACCEL * delta;
        } else {
            if (playerVelocity.z < 0) playerVelocity.z += PLAYER_DRAG * delta;
            if (playerVelocity.z > 0) playerVelocity.z = 0;
        }

        playerVelocity.z = Math.max(playerVelocity.z, -PLAYER_MAX_SPEED);

        // Gravity
        if (isJumping || player.position.y > 0.01) {
            playerVelocity.y -= GRAVITY * delta;
        } else {
            player.position.y = 0;
            playerVelocity.y = 0;
            isJumping = false;
        }

        player.position.add(playerVelocity.clone().multiplyScalar(delta));

        if (player.position.y < 0) {
            player.position.y = 0;
            playerVelocity.y = 0;
            isJumping = false;
        }

        // Bike tilt
        const targetTilt = isAccelerating ? -0.18 : 0;
        player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, targetTilt, 0.12);

        // Ramp trigger
        if (!hasJumped && player.position.z < 14 && player.position.z > 8) {
            if (Math.abs(player.position.x) < 2.5) {
                isJumping = true;
                hasJumped = true;
                playerVelocity.y = JUMP_FORCE;
            }
        }

        // Win condition - passed through the trucks
        if (player.position.z < -20 && passedThroughTrucks) {
            gameWon = true;
            if (!bestTime || elapsedTime < bestTime) {
                bestTime = elapsedTime;
                localStorage.setItem('bestTime', bestTime.toString());
            }
            if (isMultiplayer) {
                sendGameEvent('won');
                checkMultiplayerEnd();
            } else {
                showOverlay('SUCCESS!', 'You made it! Press ENTER to play again');
            }
            updateUI();
        }
    }

    // Truck updates
    trucks.forEach(t => t.update(delta));

    // Collision
    if (!gameOver && !gameWon) {
        const playerBox = new THREE.Box3().setFromObject(player);
        playerBox.expandByScalar(-0.25);

        for (const truck of trucks) {
            if (truck.checkCollision(playerBox)) {
                gameOver = true;
                // Trigger realistic crash physics
                initCrash(truck.getDirection(), TRUCK_SPEED);
                if (isMultiplayer) {
                    sendGameEvent('crashed');
                    checkMultiplayerEnd();
                } else {
                    showOverlay('CRASHED!', 'Press ENTER to restart');
                }
                updateUI();
                break;
            }
        }
    }

    // Update crash physics if crash occurred
    if (crashState) {
        updateCrashPhysics(delta);
    }

    // Multiplayer updates
    if (isMultiplayer) {
        // Send local player position to remote
        sendPlayerUpdate();

        // Update remote player visual position (already handled in handleNetworkData)
        // Make remote player visible/invisible based on crash state
        if (remotePlayer) {
            remotePlayer.visible = !remotePlayerData.crashed;
        }
    }

    // Camera
    const camTarget = player.position.clone();
    camTarget.y += 4 + Math.abs(playerVelocity.z) * 0.04;
    camTarget.z += 14 + Math.abs(playerVelocity.z) * 0.15;

    camera.position.lerp(camTarget, 0.1);
    camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z - 8);

    composer.render();
}

init();
