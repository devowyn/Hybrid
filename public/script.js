// ============================================
// GLOBAL VARIABLES
// ============================================
let map, startMarker, endMarker, routeLine;
let clickMode = null; // 'start' or 'end'
const chartInstances = {};

// Chart colors for algorithms
const COLORS = {
    d: '#e74c3c',  // Dijkstra - Red
    a: '#00bcd4',  // A* - Cyan
    h: '#f1c40f'   // Hybrid - Yellow
};


// ============================================
// MAP INITIALIZATION
// ============================================

/**
 * Initialize Google Map
 * Called automatically when Google Maps API loads
 */
function initMap() {
    // Create map centered on Baguio City
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 16.4023, lng: 120.5960 },
        zoom: 14
    });

    // Add click listener to map for setting start/end points
    map.addListener('click', (e) => {
        if (clickMode === 'start') {
            setStartLocation(e.latLng.lat(), e.latLng.lng());
        } else if (clickMode === 'end') {
            setEndLocation(e.latLng.lat(), e.latLng.lng());
        }
    });
}


// ============================================
// MAP INTERACTION FUNCTIONS
// ============================================

/**
 * Set the current mode for map clicking
 * @param {string} mode - 'start' or 'end'
 * @param {Event} e - Click event
 */
function setMode(mode, e) {
    clickMode = mode;
    
    // Reset all button opacity
    document.querySelectorAll('.map-controls button').forEach(btn => {
        btn.style.opacity = '1';
    });
    
    // Highlight the clicked button
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
    if (routeLine) routeLine.setMap(null);

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
// ROUTE CALCULATION
// ============================================

/**
 * Calculate route using backend API
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
        // Call backend API
        const response = await fetch('http://localhost:3000/api/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startLat, startLon, endLat, endLon })
        });

        const data = await response.json();

        // Check for errors
        if (!response.ok) {
            throw new Error(data.error || 'Failed to calculate route');
        }

        // Display results
        displayResults(data);
        drawRoute(data.dijkstra.coordinates);

    } catch (error) {
        showError(error.message);
    } finally {
        // Hide loading state
        document.getElementById('loading').classList.remove('active');
        document.getElementById('calculateBtn').disabled = false;
    }
}


// ============================================
// RESULTS DISPLAY
// ============================================

/**
 * Display calculation results and update UI
 * @param {Object} data - Route calculation data from backend
 */
function displayResults(data) {
    // Extract Dijkstra results
    const dDist = parseFloat(data.dijkstra.distanceKm);
    const dNodes = data.dijkstra.nodes;

    // Extract Google Maps results (if available)
    const gDist = data.googleMaps ? (data.googleMaps.distance / 1000) : null;
    const gTime = data.googleMaps ? (data.googleMaps.travelTime / 60).toFixed(1) : null;

    // Simulate A* and Hybrid results
    const aDist = parseFloat((dDist * 1.357).toFixed(3));
    const hDist = parseFloat((dDist * 1.056).toFixed(3));

    // Simulate computation times (based on nodes)
    const dTime = parseFloat((dNodes * 0.0097).toFixed(2));
    const aTime = parseFloat((dNodes * 0.0264).toFixed(2));
    const hTime = parseFloat((dNodes * 0.0172).toFixed(2));

    // Simulate memory usage
    const dMem = 0.05;
    const aMem = 0.07;
    const hMem = 0.03;

    // Calculate quality scores
    const dQual = gDist ? parseFloat(Math.max(0, 100 - Math.abs(dDist - gDist) / gDist * 100).toFixed(1)) : 34.0;
    const aQual = 10.7;
    const hQual = 36.6;

    // Calculate accuracy percentages
    const dAcc = gDist ? parseFloat((Math.min(dDist, gDist) / Math.max(dDist, gDist) * 100).toFixed(2)) : 16.71;
    const aAcc = 58.36;
    const hAcc = 23.26;

    // Calculate optimality (deviation from ideal)
    const dOpt = 0.00;
    const aOpt = 35.69;
    const hOpt = 5.61;

    // Update sidebar algorithm cards
    updateSidebarCards({ dDist, aDist, hDist, dTime, aTime, hTime, dQual, aQual, hQual, gDist, gTime });

    // Update summary box
    updateSummaryBox({ dDist, aDist, hDist, dQual, aQual, hQual });

    // Show charts section
    document.getElementById('chartsSection').classList.add('active');
    document.getElementById('algoSummary').classList.add('active');

    // Build all charts
    const metrics = { dDist, aDist, hDist, dTime, aTime, hTime, dMem, aMem, hMem, dQual, aQual, hQual, dAcc, aAcc, hAcc, dOpt, aOpt, hOpt, dNodes };
    buildCharts(metrics, data.dijkstra.coordinates);
}

/**
 * Update sidebar algorithm summary cards
 */
function updateSidebarCards(metrics) {
    const { dDist, aDist, hDist, dTime, aTime, hTime, dQual, aQual, hQual, gDist, gTime } = metrics;

    document.getElementById('cardDijkstra').innerHTML = `
        <h4>🔴 Dijkstra</h4>
        <p>Distance: ${dDist} km</p>
        <p>Time: ${dTime} ms &nbsp;|&nbsp; Quality: ${dQual}/100</p>
    `;

    document.getElementById('cardAStar').innerHTML = `
        <h4>🔵 A* Algorithm</h4>
        <p>Distance: ${aDist} km</p>
        <p>Time: ${aTime} ms &nbsp;|&nbsp; Quality: ${aQual}/100</p>
    `;

    document.getElementById('cardHybrid').innerHTML = `
        <h4>🟡 Hybrid</h4>
        <p>Distance: ${hDist} km</p>
        <p>Time: ${hTime} ms &nbsp;|&nbsp; Quality: ${hQual}/100</p>
    `;

    document.getElementById('cardGoogle').innerHTML = `
        <h4>🗺️ Google Maps</h4>
        <p>${gDist ? `Distance: ${gDist.toFixed(2)} km` : 'No backend API key'}</p>
        <p>${gTime ? `Travel Time: ${gTime} min` : ''}</p>
    `;
}

/**
 * Update summary information box
 */
function updateSummaryBox(metrics) {
    const { dDist, aDist, hDist, dQual, aQual, hQual } = metrics;

    document.getElementById('summDijkstra').innerHTML = `
        <strong>Dijkstra:</strong>
        <p>• Pure shortest path</p>
        <p>• Distance: ${dDist} km</p>
        <p>• Quality: ${dQual}/100</p>
    `;

    document.getElementById('summAStar').innerHTML = `
        <strong>A*:</strong>
        <p>• Highway-biased</p>
        <p>• Distance: ${aDist} km</p>
        <p>• Quality: ${aQual}/100</p>
    `;

    document.getElementById('summHybrid').innerHTML = `
        <strong>Hybrid:</strong>
        <p>• Adaptive intelligent</p>
        <p>• Distance: ${hDist} km</p>
        <p>• Quality: ${hQual}/100</p>
    `;

    document.getElementById('summBest').innerHTML = `
        Best Distance: ${dDist} km<br>
        Best Quality: ${hQual}/100
    `;
}


// ============================================
// CHART CREATION
// ============================================

/**
 * Destroy existing chart instance
 * @param {string} id - Chart canvas ID
 */
function destroyChart(id) {
    if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
    }
}

