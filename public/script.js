// ============================================
// ROUTING CALCULATOR - FRONTEND UI ONLY
// Pure JavaScript for user interactions
// Backend: Python FastAPI (port 8000)
// ============================================

// ============================================
// GLOBAL VARIABLES
// ============================================
let map, startMarker, endMarker;
let clickMode = null; // 'start' or 'end'
const chartInstances = {};
let routeLines = [];

// Chart colors for algorithms
const COLORS = {
    dijkstra: '#e74c3c',  // Dijkstra - Red
    astar: '#00bcd4',     // A* - Cyan
    hybrid: '#f1c40f'     // Hybrid - Yellow
};

// Python backend URL
const BACKEND_URL = 'http://localhost:8000';

// Cached road network edges (fetched once from backend)
let roadNetworkEdges = null;


// ============================================
// MAP INITIALIZATION
// ============================================

/**
 * Initialize Google Map
 * Called automatically when Google Maps API loads
 */
function initMap() {
    // Map bounds for Tramcoville and Aurora Hill area
    const bounds = new google.maps.LatLngBounds(
        { lat: 16.421226808151626, lng: 120.58993396277761 }, // Southwest
        { lat: 16.430451591739512, lng: 120.60680483368087 }  // Northeast
    );

    // Create map
    map = new google.maps.Map(document.getElementById('map'), {
        mapTypeId: 'roadmap',
        minZoom: 1,
        maxZoom: 50
    });

    // Fit map to bounds
    map.fitBounds(bounds);
    map.setOptions({ restriction: { latLngBounds: bounds } });

    // Add click listener for setting start/end points
    map.addListener('click', (e) => {
        if (clickMode === 'start') {
            setStartLocation(e.latLng.lat(), e.latLng.lng());
        } else if (clickMode === 'end') {
            setEndLocation(e.latLng.lat(), e.latLng.lng());
        }
    });
}

// Make initMap globally accessible for Google Maps callback
window.initMap = initMap;


// ============================================
// MAP INTERACTION FUNCTIONS
// ============================================

/**
 * Set the mode for map clicking
 * @param {string} mode - 'start' or 'end'
 * @param {Event} e - Click event
 */
function setMode(mode, e) {
    clickMode = mode;
    
    // Reset all button opacity
    document.querySelectorAll('.map-controls button').forEach(btn => {
        btn.style.opacity = '1';
    });
    
    // Highlight clicked button
    if (e && e.target) {
        e.target.style.opacity = '0.6';
    }
}

/**
 * Set start location and place marker
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 */
function setStartLocation(lat, lng) {
    // Update input fields
    document.getElementById('startLat').value = lat.toFixed(8);
    document.getElementById('startLon').value = lng.toFixed(8);

    // Remove existing marker
    if (startMarker) {
        startMarker.setMap(null);
    }

    // Create new marker
    startMarker = new google.maps.Marker({
        position: { lat, lng },
        map: map,
        title: 'Start',
        label: 'A',
        animation: google.maps.Animation.DROP
    });
}

/**
 * Set end location and place marker
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 */
function setEndLocation(lat, lng) {
    // Update input fields
    document.getElementById('endLat').value = lat.toFixed(8);
    document.getElementById('endLon').value = lng.toFixed(8);

    // Remove existing marker
    if (endMarker) {
        endMarker.setMap(null);
    }

    // Create new marker
    endMarker = new google.maps.Marker({
        position: { lat, lng },
        map: map,
        title: 'End',
        label: 'B',
        animation: google.maps.Animation.DROP
    });
}

/**
 * Clear all markers and routes from map
 */
function clearMap() {
    // Remove markers
    if (startMarker) startMarker.setMap(null);
    if (endMarker) endMarker.setMap(null);
    
    // Remove route lines
    routeLines.forEach(line => line.setMap(null));
    routeLines = [];

    // Clear input fields
    ['startLat', 'startLon', 'endLat', 'endLon'].forEach(id => {
        document.getElementById(id).value = '';
    });

    // Hide results
    document.getElementById('chartsSection').classList.remove('active');
    document.getElementById('algoSummary').classList.remove('active');
    document.getElementById('error').classList.remove('active');
}


// ============================================
// ROUTE CALCULATION (Calls Python Backend)
// ============================================

/**
 * Calculate route by calling Python backend
 * Backend runs all 3 algorithms (Dijkstra, A*, Hybrid)
 */
