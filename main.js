const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const statusContainer = document.getElementById('status-container');
const statusText = document.getElementById('status-text');
const controlsPanel = document.getElementById('controls-panel');
const actionPanel = document.getElementById('action-panel');
const downloadBtn = document.getElementById('download-btn');
const sizeInfo = document.getElementById('size-info');
const previewContainer = document.getElementById('preview-container');
const emptyState = document.getElementById('empty-state');
const previewCanvas = document.getElementById('preview-canvas');
const renderCanvas = document.getElementById('render-canvas');
const settings = {
    front: {
        x: document.getElementById('front-x'),
        y: document.getElementById('front-y'),
        w: document.getElementById('front-w'),
        h: document.getElementById('front-h')
    },
    back: {
        x: document.getElementById('back-x'),
        y: document.getElementById('back-y'),
        w: document.getElementById('back-w'),
        h: document.getElementById('back-h')
    }
};

let finalJpegBlob = null;
let currentPdfFile = null;
let cachedSourceCanvas = null;

// Drag and drop events
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', (e) => {
    let dt = e.dataTransfer;
    let files = dt.files;
    handleFiles(files);
});

dropZone.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', function() {
    handleFiles(this.files);
});

// Expose adjustValue globally for HTML inline onclick handlers
window.adjustValue = function(inputId, delta) {
    const input = document.getElementById(inputId);
    if (input) {
        let currentVal = parseFloat(input.value);
        input.value = (currentVal + delta).toFixed(1);
        
        // Dispatch input event to trigger the live preview update
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
    }
};

let adjustInterval;
let adjustTimeout;

window.startAdjusting = function(inputId, delta) {
    // Fire immediately once
    window.adjustValue(inputId, delta);
    
    // Set timeout to start continuous adjustment
    adjustTimeout = setTimeout(() => {
        adjustInterval = setInterval(() => {
            window.adjustValue(inputId, delta);
        }, 100); // 10 ticks a second
    }, 400); // Wait 400ms before repeating
};

window.stopAdjusting = function() {
    clearTimeout(adjustTimeout);
    clearInterval(adjustInterval);
};

// Update preview when settings change
let debounceTimer;
Object.values(settings.front).concat(Object.values(settings.back)).forEach(input => {
    input.addEventListener('input', () => {
        if (cachedSourceCanvas) {
            drawCroppedImages(cachedSourceCanvas);
            
            clearTimeout(debounceTimer);
            sizeInfo.innerText = 'Re-calculating final size...';
            sizeInfo.style.color = 'var(--text-secondary)';
            
            debounceTimer = setTimeout(async () => {
                await optimizeAndGenerateBlob(true);
            }, 500);
        }
    });
});

function handleFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    if (file.type !== 'application/pdf') {
        alert('Please upload a valid PDF file.');
        return;
    }
    
    currentPdfFile = file;
    processPDF(file);
}

async function processPDF(file) {
    try {
        // UI Updates
        dropZone.style.display = 'none';
        statusContainer.style.display = 'block';
        controlsPanel.style.display = 'none';
        previewContainer.style.display = 'none';
        emptyState.style.display = 'none';
        statusText.innerText = 'Reading PDF...';

        const arrayBuffer = await file.arrayBuffer();
        
        // Load PDF
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        // Get first page
        statusText.innerText = 'Rendering PDF Page...';
        const page = await pdf.getPage(1);
        
        // Render at a high scale for quality (approx 300 DPI)
        // Standard A4 width is 8.27 inches * 72 points/inch = ~595 points
        // 300 DPI / 72 = 4.16 scale
        const scale = 5.0; 
        const viewport = page.getViewport({ scale: scale });
        
        const tempCanvas = document.createElement('canvas');
        const context = tempCanvas.getContext('2d');
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        await page.render(renderContext).promise;

        cachedSourceCanvas = tempCanvas;

        // Process images
        statusText.innerText = 'Processing and Cropping Images...';
        drawCroppedImages(cachedSourceCanvas);
        
        previewContainer.style.display = 'flex';
        controlsPanel.style.display = 'flex';
        actionPanel.style.display = 'flex';
        
        await optimizeAndGenerateBlob();
        statusContainer.style.display = 'none';
        dropZone.style.display = 'block'; // Bring back upload block at top

    } catch (error) {
        console.error(error);
        alert('An error occurred while processing the PDF.');
        resetUI();
    }
}