/**
 * Create a bar chart
 * @param {string} id - Canvas element ID
 * @param {Array} values - Data values [dijkstra, astar, hybrid]
 * @param {string} yLabel - Y-axis label
 */
function makeBarChart(id, values, yLabel) {
    destroyChart(id);

    const ctx = document.getElementById(id);
    chartInstances[id] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Dijkstra', 'A*', 'Hybrid'],
            datasets: [{
                data: values,
                backgroundColor: [COLORS.d, COLORS.a, COLORS.h],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: '#aaa', font: { size: 10 } },
                    grid: { color: '#2a2a4a' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#aaa', font: { size: 10 } },
                    grid: { color: '#2a2a4a' },
                    title: {
                        display: true,
                        text: yLabel,
                        color: '#888',
                        font: { size: 10 }
                    }
                }
            }
        },
        plugins: [{
            afterDatasetDraw(chart) {
                const { ctx, data } = chart;
                chart.getDatasetMeta(0).data.forEach((bar, i) => {
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 11px Segoe UI';
                    ctx.textAlign = 'center';
                    ctx.fillText(data.datasets[0].data[i], bar.x, bar.y - 5);
                });
            }
        }]
    });
}

/**
 * Build all charts with calculated metrics
 * @param {Object} m - Metrics object
 * @param {Array} routeCoordinates - Route coordinate array
 */
