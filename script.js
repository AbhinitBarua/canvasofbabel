document.addEventListener('DOMContentLoaded', () => {

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = {
        CANVASES_PER_SECTOR: 1000,
        // Using hexadecimal characters for a cryptographic feel.
        ID_CHAR_SET: 'abcdef0123456789',
        // NEW: Extremely long ID length.
        SECTOR_ID_LENGTH: 1024,
    };

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    let state = {
        currentSector: null,
        bookmarks: [],
        activeModalCanvas: null, // { sectorId, canvasIndex, isUploaded, base64Data }
    };

    // =========================================================================
    // UI ELEMENT REFERENCES
    // =========================================================================
    const UI = {
        sectorInput: document.getElementById('sector-input'),
        goBtn: document.getElementById('go-btn'),
        randomSectorBtn: document.getElementById('random-sector-btn'),
        canvasGrid: document.getElementById('canvas-grid'),
        sectorInfo: document.getElementById('sector-info'),
        dropZone: document.getElementById('image-drop-zone'),
        uploadInput: document.getElementById('image-upload-input'),
        modal: {
            container: document.getElementById('modal-container'),
            closeBtn: document.getElementById('modal-close-btn'),
            view: document.getElementById('modal-canvas-view'),
            idDisplay: document.getElementById('canvas-id-display'),
            bookmarkBtn: document.getElementById('bookmark-btn'),
            copyLinkBtn: document.getElementById('copy-link-btn'),
            downloadBtn: document.getElementById('download-btn'),
        },
        overlay: {
            container: document.getElementById('system-overlay'),
            text: document.getElementById('system-text'),
        }
    };

    // =========================================================================
    // CORE PROCEDURAL ENGINE
    // =========================================================================
    const engine = {
        /**
         * Fast, non-cryptographic 53-bit hash function.
         * @param {string} str The string to hash.
         * @param {number} seed An optional seed.
         * @returns {number} A numerical hash.
         */
        cyrb53: (str, seed = 0) => {
            let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
            for (let i = 0, ch; i < str.length; i++) {
                ch = str.charCodeAt(i);
                h1 = Math.imul(h1 ^ ch, 2654435761);
                h2 = Math.imul(h2 ^ ch, 1597334677);
            }
            h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
            h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
            return 4294967296 * (2097151 & h2) + (h1 >>> 0);
        },

        /**
         * Seedable Pseudo-Random Number Generator.
         * @param {number} seed The initial seed.
         * @returns {function(): number} A function that returns the next random number.
         */
        mulberry32: (seed) => () => {
            var t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        },

        /**
         * Generates a random string of a given length.
         * @param {number} length The desired length of the string.
         * @returns {string} The generated random string.
         */
        generateRandomString(length) {
            let result = '';
            for (let i = 0; i < length; i++) {
                result += CONFIG.ID_CHAR_SET[Math.floor(Math.random() * CONFIG.ID_CHAR_SET.length)];
            }
            return result;
        },

        /**
         * Creates the canonical string ID for a canvas.
         * @param {string} sectorId The ID of the sector.
         * @param {number} canvasIndex The index of the canvas within the sector.
         * @returns {string} The full canvas ID.
         */
        getCanvasId: (sectorId, canvasIndex) => `sector-${sectorId}:canvas-${canvasIndex}`,

        /**
         * Generates a unique, deterministic SVG image based on a seed.
         * @param {number} seed The seed for generation.
         * @returns {string} The SVG markup as a string.
         */
        generateSVG(seed) {
            const random = this.mulberry32(seed);
            const w = 200, h = 200;
            const hue1 = Math.floor(random() * 360);
            const hue2 = (hue1 + 120 + random() * 120) % 360;
            const bgColor = `hsl(${hue1}, 70%, 10%)`;
            const fgColor = `hsl(${hue2}, 80%, 60%)`;

            const turbulenceType = random() > 0.5 ? 'fractalNoise' : 'turbulence';
            const baseFrequency = (0.01 + random() * 0.05).toFixed(4);
            const numOctaves = 2 + Math.floor(random() * 4);
            const displacementScale = 10 + Math.floor(random() * 40);

            return `
                <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <filter id="filter-${seed}">
                            <feTurbulence type="${turbulenceType}" baseFrequency="${baseFrequency}" numOctaves="${numOctaves}" result="noise" />
                            <feDisplacementMap in="SourceGraphic" in2="noise" scale="${displacementScale}" />
                        </filter>
                    </defs>
                    <rect width="100%" height="100%" fill="${bgColor}" />
                    <rect width="100%" height="100%" fill="${fgColor}" filter="url(#filter-${seed})" style="mix-blend-mode: screen;" />
                </svg>`;
        }
    };

    // =========================================================================
    // APPLICATION CONTROLLER
    // =========================================================================
    const app = {
        /**
         * Displays a system-wide overlay with a message.
         * @param {string} text The message to display.
         */
        showOverlay(text) {
            UI.overlay.text.textContent = text;
            UI.overlay.container.classList.remove('hidden');
        },
        
        /** Hides the system-wide overlay. */
        hideOverlay() {
            UI.overlay.container.classList.add('hidden');
        },
        
        /**
         * Renders all canvases for a given sector ID.
         * @param {string} sectorId The ID of the sector to load.
         */
        loadSector(sectorId) {
            if (!sectorId || sectorId.length !== CONFIG.SECTOR_ID_LENGTH) {
                alert(`Invalid Sector ID. Must be ${CONFIG.SECTOR_ID_LENGTH} characters long.`);
                return;
            }
            state.currentSector = sectorId;
            UI.sectorInfo.textContent = `Sector: ${sectorId.substring(0, 10)}...${sectorId.substring(sectorId.length - 10)}`;
            UI.canvasGrid.innerHTML = '';

            // Use a document fragment for performance when adding many elements.
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < CONFIG.CANVASES_PER_SECTOR; i++) {
                const thumbnail = document.createElement('div');
                thumbnail.className = 'canvas-thumbnail';
                const canvasId = engine.getCanvasId(sectorId, i);
                const seed = engine.cyrb53(canvasId);
                thumbnail.innerHTML = engine.generateSVG(seed);
                thumbnail.addEventListener('click', () => app.showModal({ sectorId, canvasIndex: i }));
                fragment.appendChild(thumbnail);
            }
            UI.canvasGrid.appendChild(fragment);
        },
        
        /**
         * Displays the modal viewer for a specific canvas.
         * @param {object} canvasData The data for the canvas to show.
         */
        showModal(canvasData) { // canvasData = { sectorId, canvasIndex, isUploaded, base64Data }
            state.activeModalCanvas = canvasData;
            const { sectorId, canvasIndex, isUploaded, base64Data } = canvasData;
            const canvasId = engine.getCanvasId(sectorId, canvasIndex);
            
            if (isUploaded) {
                UI.modal.view.innerHTML = `<img src="${base64Data}" alt="Uploaded Canvas from ${canvasId}">`;
            } else {
                const seed = engine.cyrb53(canvasId);
                UI.modal.view.innerHTML = engine.generateSVG(seed);
            }
            
            UI.modal.idDisplay.textContent = canvasId;
            app.updateBookmarkButton();
            UI.modal.container.classList.remove('hidden');
        },

        /** Hides the modal viewer. */
        hideModal() {
            UI.modal.container.classList.add('hidden');
            state.activeModalCanvas = null;
        },

        /**
         * Handles the logic for a user-uploaded image.
         * @param {File} file The uploaded image file.
         */
        handleImageUpload(file) {
            if (!file || !file.type.startsWith('image/')) return;
            app.showOverlay('Analyzing image...');
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64Data = e.target.result;
                const hash = engine.cyrb53(base64Data);
                const random = engine.mulberry32(hash);

                let sectorId = '';
                for (let i = 0; i < CONFIG.SECTOR_ID_LENGTH; i++) {
                    sectorId += CONFIG.ID_CHAR_SET[Math.floor(random() * CONFIG.ID_CHAR_SET.length)];
                }
                const canvasIndex = Math.floor(random() * CONFIG.CANVASES_PER_SECTOR);
                
                app.hideOverlay();
                app.showModal({ sectorId, canvasIndex, isUploaded: true, base64Data });
            };
            reader.onerror = () => { app.hideOverlay(); alert('Error reading file.'); };
            reader.readAsDataURL(file);
        },

        /** Loads bookmarks from Local Storage into the state. */
        loadBookmarks() {
            try {
                const b = localStorage.getItem('canvas_babel_bookmarks');
                if (b) state.bookmarks = JSON.parse(b);
            } catch (e) {
                console.error("Failed to load bookmarks:", e);
                state.bookmarks = [];
            }
        },

        /** Saves the current bookmarks from state to Local Storage. */
        saveBookmarks() {
            localStorage.setItem('canvas_babel_bookmarks', JSON.stringify(state.bookmarks));
        },

        /** Updates the text and behavior of the bookmark button in the modal. */
        updateBookmarkButton() {
            if (!state.activeModalCanvas) return;
            const canvasId = engine.getCanvasId(state.activeModalCanvas.sectorId, state.activeModalCanvas.canvasIndex);
            const isBookmarked = state.bookmarks.some(b => b.id === canvasId);
            UI.modal.bookmarkBtn.textContent = isBookmarked ? 'Bookmarked' : 'Bookmark';
        },

        /** Initializes the application, sets up event listeners, and handles deep links. */
        init() {
            this.loadBookmarks();

            // --- Event Listeners ---

            // Navigation Controls
            UI.goBtn.addEventListener('click', () => this.loadSector(UI.sectorInput.value.trim()));
            UI.sectorInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') UI.goBtn.click(); });
            UI.randomSectorBtn.addEventListener('click', () => {
                const randomId = engine.generateRandomString(CONFIG.SECTOR_ID_LENGTH);
                UI.sectorInput.value = randomId;
                this.loadSector(randomId);
            });

            // Image Upload Controls
            UI.dropZone.addEventListener('click', () => UI.uploadInput.click());
            UI.uploadInput.addEventListener('change', (e) => { if (e.target.files.length) this.handleImageUpload(e.target.files[0]); });
            UI.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); UI.dropZone.classList.add('drag-over'); });
            UI.dropZone.addEventListener('dragleave', () => UI.dropZone.classList.remove('drag-over'));
            UI.dropZone.addEventListener('drop', (e) => {
                e.preventDefault(); UI.dropZone.classList.remove('drag-over');
                if (e.dataTransfer.files.length) this.handleImageUpload(e.dataTransfer.files[0]);
            });

            // Modal Controls
            UI.modal.closeBtn.addEventListener('click', () => this.hideModal());
            UI.modal.bookmarkBtn.addEventListener('click', () => {
                if (!state.activeModalCanvas) return;
                const { sectorId, canvasIndex, isUploaded, base64Data } = state.activeModalCanvas;
                const canvasId = engine.getCanvasId(sectorId, canvasIndex);
                const existingIndex = state.bookmarks.findIndex(b => b.id === canvasId);
                
                if (existingIndex > -1) {
                    state.bookmarks.splice(existingIndex, 1);
                } else {
                    state.bookmarks.push({ id: canvasId, sectorId, canvasIndex, isUploaded, base64Data });
                }
                this.saveBookmarks();
                this.updateBookmarkButton();
            });

            // ** NEW: Copy Link Functionality **
            UI.modal.copyLinkBtn.addEventListener('click', () => {
                if (!state.activeModalCanvas) return;
                const { sectorId, canvasIndex, isUploaded, base64Data } = state.activeModalCanvas;
                
                const url = new URL(window.location.href.split('?')[0]);
                url.searchParams.set('sector', sectorId);
                url.searchParams.set('canvas', canvasIndex);

                // If it's a "found" image, we need to include its data in the URL to reproduce it.
                if (isUploaded) {
                    url.searchParams.set('data', base64Data);
                }
                
                navigator.clipboard.writeText(url.toString()).then(() => {
                    alert('Link copied to clipboard!');
                }).catch(err => {
                    console.error('Failed to copy link: ', err);
                    alert('Could not copy link.');
                });
            });

            UI.modal.downloadBtn.addEventListener('click', () => {
                if (!state.activeModalCanvas) return;
                const { isUploaded, base64Data, sectorId, canvasIndex } = state.activeModalCanvas;
                const canvasId = engine.getCanvasId(sectorId, canvasIndex);
                const link = document.createElement('a');
                
                if(isUploaded) {
                    link.href = base64Data;
                    link.download = `found-${canvasId.substring(0,20)}.png`;
                } else {
                    const seed = engine.cyrb53(canvasId);
                    const svgContent = engine.generateSVG(seed);
                    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
                    link.href = URL.createObjectURL(blob);
                    link.download = `${canvasId.substring(0,20)}.svg`;
                }
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });

            // Handle deep links on page load
            const params = new URLSearchParams(window.location.search);
            const sectorParam = params.get('sector');
            const canvasParam = params.get('canvas');
            const dataParam = params.get('data');

            if (sectorParam && canvasParam) {
                const canvasIndex = parseInt(canvasParam, 10);
                if (!isNaN(canvasIndex)) {
                    // If there's data, it's a link to a "found" image.
                    if (dataParam) {
                        this.showModal({
                            sectorId: sectorParam,
                            canvasIndex,
                            isUploaded: true,
                            base64Data: dataParam
                        });
                    } else { // Otherwise, it's a link to a procedural canvas.
                        UI.sectorInput.value = sectorParam;
                        this.loadSector(sectorParam);
                        this.showModal({ sectorId: sectorParam, canvasIndex });
                    }
                }
            } else {
                // Initial welcome state
                UI.sectorInfo.textContent = 'Welcome. Enter a Sector ID or click "Random Sector" to begin.';
            }
        }
    };

    // Run the application
    app.init();
});