/**
 * Chunk Editor - Visual tool for designing 8x8 chunk layouts
 */

// Object definitions with display info
const EditorObjects = {
    '..': { label: 'Empty', color: '#1a2535', textColor: '#3a4a5a' },
    'TR': { label: 'Tree', color: '#1a5a1a', textColor: '#00ff88' },
    'RK': { label: 'Rock', color: '#5a5a6a', textColor: '#aabbcc' },
    'WH': { label: 'Wall H', color: '#5a5a5a', textColor: '#ffffff' },
    'WV': { label: 'Wall V', color: '#4a4a5a', textColor: '#ffffff' },
    'WD': { label: 'Wall /', color: '#4a5a5a', textColor: '#ffffff' },
    'WA': { label: 'Wall \\', color: '#5a4a5a', textColor: '#ffffff' },
    'CF': { label: 'Cliff', color: '#4a4040', textColor: '#ccbbaa' },
    'CR': { label: 'Crate', color: '#8B5A2B', textColor: '#ffdd88' },
    'BR': { label: 'Barrel', color: '#6B4423', textColor: '#ffcc66' },
    'ST': { label: 'Stairs', color: '#555555', textColor: '#aaaaaa' }
};

// Editor state
const Editor = {
    grid: [],
    selectedObject: '..',
    isDragging: false,
    gridSize: 8
};

// Initialize the editor
function initEditor() {
    createGrid();
    createPalette();
    setupEventListeners();
    console.log('Chunk Editor initialized');
}

// Create the 8x8 grid
function createGrid() {
    const gridEl = document.getElementById('chunk-grid');
    gridEl.innerHTML = '';
    Editor.grid = [];

    for (let row = 0; row < Editor.gridSize; row++) {
        Editor.grid[row] = [];
        for (let col = 0; col < Editor.gridSize; col++) {
            Editor.grid[row][col] = '..';

            const cell = document.createElement('div');
            cell.className = 'grid-cell empty';
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.textContent = '..';

            cell.addEventListener('mousedown', (e) => onCellMouseDown(e, row, col));
            cell.addEventListener('mouseenter', (e) => onCellMouseEnter(e, row, col));
            cell.addEventListener('contextmenu', (e) => e.preventDefault());

            gridEl.appendChild(cell);
        }
    }

    document.addEventListener('mouseup', () => Editor.isDragging = false);
}

// Create object palette
function createPalette() {
    const palette = document.getElementById('object-palette');
    palette.innerHTML = '';

    for (const [code, info] of Object.entries(EditorObjects)) {
        const item = document.createElement('div');
        item.className = 'palette-item' + (code === '..' ? ' selected' : '');
        item.dataset.code = code;
        item.innerHTML = `
            <div class="code" style="color: ${info.textColor}">${code}</div>
            <div class="label">${info.label}</div>
        `;
        item.style.background = info.color;

        item.addEventListener('click', () => selectObject(code));
        palette.appendChild(item);
    }
}

// Select object from palette
function selectObject(code) {
    Editor.selectedObject = code;

    document.querySelectorAll('.palette-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.code === code);
    });

    document.getElementById('current-object').textContent = code;
}

// Handle cell mouse down
function onCellMouseDown(e, row, col) {
    e.preventDefault();
    Editor.isDragging = true;

    if (e.button === 2) {
        // Right click - erase
        setCell(row, col, '..');
    } else {
        // Left click - place
        setCell(row, col, Editor.selectedObject);
    }
}

// Handle cell mouse enter (for dragging)
function onCellMouseEnter(e, row, col) {
    if (!Editor.isDragging) {
        updateCoords(row, col);
        return;
    }

    if (e.buttons === 2) {
        setCell(row, col, '..');
    } else if (e.buttons === 1) {
        setCell(row, col, Editor.selectedObject);
    }

    updateCoords(row, col);
}

// Update coordinate display
function updateCoords(row, col) {
    const code = Editor.grid[row][col];
    const info = EditorObjects[code] || EditorObjects['..'];
    document.getElementById('grid-coords').textContent =
        `Row: ${row}, Col: ${col} | ${info.label} (${code})`;
}

// Set cell value
function setCell(row, col, code) {
    Editor.grid[row][col] = code;

    const cell = document.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
    if (cell) {
        const info = EditorObjects[code] || EditorObjects['..'];
        cell.textContent = code;
        cell.style.background = info.color;
        cell.style.color = info.textColor;
        cell.classList.toggle('has-object', code !== '..');
        cell.classList.toggle('empty', code === '..');
    }
}

// Clear the grid
function clearGrid() {
    if (confirm('Clear entire grid?')) {
        for (let row = 0; row < Editor.gridSize; row++) {
            for (let col = 0; col < Editor.gridSize; col++) {
                setCell(row, col, '..');
            }
        }
    }
}

// Export to JavaScript code
function exportCode() {
    const biome = document.getElementById('biome-select').value;
    let name = document.getElementById('preset-name').value.trim();

    if (!name) {
        name = biome.toLowerCase() + '_custom_' + Date.now();
    }

    // Clean name - lowercase, underscores only
    name = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    // Build grid strings
    const gridLines = [];
    for (let row = 0; row < Editor.gridSize; row++) {
        gridLines.push("            '" + Editor.grid[row].join(' ') + "'");
    }

    const code = `    // Add this to ChunkPresets in WorldObject.js
    ${name}: {
        biome: '${biome}',
        grid: [
${gridLines.join(',\n')}
        ]
    },`;

    document.getElementById('export-output').value = code;
}

// Copy to clipboard
function copyToClipboard() {
    const output = document.getElementById('export-output');
    output.select();
    document.execCommand('copy');

    // Visual feedback
    const btn = document.getElementById('btn-copy');
    const originalText = btn.textContent;
    btn.textContent = '✅ Copied!';
    btn.style.background = '#00aa44';

    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
    }, 2000);
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('btn-clear').addEventListener('click', clearGrid);
    document.getElementById('btn-export').addEventListener('click', exportCode);
    document.getElementById('btn-copy').addEventListener('click', copyToClipboard);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            selectObject('..');
        }
        if (e.key === 'e' && e.ctrlKey) {
            e.preventDefault();
            exportCode();
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initEditor);