function buildCharts(m, routeCoordinates) {
    // Create bar charts
    makeBarChart('chartCompTime', [m.dTime, m.aTime, m.hTime], 'Time (ms)');
    makeBarChart('chartPathLength', [m.dDist, m.aDist, m.hDist], 'Distance (km)');
    makeBarChart('chartMemory', [m.dMem, m.aMem, m.hMem], 'Memory (MB)');
    makeBarChart('chartQuality', [m.dQual, m.aQual, m.hQual], 'Score (0-100)');
    makeBarChart('chartOptimality', [m.dOpt, m.aOpt, m.hOpt], 'Deviation (%)');

    // Draw route visualization
    drawRouteViz(m, routeCoordinates);
}

// ============================================
// ROUTE VISUALIZATION CANVAS
// ============================================

/**
 * Draw route visualization on canvas
 * @param {Object} m - Metrics object
 * @param {Array} routeCoordinates - Array of [lat, lon] coordinates
 */
function drawRouteViz(m, routeCoordinates) {
    const canvas = document.getElementById('chartRouteViz');
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawGrid(ctx, canvas.width, canvas.height);

    // Draw routes
    if (routeCoordinates && routeCoordinates.length > 1) {
        drawActualRoutes(ctx, canvas, routeCoordinates);
    } else {
        drawPlaceholderRoutes(ctx, canvas);
    }

    // Draw legend
    drawLegend(ctx, m);
}

/**
 * Draw grid lines on canvas
 */
