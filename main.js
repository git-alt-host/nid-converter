const dropZoneOnline = document.getElementById('drop-zone-online');
const fileInputOnline = document.getElementById('file-input-online');
const smartModeUpload = document.getElementById('smart-mode-upload');
const dropZoneFront = document.getElementById('drop-zone-front');
const fileInputFront = document.getElementById('file-input-front');
const dropZoneBack = document.getElementById('drop-zone-back');
const fileInputBack = document.getElementById('file-input-back');

const tabOnline = document.getElementById('tab-online');
const tabSmart = document.getElementById('tab-smart');

const statusContainer = document.getElementById('status-container');
const statusText = document.getElementById('status-text');
const controlsPanel = document.getElementById('controls-panel');
const smartControlsPanel = document.getElementById('smart-controls-panel');
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

const smartSettings = {
    front: {
        x: document.getElementById('smart-front-x'),
        y: document.getElementById('smart-front-y'),
        z: document.getElementById('smart-front-z')
    },
    back: {
        x: document.getElementById('smart-back-x'),
        y: document.getElementById('smart-back-y'),
        z: document.getElementById('smart-back-z')
    }
};

let finalJpegBlob = null;
let currentPdfFile = null;
let cachedSourceCanvas = null;

let currentMode = 'online';
let smartFrontImg = null;
let smartBackImg = null;

// Mode Switching
tabOnline.addEventListener('click', (e) => {
    e.preventDefault();
    currentMode = 'online';
    tabOnline.classList.add('active');
    tabSmart.classList.remove('active');
    
    dropZoneOnline.style.display = 'block';
    smartModeUpload.style.display = 'none';
    resetUI();
});

tabSmart.addEventListener('click', (e) => {
    e.preventDefault();
    currentMode = 'smart';
    tabSmart.classList.add('active');
    tabOnline.classList.remove('active');
    
    dropZoneOnline.style.display = 'none';
    smartModeUpload.style.display = 'flex';
    resetUI();
});

// Drag and drop events setup for a given zone and input
function setupDropZone(zone, input, callback) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        zone.addEventListener(eventName, () => zone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, () => zone.classList.remove('dragover'), false);
    });

    zone.addEventListener('drop', (e) => {
        let dt = e.dataTransfer;
        let files = dt.files;
        callback(files);
    });

    zone.addEventListener('click', () => {
        input.click();
    });

    input.addEventListener('change', function() {
        callback(this.files);
    });
}

