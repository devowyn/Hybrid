const express = require('express');
const cors = require('cors');
const axios = require('axios');
const turf = require('@turf/turf');
const Graph = require('node-dijkstra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static HTML files

// Fetch road network from OpenStreetMap using Overpass API
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

// Build graph from OSM data
function buildGraph(osmData) {
    const graph = new Map();
    const nodes = new Map();
    
    // Store all nodes
    osmData.elements.forEach(element => {
        if (element.type === 'node') {
            nodes.set(element.id, {
                lat: element.lat,
                lon: element.lon
            });
        }
    });
    
    // Build graph from ways
    osmData.elements.forEach(element => {
        if (element.type === 'way' && element.nodes) {
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
                    
                    if (!graph.has(fromId)) {
                        graph.set(fromId, {});
                    }
                    if (!graph.has(toId)) {
                        graph.set(toId, {});
                    }
                    
                    graph.get(fromId)[toId] = distance;
                    graph.get(toId)[fromId] = distance;
                }
            }
        }
    });
    
    return { graph, nodes };
}

// Find nearest node to coordinates
function findNearestNode(lat, lon, nodes) {
    let nearest = null;
    let minDistance = Infinity;
    
    nodes.forEach((node, id) => {
        const distance = turf.distance(
            [lon, lat],
            [node.lon, node.lat],
            { units: 'meters' }
        );
        
        if (distance < minDistance) {
            minDistance = distance;
            nearest = id;
        }
    });
    
    return nearest;
}

// Calculate route using Dijkstra
function calculateDijkstraRoute(graph, start, end) {
    const route = new Graph();
    
    const graphObj = {};
    graph.forEach((edges, nodeId) => {
        graphObj[nodeId] = edges;
    });
    
    Object.keys(graphObj).forEach(node => {
        route.addNode(node, graphObj[node]);
    });
    
    return route.path(start.toString(), end.toString());
}

// Calculate route length
function calculateRouteLength(route, nodes) {
    if (!route || route.length < 2) return 0;
    
    let totalLength = 0;
    for (let i = 0; i < route.length - 1; i++) {
        const fromNode = nodes.get(parseInt(route[i]));
        const toNode = nodes.get(parseInt(route[i + 1]));
        
        if (fromNode && toNode) {
            const distance = turf.distance(
                [fromNode.lon, fromNode.lat],
                [toNode.lon, toNode.lat],
                { units: 'meters' }
            );
            totalLength += distance;
        }
    }
    
    return totalLength;
}

// Get route coordinates for display
function getRouteCoordinates(route, nodes) {
    if (!route) return [];
    
    return route.map(nodeId => {
        const node = nodes.get(parseInt(nodeId));
        return node ? [node.lat, node.lon] : null;
    }).filter(coord => coord !== null);
}

// API endpoint to calculate route
app.post('/api/calculate-route', async (req, res) => {
    try {
        const { startLat, startLon, endLat, endLon } = req.body;
        
        if (!startLat || !startLon || !endLat || !endLon) {
            return res.status(400).json({ error: 'Missing coordinates' });
        }
        
        const startCoords = { lat: parseFloat(startLat), lon: parseFloat(startLon) };
        const endCoords = { lat: parseFloat(endLat), lon: parseFloat(endLon) };
        
        // Create bounding box
        const buffer = 0.02;
        const bbox = {
            north: Math.max(startCoords.lat, endCoords.lat) + buffer,
            south: Math.min(startCoords.lat, endCoords.lat) - buffer,
            east: Math.max(startCoords.lon, endCoords.lon) + buffer,
            west: Math.min(startCoords.lon, endCoords.lon) - buffer
        };
        
        // Fetch OSM network
        const osmData = await fetchOSMNetwork(bbox);
        
        if (!osmData) {
            return res.status(500).json({ error: 'Failed to fetch OSM data' });
        }
        
        // Build graph
        const { graph, nodes } = buildGraph(osmData);
        
        // Find nearest nodes
        const startNode = findNearestNode(startCoords.lat, startCoords.lon, nodes);
        const endNode = findNearestNode(endCoords.lat, endCoords.lon, nodes);
        
        if (!startNode || !endNode) {
            return res.status(404).json({ error: 'Could not find nearby roads' });
        }
        
        // Calculate route using Dijkstra
        const dijkstraRoute = calculateDijkstraRoute(graph, startNode, endNode);
        
        if (!dijkstraRoute) {
            return res.status(404).json({ error: 'No route found' });
        }
        
        const routeLength = calculateRouteLength(dijkstraRoute, nodes);
        const routeCoordinates = getRouteCoordinates(dijkstraRoute, nodes);
        
        // Get Google Maps route
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
        
        res.json({
            success: true,
            dijkstra: {
                distance: routeLength,
                distanceKm: (routeLength / 1000).toFixed(2),
                nodes: dijkstraRoute.length,
                coordinates: routeCoordinates
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

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Open your browser and navigate to http://localhost:${PORT}`);
});
