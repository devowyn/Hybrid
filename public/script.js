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
 * Build route visualization on canvas
 */
function buildRouteVisualization(dijkstra, astar, hybrid) {
    const canvas = document.getElementById('chartRouteViz');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawGrid(ctx, canvas.width, canvas.height);

    // Draw simple representation (placeholder)
    drawPlaceholderRoutes(ctx, canvas);

    // Draw legend
    drawLegend(ctx, dijkstra, astar, hybrid);
}


function drawGrid(ctx, width, height) {
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y < height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}


function drawPlaceholderRoutes(ctx, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const sx = cx + 100, sy = cy + 20;
    const ex = cx - 80, ey = cy - 20;

    const routes = [
        { color: COLORS.dijkstra, pts: [[sx,sy],[sx-30,sy-15],[sx-55,sy-10],[sx-80,sy-25],[sx-110,sy-20],[ex,ey]] },
        { color: COLORS.astar, pts: [[sx,sy],[sx-20,sy+20],[sx-50,sy+25],[sx-80,sy+10],[sx-110,sy-10],[ex,ey]] },
        { color: COLORS.hybrid, pts: [[sx,sy],[sx-25,sy-8],[sx-55,sy-18],[sx-85,sy-20],[sx-110,sy-22],[ex,ey]] }
    ];

    routes.forEach(r => {
        ctx.beginPath();
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3;
        ctx.moveTo(r.pts[0][0], r.pts[0][1]);
        r.pts.forEach(p => ctx.lineTo(p[0], p[1]));
        ctx.stroke();
    });

    // Markers
    ctx.fillStyle = '#27ae60';
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(ex, ey, 9, 0, Math.PI * 2);
    ctx.fill();
}


function drawLegend(ctx, dijkstra, astar, hybrid) {
    const items = [
        { color: COLORS.dijkstra, label: `Dijkstra (${dijkstra.distanceKm} km)` },
        { color: COLORS.astar, label: `A* (${astar.distanceKm} km)` },
        { color: COLORS.hybrid, label: `Hybrid (${hybrid.distanceKm} km)` }
    ];

    items.forEach((item, i) => {
        ctx.fillStyle = item.color;
        ctx.fillRect(12, 12 + i * 22, 22, 4);
        
        ctx.fillStyle = 'white';
        ctx.font = '11px Segoe UI';
        ctx.textAlign = 'left';
        ctx.fillText(item.label, 40, 17 + i * 22);
    });
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
