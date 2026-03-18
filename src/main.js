import './style.css';
import { AppController } from './app.js';

document.addEventListener('DOMContentLoaded', () => {
    const app = new AppController();
    app.init();
});
