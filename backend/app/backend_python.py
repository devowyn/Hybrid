"""
Python FastAPI Backend for Routing Calculator
Implements Dijkstra, A*, and Hybrid algorithms using real OSM data
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
import geopandas as gpd
import pandas as pd
from bs4 import BeautifulSoup
import osmnx as ox
import networkx as nx
import time
import tracemalloc
import psutil
import os
from pathlib import Path
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================
# CONFIGURATION
# ============================================

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

# Graph settings
GRAPH_CENTER = (16.42271, 120.59911)  # Baguio City
GRAPH_RADIUS = 1100  # meters

# CORS settings
ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

# ============================================
# GLOBAL VARIABLES
# ============================================

G = None  # OSM Graph
kmz_roads = None  # KMZ road data
penalty_lookup = {}  # Edge penalties


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class RouteRequest(BaseModel):
    startLat: float
    startLon: float
    endLat: float
    endLon: float


class AlgorithmResult(BaseModel):
    distanceKm: str
    timeMs: str
    nodes: int
    coordinates: list
    qualityScore: float
    peakMemoryMb: float


class RouteResponse(BaseModel):
    success: bool
    dijkstra: AlgorithmResult
    astar: AlgorithmResult
    hybrid: AlgorithmResult
    metadata: dict


# ============================================
# UTILITY FUNCTIONS
# ============================================

def get_memory_usage():
    """Get current memory usage in MB"""
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024


def parse_description(html):
    """Parse KMZ HTML description"""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.find_all("tr")
    data = {}
    for row in rows:
        cells = row.find_all("td")
        if len(cells) == 2:
            key = cells[0].get_text(strip=True).upper()
            value = cells[1].get_text(strip=True)
            data[key] = value if value else None
    return data


def width_penalty(width, length):
    """Calculate penalty based on road width"""
    if pd.isna(width) or pd.isna(length):
        return 0
    elif width < 1.75:
        return length * 10
    elif width < 2.5:
        return length * 0.2
    else:
        return 0


# ============================================
# GRAPH INITIALIZATION
# ============================================

def load_kmz_files():
    """Load and parse KMZ files"""
    global kmz_roads
    
    logger.info("Loading KMZ files...")
    
    kmz_files = {
        "alley": DATA_DIR / "Alley.kmz",
        "barangay": DATA_DIR / "Barangay Road.kmz",
        "city": DATA_DIR / "City Road.kmz",
        "national": DATA_DIR / "National Road.kmz"
    }
    
    dataframes = []
    for name, filepath in kmz_files.items():
        if filepath.exists():
            logger.info(f"   Loading {filepath.name}...")
            try:
                gdf = gpd.read_file(filepath, driver="KML")
                dataframes.append(gdf)
            except Exception as e:
                logger.warning(f"   Failed to load {filepath.name}: {e}")
        else:
            logger.warning(f"   {filepath.name} not found")
    
    if dataframes:
        kmz_roads = gpd.GeoDataFrame(pd.concat(dataframes, ignore_index=True))
        
        # Parse descriptions
        parsed = kmz_roads["description"].apply(parse_description)
        parsed_df = pd.DataFrame(parsed.tolist())
        kmz_roads = pd.concat([kmz_roads, parsed_df], axis=1)
        
        # Convert columns
        kmz_roads["RANGE_FROM"] = pd.to_numeric(kmz_roads["RANGE_FROM"], errors="coerce")
        kmz_roads["LENGTH_MAP"] = pd.to_numeric(kmz_roads["LENGTH_MAP"], errors="coerce")
        
        # Calculate penalties
        kmz_roads["width_penalty"] = kmz_roads.apply(
            lambda row: width_penalty(row["RANGE_FROM"], row["LENGTH_MAP"]), axis=1
        )
        
        logger.info(f"✅ Loaded {len(kmz_roads)} KMZ road segments")
    else:
        logger.warning("⚠️  No KMZ files loaded")


def build_graph():
    """Build OSM graph and apply cost models"""
    global G, penalty_lookup
    
    logger.info(f"Building OSM graph (center: {GRAPH_CENTER}, radius: {GRAPH_RADIUS}m)...")
    
    # Download OSM data
    G = ox.graph_from_point(GRAPH_CENTER, dist=GRAPH_RADIUS, network_type="drive")
    
    logger.info(f"   Nodes: {G.number_of_nodes()}, Edges: {G.number_of_edges()}")
    
    # Apply KMZ penalties if available
    if kmz_roads is not None:
        logger.info("Applying KMZ penalties...")
        edges = ox.graph_to_gdfs(G, nodes=False, edges=True).reset_index()
        edges = edges.to_crs(kmz_roads.crs)
        
        edges_with_penalty = gpd.sjoin(
            edges, kmz_roads[["geometry", "width_penalty"]], 
            how="left", predicate="intersects"
        )
        edges_with_penalty["width_penalty"] = edges_with_penalty["width_penalty"].fillna(0)
        edges_with_penalty["cost"] = edges_with_penalty["length"] + edges_with_penalty["width_penalty"]
        
        penalty_lookup = edges_with_penalty.set_index(["u", "v", "key"])["cost"].to_dict()
    
    # Apply cost models to all edges
    logger.info("Applying cost models...")
    apply_cost_models()
    
    logger.info("✅ Graph ready")


def apply_cost_models():
    """Apply Dijkstra, A*, and Hybrid cost models to graph edges"""
    global G
    
    for u, v, k, data in G.edges(keys=True, data=True):
        base_length = data.get("length", 1)
        base_cost = penalty_lookup.get((u, v, k), base_length)
        
        highway_type = data.get('highway', 'residential')
        if isinstance(highway_type, list):
            highway_type = highway_type[0]
        
        # Get lanes
        lanes = 1
        if 'lanes' in data:
            try:
                lanes = int(data['lanes']) if not isinstance(data['lanes'], list) else int(data['lanes'][0])
            except:
                lanes = 1
        
        # Get max speed
        max_speed = 30
        if 'maxspeed' in data:
            try:
                speed = data['maxspeed']
                if isinstance(speed, list):
                    speed = speed[0]
                max_speed = int(str(speed).replace(' kph', '').replace(' mph', ''))
            except:
                max_speed = 30
        
        # === DIJKSTRA: Pure distance ===
        data["dijkstra_cost"] = base_length
        
        # === A*: Highway-biased ===
        astar_factor = 1.0
        if highway_type in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            astar_factor = 0.3
        elif highway_type in ['secondary', 'secondary_link']:
            astar_factor = 0.6
        elif highway_type in ['tertiary', 'tertiary_link']:
            astar_factor = 1.0
        elif highway_type in ['residential']:
            astar_factor = 1.8
        elif highway_type in ['service', 'unclassified']:
            astar_factor = 2.5
        
        data["astar_cost"] = base_length * astar_factor
        
        # === HYBRID: Adaptive intelligent ===
        hybrid_cost = base_length
        
        # 1. Road type intelligence
        if highway_type in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            if base_length > 100:
                hybrid_cost *= 0.95
            else:
                hybrid_cost *= 0.98
        elif highway_type in ['secondary', 'secondary_link']:
            if base_length > 100:
                hybrid_cost *= 0.98
            else:
                hybrid_cost *= 0.99
        elif highway_type in ['tertiary', 'tertiary_link']:
            hybrid_cost *= 1.0
        elif highway_type in ['residential']:
            if base_length > 100:
                hybrid_cost *= 1.08
            else:
                hybrid_cost *= 1.02
        elif highway_type in ['service', 'unclassified']:
            if base_length > 50:
                hybrid_cost *= 1.15
            else:
                hybrid_cost *= 1.05
        
        # 2. Lane width quality
        if lanes >= 4:
            hybrid_cost *= 0.94
        elif lanes == 3:
            hybrid_cost *= 0.97
        elif lanes == 2:
            hybrid_cost *= 1.0
        elif lanes == 1:
            if base_length > 50:
                hybrid_cost *= 1.06
            else:
                hybrid_cost *= 1.02
        
        # 3. Speed-based efficiency
        if max_speed >= 60:
            hybrid_cost *= 0.92
        elif max_speed >= 50:
            hybrid_cost *= 0.96
        elif max_speed >= 40:
            hybrid_cost *= 0.99
        elif max_speed >= 30:
            hybrid_cost *= 1.0
        else:
            hybrid_cost *= 1.08
        
        # 4. Width penalties
        width_penalty_amount = base_cost - base_length
        if width_penalty_amount > base_length * 3:
            hybrid_cost *= 1.10
        elif width_penalty_amount > base_length:
            hybrid_cost *= 1.03
        
        # 5. Turn complexity
        if base_length < 15:
            hybrid_cost *= 1.04
        elif base_length < 30:
            hybrid_cost *= 1.01
        
        data["hybrid_cost"] = hybrid_cost


# ============================================
# ALGORITHM FUNCTIONS
# ============================================

def route_length(route, G):
    """Calculate total route length"""
    return sum(G[u][v][0].get("length", 0) for u, v in zip(route[:-1], route[1:]))


def route_cost(route, G, cost_attr):
    """Calculate total route cost"""
    total = 0
    for u, v in zip(route[:-1], route[1:]):
        edge_data = G[u][v][0]
        total += edge_data.get(cost_attr, edge_data.get("length", 0))
    return total


def calculate_quality_score(route, G):
    """Calculate route quality score (0-100)"""
    score = 100.0
    total_length = 0
    
    for u, v in zip(route[:-1], route[1:]):
        edge = G[u][v][0]
        length = edge.get('length', 0)
        total_length += length
        
        highway = edge.get('highway', 'residential')
        if isinstance(highway, list):
            highway = highway[0]
        
        # Score adjustments
        if highway in ['primary', 'primary_link', 'trunk', 'trunk_link']:
            score += (length / total_length if total_length > 0 else 0) * 10
        elif highway in ['service', 'unclassified']:
            score -= (length / total_length if total_length > 0 else 0) * 20
        elif highway in ['residential']:
            score -= (length / total_length if total_length > 0 else 0) * 8
        
        # Width penalty
        road_quality = edge.get('road_quality', 1.0)
        if road_quality > 1.05:
            score -= (length / total_length if total_length > 0 else 0) * 12
        
        # Turn penalty
        if length < 20:
            score -= 0.5
    
    return max(0, min(100, score))


def euclidean_heuristic(u, v, G):
    """Euclidean distance heuristic for A*"""
    x1, y1 = G.nodes[u]['x'], G.nodes[u]['y']
    x2, y2 = G.nodes[v]['x'], G.nodes[v]['y']
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5


def get_route_coordinates(route, G):
    """Convert route to lat/lon coordinates"""
    coords = []
    for node in route:
        coords.append([G.nodes[node]['y'], G.nodes[node]['x']])
    return coords


def calculate_dijkstra(origin, destination):
    """Run Dijkstra algorithm"""
    logger.info("Running Dijkstra...")
    
    tracemalloc.start()
    mem_before = get_memory_usage()
    start_time = time.time()
    
    route = nx.shortest_path(G, origin, destination, weight="dijkstra_cost", method="dijkstra")
    
    end_time = time.time()
    mem_after = get_memory_usage()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    
    length = route_length(route, G)
    quality = calculate_quality_score(route, G)
    coords = get_route_coordinates(route, G)
    
    return {
        "distanceKm": f"{length / 1000:.4f}",
        "timeMs": f"{(end_time - start_time) * 1000:.2f}",
        "nodes": len(route),
        "coordinates": coords,
        "qualityScore": round(quality, 1),
        "peakMemoryMb": round(peak / 1024 / 1024, 2)
    }


def calculate_astar(origin, destination):
    """Run A* algorithm"""
    logger.info("Running A*...")
    
    tracemalloc.start()
    mem_before = get_memory_usage()
    start_time = time.time()
    
    route = nx.astar_path(
        G, origin, destination,
        heuristic=lambda u, v: euclidean_heuristic(u, v, G),
        weight="astar_cost"
    )
    
    end_time = time.time()
    mem_after = get_memory_usage()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    
    length = route_length(route, G)
    quality = calculate_quality_score(route, G)
    coords = get_route_coordinates(route, G)
    
    return {
        "distanceKm": f"{length / 1000:.4f}",
        "timeMs": f"{(end_time - start_time) * 1000:.2f}",
        "nodes": len(route),
        "coordinates": coords,
        "qualityScore": round(quality, 1),
        "peakMemoryMb": round(peak / 1024 / 1024, 2)
    }


def calculate_hybrid(origin, destination):
    """Run Hybrid algorithm"""
    logger.info("Running Hybrid...")
    
    tracemalloc.start()
    mem_before = get_memory_usage()
    start_time = time.time()
    
    route = nx.astar_path(
        G, origin, destination,
        heuristic=lambda u, v: euclidean_heuristic(u, v, G) * 1.0,
        weight="hybrid_cost"
    )
    
    end_time = time.time()
    mem_after = get_memory_usage()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    
    length = route_length(route, G)
    quality = calculate_quality_score(route, G)
    coords = get_route_coordinates(route, G)
    
    return {
        "distanceKm": f"{length / 1000:.4f}",
        "timeMs": f"{(end_time - start_time) * 1000:.2f}",
        "nodes": len(route),
        "coordinates": coords,
        "qualityScore": round(quality, 1),
        "peakMemoryMb": round(peak / 1024 / 1024, 2)
    }


# ============================================
# FASTAPI APP
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    logger.info("=" * 70)
    logger.info("🚀 STARTING ROUTING CALCULATOR BACKEND")
    logger.info("=" * 70)
    
    # Load KMZ files
    try:
        load_kmz_files()
    except Exception as e:
        logger.warning(f"Could not load KMZ files: {e}")
    
    # Build graph
    build_graph()
    
    logger.info("✅ Backend ready!")
    
    yield
    
    logger.info("Shutting down...")


app = FastAPI(title="Routing Calculator API", lifespan=lifespan)

# Add CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# API ENDPOINTS
# ============================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "OK",
        "graph_nodes": G.number_of_nodes() if G else 0,
        "graph_edges": G.number_of_edges() if G else 0
    }


@app.get("/api/road-network")
async def get_road_network():
    """
    Returns all road edges in the loaded OSM graph as coordinate arrays.
    Each edge is a list of [lat, lon] pairs representing the road geometry.
    The frontend uses this to draw the real road map on the canvas.
    """
    if G is None:
        raise HTTPException(status_code=503, detail="Graph not loaded")

    edges_data = []
    for u, v, data in G.edges(data=True):
        # Use the 'geometry' attribute if available (gives curved road shape)
        # Otherwise fall back to straight line between the two nodes
        if 'geometry' in data:
            coords = [[lat, lon] for lon, lat in data['geometry'].coords]
        else:
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            coords = [
                [u_data['y'], u_data['x']],
                [v_data['y'], v_data['x']]
            ]
        edges_data.append(coords)

    return {
        "edges": edges_data,
        "node_count": G.number_of_nodes(),
        "edge_count": G.number_of_edges()
    }


@app.post("/api/calculate-route")
async def calculate_route(request: RouteRequest):
    """Calculate routes using all three algorithms"""
    try:
        logger.info(f"📍 Route request: ({request.startLat}, {request.startLon}) → ({request.endLat}, {request.endLon})")
        
        # Find nearest nodes
        origin = ox.nearest_nodes(G, request.startLon, request.startLat)
        destination = ox.nearest_nodes(G, request.endLon, request.endLat)
        
        # Calculate all routes
        dijkstra_result = calculate_dijkstra(origin, destination)
        astar_result = calculate_astar(origin, destination)
        hybrid_result = calculate_hybrid(origin, destination)
        
        logger.info("✅ Routes calculated successfully")
        
        return {
            "success": True,
            "dijkstra": dijkstra_result,
            "astar": astar_result,
            "hybrid": hybrid_result,
            "metadata": {
                "graph_nodes": G.number_of_nodes(),
                "graph_edges": G.number_of_edges()
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# RUN SERVER
# ============================================

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "backend_python:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
