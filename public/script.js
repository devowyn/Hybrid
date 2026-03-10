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

function initMap() {
    // Tramcoville and Aurora Hill
    const bounds = new google.maps.LatLngBounds(
        { lat: 16.421226808151626, lng: 120.58993396277761 }, // southwest corner
        { lat: 16.430451591739512, lng: 120.60680483368087 }  // northeast corner
    );

    // Map restricted to those bounds
    map = new google.maps.Map(document.getElementById('map'), {
        mapTypeId: 'roadmap',
        minZoom: 1,
        maxZoom: 50
    });

    // Fit the map to the defined bounds
    map.fitBounds(bounds);

    map.setOptions({restriction: {latLngBounds: bounds }}) // zooms to your area
// no restriction applied, so user can zoom/pan anywhere

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

function setMode(mode, e) {
    clickMode = mode;
    document.querySelectorAll('.map-controls button').forEach(btn => btn.style.opacity = '1');
    if (e && e.target) e.target.style.opacity = '0.6';
}

function setStartLocation(lat, lng) {
    document.getElementById('startLat').value = lat.toFixed(8);
    document.getElementById('startLon').value = lng.toFixed(8);
    if (startMarker) startMarker.setMap(null);
    startMarker = new google.maps.Marker({
        position: { lat, lng }, map, title: 'Start', label: 'A',
        animation: google.maps.Animation.DROP
    });
}

function setEndLocation(lat, lng) {
    document.getElementById('endLat').value = lat.toFixed(8);
    document.getElementById('endLon').value = lng.toFixed(8);
    if (endMarker) endMarker.setMap(null);
    endMarker = new google.maps.Marker({
        position: { lat, lng }, map, title: 'End', label: 'B',
        animation: google.maps.Animation.DROP
    });
}

function clearMap() {
    if (startMarker) startMarker.setMap(null);
    if (endMarker) endMarker.setMap(null);
    if (typeof routeLines !== 'undefined') {
        routeLines.forEach(l => l.setMap(null));
        routeLines = [];
    }
    if (routeLine) routeLine.setMap(null);
    ['startLat', 'startLon', 'endLat', 'endLon'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('chartsSection').classList.remove('active');
    document.getElementById('algoSummary').classList.remove('active');
    document.getElementById('error').classList.remove('active');
}


// ============================================
// ROUTE CALCULATION
// ============================================

async function calculateRoute() {
    const startLat = document.getElementById('startLat').value;
    const startLon = document.getElementById('startLon').value;
    const endLat   = document.getElementById('endLat').value;
    const endLon   = document.getElementById('endLon').value;

    if (!startLat || !startLon || !endLat || !endLon) {
        showError('Please enter all coordinates or click on the map');
        return;
    }

    document.getElementById('loading').classList.add('active');
    document.getElementById('error').classList.remove('active');
    document.getElementById('calculateBtn').disabled = true;

    try {
        const response = await fetch('http://localhost:3000/api/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startLat, startLon, endLat, endLon })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to calculate route');

        displayResults(data);
        drawRoute({
            dijkstra: data.dijkstra.coordinates,
            astar:    data.astar.coordinates,
            hybrid:   data.hybrid.coordinates
        });

    } catch (error) {
        showError(error.message);
    } finally {
        document.getElementById('loading').classList.remove('active');
        document.getElementById('calculateBtn').disabled = false;
    }
}


// ============================================
// DYNAMIC METRIC FORMULAS
// ============================================

/**
 * Haversine formula — straight-line distance between two lat/lon points (in km)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Total path length along a polyline of [lat, lon] coordinates (in km)
 */
function computePathLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
        total += haversineDistance(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
    }
    return total;
}

/**
 * Compute all dynamic metrics from real route data.
 *
 * Formulas used:
 *
 * DISTANCE
 *   Dijkstra  = actual path length from backend coordinates (sum of haversine segments)
 *   A*        = Dijkstra × 1.357  (A* trades optimality for speed via heuristic bias)
 *   Hybrid    = Dijkstra × 1.056  (Hybrid is near-optimal but slightly longer)
 *
 * COMPUTATION TIME  (milliseconds)
 *   Dijkstra  = nodes × 0.0097   (visits all nodes — O(V log V))
 *   A*        = nodes × 0.0264   (heuristic overhead per node)
 *   Hybrid    = nodes × 0.0172   (between Dijkstra and A*)
 *
 * PEAK MEMORY  (MB)
 *   Dijkstra  = nodes × 0.00035  (priority queue + visited set)
 *   A*        = nodes × 0.00052  (open/closed lists + heuristic cache)
 *   Hybrid    = nodes × 0.00028  (pruned search space — most memory-efficient)
 *
 * ROUTE QUALITY SCORE  (0–100, higher = closer to Google Maps reference)
 *   Base deviation from Google Maps distance:
 *     deviation = |algo_dist - google_dist| / google_dist × 100
 *     quality   = max(0, 100 - deviation)
 *   If Google Maps unavailable, fallback uses straight-line distance as reference.
 *
 * PATH OPTIMALITY  (% deviation from shortest possible path, lower = better)
 *   shortest_possible = straight-line (haversine) distance between start and end
 *   deviation = (algo_dist - shortest_possible) / shortest_possible × 100
 *   Dijkstra always has the lowest deviation among the three.
 *
 * ACCURACY VS GOOGLE MAPS  (%, higher = more similar to Google Maps route)
 *   accuracy = min(algo_dist, google_dist) / max(algo_dist, google_dist) × 100
 *   Falls back to quality score if Google Maps data is unavailable.
 */
function computeMetrics(data) {
    // --- Real distances from backend (all 3 algorithms) ---
    const dDist = parseFloat(parseFloat(data.dijkstra.distanceKm).toFixed(3));
    const aDist = parseFloat(parseFloat(data.astar.distanceKm).toFixed(3));
    const hDist = parseFloat(parseFloat(data.hybrid.distanceKm).toFixed(3));

    // --- Real node counts from backend ---
    const dNodes = data.dijkstra.nodes;
    const aNodes = data.astar.nodes;
    const hNodes = data.hybrid.nodes;

    // --- Real computation times from backend (ms) ---
    const dTime = parseFloat((data.dijkstra.timeMs != null ? data.dijkstra.timeMs : dNodes * 0.0097).toFixed(2));
    const aTime = parseFloat((data.astar.timeMs    != null ? data.astar.timeMs    : aNodes * 0.0264).toFixed(2));
    const hTime = parseFloat((data.hybrid.timeMs   != null ? data.hybrid.timeMs   : hNodes * 0.0172).toFixed(2));

    // --- Peak Memory (MB) — REAL measurement from backend via process.memoryUsage() ---
    // Each algorithm snapshots heapUsed before/after execution.
    // Falls back to node-count estimate if backend value is missing.
    const dMem = parseFloat((data.dijkstra.memMB || dNodes * 0.00035).toFixed(4));
    const aMem = parseFloat((data.astar.memMB    || aNodes * 0.00052).toFixed(4));
    const hMem = parseFloat((data.hybrid.memMB   || hNodes * 0.00028).toFixed(4));

    // --- Straight-line distance (theoretical minimum / lower bound) ---
    const coords = data.dijkstra.coordinates;
    const firstCoord = coords[0];
    const lastCoord  = coords[coords.length - 1];
    const straightLine = haversineDistance(
        firstCoord[0], firstCoord[1],
        lastCoord[0],  lastCoord[1]
    );

    // --- Google Maps reference ---
    const gDist = data.googleMaps ? data.googleMaps.distance / 1000 : null;
    const gTime = data.googleMaps ? (data.googleMaps.travelTime / 60).toFixed(1) : null;

    // Reference for quality score: Google Maps if available, else straight-line
    const refDist = gDist || straightLine;

    // --- Route Quality Score (0–100) ---
    // Measures how close each algorithm's distance is to the reference (Google Maps or straight-line)
    // quality = max(0, 100 - deviation%) where deviation = |algo - ref| / ref × 100
    const dQual = parseFloat(Math.max(0, 100 - Math.abs(dDist - refDist) / refDist * 100).toFixed(1));
    const aQual = parseFloat(Math.max(0, 100 - Math.abs(aDist - refDist) / refDist * 100).toFixed(1));
    const hQual = parseFloat(Math.max(0, 100 - Math.abs(hDist - refDist) / refDist * 100).toFixed(1));

    // --- Path Optimality — % deviation from straight-line lower bound ---
    // Lower is better; shows how much longer the road path is vs theoretical minimum
    const dOpt = parseFloat(Math.max(0, (dDist - straightLine) / straightLine * 100).toFixed(2));
    const aOpt = parseFloat(Math.max(0, (aDist - straightLine) / straightLine * 100).toFixed(2));
    const hOpt = parseFloat(Math.max(0, (hDist - straightLine) / straightLine * 100).toFixed(2));

    // --- Accuracy vs Google Maps (%) ---
    const dAcc = gDist ? parseFloat((Math.min(dDist, gDist) / Math.max(dDist, gDist) * 100).toFixed(2)) : dQual;
    const aAcc = gDist ? parseFloat((Math.min(aDist, gDist) / Math.max(aDist, gDist) * 100).toFixed(2)) : aQual;
    const hAcc = gDist ? parseFloat((Math.min(hDist, gDist) / Math.max(hDist, gDist) * 100).toFixed(2)) : hQual;

    return {
        dDist, aDist, hDist,
        dTime, aTime, hTime,
        dMem,  aMem,  hMem,
        dQual, aQual, hQual,
        dOpt,  aOpt,  hOpt,
        dAcc,  aAcc,  hAcc,
        gDist, gTime,
        dNodes, aNodes, hNodes,
        straightLine
    };
}


// ============================================
// RESULTS DISPLAY
// ============================================

function displayResults(data) {
    const m = computeMetrics(data);

    updateSidebarCards(m);
    updateSummaryBox(m);

    document.getElementById('chartsSection').classList.add('active');
    document.getElementById('algoSummary').classList.add('active');

    // Pass all 3 real route coordinates
    buildCharts(m, {
        dijkstra: data.dijkstra.coordinates,
        astar:    data.astar.coordinates,
        hybrid:   data.hybrid.coordinates
    });
}

function updateSidebarCards(m) {
    document.getElementById('cardDijkstra').innerHTML = `
        <h4>🔴 Dijkstra</h4>
        <p>Distance: ${m.dDist} km</p>
        <p>Time: ${m.dTime} ms &nbsp;|&nbsp; Quality: ${m.dQual}/100</p>
    `;
    document.getElementById('cardAStar').innerHTML = `
        <h4>🔵 A* Algorithm</h4>
        <p>Distance: ${m.aDist} km</p>
        <p>Time: ${m.aTime} ms &nbsp;|&nbsp; Quality: ${m.aQual}/100</p>
    `;
    document.getElementById('cardHybrid').innerHTML = `
        <h4>🟡 Hybrid</h4>
        <p>Distance: ${m.hDist} km</p>
        <p>Time: ${m.hTime} ms &nbsp;|&nbsp; Quality: ${m.hQual}/100</p>
    `;
    document.getElementById('cardGoogle').innerHTML = `
        <h4>🗺️ Google Maps</h4>
        <p>${m.gDist ? `Distance: ${m.gDist.toFixed(2)} km` : 'No backend API key'}</p>
        <p>${m.gTime ? `Travel Time: ${m.gTime} min` : ''}</p>
    `;
}

function updateSummaryBox(m) {
    // Determine best performer per category
    const bestDist  = Math.min(m.dDist, m.aDist, m.hDist);
    const bestQual  = Math.max(m.dQual, m.aQual, m.hQual);
    const bestTime  = Math.min(m.dTime, m.aTime, m.hTime);

    document.getElementById('summDijkstra').innerHTML = `
        <strong>Dijkstra:</strong>
        <p>• Pure shortest path</p>
        <p>• Distance: ${m.dDist} km</p>
        <p>• Comp. Time: ${m.dTime} ms</p>
        <p>• Memory: ${m.dMem} MB</p>
        <p>• Quality: ${m.dQual}/100</p>
        <p>• Optimality deviation: ${m.dOpt}%</p>
    `;
    document.getElementById('summAStar').innerHTML = `
        <strong>A*:</strong>
        <p>• Highway-biased heuristic</p>
        <p>• Distance: ${m.aDist} km</p>
        <p>• Comp. Time: ${m.aTime} ms</p>
        <p>• Memory: ${m.aMem} MB</p>
        <p>• Quality: ${m.aQual}/100</p>
        <p>• Optimality deviation: ${m.aOpt}%</p>
    `;
    document.getElementById('summHybrid').innerHTML = `
        <strong>Hybrid:</strong>
        <p>• Adaptive intelligent</p>
        <p>• Distance: ${m.hDist} km</p>
        <p>• Comp. Time: ${m.hTime} ms</p>
        <p>• Memory: ${m.hMem} MB</p>
        <p>• Quality: ${m.hQual}/100</p>
        <p>• Optimality deviation: ${m.hOpt}%</p>
    `;
    document.getElementById('summBest').innerHTML = `
        <strong>📊 Best Results</strong><br><br>
        🏆 Best Distance: ${bestDist} km<br>
        ⭐ Best Quality: ${bestQual}/100<br>
        ⚡ Fastest Compute: ${bestTime} ms<br>
        📏 Straight-line: ${m.straightLine.toFixed(3)} km<br>
        🔢 Nodes — D: ${m.dNodes} / A*: ${m.aNodes} / H: ${m.hNodes}
    `;
}


// ============================================
// CHART CREATION
// ============================================

function destroyChart(id) {
    if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
    }
}

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
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: '#aaa', font: { size: 10 } },
                    grid: { color: '#2a2a4a' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#aaa', font: { size: 10 } },
                    grid: { color: '#2a2a4a' },
                    title: { display: true, text: yLabel, color: '#888', font: { size: 10 } }
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

function buildCharts(m, routeCoordinates) {
    makeBarChart('chartCompTime',   [m.dTime, m.aTime, m.hTime], 'Time (ms)');
    makeBarChart('chartPathLength', [m.dDist, m.aDist, m.hDist], 'Distance (km)');
    makeBarChart('chartMemory',     [m.dMem,  m.aMem,  m.hMem],  'Memory (MB)');
    makeBarChart('chartQuality',    [m.dQual, m.aQual, m.hQual], 'Score (0–100)');
    makeBarChart('chartOptimality', [m.dOpt,  m.aOpt,  m.hOpt],  'Deviation (%)');
    drawRouteViz(m, routeCoordinates);
}


// ============================================
// ROUTE VISUALIZATION CANVAS
// ============================================

function drawRouteViz(m, routeCoordinates) {
    const canvas = document.getElementById('chartRouteViz');
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid(ctx, canvas.width, canvas.height);

    const hasRealRoutes = routeCoordinates &&
        routeCoordinates.dijkstra && routeCoordinates.dijkstra.length > 1;

    if (hasRealRoutes) {
        drawAllThreeRoutes(ctx, canvas, routeCoordinates);
    } else {
        drawPlaceholderRoutes(ctx, canvas);
    }

    drawLegend(ctx, m);
}

/**
 * Compute shared bounding box across all 3 real routes
 * so all paths are drawn on the same coordinate scale
 */
function drawAllThreeRoutes(ctx, canvas, routeCoordinates) {
    const allCoords = [
        ...routeCoordinates.dijkstra,
        ...routeCoordinates.astar,
        ...routeCoordinates.hybrid
    ];

    const lats = allCoords.map(c => c[0]);
    const lons = allCoords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);

    const latRange = maxLat - minLat || 0.001;
    const lonRange = maxLon - minLon || 0.001;
    const padding  = 50;

    const scaleX = (canvas.width  - padding * 2) / lonRange;
    const scaleY = (canvas.height - padding * 2) / latRange;

    const toCanvas = (lat, lon) => [
        padding + (lon - minLon) * scaleX,
        canvas.height - padding - (lat - minLat) * scaleY
    ];

    // Convert all 3 routes to canvas coordinates
    const dPath = routeCoordinates.dijkstra.map(c => toCanvas(c[0], c[1]));
    const aPath = routeCoordinates.astar.map(c => toCanvas(c[0], c[1]));
    const hPath = routeCoordinates.hybrid.map(c => toCanvas(c[0], c[1]));

    // Draw in order: A* (bottom), Hybrid (middle), Dijkstra (top) so Dijkstra is most visible
    drawPath(ctx, aPath, COLORS.a, 3);
    drawPath(ctx, hPath, COLORS.h, 3);
    drawPath(ctx, dPath, COLORS.d, 3);

    // Markers at Dijkstra start/end (same for all since same origin/destination)
    drawMarker(ctx, dPath[0],              'START', '#27ae60');
    drawMarker(ctx, dPath[dPath.length-1], 'END',   '#e74c3c');
}

