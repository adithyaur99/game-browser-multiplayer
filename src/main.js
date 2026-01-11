import { Game3D } from './game/Game3D.js';

window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');

    // Initialize Game
    const game = new Game3D(canvas);
    game.start();

    // Handle window resize
    window.addEventListener('resize', () => {
        game.resize(window.innerWidth, window.innerHeight);
    });
});