setupDropZone(dropZoneOnline, fileInputOnline, handleOnlineFiles);
setupDropZone(dropZoneFront, fileInputFront, (files) => handleSmartFiles(files, 'front'));
setupDropZone(dropZoneBack, fileInputBack, (files) => handleSmartFiles(files, 'back'));

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Expose adjustValue globally for HTML inline onclick handlers
window.adjustValue = function(inputId, delta) {
    const input = document.getElementById(inputId);
    if (input) {
        let currentVal = parseFloat(input.value);
        let newVal = currentVal + delta;
        
        // Determine precision based on the input's step attribute
        let decimals = 1; // Default
        if (input.step) {
            const stepStr = input.step.toString();
            if (stepStr.includes('.')) {
                decimals = stepStr.split('.')[1].length;
            } else {
                decimals = 0;
            }
        }
        
        input.value = newVal.toFixed(decimals);
        
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
        if (cachedSourceCanvas && currentMode === 'online') {
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

Object.values(smartSettings.front).concat(Object.values(smartSettings.back)).forEach(input => {
    input.addEventListener('input', () => {
        if (smartFrontImg && smartBackImg && currentMode === 'smart') {
            drawSmartImages();
            
            clearTimeout(debounceTimer);
            sizeInfo.innerText = 'Re-calculating final size...';
            sizeInfo.style.color = 'var(--text-secondary)';
            
            debounceTimer = setTimeout(async () => {
                await optimizeAndGenerateBlob(true);
            }, 500);
        }
    });
});

function handleOnlineFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    if (file.type !== 'application/pdf') {
        alert('Please upload a valid PDF file.');
        return;
    }
    
    currentPdfFile = file;
    processPDF(file);
}

function handleSmartFiles(files, type) {
    if (files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            if (type === 'front') {
                smartFrontImg = img;
                document.getElementById('drop-zone-front').classList.add('has-image');
                document.getElementById('front-label').innerText = 'Front Image Ready';
            } else {
                smartBackImg = img;
                document.getElementById('drop-zone-back').classList.add('has-image');
                document.getElementById('back-label').innerText = 'Back Image Ready';
            }
            checkSmartReady();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function checkSmartReady() {
    if (smartFrontImg && smartBackImg) {
        // Both images ready, process them
        smartModeUpload.style.display = 'none';
        statusContainer.style.display = 'block';
        controlsPanel.style.display = 'none';
        smartControlsPanel.style.display = 'none';
        previewContainer.style.display = 'none';
        emptyState.style.display = 'none';
        statusText.innerText = 'Creating A4 Document...';

        await new Promise(r => setTimeout(r, 100)); // allow UI update
        
        drawSmartImages();
        
        previewContainer.style.display = 'flex';
        smartControlsPanel.style.display = 'flex';
        actionPanel.style.display = 'flex';
        
        await optimizeAndGenerateBlob();
        statusContainer.style.display = 'none';
        smartModeUpload.style.display = 'flex'; // Bring back
    }
}

async function processPDF(file) {
    try {
        // UI Updates
        dropZoneOnline.style.display = 'none';
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
        dropZoneOnline.style.display = 'block'; // Bring back upload block at top

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

function drawSmartImages() {
    // A4 dimensions at 300 DPI
    const A4_WIDTH = 2480;
    const A4_HEIGHT = 3508;
    
    renderCanvas.width = A4_WIDTH;
    renderCanvas.height = A4_HEIGHT;
    const ctx = renderCanvas.getContext('2d');
    
    // 1. Canvas as black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);
    
    // 2. New A4 size page full white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT);
    
    // Define the precise windows (Top and Bottom)
    // Standard NID aspect ratio ~ 1.585
    const windowWidth = A4_WIDTH * 0.88; // Take up 88% of A4 width
    const windowHeight = windowWidth / 1.585; 
    
    const gap = 160; // 2x space between the 2 images
    const windowX = (A4_WIDTH - windowWidth) / 2;
    const window1Y = 150; // Top margin
    const window2Y = window1Y + windowHeight + gap;
    
    const cornerRadius = 80; // Curved borders (increased radius)
    
    // Helper to draw the curved window, fill it black, and fit the image inside
    function drawRoundedWindowAndImage(img, wx, wy, ww, wh, radius, settings) {
        ctx.save();
        
        // Create rounded path
        ctx.beginPath();
        ctx.moveTo(wx + radius, wy);
        ctx.lineTo(wx + ww - radius, wy);
        ctx.quadraticCurveTo(wx + ww, wy, wx + ww, wy + radius);
        ctx.lineTo(wx + ww, wy + wh - radius);
        ctx.quadraticCurveTo(wx + ww, wy + wh, wx + ww - radius, wy + wh);
        ctx.lineTo(wx + radius, wy + wh);
        ctx.quadraticCurveTo(wx, wy + wh, wx, wy + wh - radius);
        ctx.lineTo(wx, wy + radius);
        ctx.quadraticCurveTo(wx, wy, wx + radius, wy);
        ctx.closePath();
        
        // Fill black window background
        ctx.fillStyle = '#000000';
        ctx.fill();
        
        // Clip to this rounded rectangle so the image gets the same curved borders
        ctx.clip();
        
        // Fit image into window (using 'cover' logic + a small zoom to crop borders)
        const imgRatio = img.width / img.height;
        const winRatio = ww / wh;
        let dw, dh;
        
        if (imgRatio > winRatio) {
            // Image is wider than window: scale height to fit, width overflows
            dh = wh;
            dw = wh * imgRatio;
        } else {
            // Image is taller than window: scale width to fit, height overflows
            dw = ww;
            dh = ww / imgRatio;
        }
        
        // Apply the dynamic zoom factor
        const zoom = parseFloat(settings.z.value);
        dw = dw * zoom;
        dh = dh * zoom;
        
        // Retrieve X and Y offsets
        const offsetX = parseFloat(settings.x.value);
        const offsetY = parseFloat(settings.y.value);
        
        // Center the scaled image inside the window, applying user offsets
        const dx = wx + (ww - dw) / 2 + offsetX;
        const dy = wy + (wh - dh) / 2 + offsetY;
        
        ctx.drawImage(img, dx, dy, dw, dh);
        
        ctx.restore();
    }
    
    // 3. Fit the front image into the top window
    drawRoundedWindowAndImage(smartFrontImg, windowX, window1Y, windowWidth, windowHeight, cornerRadius, smartSettings.front);
    
    // 4. Fit the back image into the bottom window
    drawRoundedWindowAndImage(smartBackImg, windowX, window2Y, windowWidth, windowHeight, cornerRadius, smartSettings.back);

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
    if (currentMode === 'online') {
        dropZoneOnline.style.display = 'block';
        smartModeUpload.style.display = 'none';
    } else {
        dropZoneOnline.style.display = 'none';
        smartModeUpload.style.display = 'flex';
    }
    
    statusContainer.style.display = 'none';
    controlsPanel.style.display = 'none';
    smartControlsPanel.style.display = 'none';
    previewContainer.style.display = 'none';
    actionPanel.style.display = 'none';
    emptyState.style.display = 'flex';
}