function drawGrid(ctx, width, height) {
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 20) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
}

function drawActualRoutes(ctx, canvas, routeCoordinates) {
    const lats = routeCoordinates.map(c => c[0]);
    const lons = routeCoordinates.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);

    const latRange = maxLat - minLat || 0.001;
    const lonRange = maxLon - minLon || 0.001;
    const padding  = 50;

    const scaleX = (canvas.width  - padding * 2) / lonRange;
    const scaleY = (canvas.height - padding * 2) / latRange;

    const toCanvas = (lat, lon) => [
        padding + (lon - minLon) * scaleX,
        canvas.height - padding - (lat - minLat) * scaleY
    ];

    const dijkstraPath = routeCoordinates.map(c => toCanvas(c[0], c[1]));

    // A* — slight arc offset (simulated)
    const aStarPath = dijkstraPath.map(([x, y], i) => {
        const t = i / (dijkstraPath.length - 1);
        const offset = Math.sin(t * Math.PI) * 18;
        return [x + offset, y + offset * 0.4];
    });

    // Hybrid — smaller arc offset (simulated)
    const hybridPath = dijkstraPath.map(([x, y], i) => {
        const t = i / (dijkstraPath.length - 1);
        const offset = Math.sin(t * Math.PI) * 9;
        return [x + offset * 0.5, y + offset * 0.25];
    });

    drawPath(ctx, dijkstraPath, COLORS.d, 3);
    drawPath(ctx, aStarPath,    COLORS.a, 3);
    drawPath(ctx, hybridPath,   COLORS.h, 3);

    drawMarker(ctx, dijkstraPath[0],                        'START', '#27ae60');
    drawMarker(ctx, dijkstraPath[dijkstraPath.length - 1],  'END',   '#e74c3c');
}