async function calculateRoute() {
    // Get coordinates from input fields
    const startLat = document.getElementById('startLat').value;
    const startLon = document.getElementById('startLon').value;
    const endLat = document.getElementById('endLat').value;
    const endLon = document.getElementById('endLon').value;

    // Validate inputs
    if (!startLat || !startLon || !endLat || !endLon) {
        showError('Please enter all coordinates or click on the map');
        return;
    }

    // Show loading state
    document.getElementById('loading').classList.add('active');
    document.getElementById('error').classList.remove('active');
    document.getElementById('calculateBtn').disabled = true;

    try {
        console.log('🚀 Calling Python backend...');
        
        // Call Python backend API
        const response = await fetch(`${BACKEND_URL}/api/calculate-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                startLat: parseFloat(startLat),
                startLon: parseFloat(startLon),
                endLat: parseFloat(endLat),
                endLon: parseFloat(endLon)
            })
        });

        const data = await response.json();
        console.log('✅ Response received:', data);

        // Check for errors
        if (!response.ok) {
            throw new Error(data.error || data.detail || 'Failed to calculate route');
        }

        // Display results
        displayResults(data);
        
        // Draw routes on Google Map
        drawMapRoutes({
            dijkstra: data.dijkstra.coordinates,
            astar: data.astar.coordinates,
            hybrid: data.hybrid.coordinates
        });

    } catch (error) {
        console.error('❌ Error:', error);
        showError(error.message);
    } finally {
        // Hide loading state
        document.getElementById('loading').classList.remove('active');
        document.getElementById('calculateBtn').disabled = false;
    }
}


// ============================================
// DISPLAY RESULTS
// ============================================

/**
 * Display calculation results from Python backend
 * @param {Object} data - Response from backend with all algorithm results
 */
function displayResults(data) {
    console.log('📊 Displaying results...');
    
    // Extract data (Python backend already calculated everything!)
    const dijkstra = data.dijkstra;
    const astar = data.astar;
    const hybrid = data.hybrid;

    // Update algorithm summary cards in sidebar
    document.getElementById('cardDijkstra').innerHTML = `
        <h4>🔴 Dijkstra</h4>
        <p>Distance: ${dijkstra.distanceKm} km</p>
        <p>Time: ${dijkstra.timeMs} ms</p>
    `;

    document.getElementById('cardAStar').innerHTML = `
        <h4>🔵 A* Algorithm</h4>
        <p>Distance: ${astar.distanceKm} km</p>
        <p>Time: ${astar.timeMs} ms</p>
    `;

    document.getElementById('cardHybrid').innerHTML = `
        <h4>🟡 Hybrid</h4>
        <p>Distance: ${hybrid.distanceKm} km</p>
        <p>Time: ${hybrid.timeMs} ms</p>
    `;

    // Show algorithm summary
    document.getElementById('algoSummary').classList.add('active');

    // Update summary box at bottom
    updateSummaryBox(dijkstra, astar, hybrid);

    // Build charts
    buildCharts(dijkstra, astar, hybrid);
    
    // Show charts section
    document.getElementById('chartsSection').classList.add('active');
}


/**
 * Update summary box with algorithm comparison
 */
function updateSummaryBox(dijkstra, astar, hybrid) {
    const dDist = parseFloat(dijkstra.distanceKm);
    const aDist = parseFloat(astar.distanceKm);
    const hDist = parseFloat(hybrid.distanceKm);
    const bestDist = Math.min(dDist, aDist, hDist).toFixed(4);

    document.getElementById('summDijkstra').innerHTML = `
        <strong>Dijkstra:</strong>
        <p>• Pure shortest path</p>
        <p>• Distance: ${dijkstra.distanceKm} km</p>
    `;

    document.getElementById('summAStar').innerHTML = `
        <strong>A*:</strong>
        <p>• Highway-biased</p>
        <p>• Distance: ${astar.distanceKm} km</p>
    `;

    document.getElementById('summHybrid').innerHTML = `
        <strong>Hybrid:</strong>
        <p>• Adaptive intelligent</p>
        <p>• Distance: ${hybrid.distanceKm} km</p>
    `;

    document.getElementById('summBest').innerHTML = `
        Best Distance: ${bestDist} km
    `;
}


// ============================================
// CHARTS (Data from Python Backend)
// ============================================

/**
 * Build all performance charts
 * All calculations already done by Python backend!
 */
function buildCharts(dijkstra, astar, hybrid) {
    console.log('📈 Building charts...');

    buildBarChart(
        'chartCompTime',
        'Computation Time (ms)',
        [parseFloat(dijkstra.timeMs), parseFloat(astar.timeMs), parseFloat(hybrid.timeMs)]
    );

    buildBarChart(
        'chartPathLength',
        'Path Length (km)',
        [parseFloat(dijkstra.distanceKm), parseFloat(astar.distanceKm), parseFloat(hybrid.distanceKm)]
    );

    buildBarChart(
        'chartMemory',
        'Peak Memory (MB)',
        [dijkstra.peakMemoryMb, astar.peakMemoryMb, hybrid.peakMemoryMb]
    );

    // Path Optimality — computed by Python backend
    buildBarChart(
        'chartOptimality',
        'Path Optimality (% deviation from shortest)',
        [dijkstra.pathOptimality, astar.pathOptimality, hybrid.pathOptimality]
    );

    buildRouteVisualization(dijkstra, astar, hybrid,
        dijkstra.coordinates, astar.coordinates, hybrid.coordinates);
}


/**
 * Build a bar chart
 */
function buildBarChart(canvasId, label, values, min = 0, max = null) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    // Destroy existing chart
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    // Create new chart
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Dijkstra', 'A*', 'Hybrid'],
            datasets: [{
                label: label,
                data: values,
                backgroundColor: [COLORS.dijkstra, COLORS.astar, COLORS.hybrid],
                borderColor: ['#c0392b', '#0097a7', '#f39c12'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { 
                    display: true, 
                    text: label, 
                    color: '#ecf0f1', 
                    font: { size: 13, weight: 'bold' } 
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    min: min,
                    max: max,
                    ticks: { color: '#bdc3c7' },
                    grid: { color: '#34495e' }
                },
                x: {
                    ticks: { color: '#bdc3c7' },
                    grid: { color: '#34495e' }
                }
            }
        }
    });
}


/**
 * Build route visualization on canvas using REAL coordinates + OSM road network
 */
function buildRouteVisualization(dijkstra, astar, hybrid, dCoords, aCoords, hCoords) {
    console.log('🎨 Building route visualization canvas...');

    const canvas = document.getElementById('chartRouteViz');
    if (!canvas) { console.error('❌ Canvas element not found!'); return; }

    // ── Set canvas pixel size to match its display size ──────
    // Without this, canvas.width=1100 but CSS renders it smaller,
    // causing all coordinates to be clipped or off-screen.
    canvas.width  = canvas.offsetWidth  || 1100;
    canvas.height = canvas.offsetHeight || 600;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');

    // ── White background ─────────────────────────────────────
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, W, H);

    // ── Gather all real coordinate points ────────────────────
    const allPts = [
        ...(dCoords || []),
        ...(aCoords || []),
        ...(hCoords || [])
    ];

    if (allPts.length === 0) {
        drawRoadNetwork(ctx, W, H, null);
        drawVisualizationHeader(ctx, dijkstra, astar, hybrid);
        drawStatsBox(ctx, dijkstra, astar, hybrid, W, H);
        return;
    }

    // ── Bounding box from route points only ──────────────────
    let minLat =  Infinity, maxLat = -Infinity;
    let minLng =  Infinity, maxLng = -Infinity;
    allPts.forEach(([lat, lng]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    });

    // Add 15% margin so routes are not flush against the edges
    const latRange = (maxLat - minLat) || 0.005;
    const lngRange = (maxLng - minLng) || 0.005;
    minLat -= latRange * 0.15;  maxLat += latRange * 0.15;
    minLng -= lngRange * 0.15;  maxLng += lngRange * 0.15;

    // ── Coordinate → pixel (flip Y so north is up) ───────────
    const PAD = 70;
    function px(lat, lng) {
        return {
            x: PAD + ((lng - minLng) / (maxLng - minLng)) * (W - PAD * 2),
            y: PAD + ((maxLat - lat) / (maxLat - minLat)) * (H - PAD * 2)
        };
    }

    // ── Draw OSM road network first (background layer) ───────
    // If roadNetworkEdges is still null, try fetching again
    if (roadNetworkEdges === null) {
        fetchRoadNetwork();
    }
    drawRoadNetwork(ctx, W, H, px);

    // ── Draw routes (Dijkstra bottom, A* middle, Hybrid top) ─
    const routeDefs = [
        { coords: dCoords, color: COLORS.dijkstra, width: 5 },
        { coords: aCoords, color: COLORS.astar,    width: 5 },
        { coords: hCoords, color: COLORS.hybrid,   width: 6 }
    ];

    routeDefs.forEach(({ coords, color, width }) => {
        if (!coords || coords.length < 2) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth   = width;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        coords.forEach(([lat, lng], i) => {
            const { x, y } = px(lat, lng);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
    });

    // ── START marker ─────────────────────────────────────────
    const startCoord = (dCoords && dCoords[0]) || (aCoords && aCoords[0]) || (hCoords && hCoords[0]);
    if (startCoord) {
        const { x, y } = px(startCoord[0], startCoord[1]);

        // Outer green circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fillStyle   = '#00CC00';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 3;
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Label pill above marker
        ctx.save();
        ctx.fillStyle = '#00CC00';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        roundRect(ctx, x - 28, y - 38, 56, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle    = '#000000';
        ctx.font         = 'bold 11px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('START', x, y - 28);
        ctx.restore();
    }

    // ── END marker ───────────────────────────────────────────
    const lastOf = arr => arr && arr.length ? arr[arr.length - 1] : null;
    const endCoord = lastOf(dCoords) || lastOf(aCoords) || lastOf(hCoords);
    if (endCoord) {
        const { x, y } = px(endCoord[0], endCoord[1]);

        // Red rectangle marker
        ctx.save();
        ctx.fillStyle   = '#CC0000';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.rect(x - 14, y - 14, 28, 28);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Label pill
        ctx.save();
        ctx.fillStyle   = '#CC0000';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth   = 1.5;
        roundRect(ctx, x - 20, y - 38, 40, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle    = '#FFFFFF';
        ctx.font         = 'bold 11px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('END', x, y - 28);
        ctx.restore();
    }

    // ── Legend + Stats (drawn last so they sit on top) ───────
    drawVisualizationHeader(ctx, dijkstra, astar, hybrid);
    drawStatsBox(ctx, dijkstra, astar, hybrid, W, H);

    console.log('✅ Visualization: W=' + W + ' H=' + H + ' pts=' + allPts.length
        + ' roads=' + (roadNetworkEdges || []).length);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}


/**
 * Fetch road network edges from backend once and cache them.
 * Called on page load so the canvas is ready when routes are calculated.
 */
async function fetchRoadNetwork() {
    if (roadNetworkEdges !== null) return; // already fetched
    try {
        const res = await fetch(`${BACKEND_URL}/api/road-network`);
        if (!res.ok) throw new Error('Road network fetch failed');
        const data = await res.json();
        roadNetworkEdges = data.edges;
        console.log(`🗺️ Road network loaded: ${data.edge_count} edges`);
    } catch (err) {
        console.warn('⚠️ Could not load road network:', err.message);
        roadNetworkEdges = []; // empty — canvas will be blank background
    }
}


/**
 * Draw real OSM road network on canvas using cached edge data.
 * Falls back to a light grid if no data is available.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W - canvas width
 * @param {number} H - canvas height
 * @param {Function} px - coord-to-pixel function (lat,lng) => {x,y}
 */
function drawRoadNetwork(ctx, W, H, px) {
    if (!roadNetworkEdges || roadNetworkEdges.length === 0) {
        // Fallback: faint grid only
        ctx.save();
        ctx.strokeStyle = 'rgba(180,180,180,0.4)';
        ctx.lineWidth = 0.5;
        for (let x = 80; x < W - 80; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, H - 60); ctx.stroke();
        }
        for (let y = 60; y < H - 60; y += 50) {
            ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(W - 80, y); ctx.stroke();
        }
        ctx.restore();
        return;
    }

    // Draw real OSM road edges — styled like the reference image (grey roads on white)
    ctx.save();
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth   = 1.0;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    roadNetworkEdges.forEach(edge => {
        if (!edge || edge.length < 2) return;
        ctx.beginPath();
        edge.forEach(([lat, lng], i) => {
            const { x, y } = px(lat, lng);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    });
    ctx.restore();
}


function drawCanvasRoutes(ctx, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Define start and end points in visible area
    const startX = centerX + 250;
    const startY = centerY - 100;
    const endX = centerX - 200;
    const endY = centerY + 150;
    
    // Draw all three routes with different paths
    
    // 1. A* route (cyan) - takes longest detour via top
    ctx.strokeStyle = COLORS.astar;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX - 100, startY - 120);
    ctx.lineTo(startX - 250, startY - 150);
    ctx.lineTo(startX - 400, startY - 100);
    ctx.lineTo(startX - 500, startY + 50);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // 2. Hybrid route (yellow) - balanced middle route
    ctx.strokeStyle = COLORS.hybrid;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX - 150, startY - 50);
    ctx.lineTo(startX - 280, startY + 20);
    ctx.lineTo(startX - 380, startY + 100);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // 3. Dijkstra route (red) - shortest but more direct
    ctx.strokeStyle = COLORS.dijkstra;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX - 120, startY + 50);
    ctx.lineTo(startX - 250, startY + 100);
    ctx.lineTo(startX - 350, startY + 130);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // Draw START marker (green circle with black border)
    ctx.fillStyle = '#00FF00';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(startX, startY, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // START label above marker
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 16px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('START', startX, startY - 35);
    
    // Draw END marker (red square with black border)
    ctx.fillStyle = '#FF0000';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.rect(endX - 18, endY - 18, 36, 36);
    ctx.fill();
    ctx.stroke();
    
    // END label inside square
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px Segoe UI';
    ctx.fillText('END', endX, endY + 6);
}


function drawVisualizationHeader(ctx, dijkstra, astar, hybrid) {
    // Title box at top
    ctx.fillStyle = '#000000';
    ctx.fillRect(20, 20, 320, 130);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 18px Segoe UI';
    ctx.textAlign = 'left';
    ctx.fillText('Algorithm Performance', 35, 50);
    
    // Draw colored legend lines with distances
    const legendItems = [
        { color: COLORS.dijkstra, label: `Dijkstra (${dijkstra.distanceKm} km)`, y: 80 },
        { color: COLORS.astar, label: `A* (${astar.distanceKm} km)`, y: 110 },
        { color: COLORS.hybrid, label: `Hybrid (${hybrid.distanceKm} km)`, y: 140 }
    ];
    
    legendItems.forEach(item => {
        // Colored line
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(45, item.y);
        ctx.lineTo(90, item.y);
        ctx.stroke();
        
        // Label
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '14px Segoe UI';
        ctx.fillText(item.label, 105, item.y + 5);
    });
}


function drawStatsBox(ctx, dijkstra, astar, hybrid) {
    // Calculate graph size (you'll get this from backend metadata)
    const graphNodes = 429; // Example - get from metadata
    const graphEdges = 873; // Example - get from metadata
    
    // Stats box at bottom left with yellow border
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 8;
    ctx.strokeRect(20, 650, 280, 130);
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(24, 654, 272, 122);
    
    // Title
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 15px monospace';
    ctx.fillText('ADAPTIVE HYBRID ROUTING', 35, 680);
    
    // Stats text
    ctx.font = '12px monospace';
    const stats = [
        `Dijkstra: ${dijkstra.distanceKm} km`,
        `A*: ${astar.distanceKm} km`,
        `Hybrid: ${hybrid.distanceKm} km`,
        '',
        `Graph: ${graphNodes} nodes, ${graphEdges} edges`
    ];
    
    let yPos = 705;
    stats.forEach(line => {
        ctx.fillText(line, 35, yPos);
        yPos += 18;
    });
}


function drawGrid(ctx, width, height) {
    // Draw subtle road network grid
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 0.5;
    
    // Draw irregular road-like grid
    for (let x = 100; x < width - 100; x += 50 + Math.random() * 30) {
        ctx.beginPath();
        ctx.moveTo(x, 200);
        ctx.lineTo(x + Math.random() * 50 - 25, height - 200);
        ctx.stroke();
    }
    
    for (let y = 200; y < height - 200; y += 40 + Math.random() * 30) {
        ctx.beginPath();
        ctx.moveTo(100, y);
        ctx.lineTo(width - 100, y + Math.random() * 40 - 20);
        ctx.stroke();
    }
}


function drawPlaceholderRoutes(ctx, canvas) {
    const width = canvas.width;
    const height = canvas.height;
    
    // Draw light gray road network background
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    
    // Draw random road network
    for (let i = 0; i < 30; i++) {
        ctx.beginPath();
        const startX = 100 + Math.random() * (width - 200);
        const startY = 200 + Math.random() * (height - 400);
        ctx.moveTo(startX, startY);
        
        for (let j = 0; j < 3; j++) {
            const nextX = startX + (Math.random() - 0.5) * 200;
            const nextY = startY + (Math.random() - 0.5) * 200;
            ctx.lineTo(nextX, nextY);
        }
        ctx.stroke();
    }
    
    // Define route paths (realistic looking routes)
    const centerX = width / 2;
    const centerY = height / 2;
    
    const startX = centerX + 200;
    const startY = centerY + 100;
    const endX = centerX - 50;
    const endY = centerY - 80;
    
    // A* route (cyan) - takes longer detour
    ctx.strokeStyle = COLORS.astar;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX - 50, startY + 150);
    ctx.lineTo(startX - 150, startY + 200);
    ctx.lineTo(startX - 250, startY + 150);
    ctx.lineTo(startX - 300, startY + 50);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // Hybrid route (yellow) - balanced route
    ctx.strokeStyle = COLORS.hybrid;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX - 80, startY + 50);
    ctx.lineTo(startX - 150, startY + 20);
    ctx.lineTo(startX - 220, startY - 60);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // Dijkstra route (red) - shortest but might use poor roads
    ctx.strokeStyle = COLORS.dijkstra;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX - 70, startY + 30);
    ctx.lineTo(startX - 140, startY - 20);
    ctx.lineTo(startX - 200, startY - 50);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    // Draw START marker (green)
    ctx.fillStyle = '#00FF00';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(startX, startY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // START label
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 14px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('START', startX, startY - 25);
    
    // Draw END marker (red)
    ctx.fillStyle = '#FF0000';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.rect(endX - 12, endY - 12, 24, 24);
    ctx.fill();
    ctx.stroke();
    
    // END label
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px Segoe UI';
    ctx.fillText('END', endX, endY + 5);
}


// ============================================
// MAP ROUTE DRAWING
// ============================================

/**
 * Draw all three routes on Google Map
 * @param {Object} routes - Contains dijkstra, astar, hybrid coordinate arrays
 */
function drawMapRoutes(routes) {
    console.log('🗺️  Drawing routes on map...');

    routeLines.forEach(line => line.setMap(null));
    routeLines = [];

    if (!routes.dijkstra || !routes.dijkstra.length) {
        console.warn('⚠️ No route data to draw');
        return;
    }

    const bounds = new google.maps.LatLngBounds();

    // Strategy: When Dijkstra and Hybrid share the same path they overlap.
    // Fix: Draw Dijkstra as a wide semi-transparent base, A* as dashed,
    // and Hybrid as a thin solid line on top — all three always visible.
    const routeConfigs = [
        // Dijkstra — wide, semi-transparent base so Hybrid shows on top
        { coords: routes.dijkstra, color: COLORS.dijkstra,
          weight: 10, opacity: 0.45, zIndex: 1, dashed: false },
        // A* — medium dashed so it stands out from the solid lines
        { coords: routes.astar,    color: COLORS.astar,
          weight: 5,  opacity: 0.9,  zIndex: 2, dashed: true  },
        // Hybrid — thin solid line on very top, always visible
        { coords: routes.hybrid,   color: COLORS.hybrid,
          weight: 4,  opacity: 1.0,  zIndex: 3, dashed: false }
    ];

    routeConfigs.forEach(({ coords, color, weight, opacity, zIndex, dashed }) => {
        if (!coords || !coords.length) return;
        const path = coords.map(c => ({ lat: c[0], lng: c[1] }));

        const icons = dashed ? [{
            icon: {
                path        : 'M 0,-1 0,1',
                strokeOpacity: 1,
                scale        : 3
            },
            offset: '0',
            repeat: '12px'
        }] : [];

        const polyline = new google.maps.Polyline({
            path,
            geodesic      : true,
            strokeColor   : color,
            strokeOpacity : dashed ? 0 : opacity,
            strokeWeight  : weight,
            zIndex,
            icons,
            map
        });

        routeLines.push(polyline);
        path.forEach(p => bounds.extend(p));
    });

    map.fitBounds(bounds);
}


// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Show error message to user
 * @param {string} message - Error message
 */
function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.classList.add('active');
}


// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🎯 Routing Calculator Frontend Loaded');
    console.log('🔗 Backend URL:', BACKEND_URL);

    // Pre-fetch the road network so it's ready when routes are calculated
    fetchRoadNetwork();
    
    // Set Start button
    const setStartBtn = document.getElementById('setStartBtn');
    if (setStartBtn) {
        setStartBtn.addEventListener('click', function(e) {
            setMode('start', e);
        });
    }

    // Set End button
    const setEndBtn = document.getElementById('setEndBtn');
    if (setEndBtn) {
        setEndBtn.addEventListener('click', function(e) {
            setMode('end', e);
        });
    }

    // Calculate Route button
    const calculateBtn = document.getElementById('calculateBtn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', calculateRoute);
    }

    // Clear Map button
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearMap);
    }

    // Enter key to calculate
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                calculateRoute();
            }
        });
    });

    console.log('✅ Event listeners attached');
});