function drawCroppedImages(sourceCanvas) {
    // A4 dimensions at 300 DPI
    const A4_WIDTH = 2480;
    const A4_HEIGHT = 3508;
    
    renderCanvas.width = A4_WIDTH;
    renderCanvas.height = A4_HEIGHT;
    const ctx = renderCanvas.getContext('2d');
    
    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);
    
    // Get crop parameters (convert percentage to pixels)
    const getCropRect = (settingsObj) => {
        return {
            x: (parseFloat(settingsObj.x.value) / 100) * sourceCanvas.width,
            y: (parseFloat(settingsObj.y.value) / 100) * sourceCanvas.height,
            w: (parseFloat(settingsObj.w.value) / 100) * sourceCanvas.width,
            h: (parseFloat(settingsObj.h.value) / 100) * sourceCanvas.height
        };
    };

    const frontRect = getCropRect(settings.front);
    const backRect = getCropRect(settings.back);

    // We will place the left (front) image on top, and right (back) image on bottom.
    
    // Calculate aspect ratios based on the crop regions
    const frontRatio = frontRect.w / frontRect.h;
    const backRatio = backRect.w / backRect.h;

    // Base width for scaling
    const baseTargetWidth = A4_WIDTH * 0.85;
    
    // The front card has the correct standard aspect ratio.
    // We apply a larger zoom to the front card as requested.
    const frontZoom = 1.035;
    const targetFrontWidth = baseTargetWidth * frontZoom;
    const targetFrontHeight = targetFrontWidth / frontRatio;
    
    // The back card has a wider crop area (41.5%). We base its height on the 
    // UNZOOMED front height so we can scale them independently.
    // We increase the zoom on the back card to make it larger as requested.
    const baseFrontHeight = baseTargetWidth / frontRatio;
    const backZoom = 1.035; 
    const targetBackHeight = baseFrontHeight * backZoom;
    const targetBackWidth = targetBackHeight * backRatio;

    // Center each image horizontally independently
    const drawFrontX = (A4_WIDTH - targetFrontWidth) / 2;
    
    // The back image has a bit more white space on its right side in the PDF crop.
    // When centered mathematically, the actual card looks slightly shifted to the left.
    // We add a small offset to push it to the right so the physical cards align perfectly.
    const backVisualOffsetX = A4_WIDTH * 0.006; // Push right by ~0.6% of page width
    const drawBackX = ((A4_WIDTH - targetBackWidth) / 2) + backVisualOffsetX;
    
    // Calculate vertical positions
    // We will dynamically center both images vertically on the A4 page
    // The crop boxes include extra white padding vertically. To reduce the visual gap 
    // between the cards significantly, we use a negative gap to overlap that white space.
    const gap = A4_HEIGHT * -0.01; 
    
    // Push the images aggressively to the very top of the A4 page (0.5% printable margin)
    const topMargin = A4_HEIGHT * 0.005; 
    const drawFrontY = topMargin;
    const drawBackY = drawFrontY + targetFrontHeight + gap;

    // Draw Front Image (Top)
    ctx.drawImage(
        sourceCanvas,
        frontRect.x, frontRect.y, frontRect.w, frontRect.h,
        drawFrontX, drawFrontY, targetFrontWidth, targetFrontHeight
    );
    
    // Draw Back Image (Bottom)
    ctx.drawImage(
        sourceCanvas,
        backRect.x, backRect.y, backRect.w, backRect.h,
        drawBackX, drawBackY, targetBackWidth, targetBackHeight
    );

    // Update Preview UI immediately
    const previewCtx = previewCanvas.getContext('2d');
    previewCanvas.width = A4_WIDTH / 4;
    previewCanvas.height = A4_HEIGHT / 4;
    previewCtx.drawImage(renderCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
}

async function optimizeAndGenerateBlob(quiet = false) {
    if (!quiet) {
        statusText.innerText = 'Optimizing Image Size (Target 800KB - 1MB)...';
    }
    
    // Binary search for quality
    let minQ = 0.1;
    let maxQ = 1.0;
    let currentQ = 0.8;
    let bestBlob = null;
    let iterations = 0;
    const TARGET_MIN = 800 * 1024;
    const TARGET_MAX = 1000 * 1024;

    while (iterations < 10) {
        const blob = await new Promise(resolve => renderCanvas.toBlob(resolve, 'image/jpeg', currentQ));
        const size = blob.size;
        
        bestBlob = blob; // Keep latest as fallback
        
        if (size >= TARGET_MIN && size <= TARGET_MAX) {
            // Found perfect size
            break;
        } else if (size < TARGET_MIN) {
            minQ = currentQ;
            currentQ = (currentQ + maxQ) / 2;
        } else {
            maxQ = currentQ;
            currentQ = (minQ + currentQ) / 2;
        }
        iterations++;
    }

    finalJpegBlob = bestBlob;
    const sizeKB = (finalJpegBlob.size / 1024).toFixed(1);
    
    sizeInfo.innerText = `Final Size: ${sizeKB} KB (Quality: ${Math.round(currentQ * 100)}%)`;
    
    if (finalJpegBlob.size < TARGET_MIN || finalJpegBlob.size > TARGET_MAX) {
        sizeInfo.innerText += ` - Note: Hard to hit exact target with this source image.`;
        sizeInfo.style.color = '#fbbf24'; // Warning color
    } else {
        sizeInfo.style.color = '#34d399'; // Success color
    }
}

downloadBtn.addEventListener('click', () => {
    if (!finalJpegBlob) return;
    const url = URL.createObjectURL(finalJpegBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'NID_Processed_A4.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

function resetUI() {
    dropZone.style.display = 'block';
    statusContainer.style.display = 'none';
    controlsPanel.style.display = 'none';
    previewContainer.style.display = 'none';
    emptyState.style.display = 'flex';
}