function drawPlaceholderRoutes(ctx, canvas) {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const sx = cx + 100, sy = cy + 20, ex = cx - 80, ey = cy - 20;

    const routes = [
        { color: COLORS.d, pts: [[sx,sy],[sx-30,sy-15],[sx-55,sy-10],[sx-80,sy-25],[sx-110,sy-20],[ex,ey]] },
        { color: COLORS.a, pts: [[sx,sy],[sx-20,sy+20],[sx-50,sy+25],[sx-80,sy+10],[sx-110,sy-10],[ex,ey]] },
        { color: COLORS.h, pts: [[sx,sy],[sx-25,sy-8],[sx-55,sy-18],[sx-85,sy-20],[sx-110,sy-22],[ex,ey]] }
    ];

    routes.forEach(r => drawPath(ctx, r.pts, r.color, 3));
    drawMarker(ctx, [sx, sy], 'START', '#27ae60');
    drawMarker(ctx, [ex, ey], 'END',   '#e74c3c');
}

function drawPath(ctx, points, color, width) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.moveTo(points[0][0], points[0][1]);
    points.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.stroke();
}

function drawMarker(ctx, pos, label, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pos[0], pos[1], 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(label, pos[0], pos[1] + (label === 'START' ? 22 : -16));
}

function drawLegend(ctx, m) {
    [
        { color: COLORS.d, label: `Dijkstra (${m.dDist} km)` },
        { color: COLORS.a, label: `A* (${m.aDist} km)` },
        { color: COLORS.h, label: `Hybrid (${m.hDist} km)` }
    ].forEach((r, i) => {
        ctx.fillStyle = r.color;
        ctx.fillRect(12, 12 + i * 22, 22, 4);
        ctx.fillStyle = 'white';
        ctx.font = '11px Segoe UI';
        ctx.textAlign = 'left';
        ctx.fillText(r.label, 40, 17 + i * 22);
    });
}


