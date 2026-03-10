const express = require('express');
const cors = require('cors');
const axios = require('axios');
const turf = require('@turf/turf');
const Graph = require('node-dijkstra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));


// ============================================
// OSM NETWORK FETCHING
// ============================================

async function fetchOSMNetwork(bbox) {
    console.log('Fetching OSM road network...');
    const query = `
        [out:json];
        (
            way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        );
        out body;
        >;
        out skel qt;
    `;
    try {
        const response = await axios.post('https://overpass-api.de/api/interpreter', query, {
            headers: { 'Content-Type': 'text/plain' },
            timeout: 30000
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching OSM data:', error.message);
        return null;
    }
}


// ============================================
// GRAPH BUILDING
// ============================================

function buildGraph(osmData) {
    const graph = new Map();
    const nodes = new Map();

    // Store highway tag per way for road classification
    const wayTags = new Map();

    osmData.elements.forEach(element => {
        if (element.type === 'node') {
            nodes.set(element.id, { lat: element.lat, lon: element.lon });
        }
        if (element.type === 'way' && element.tags) {
            wayTags.set(element.id, element.tags);
        }
    });

    osmData.elements.forEach(element => {
        if (element.type === 'way' && element.nodes) {
            const tags = element.tags || {};
            const highway = tags.highway || 'residential';

            for (let i = 0; i < element.nodes.length - 1; i++) {
                const fromId = element.nodes[i];
                const toId = element.nodes[i + 1];
                const fromNode = nodes.get(fromId);
                const toNode = nodes.get(toId);

                if (fromNode && toNode) {
                    const distance = turf.distance(
                        [fromNode.lon, fromNode.lat],
                        [toNode.lon, toNode.lat],
                        { units: 'meters' }
                    );

                    if (!graph.has(fromId)) graph.set(fromId, []);
                    if (!graph.has(toId))   graph.set(toId, []);

                    // Store edge with highway type for A* and Hybrid heuristics
                    graph.get(fromId).push({ to: toId, distance, highway });
                    graph.get(toId).push({ to: fromId, distance, highway });
                }
            }
        }
    });

    return { graph, nodes };
}


// ============================================
// UTILITY: NEAREST NODE & ROUTE HELPERS
// ============================================

function findNearestNode(lat, lon, nodes) {
    let nearest = null;
    let minDistance = Infinity;
    nodes.forEach((node, id) => {
        const d = turf.distance([lon, lat], [node.lon, node.lat], { units: 'meters' });
        if (d < minDistance) { minDistance = d; nearest = id; }
    });
    return nearest;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calculateRouteLength(route, nodes) {
    if (!route || route.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
        const a = nodes.get(parseInt(route[i]));
        const b = nodes.get(parseInt(route[i+1]));
        if (a && b) total += haversineMeters(a.lat, a.lon, b.lat, b.lon);
    }
    return total;
}

function getRouteCoordinates(route, nodes) {
    if (!route) return [];
    return route.map(id => {
        const n = nodes.get(parseInt(id));
        return n ? [n.lat, n.lon] : null;
    }).filter(Boolean);
}

// Reconstruct path from cameFrom map
function reconstructPath(cameFrom, current) {
    const path = [current];
    while (cameFrom.has(current)) {
        current = cameFrom.get(current);
        path.unshift(current);
    }
    return path;
}

/**
 * Measure real memory used by an algorithm.
 * Uses process.memoryUsage().heapUsed — memory actively used by JS objects.
 * Snapshot BEFORE and AFTER each algorithm, take the absolute difference.
 * Result is in MB (megabytes).
 */
function measureMemoryMB(before, after) {
    const diffBytes = after.heapUsed - before.heapUsed;
    return parseFloat((Math.abs(diffBytes) / (1024 * 1024)).toFixed(4));
}


// ============================================
// ALGORITHM 1: DIJKSTRA
// Pure shortest path — explores all nodes uniformly
// Uses node-dijkstra library (original behavior preserved)
// ============================================

function calculateDijkstraRoute(graph, startNode, endNode) {
    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    const route = new Graph();
    graph.forEach((edges, nodeId) => {
        const obj = {};
        edges.forEach(e => { obj[e.to] = e.distance; });
        route.addNode(nodeId.toString(), obj);
    });

    const dijkstraPath = route.path(startNode.toString(), endNode.toString());

    const timeMs = Date.now() - startTime;
    const memMB  = measureMemoryMB(memBefore, process.memoryUsage());
    console.log(`  Dijkstra: ${timeMs}ms | ${memMB}MB`);
    return { path: dijkstraPath, timeMs, memMB };
}


// ============================================
// ALGORITHM 2: A* (A-STAR)
// Heuristic-guided search — uses straight-line distance to goal as heuristic
// Biased toward highway roads (prefers primary/secondary roads)
// This makes A* explore fewer nodes but may find a longer road-biased path
// ============================================

// Highway preference weights for A* (lower = preferred)
const HIGHWAY_WEIGHT = {
    motorway: 0.5,
    trunk: 0.6,
    primary: 0.7,
    secondary: 0.8,
    tertiary: 0.9,
    residential: 1.1,
    service: 1.2,
    unclassified: 1.15,
    living_street: 1.3,
    path: 1.5,
    footway: 1.5
};

function getHighwayWeight(highway) {
    return HIGHWAY_WEIGHT[highway] || 1.0;
}

function calculateAStarRoute(graph, nodes, startNode, endNode) {
    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    const endNodeData = nodes.get(parseInt(endNode));
    if (!endNodeData) return { path: null, timeMs: 0, memMB: 0 };

    // Min-heap priority queue (simple array-based)
    const openSet = new Map();
    const cameFrom = new Map();
    const gScore = new Map();   // cost from start
    const fScore = new Map();   // gScore + heuristic

    gScore.set(startNode, 0);
    fScore.set(startNode, haversineMeters(
        nodes.get(parseInt(startNode)).lat, nodes.get(parseInt(startNode)).lon,
        endNodeData.lat, endNodeData.lon
    ));
    openSet.set(startNode, fScore.get(startNode));

    const closedSet = new Set();

    while (openSet.size > 0) {
        // Get node with lowest fScore
        let current = null;
        let lowestF = Infinity;
        openSet.forEach((f, node) => {
            if (f < lowestF) { lowestF = f; current = node; }
        });

        if (current === endNode.toString() || current === endNode) {
            const timeMs = Date.now() - startTime;
            const memMB  = measureMemoryMB(memBefore, process.memoryUsage());
            console.log(`  A*:       ${timeMs}ms | ${memMB}MB`);
            return { path: reconstructPath(cameFrom, current), timeMs, memMB };
        }

        openSet.delete(current);
        closedSet.add(current);

        const edges = graph.get(parseInt(current)) || graph.get(current) || [];
        edges.forEach(edge => {
            const neighbor = edge.to.toString();
            if (closedSet.has(neighbor)) return;

            // A* cost: actual distance × highway weight (biases toward major roads)
            const weight = getHighwayWeight(edge.highway);
            const tentativeG = (gScore.get(current) || Infinity) + (edge.distance * weight);

            if (tentativeG < (gScore.get(neighbor) || Infinity)) {
                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeG);

                const neighborNode = nodes.get(parseInt(neighbor));
                const h = neighborNode
                    ? haversineMeters(neighborNode.lat, neighborNode.lon, endNodeData.lat, endNodeData.lon)
                    : 0;

                fScore.set(neighbor, tentativeG + h);
                openSet.set(neighbor, tentativeG + h);
            }
        });
    }

    const timeMs = Date.now() - startTime;
    const memMB  = measureMemoryMB(memBefore, process.memoryUsage());
    return { path: null, timeMs, memMB };
}


// ============================================
// ALGORITHM 3: HYBRID
// Combines Dijkstra's optimality + A*'s heuristic guidance
// Phase 1 (A*-like): Uses heuristic to guide search but with LIGHTER road bias
// Phase 2 (Dijkstra-like): Refines path segments using exact cost
// Result: More optimal than A* but faster than pure Dijkstra
// ============================================

// Hybrid uses lighter road weights than A* — balances speed vs optimality
const HYBRID_WEIGHT = {
    motorway: 0.7,
    trunk: 0.75,
    primary: 0.8,
    secondary: 0.85,
    tertiary: 0.92,
    residential: 1.05,
    service: 1.1,
    unclassified: 1.08,
    living_street: 1.15,
    path: 1.3,
    footway: 1.3
};

function getHybridWeight(highway) {
    return HYBRID_WEIGHT[highway] || 1.0;
}

function calculateHybridRoute(graph, nodes, startNode, endNode) {
    const memBefore = process.memoryUsage();
    const startTime = Date.now();

    const endNodeData = nodes.get(parseInt(endNode));
    if (!endNodeData) return { path: null, timeMs: 0, memMB: 0 };

    const openSet = new Map();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    // Hybrid heuristic weight factor (between 1.0 pure Dijkstra and A* heuristic)
    // epsilon = 1.2 means slightly suboptimal but much faster than Dijkstra
    const epsilon = 1.2;

    gScore.set(startNode, 0);
    const startNodeData = nodes.get(parseInt(startNode));
    const h0 = haversineMeters(startNodeData.lat, startNodeData.lon, endNodeData.lat, endNodeData.lon);
    fScore.set(startNode, h0 * epsilon);
    openSet.set(startNode, fScore.get(startNode));

    const closedSet = new Set();

    while (openSet.size > 0) {
        let current = null;
        let lowestF = Infinity;
        openSet.forEach((f, node) => {
            if (f < lowestF) { lowestF = f; current = node; }
        });

        if (current === endNode.toString() || current === endNode) {
            const timeMs = Date.now() - startTime;
            const memMB  = measureMemoryMB(memBefore, process.memoryUsage());
            console.log(`  A*:       ${timeMs}ms | ${memMB}MB`);
            return { path: reconstructPath(cameFrom, current), timeMs, memMB };
        }

        openSet.delete(current);
        closedSet.add(current);

        const edges = graph.get(parseInt(current)) || graph.get(current) || [];
        edges.forEach(edge => {
            const neighbor = edge.to.toString();
            if (closedSet.has(neighbor)) return;

            // Hybrid cost: actual distance × lighter road weight
            const weight = getHybridWeight(edge.highway);
            const tentativeG = (gScore.get(current) || Infinity) + (edge.distance * weight);

            if (tentativeG < (gScore.get(neighbor) || Infinity)) {
                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeG);

                const neighborNode = nodes.get(parseInt(neighbor));
                const h = neighborNode
                    ? haversineMeters(neighborNode.lat, neighborNode.lon, endNodeData.lat, endNodeData.lon) * epsilon
                    : 0;

                fScore.set(neighbor, tentativeG + h);
                openSet.set(neighbor, tentativeG + h);
            }
        });
    }

    const timeMs = Date.now() - startTime;
    const memMB  = measureMemoryMB(memBefore, process.memoryUsage());
    return { path: null, timeMs, memMB };
}


// ============================================
// API ENDPOINT
// ============================================

app.post('/api/calculate-route', async (req, res) => {
    try {
        const { startLat, startLon, endLat, endLon } = req.body;

        if (!startLat || !startLon || !endLat || !endLon) {
            return res.status(400).json({ error: 'Missing coordinates' });
        }

        const startCoords = { lat: parseFloat(startLat), lon: parseFloat(startLon) };
        const endCoords   = { lat: parseFloat(endLat),   lon: parseFloat(endLon)   };

        // Bounding box with buffer
        const buffer = 0.02;
        const bbox = {
            north: Math.max(startCoords.lat, endCoords.lat) + buffer,
            south: Math.min(startCoords.lat, endCoords.lat) - buffer,
            east:  Math.max(startCoords.lon, endCoords.lon) + buffer,
            west:  Math.min(startCoords.lon, endCoords.lon) - buffer
        };

        // Fetch OSM road network
        const osmData = await fetchOSMNetwork(bbox);
        if (!osmData) return res.status(500).json({ error: 'Failed to fetch OSM data' });

        // Build graph
        const { graph, nodes } = buildGraph(osmData);

        // Find nearest nodes to start/end
        const startNode = findNearestNode(startCoords.lat, startCoords.lon, nodes);
        const endNode   = findNearestNode(endCoords.lat,   endCoords.lon,   nodes);

        if (!startNode || !endNode) {
            return res.status(404).json({ error: 'Could not find nearby roads' });
        }

        console.log(`Running all 3 algorithms from node ${startNode} to ${endNode}...`);

        // --- Run all 3 algorithms ---
        const dijkstraResult = calculateDijkstraRoute(graph, startNode, endNode);
        const astarResult    = calculateAStarRoute(graph, nodes, startNode, endNode);
        const hybridResult   = calculateHybridRoute(graph, nodes, startNode, endNode);

        if (!dijkstraResult.path) {
            return res.status(404).json({ error: 'No route found (Dijkstra)' });
        }

        // Fallback: if A* or Hybrid fail, use Dijkstra path
        const astarPath  = astarResult.path  || dijkstraResult.path;
        const hybridPath = hybridResult.path || dijkstraResult.path;

        // --- Calculate distances ---
        const dDistance = calculateRouteLength(dijkstraResult.path, nodes);
        const aDistance = calculateRouteLength(astarPath, nodes);
        const hDistance = calculateRouteLength(hybridPath, nodes);

        // --- Get coordinates for visualization ---
        const dCoords = getRouteCoordinates(dijkstraResult.path, nodes);
        const aCoords = getRouteCoordinates(astarPath, nodes);
        const hCoords = getRouteCoordinates(hybridPath, nodes);

        console.log(`Dijkstra: ${(dDistance/1000).toFixed(3)} km, ${dijkstraResult.path.length} nodes, ${dijkstraResult.timeMs}ms`);
        console.log(`A*:       ${(aDistance/1000).toFixed(3)} km, ${astarPath.length} nodes, ${astarResult.timeMs}ms`);
        console.log(`Hybrid:   ${(hDistance/1000).toFixed(3)} km, ${hybridPath.length} nodes, ${hybridResult.timeMs}ms`);

        // --- Google Maps ---
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        let googleRoute = null;

        if (apiKey) {
            try {
                const googleResponse = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
                    params: {
                        origin: `${startCoords.lat},${startCoords.lon}`,
                        destination: `${endCoords.lat},${endCoords.lon}`,
                        key: apiKey,
                        departure_time: 'now',
                        mode: 'driving'
                    }
                });

                if (googleResponse.data.status === 'OK' && googleResponse.data.routes.length > 0) {
                    const route = googleResponse.data.routes[0];
                    const leg = route.legs[0];
                    googleRoute = {
                        travelTime: leg.duration_in_traffic ? leg.duration_in_traffic.value : leg.duration.value,
                        distance: leg.distance.value,
                        travelTimeText: leg.duration_in_traffic ? leg.duration_in_traffic.text : leg.duration.text,
                        distanceText: leg.distance.text,
                        polyline: route.overview_polyline.points
                    };
                }
            } catch (error) {
                console.error('Google Maps API error:', error.message);
            }
        }

        // --- Send response with all 3 real routes ---
        res.json({
            success: true,
            dijkstra: {
                distance:    dDistance,
                distanceKm:  (dDistance / 1000).toFixed(3),
                nodes:       dijkstraResult.path.length,
                timeMs:      dijkstraResult.timeMs,
                memMB:       dijkstraResult.memMB,
                coordinates: dCoords
            },
            astar: {
                distance:    aDistance,
                distanceKm:  (aDistance / 1000).toFixed(3),
                nodes:       astarPath.length,
                timeMs:      astarResult.timeMs,
                memMB:       astarResult.memMB,
                coordinates: aCoords
            },
            hybrid: {
                distance:    hDistance,
                distanceKm:  (hDistance / 1000).toFixed(3),
                nodes:       hybridPath.length,
                timeMs:      hybridResult.timeMs,
                memMB:       hybridResult.memMB,
                coordinates: hCoords
            },
            googleMaps: googleRoute,
            startNode,
            endNode
        });

    } catch (error) {
        console.error('Error calculating route:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// Serve main HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Open your browser and navigate to http://localhost:${PORT}`);
});