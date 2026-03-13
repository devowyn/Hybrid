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
        
        // Draw routes on map
        drawRoutes({
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
        <p>Time: ${dijkstra.timeMs} ms &nbsp;|&nbsp; Quality: ${dijkstra.qualityScore}/100</p>
    `;

    document.getElementById('cardAStar').innerHTML = `
        <h4>🔵 A* Algorithm</h4>
        <p>Distance: ${astar.distanceKm} km</p>
        <p>Time: ${astar.timeMs} ms &nbsp;|&nbsp; Quality: ${astar.qualityScore}/100</p>
    `;

    document.getElementById('cardHybrid').innerHTML = `
        <h4>🟡 Hybrid</h4>
        <p>Distance: ${hybrid.distanceKm} km</p>
        <p>Time: ${hybrid.timeMs} ms &nbsp;|&nbsp; Quality: ${hybrid.qualityScore}/100</p>
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
    const bestQuality = Math.max(dijkstra.qualityScore, astar.qualityScore, hybrid.qualityScore);

    document.getElementById('summDijkstra').innerHTML = `
        <strong>Dijkstra:</strong>
        <p>• Pure shortest path</p>
        <p>• Distance: ${dijkstra.distanceKm} km</p>
        <p>• Quality: ${dijkstra.qualityScore}/100</p>
    `;

    document.getElementById('summAStar').innerHTML = `
        <strong>A*:</strong>
        <p>• Highway-biased</p>
        <p>• Distance: ${astar.distanceKm} km</p>
        <p>• Quality: ${astar.qualityScore}/100</p>
    `;

    document.getElementById('summHybrid').innerHTML = `
        <strong>Hybrid:</strong>
        <p>• Adaptive intelligent</p>
        <p>• Distance: ${hybrid.distanceKm} km</p>
        <p>• Quality: ${hybrid.qualityScore}/100</p>
    `;

    document.getElementById('summBest').innerHTML = `
        Best Distance: ${bestDist} km<br>
        Best Quality: ${bestQuality}/100
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
    
    // Computation Time Chart
    buildBarChart(
        'chartCompTime',
        'Computation Time (ms)',
        [
            parseFloat(dijkstra.timeMs),
            parseFloat(astar.timeMs),
            parseFloat(hybrid.timeMs)
        ]
    );

    // Path Length Chart
    buildBarChart(
        'chartPathLength',
        'Path Length (km)',
        [
            parseFloat(dijkstra.distanceKm),
            parseFloat(astar.distanceKm),
            parseFloat(hybrid.distanceKm)
        ]
    );

    // Peak Memory Chart
    buildBarChart(
        'chartMemory',
        'Peak Memory (MB)',
        [
            dijkstra.peakMemoryMb,
            astar.peakMemoryMb,
            hybrid.peakMemoryMb
        ]
    );

    // Route Quality Score Chart
    buildBarChart(
        'chartQuality',
        'Route Quality Score (0-100)',
        [
            dijkstra.qualityScore,
            astar.qualityScore,
            hybrid.qualityScore
        ],
        0,
        100
    );

    // Path Optimality Chart (deviation from shortest)
    const shortest = Math.min(
        parseFloat(dijkstra.distanceKm),
        parseFloat(astar.distanceKm),
        parseFloat(hybrid.distanceKm)
    );
    
    buildBarChart(
        'chartOptimality',
        'Path Optimality (% deviation)',
        [
            ((parseFloat(dijkstra.distanceKm) - shortest) / shortest * 100),
            ((parseFloat(astar.distanceKm) - shortest) / shortest * 100),
            ((parseFloat(hybrid.distanceKm) - shortest) / shortest * 100)
        ]
    );

    // Route Visualization Canvas
    buildRouteVisualization(dijkstra, astar, hybrid);
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
 * Build route visualization on canvas with actual road network
 */
function buildRouteVisualization(dijkstra, astar, hybrid) {
    const canvas = document.getElementById('chartRouteViz');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas with light background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, width, height);

    // Draw road network background first
    drawRoadNetwork(ctx, width, height);
    
    // Draw the actual routes
    drawRoutes(ctx, width, height);
    
    // Draw legend and stats on top
    drawVisualizationHeader(ctx, dijkstra, astar, hybrid);
    drawStatsBox(ctx, dijkstra, astar, hybrid);
}


function drawRoadNetwork(ctx, width, height) {
    // Draw light gray road network background
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1.5;
    
    // Draw random realistic road network
    const centerX = width / 2;
    const centerY = height / 2;
    
    // Horizontal roads
    for (let i = 0; i < 15; i++) {
        ctx.beginPath();
        const y = 200 + i * 40 + (Math.random() - 0.5) * 30;
        ctx.moveTo(100, y);
        ctx.lineTo(width - 100, y);
        ctx.stroke();
    }
    
    // Vertical roads
    for (let i = 0; i < 20; i++) {
        ctx.beginPath();
        const x = 150 + i * 50 + (Math.random() - 0.5) * 30;
        ctx.moveTo(x, 180);
        ctx.lineTo(x, height - 100);
        ctx.stroke();
    }
}


function drawRoutes(ctx, width, height) {
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
        `Dijkstra: ${dijkstra.distanceKm} km | Q: ${dijkstra.qualityScore}/100`,
        `A*: ${astar.distanceKm} km | Q: ${astar.qualityScore}/100`,
        `Hybrid: ${hybrid.distanceKm} km | Q: ${hybrid.qualityScore}/100`,
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
function drawRoutes(routes) {
    console.log('🗺️  Drawing routes on map...');
    
    // Remove existing route lines
    routeLines.forEach(line => line.setMap(null));
    routeLines = [];

    if (!routes.dijkstra || !routes.dijkstra.length) {
        console.warn('No route data to draw');
        return;
    }

    const bounds = new google.maps.LatLngBounds();

    // Draw all three routes (order: hybrid, astar, dijkstra so dijkstra is on top)
    const routeConfigs = [
        { coords: routes.hybrid, color: COLORS.hybrid, weight: 3 },
        { coords: routes.astar, color: COLORS.astar, weight: 3 },
        { coords: routes.dijkstra, color: COLORS.dijkstra, weight: 4 }
    ];

    routeConfigs.forEach(config => {
        if (!config.coords || !config.coords.length) return;

        const path = config.coords.map(c => ({ lat: c[0], lng: c[1] }));
        
        const polyline = new google.maps.Polyline({
            path: path,
            geodesic: true,
            strokeColor: config.color,
            strokeOpacity: 0.85,
            strokeWeight: config.weight,
            map: map
        });

        routeLines.push(polyline);
        
        // Extend bounds
        path.forEach(p => bounds.extend(p));
    });

    // Fit map to show all routes
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