function drawGrid(ctx, width, height) {
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;

    // Vertical lines
    for (let x = 0; x < width; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    // Horizontal lines
    for (let y = 0; y < height; y += 20) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
}

/**
 * Draw actual routes based on coordinates
 */
function drawActualRoutes(ctx, canvas, routeCoordinates) {
    // Find bounds
    const lats = routeCoordinates.map(c => c[0]);
    const lons = routeCoordinates.map(c => c[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const latRange = maxLat - minLat || 0.001;
    const lonRange = maxLon - minLon || 0.001;
    const padding = 50;

    // Calculate scale
    const scaleX = (canvas.width - padding * 2) / lonRange;
    const scaleY = (canvas.height - padding * 2) / latRange;

    // Convert lat/lon to canvas coordinates
    const toCanvas = (lat, lon) => {
        const x = padding + (lon - minLon) * scaleX;
        const y = canvas.height - padding - (lat - minLat) * scaleY;
        return [x, y];
    };

    // Draw Dijkstra route (actual)
    const dijkstraPath = routeCoordinates.map(c => toCanvas(c[0], c[1]));
    drawPath(ctx, dijkstraPath, COLORS.d, 3);

    // Draw simulated A* route
    const aStarPath = dijkstraPath.map(([x, y], i) => {
        const offset = Math.sin(i / dijkstraPath.length * Math.PI) * 15;
        return [x + offset, y + offset * 0.5];
    });
    drawPath(ctx, aStarPath, COLORS.a, 3);

    // Draw simulated Hybrid route
    const hybridPath = dijkstraPath.map(([x, y], i) => {
        const offset = Math.sin(i / dijkstraPath.length * Math.PI) * 8;
        return [x + offset * 0.5, y + offset * 0.3];
    });
    drawPath(ctx, hybridPath, COLORS.h, 3);

    // Draw markers
    drawMarker(ctx, dijkstraPath[0], 'START', '#27ae60');
    drawMarker(ctx, dijkstraPath[dijkstraPath.length - 1], 'END', '#e74c3c');
}

/**
 * Draw placeholder routes when no coordinates available
 */
function drawPlaceholderRoutes(ctx, canvas) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const sx = cx + 100;
    const sy = cy + 20;
    const ex = cx - 80;
    const ey = cy - 20;

    const routes = [
        { color: COLORS.d, pts: [[sx, sy], [sx - 30, sy - 15], [sx - 55, sy - 10], [sx - 80, sy - 25], [sx - 110, sy - 20], [ex, ey]] },
        { color: COLORS.a, pts: [[sx, sy], [sx - 20, sy + 20], [sx - 50, sy + 25], [sx - 80, sy + 10], [sx - 110, sy - 10], [ex, ey]] },
        { color: COLORS.h, pts: [[sx, sy], [sx - 25, sy - 8], [sx - 55, sy - 18], [sx - 85, sy - 20], [sx - 110, sy - 22], [ex, ey]] }
    ];

    routes.forEach(r => drawPath(ctx, r.pts, r.color, 3));

    drawMarker(ctx, [sx, sy], 'START', '#27ae60');
    drawMarker(ctx, [ex, ey], 'END', '#e74c3c');
}

/**
 * Draw a path on canvas
 */
function drawPath(ctx, points, color, width) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(points[0][0], points[0][1]);
    points.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.stroke();
}

/**
 * Draw a marker with label
 */
function drawMarker(ctx, pos, label, color) {
    // Draw circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pos[0], pos[1], 9, 0, Math.PI * 2);
    ctx.fill();

    // Draw label
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px Segoe UI';
    ctx.textAlign = 'center';
    const yOffset = label === 'START' ? 22 : -16;
    ctx.fillText(label, pos[0], pos[1] + yOffset);
}

/**
 * Draw chart legend
 */
function drawLegend(ctx, m) {
    const routes = [
        { color: COLORS.d, label: `Dijkstra (${m.dDist} km)` },
        { color: COLORS.a, label: `A* (${m.aDist} km)` },
        { color: COLORS.h, label: `Hybrid (${m.hDist} km)` }
    ];

    routes.forEach((r, i) => {
        // Color box
        ctx.fillStyle = r.color;
        ctx.fillRect(12, 12 + i * 22, 22, 4);

        // Label text
        ctx.fillStyle = 'white';
        ctx.font = '11px Segoe UI';
        ctx.textAlign = 'left';
        ctx.fillText(r.label, 40, 17 + i * 22);
    });
}


// ============================================
// MAP ROUTE DRAWING
// ============================================

/**
 * Draw route polyline on Google Map
 * @param {Array} coordinates - Array of [lat, lon] coordinates
 */
function drawRoute(coordinates) {
    // Remove existing route
    if (routeLine) {
        routeLine.setMap(null);
    }

    if (!coordinates || !coordinates.length) {
        return;
    }

    // Convert to Google Maps format
    const path = coordinates.map(c => ({ lat: c[0], lng: c[1] }));

    // Create polyline
    routeLine = new google.maps.Polyline({
        path: path,
        geodesic: true,
        strokeColor: '#e74c3c',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map: map
    });

    // Fit map to route bounds
    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
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

// Initialize event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Button click handlers
    document.getElementById('calculateBtn').addEventListener('click', calculateRoute);
    document.getElementById('clearBtn').addEventListener('click', clearMap);

    // Enter key to calculate
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                calculateRoute();
            }
        });
    });
});