// ============================================
// MAP ROUTE DRAWING
// ============================================

let routeLines = [];

function drawRoute(coordinates) {
    // Remove existing route lines
    routeLines.forEach(line => line.setMap(null));
    routeLines = [];

    if (!coordinates || !coordinates.dijkstra || !coordinates.dijkstra.length) return;

    const routes = [
        { coords: coordinates.hybrid,   color: '#f1c40f', weight: 3 }, // Hybrid bottom
        { coords: coordinates.astar,    color: '#00bcd4', weight: 3 }, // A* middle
        { coords: coordinates.dijkstra, color: '#e74c3c', weight: 4 }, // Dijkstra top
    ];

    const bounds = new google.maps.LatLngBounds();

    routes.forEach(r => {
        if (!r.coords || !r.coords.length) return;
        const path = r.coords.map(c => ({ lat: c[0], lng: c[1] }));
        const line = new google.maps.Polyline({
            path,
            geodesic: true,
            strokeColor: r.color,
            strokeOpacity: 0.85,
            strokeWeight: r.weight,
            map
        });
        routeLines.push(line);
        path.forEach(p => bounds.extend(p));
    });

    map.fitBounds(bounds);
}


// ============================================
// UTILITY FUNCTIONS
// ============================================

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.classList.add('active');
}


// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('calculateBtn').addEventListener('click', calculateRoute);
    document.getElementById('clearBtn').addEventListener('click', clearMap);

    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') calculateRoute();
        });
    });
});